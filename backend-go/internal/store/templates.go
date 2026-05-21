package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type TemplateStore struct {
	pool *pgxpool.Pool
}

func NewTemplateStore(pool *pgxpool.Pool) *TemplateStore {
	return &TemplateStore{pool: pool}
}

type LayoutTemplate struct {
	ID          int        `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Category    string     `json:"category"`
	LayoutJSON  string     `json:"layout"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func (s *TemplateStore) List(ctx context.Context) ([]LayoutTemplate, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, COALESCE(description,''), category, layout_json, created_at, updated_at
		 FROM layout_templates ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LayoutTemplate
	for rows.Next() {
		var t LayoutTemplate
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.Category, &t.LayoutJSON, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []LayoutTemplate{}
	}
	return out, nil
}

func (s *TemplateStore) Create(ctx context.Context, t LayoutTemplate) (LayoutTemplate, error) {
	err := s.pool.QueryRow(ctx,
		`INSERT INTO layout_templates (name, description, category, layout_json)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		t.Name, t.Description, t.Category, t.LayoutJSON,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (s *TemplateStore) Delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM layout_templates WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("template not found")
	}
	return nil
}
