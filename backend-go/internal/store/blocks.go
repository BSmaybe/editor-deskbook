package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BlockStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewBlockStore(pool *pgxpool.Pool) *BlockStore {
	return &BlockStore{
		pool: pool,
		q:    db.New(pool),
	}
}

type LayoutBlock struct {
	ID          int             `json:"id"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	Description string          `json:"description,omitempty"`
	Objects     json.RawMessage `json:"objects"` // array of desk-like objects
	PreviewSVG  string          `json:"preview_svg,omitempty"`
	CreatedAt   *time.Time      `json:"created_at,omitempty"`
	UpdatedAt   *time.Time      `json:"updated_at,omitempty"`
}

func (s *BlockStore) List(ctx context.Context) ([]LayoutBlock, error) {
	rows, err := s.q.ListBlocks(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]LayoutBlock, len(rows))
	for i, r := range rows {
		out[i] = LayoutBlock{
			ID:          int(r.ID),
			Name:        r.Name,
			Category:    r.Category,
			Description: r.Description,
			Objects:     json.RawMessage(r.ObjectsJson),
			PreviewSVG:  r.PreviewSvg,
			CreatedAt:   timestamptzToPtr(r.CreatedAt),
			UpdatedAt:   timestamptzToPtr(r.UpdatedAt),
		}
	}
	return out, nil
}

func (s *BlockStore) Create(ctx context.Context, b LayoutBlock) (LayoutBlock, error) {
	objsJSON, err := json.Marshal(b.Objects)
	if err != nil {
		return b, err
	}
	r, err := s.q.CreateBlock(ctx, db.CreateBlockParams{
		Name:        b.Name,
		Category:    b.Category,
		Description: pgtype.Text{String: b.Description, Valid: true},
		ObjectsJson: string(objsJSON),
		PreviewSvg:  pgtype.Text{String: b.PreviewSVG, Valid: true},
	})
	if err != nil {
		return b, err
	}
	b.ID = int(r.ID)
	b.CreatedAt = timestamptzToPtr(r.CreatedAt)
	b.UpdatedAt = timestamptzToPtr(r.UpdatedAt)
	return b, nil
}

func (s *BlockStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteBlock(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("block not found")
	}
	return nil
}

