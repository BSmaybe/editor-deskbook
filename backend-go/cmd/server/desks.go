package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type deskStore struct {
	pool *pgxpool.Pool
}

func newDeskStore(ctx context.Context, databaseURL string) (*deskStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &deskStore{pool: pool}, nil
}

func (s *deskStore) close() { s.pool.Close() }

type deskRow struct {
	ID         int      `json:"id"`
	FloorID    int      `json:"floor_id"`
	Label      string   `json:"label"`
	Type       string   `json:"type"`
	SpaceType  string   `json:"space_type"`
	AssignedTo *string  `json:"assigned_to"`
	PositionX  *float64 `json:"position_x"`
	PositionY  *float64 `json:"position_y"`
	W          float64  `json:"w"`
	H          float64  `json:"h"`
	QRToken    string   `json:"qr_token"`
}

func (s *deskStore) list(ctx context.Context, floorID *int) ([]deskRow, error) {
	var query string
	var args []any
	if floorID != nil {
		query = `SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
		         FROM desks WHERE floor_id = $1 ORDER BY id`
		args = []any{*floorID}
	} else {
		query = `SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
		         FROM desks ORDER BY id`
	}
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []deskRow
	for rows.Next() {
		var d deskRow
		if err := rows.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
			&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

func (s *deskStore) getByID(ctx context.Context, id int) (*deskRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
		 FROM desks WHERE id = $1`, id)
	var d deskRow
	err := row.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
		&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &d, err
}

func (s *deskStore) update(ctx context.Context, id int, label *string, deskType *string, spaceType *string,
	assignedTo *string, posX *float64, posY *float64, w *float64, h *float64) (*deskRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE desks SET
			label = COALESCE($2, label),
			type = COALESCE($3, type),
			space_type = COALESCE($4, space_type),
			assigned_to = COALESCE($5, assigned_to),
			position_x = COALESCE($6, position_x),
			position_y = COALESCE($7, position_y),
			w = COALESCE($8, w),
			h = COALESCE($9, h)
		 WHERE id = $1
		 RETURNING id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token`,
		id, label, deskType, spaceType, assignedTo, posX, posY, w, h)
	var d deskRow
	err := row.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
		&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &d, err
}

func (s *deskStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM desks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- Handlers ---

func (app *appServer) listDesksHandler(w http.ResponseWriter, r *http.Request) {
	if app.desks == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	var floorID *int
	if v := r.URL.Query().Get("floor_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid floor_id"))
			return
		}
		floorID = &id
	}
	desks, err := app.desks.list(r.Context(), floorID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if desks == nil {
		desks = []deskRow{}
	}
	writeJSON(w, http.StatusOK, desks)
}

func (app *appServer) getDeskHandler(w http.ResponseWriter, r *http.Request) {
	if app.desks == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	desk, err := app.desks.getByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if desk == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
		return
	}
	writeJSON(w, http.StatusOK, desk)
}

func (app *appServer) updateDeskHandler(w http.ResponseWriter, r *http.Request) {
	if app.desks == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	var p struct {
		Label      *string  `json:"label"`
		Type       *string  `json:"type"`
		SpaceType  *string  `json:"space_type"`
		AssignedTo *string  `json:"assigned_to"`
		PositionX  *float64 `json:"position_x"`
		PositionY  *float64 `json:"position_y"`
		W          *float64 `json:"w"`
		H          *float64 `json:"h"`
	}
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	desk, err := app.desks.update(r.Context(), id, p.Label, p.Type, p.SpaceType, p.AssignedTo, p.PositionX, p.PositionY, p.W, p.H)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if desk == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
		return
	}
	writeJSON(w, http.StatusOK, desk)
}

func (app *appServer) deleteDeskHandler(w http.ResponseWriter, r *http.Request) {
	if app.desks == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := requireAuthContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	if err := app.desks.delete(r.Context(), id); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
