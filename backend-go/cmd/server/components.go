package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"deskbook/backend-go/internal/exporter"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	errForbidden       = errors.New("admin role required")
	errAccountDisabled = errors.New("account is disabled")
	componentIDRE      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$`)
	assetTypes         = map[string]bool{
		"workplace": true, "desk": true, "chair": true, "meeting_table": true, "conference_set": true,
		"call_room": true, "lounge": true, "sofa": true, "plant": true, "storage": true,
		"printer": true, "reception": true, "column": true, "asset": true,
	}
	builtinComponentIDs = map[string]bool{
		"workplace-desk-chair": true, "chair": true, "desk-short": true, "desk-long": true,
		"sit-stand-desk": true, "bench-4": true, "meeting-table": true, "round-table": true,
		"conference-chair": true, "conference-set": true, "phone-booth": true, "focus-room": true,
		"sofa": true, "lounge-chair": true, "plant": true, "storage-cabinet": true,
		"locker-bank": true, "printer": true, "reception-desk": true, "column": true,
	}
)

type appServer struct {
	components *componentStore
	layouts    *layoutStore
	users      *userStore
	offices    *officeStore
	floors     *floorStore
	desks      *deskStore
	templates  *templateStore
	blocks     *blockStore
	invites    *inviteStore
}

type componentStore struct {
	pool *pgxpool.Pool
}

type componentPayload struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	AssetType string    `json:"asset_type"`
	ViewBox   []float64 `json:"view_box"`
	DefaultW  float64   `json:"default_w"`
	DefaultH  float64   `json:"default_h"`
	SVGMarkup string    `json:"svg_markup"`
}

type componentOut struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	AssetType string    `json:"asset_type"`
	ViewBox   []float64 `json:"view_box"`
	DefaultW  float64   `json:"default_w"`
	DefaultH  float64   `json:"default_h"`
	SVGMarkup string    `json:"svg_markup"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func newComponentStore(ctx context.Context, databaseURL string) (*componentStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	store := &componentStore{pool: pool}
	if err := store.ensureSchema(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *componentStore) close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *componentStore) ensureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS global_components (
			id          VARCHAR(120) PRIMARY KEY,
			label       VARCHAR(120) NOT NULL,
			asset_type  VARCHAR(30) NOT NULL DEFAULT 'asset',
			view_box    VARCHAR(100) NOT NULL DEFAULT '0 0 100 60',
			default_w   DOUBLE PRECISION NOT NULL DEFAULT 100,
			default_h   DOUBLE PRECISION NOT NULL DEFAULT 60,
			svg_markup  TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	return err
}

func (a *appServer) listComponentsHandler(w http.ResponseWriter, r *http.Request) {
	if a.components == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}
	rows, err := a.components.pool.Query(r.Context(), `
		SELECT id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
		FROM global_components
		ORDER BY label
	`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer rows.Close()

	out := []componentOut{}
	for rows.Next() {
		component, err := scanComponent(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, component)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *appServer) createComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	body, err := decodeComponentPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := validateComponentPayload(body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	// Creating a new component with a built-in ID is not allowed — use PUT to override.
	if builtinComponentIDs[body.ID] {
		writeError(w, http.StatusConflict, errors.New("component with this ID already exists"))
		return
	}
	if a.components == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}

	viewBox := viewBoxString(body.ViewBox)
	row := a.components.pool.QueryRow(r.Context(), `
		INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
	`, body.ID, body.Label, body.AssetType, viewBox, body.DefaultW, body.DefaultH, body.SVGMarkup)
	component, err := scanComponent(row)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			writeError(w, http.StatusConflict, errors.New("component with this ID already exists"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, component)
}

func (a *appServer) updateComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	componentID := strings.TrimSpace(r.PathValue("component_id"))
	body, err := decodeComponentPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.ID != componentID {
		writeError(w, http.StatusBadRequest, errors.New("component ID cannot be changed"))
		return
	}
	if err := validateComponentPayload(body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if a.components == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}

	// UPSERT: built-in components do not exist in the DB yet; this creates the
	// override row on the first save so subsequent PUTs work as plain updates.
	row := a.components.pool.QueryRow(r.Context(), `
		INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE
		  SET label=$2, asset_type=$3, view_box=$4, default_w=$5, default_h=$6, svg_markup=$7, updated_at=now()
		RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
	`, body.ID, body.Label, body.AssetType, viewBoxString(body.ViewBox), body.DefaultW, body.DefaultH, body.SVGMarkup)
	component, err := scanComponent(row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, component)
}

func (a *appServer) deleteComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	if a.components == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}
	componentID := strings.TrimSpace(r.PathValue("component_id"))
	result, err := a.components.pool.Exec(r.Context(), `DELETE FROM global_components WHERE id=$1`, componentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, errors.New("component not found"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

func decodeComponentPayload(r *http.Request) (componentPayload, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		return componentPayload{}, err
	}
	if len(raw) > maxBodyBytes {
		return componentPayload{}, fmt.Errorf("request body exceeds %d bytes", maxBodyBytes)
	}
	var body componentPayload
	if err := json.Unmarshal(raw, &body); err != nil {
		return componentPayload{}, err
	}
	return body, nil
}

func validateComponentPayload(body componentPayload) error {
	if !componentIDRE.MatchString(body.ID) {
		return errors.New("invalid component id")
	}
	if strings.TrimSpace(body.Label) == "" || len(body.Label) > 120 {
		return errors.New("label is required and must be at most 120 characters")
	}
	if !assetTypes[body.AssetType] {
		return errors.New("invalid asset_type")
	}
	if len(body.ViewBox) != 4 || body.ViewBox[2] <= 0 || body.ViewBox[3] <= 0 {
		return errors.New("view_box must be [x, y, width, height] with positive size")
	}
	if body.DefaultW <= 0 || body.DefaultW > 10000 || body.DefaultH <= 0 || body.DefaultH > 10000 {
		return errors.New("default size is out of range")
	}
	if err := exporter.ValidateSVGFragment(body.SVGMarkup); err != nil {
		return fmt.Errorf("unsafe svg_markup: %w", err)
	}
	return nil
}

func scanComponent(row pgx.Row) (componentOut, error) {
	var out componentOut
	var viewBox string
	err := row.Scan(&out.ID, &out.Label, &out.AssetType, &viewBox, &out.DefaultW, &out.DefaultH, &out.SVGMarkup, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return out, err
	}
	out.ViewBox = parseViewBoxString(viewBox)
	return out, nil
}

func parseViewBoxString(value string) []float64 {
	parts := strings.Fields(value)
	out := make([]float64, 0, 4)
	for _, part := range parts {
		n, err := strconv.ParseFloat(part, 64)
		if err == nil {
			out = append(out, n)
		}
	}
	if len(out) != 4 || out[2] <= 0 || out[3] <= 0 {
		return []float64{0, 0, 100, 60}
	}
	return out
}

func viewBoxString(value []float64) string {
	parts := make([]string, 4)
	for i := 0; i < 4; i++ {
		parts[i] = strconv.FormatFloat(value[i], 'f', -1, 64)
	}
	return strings.Join(parts, " ")
}

func writeAuthError(w http.ResponseWriter, err error) {
	if errors.Is(err, errForbidden) || errors.Is(err, errAccountDisabled) {
		writeError(w, http.StatusForbidden, err)
		return
	}
	writeError(w, http.StatusUnauthorized, err)
}
