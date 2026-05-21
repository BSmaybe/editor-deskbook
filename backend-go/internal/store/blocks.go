package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type BlockStore struct {
	pool *pgxpool.Pool
}

func NewBlockStore(pool *pgxpool.Pool) *BlockStore {
	return &BlockStore{pool: pool}
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
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, category, COALESCE(description,''), objects_json, COALESCE(preview_svg,''), created_at, updated_at
		 FROM layout_blocks ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LayoutBlock
	for rows.Next() {
		var b LayoutBlock
		var objsStr, previewSVG string
		if err := rows.Scan(&b.ID, &b.Name, &b.Category, &b.Description, &objsStr, &previewSVG, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		b.Objects = json.RawMessage(objsStr)
		b.PreviewSVG = previewSVG
		out = append(out, b)
	}
	if out == nil {
		out = []LayoutBlock{}
	}
	return out, nil
}

func (s *BlockStore) Create(ctx context.Context, b LayoutBlock) (LayoutBlock, error) {
	objsJSON, err := json.Marshal(b.Objects)
	if err != nil {
		return b, err
	}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO layout_blocks (name, category, description, objects_json, preview_svg)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, updated_at`,
		b.Name, b.Category, b.Description, string(objsJSON), b.PreviewSVG,
	).Scan(&b.ID, &b.CreatedAt, &b.UpdatedAt)
	return b, err
}

func (s *BlockStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM layout_blocks WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("block not found")
	}
	return nil
}
