package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeskStore struct {
	pool *pgxpool.Pool
}

func NewDeskStore(pool *pgxpool.Pool) *DeskStore {
	return &DeskStore{pool: pool}
}

type DeskRow struct {
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

func (s *DeskStore) List(ctx context.Context, floorID *int) ([]DeskRow, error) {
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
	var result []DeskRow
	for rows.Next() {
		var d DeskRow
		if err := rows.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
			&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

func (s *DeskStore) GetByID(ctx context.Context, id int) (*DeskRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
		 FROM desks WHERE id = $1`, id)
	var d DeskRow
	err := row.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
		&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &d, err
}

func (s *DeskStore) Update(ctx context.Context, id int, label *string, deskType *string, spaceType *string,
	assignedTo *string, posX *float64, posY *float64, w *float64, h *float64) (*DeskRow, error) {
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
	var d DeskRow
	err := row.Scan(&d.ID, &d.FloorID, &d.Label, &d.Type, &d.SpaceType,
		&d.AssignedTo, &d.PositionX, &d.PositionY, &d.W, &d.H, &d.QRToken)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return &d, err
}

func (s *DeskStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM desks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
