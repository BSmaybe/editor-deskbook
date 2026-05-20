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

type templateStore struct {
	pool *pgxpool.Pool
}

func newTemplateStore(ctx context.Context, databaseURL string) (*templateStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &templateStore{pool: pool}, nil
}

func (s *templateStore) close() { s.pool.Close() }

type layoutTemplate struct {
	ID          int        `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Category    string     `json:"category"`
	LayoutJSON  string     `json:"layout"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func (s *templateStore) list(ctx context.Context) ([]layoutTemplate, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, COALESCE(description,''), category, layout_json, created_at, updated_at
		 FROM layout_templates ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []layoutTemplate
	for rows.Next() {
		var t layoutTemplate
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.Category, &t.LayoutJSON, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []layoutTemplate{}
	}
	return out, nil
}

func (s *templateStore) create(ctx context.Context, t layoutTemplate) (layoutTemplate, error) {
	err := s.pool.QueryRow(ctx,
		`INSERT INTO layout_templates (name, description, category, layout_json)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		t.Name, t.Description, t.Category, t.LayoutJSON,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *templateStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM layout_templates WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("template not found")
	}
	return nil
}

// Handlers

func (app *appServer) listTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	if app.templates == nil {
		writeJSON(w, http.StatusOK, []layoutTemplate{})
		return
	}
	list, err := app.templates.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (app *appServer) createTemplateHandler(w http.ResponseWriter, r *http.Request) {
	if app.templates == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("templates store not available"))
		return
	}
	if _, err := app.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}

	var body struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Category    string          `json:"category"`
		Layout      json.RawMessage `json:"layout"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid JSON"))
		return
	}
	if body.Name == "" || len(body.Layout) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("name and layout are required"))
		return
	}
	if body.Category == "" {
		body.Category = "custom"
	}

	t := layoutTemplate{
		Name:        body.Name,
		Description: body.Description,
		Category:    body.Category,
		LayoutJSON:  string(body.Layout),
	}
	t, err := app.templates.create(r.Context(), t)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (app *appServer) deleteTemplateHandler(w http.ResponseWriter, r *http.Request) {
	if app.templates == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("templates store not available"))
		return
	}
	if _, err := app.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("template_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid template_id"))
		return
	}
	if err := app.templates.delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
