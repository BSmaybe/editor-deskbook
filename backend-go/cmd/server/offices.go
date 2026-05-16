package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type officeStore struct {
	pool *pgxpool.Pool
}

func newOfficeStore(ctx context.Context, databaseURL string) (*officeStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &officeStore{pool: pool}, nil
}

func (s *officeStore) close() { s.pool.Close() }

type officeRow struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Address *string `json:"address"`
}

func (s *officeStore) list(ctx context.Context) ([]officeRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, address FROM offices ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []officeRow
	for rows.Next() {
		var o officeRow
		if err := rows.Scan(&o.ID, &o.Name, &o.Address); err != nil {
			return nil, err
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

func (s *officeStore) create(ctx context.Context, name string, address *string) (*officeRow, error) {
	row := s.pool.QueryRow(ctx,
		`INSERT INTO offices (name, address) VALUES ($1, $2) RETURNING id, name, address`,
		name, address)
	var o officeRow
	err := row.Scan(&o.ID, &o.Name, &o.Address)
	return &o, err
}

func (s *officeStore) update(ctx context.Context, id int, name *string, address *string) (*officeRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE offices SET name = COALESCE($2, name), address = COALESCE($3, address) WHERE id = $1
		 RETURNING id, name, address`, id, name, address)
	var o officeRow
	err := row.Scan(&o.ID, &o.Name, &o.Address)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &o, err
}

func (s *officeStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM offices WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- Handlers ---

func (app *appServer) listOfficesHandler(w http.ResponseWriter, r *http.Request) {
	if app.offices == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	offices, err := app.offices.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if offices == nil {
		offices = []officeRow{}
	}
	writeJSON(w, http.StatusOK, offices)
}

func (app *appServer) createOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if app.offices == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAdminContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	var p struct {
		Name    string  `json:"name"`
		Address *string `json:"address"`
	}
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if p.Name == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}
	office, err := app.offices.create(r.Context(), p.Name, p.Address)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, office)
}

func (app *appServer) updateOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if app.offices == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAdminContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("office_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid office_id"))
		return
	}
	var p struct {
		Name    *string `json:"name"`
		Address *string `json:"address"`
	}
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	office, err := app.offices.update(r.Context(), id, p.Name, p.Address)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if office == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("office not found"))
		return
	}
	writeJSON(w, http.StatusOK, office)
}

func (app *appServer) deleteOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if app.offices == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAdminContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("office_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid office_id"))
		return
	}
	if err := app.offices.delete(r.Context(), id); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("office not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
