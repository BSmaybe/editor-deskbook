package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FloorStore struct {
	pool *pgxpool.Pool
}

func NewFloorStore(pool *pgxpool.Pool) *FloorStore {
	return &FloorStore{pool: pool}
}

type FloorRow struct {
	ID       int     `json:"id"`
	OfficeID int     `json:"office_id"`
	Name     string  `json:"name"`
	PlanURL  *string `json:"plan_url"`
}

func (s *FloorStore) List(ctx context.Context, officeID *int) ([]FloorRow, error) {
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
	var result []FloorRow
	for rows.Next() {
		var f FloorRow
		if err := rows.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL); err != nil {
			return nil, err
		}
		result = append(result, f)
	}
	return result, rows.Err()
}

func (s *FloorStore) Create(ctx context.Context, officeID int, name string) (*FloorRow, error) {
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
	var f FloorRow
	err = row.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL)
	return &f, err
}

func (s *FloorStore) Update(ctx context.Context, id int, name *string) (*FloorRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE floors SET name = COALESCE($2, name) WHERE id = $1
		 RETURNING id, office_id, name, plan_url`, id, name)
	var f FloorRow
	err := row.Scan(&f.ID, &f.OfficeID, &f.Name, &f.PlanURL)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return &f, err
}

func (s *FloorStore) SetPlanURL(ctx context.Context, id int, planURL string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE floors SET plan_url = $2 WHERE id = $1`, id, planURL)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *FloorStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM floors WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
