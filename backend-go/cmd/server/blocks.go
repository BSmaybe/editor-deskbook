package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type blockStore struct {
	pool *pgxpool.Pool
}

func newBlockStore(ctx context.Context, databaseURL string) (*blockStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &blockStore{pool: pool}, nil
}

func (s *blockStore) close() { s.pool.Close() }

type layoutBlock struct {
	ID          int             `json:"id"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	Description string          `json:"description,omitempty"`
	Objects     json.RawMessage `json:"objects"` // array of desk-like objects
	PreviewSVG  string          `json:"preview_svg,omitempty"`
	CreatedAt   *time.Time      `json:"created_at,omitempty"`
	UpdatedAt   *time.Time      `json:"updated_at,omitempty"`
}

func (s *blockStore) list(ctx context.Context) ([]layoutBlock, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, category, COALESCE(description,''), objects_json, COALESCE(preview_svg,''), created_at, updated_at
		 FROM layout_blocks ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []layoutBlock
	for rows.Next() {
		var b layoutBlock
		var objsStr, previewSVG string
		if err := rows.Scan(&b.ID, &b.Name, &b.Category, &b.Description, &objsStr, &previewSVG, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		b.Objects = json.RawMessage(objsStr)
		b.PreviewSVG = previewSVG
		out = append(out, b)
	}
	if out == nil {
		out = []layoutBlock{}
	}
	return out, nil
}

func (s *blockStore) create(ctx context.Context, b layoutBlock) (layoutBlock, error) {
	objsJSON, err := json.Marshal(b.Objects)
	if err != nil {
		return b, err
	}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO layout_blocks (name, category, description, objects_json, preview_svg)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, updated_at`,
		b.Name, b.Category, b.Description, string(objsJSON), b.PreviewSVG,
	).Scan(&b.ID, &b.CreatedAt, &b.UpdatedAt)
	return b, err
}

func (s *blockStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM layout_blocks WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("block not found")
	}
	return nil
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (app *appServer) listBlocksHandler(w http.ResponseWriter, r *http.Request) {
	if app.blocks == nil {
		writeJSON(w, http.StatusOK, []layoutBlock{})
		return
	}
	list, err := app.blocks.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (app *appServer) createBlockHandler(w http.ResponseWriter, r *http.Request) {
	if app.blocks == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("blocks store not available"))
		return
	}
	if _, err := app.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	var body struct {
		Name        string          `json:"name"`
		Category    string          `json:"category"`
		Description string          `json:"description"`
		Objects     json.RawMessage `json:"objects"`
		PreviewSVG  string          `json:"preview_svg"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON"))
		return
	}
	if body.Name == "" || len(body.Objects) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("name and objects are required"))
		return
	}
	if body.Category == "" {
		body.Category = "custom"
	}
	b := layoutBlock{
		Name:        body.Name,
		Category:    body.Category,
		Description: body.Description,
		Objects:     body.Objects,
		PreviewSVG:  body.PreviewSVG,
	}
	b, err := app.blocks.create(r.Context(), b)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, b)
}

func (app *appServer) deleteBlockHandler(w http.ResponseWriter, r *http.Request) {
	if app.blocks == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("blocks store not available"))
		return
	}
	if _, err := app.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("block_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid block_id"))
		return
	}
	if err := app.blocks.delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
