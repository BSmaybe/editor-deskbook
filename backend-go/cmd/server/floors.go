package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type floorStore struct {
	pool *pgxpool.Pool
}

func newFloorStore(ctx context.Context, databaseURL string) (*floorStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &floorStore{pool: pool}, nil
}

func (s *floorStore) close() { s.pool.Close() }

type floorRow struct {
	ID       int     `json:"id"`
	OfficeID int     `json:"office_id"`
	Name     string  `json:"name"`
	PlanURL  *string `json:"plan_url"`
}

func (s *floorStore) list(ctx context.Context, officeID *int) ([]floorRow, error) {
	var query string
	var args []any
	if officeID != nil {
		query = `SELECT id, office_id, name, plan_url FROM floors WHERE office_id = $1 ORDER BY id`
		args = []any{*officeID}
	} else {
		query = `SELECT id, office_id, name, plan_url FROM floors ORDER BY id`
	}
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []floorRow
	for rows.Next() {
		var f floorRow
		if err := rows.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL); err != nil {
			return nil, err
		}
		result = append(result, f)
	}
	return result, rows.Err()
}

func (s *floorStore) create(ctx context.Context, officeID int, name string) (*floorRow, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM offices WHERE id = $1)`, officeID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("office not found")
	}
	row := s.pool.QueryRow(ctx,
		`INSERT INTO floors (office_id, name) VALUES ($1, $2) RETURNING id, office_id, name, plan_url`,
		officeID, name)
	var f floorRow
	err = row.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL)
	return &f, err
}

func (s *floorStore) update(ctx context.Context, id int, name *string) (*floorRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE floors SET name = COALESCE($2, name) WHERE id = $1
		 RETURNING id, office_id, name, plan_url`, id, name)
	var f floorRow
	err := row.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &f, err
}

func (s *floorStore) setPlanURL(ctx context.Context, id int, planURL string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE floors SET plan_url = $2 WHERE id = $1`, id, planURL)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *floorStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM floors WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- Handlers ---

func (app *appServer) listFloorsHandler(w http.ResponseWriter, r *http.Request) {
	if app.floors == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	var officeID *int
	if v := r.URL.Query().Get("office_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid office_id"))
			return
		}
		officeID = &id
	}
	floors, err := app.floors.list(r.Context(), officeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if floors == nil {
		floors = []floorRow{}
	}
	writeJSON(w, http.StatusOK, floors)
}

func (app *appServer) createFloorHandler(w http.ResponseWriter, r *http.Request) {
	if app.floors == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	var p struct {
		OfficeID int    `json:"office_id"`
		Name     string `json:"name"`
	}
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if p.Name == "" || p.OfficeID == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("office_id and name are required"))
		return
	}
	floor, err := app.floors.create(r.Context(), p.OfficeID, p.Name)
	if err != nil {
		if strings.Contains(err.Error(), "office not found") {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, floor)
}

func (app *appServer) updateFloorHandler(w http.ResponseWriter, r *http.Request) {
	if app.floors == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("floor_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid floor_id"))
		return
	}
	var p struct {
		Name *string `json:"name"`
	}
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	floor, err := app.floors.update(r.Context(), id, p.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if floor == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
		return
	}
	writeJSON(w, http.StatusOK, floor)
}

func (app *appServer) deleteFloorHandler(w http.ResponseWriter, r *http.Request) {
	if app.floors == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("floor_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid floor_id"))
		return
	}
	if err := app.floors.delete(r.Context(), id); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (app *appServer) uploadFloorPlanHandler(w http.ResponseWriter, r *http.Request) {
	if app.floors == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("floor_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid floor_id"))
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid multipart form"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("file field required"))
		return
	}
	defer file.Close()

	staticDir := envDefault("STATIC_DIR", "static")
	if err := os.MkdirAll(staticDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".png"
	}
	filename := fmt.Sprintf("floor_%d_plan%s", id, ext)
	path := filepath.Join(staticDir, filename)
	dst, err := os.Create(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	planURL := "/static/" + filename
	if err := app.floors.setPlanURL(r.Context(), id, planURL); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"plan_url": planURL})
}
