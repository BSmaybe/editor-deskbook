package store

import (
	"context"
	"errors"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OfficeStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewOfficeStore(pool *pgxpool.Pool) *OfficeStore {
	return &OfficeStore{
		pool: pool,
		q:    db.New(pool),
	}
}

type OfficeRow struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Address *string `json:"address"`
}

func mapDBOfficeToOfficeRow(o db.Office) OfficeRow {
	return OfficeRow{
		ID:      int(o.ID),
		Name:    o.Name,
		Address: textToPtr(o.Address),
	}
}

func (s *OfficeStore) List(ctx context.Context) ([]OfficeRow, error) {
	offices, err := s.q.ListOffices(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]OfficeRow, len(offices))
	for i, o := range offices {
		result[i] = mapDBOfficeToOfficeRow(o)
	}
	return result, nil
}

func (s *OfficeStore) Create(ctx context.Context, name string, address *string) (*OfficeRow, error) {
	o, err := s.q.CreateOffice(ctx, db.CreateOfficeParams{
		Name:    name,
		Address: ptrToText(address),
	})
	if err != nil {
		return nil, err
	}
	row := mapDBOfficeToOfficeRow(o)
	return &row, nil
}

func (s *OfficeStore) Update(ctx context.Context, id int, name *string, address *string) (*OfficeRow, error) {
	o, err := s.q.UpdateOffice(ctx, db.UpdateOfficeParams{
		ID:      int32(id),
		Name:    ptrToText(name),
		Address: ptrToText(address),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	row := mapDBOfficeToOfficeRow(o)
	return &row, nil
}

func (s *OfficeStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteOffice(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

