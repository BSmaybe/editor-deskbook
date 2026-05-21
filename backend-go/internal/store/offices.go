package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OfficeStore struct {
	pool *pgxpool.Pool
}

func NewOfficeStore(pool *pgxpool.Pool) *OfficeStore {
	return &OfficeStore{pool: pool}
}

type OfficeRow struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Address *string `json:"address"`
}

func (s *OfficeStore) List(ctx context.Context) ([]OfficeRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, address FROM offices ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []OfficeRow
	for rows.Next() {
		var o OfficeRow
		if err := rows.Scan(&o.ID, &o.Name, &o.Address); err != nil {
			return nil, err
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

func (s *OfficeStore) Create(ctx context.Context, name string, address *string) (*OfficeRow, error) {
	row := s.pool.QueryRow(ctx,
		`INSERT INTO offices (name, address) VALUES ($1, $2) RETURNING id, name, address`,
		name, address)
	var o OfficeRow
	err := row.Scan(&o.ID, &o.Name, &o.Address)
	return &o, err
}

func (s *OfficeStore) Update(ctx context.Context, id int, name *string, address *string) (*OfficeRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE offices SET name = COALESCE($2, name), address = COALESCE($3, address) WHERE id = $1
		 RETURNING id, name, address`, id, name, address)
	var o OfficeRow
	err := row.Scan(&o.ID, &o.Name, &o.Address)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return &o, err
}

func (s *OfficeStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM offices WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
