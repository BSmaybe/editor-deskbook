package store

import (
	"context"
	"errors"
	"fmt"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FloorStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewFloorStore(pool *pgxpool.Pool) *FloorStore {
	return &FloorStore{
		pool: pool,
		q:    db.New(pool),
	}
}

type FloorRow struct {
	ID       int     `json:"id"`
	OfficeID int     `json:"office_id"`
	Name     string  `json:"name"`
	PlanURL  *string `json:"plan_url"`
}

func (s *FloorStore) List(ctx context.Context, officeID *int) ([]FloorRow, error) {
	var floors []db.ListFloorsRow
	var err error
	if officeID != nil {
		var list []db.ListFloorsByOfficeRow
		list, err = s.q.ListFloorsByOffice(ctx, int32(*officeID))
		if err == nil {
			floors = make([]db.ListFloorsRow, len(list))
			for i, f := range list {
				floors[i] = db.ListFloorsRow{
					ID:       f.ID,
					OfficeID: f.OfficeID,
					Name:     f.Name,
					PlanUrl:  f.PlanUrl,
				}
			}
		}
	} else {
		floors, err = s.q.ListFloors(ctx)
	}
	if err != nil {
		return nil, err
	}
	result := make([]FloorRow, len(floors))
	for i, f := range floors {
		result[i] = FloorRow{
			ID:       int(f.ID),
			OfficeID: int(f.OfficeID),
			Name:     f.Name,
			PlanURL:  textToPtr(f.PlanUrl),
		}
	}
	return result, nil
}

func (s *FloorStore) Create(ctx context.Context, officeID int, name string) (*FloorRow, error) {
	exists, err := s.q.CheckOfficeExists(ctx, int32(officeID))
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("office not found")
	}
	f, err := s.q.CreateFloor(ctx, db.CreateFloorParams{
		OfficeID: int32(officeID),
		Name:     name,
	})
	if err != nil {
		return nil, err
	}
	return &FloorRow{
		ID:       int(f.ID),
		OfficeID: int(f.OfficeID),
		Name:     f.Name,
		PlanURL:  textToPtr(f.PlanUrl),
	}, nil
}

func (s *FloorStore) Update(ctx context.Context, id int, name *string) (*FloorRow, error) {
	f, err := s.q.UpdateFloor(ctx, db.UpdateFloorParams{
		ID:   int32(id),
		Name: ptrToText(name),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &FloorRow{
		ID:       int(f.ID),
		OfficeID: int(f.OfficeID),
		Name:     f.Name,
		PlanURL:  textToPtr(f.PlanUrl),
	}, nil
}

func (s *FloorStore) SetPlanURL(ctx context.Context, id int, planURL string) error {
	rowsAffected, err := s.q.SetFloorPlanURL(ctx, db.SetFloorPlanURLParams{
		ID:      int32(id),
		PlanUrl: stringToText(planURL),
	})
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *FloorStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteFloor(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

