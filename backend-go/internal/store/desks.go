package store

import (
	"context"
	"errors"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeskStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewDeskStore(pool *pgxpool.Pool) *DeskStore {
	return &DeskStore{
		pool: pool,
		q:    db.New(pool),
	}
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

func mapDBDeskToDeskRow(d db.Desk) DeskRow {
	return DeskRow{
		ID:         int(d.ID),
		FloorID:    int(d.FloorID),
		Label:      d.Label,
		Type:       d.Type,
		SpaceType:  d.SpaceType,
		AssignedTo: textToPtr(d.AssignedTo),
		PositionX:  float8ToPtr(d.PositionX),
		PositionY:  float8ToPtr(d.PositionY),
		W:          d.W,
		H:          d.H,
		QRToken:    d.QrToken,
	}
}

func (s *DeskStore) List(ctx context.Context, floorID *int) ([]DeskRow, error) {
	var desks []db.Desk
	var err error
	if floorID != nil {
		desks, err = s.q.ListDesksByFloor(ctx, int32(*floorID))
	} else {
		desks, err = s.q.ListDesks(ctx)
	}
	if err != nil {
		return nil, err
	}
	result := make([]DeskRow, len(desks))
	for i, d := range desks {
		result[i] = mapDBDeskToDeskRow(d)
	}
	return result, nil
}

func (s *DeskStore) GetByID(ctx context.Context, id int) (*DeskRow, error) {
	d, err := s.q.GetDeskByID(ctx, int32(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	row := mapDBDeskToDeskRow(d)
	return &row, nil
}

func (s *DeskStore) Update(ctx context.Context, id int, label *string, deskType *string, spaceType *string,
	assignedTo *string, posX *float64, posY *float64, w *float64, h *float64) (*DeskRow, error) {
	d, err := s.q.UpdateDesk(ctx, db.UpdateDeskParams{
		ID:         int32(id),
		Label:      ptrToText(label),
		Type:       ptrToText(deskType),
		SpaceType:  ptrToText(spaceType),
		AssignedTo: ptrToText(assignedTo),
		PositionX:  ptrToFloat8(posX),
		PositionY:  ptrToFloat8(posY),
		W:          ptrToFloat8(w),
		H:          ptrToFloat8(h),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	row := mapDBDeskToDeskRow(d)
	return &row, nil
}

func (s *DeskStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteDesk(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

