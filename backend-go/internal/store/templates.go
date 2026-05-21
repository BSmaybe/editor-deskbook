package store

import (
	"context"
	"fmt"
	"time"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TemplateStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewTemplateStore(pool *pgxpool.Pool) *TemplateStore {
	return &TemplateStore{
		pool: pool,
		q:    db.New(pool),
	}
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
	rows, err := s.q.ListTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]LayoutTemplate, len(rows))
	for i, r := range rows {
		out[i] = LayoutTemplate{
			ID:          int(r.ID),
			Name:        r.Name,
			Description: r.Description,
			Category:    r.Category,
			LayoutJSON:  r.LayoutJson,
			CreatedAt:   timestamptzToPtr(r.CreatedAt),
			UpdatedAt:   timestamptzToPtr(r.UpdatedAt),
		}
	}
	return out, nil
}

func (s *TemplateStore) Create(ctx context.Context, t LayoutTemplate) (LayoutTemplate, error) {
	r, err := s.q.CreateTemplate(ctx, db.CreateTemplateParams{
		Name:        t.Name,
		Description: pgtype.Text{String: t.Description, Valid: true},
		Category:    t.Category,
		LayoutJson:  t.LayoutJSON,
	})
	if err != nil {
		return t, err
	}
	t.ID = int(r.ID)
	t.CreatedAt = timestamptzToPtr(r.CreatedAt)
	t.UpdatedAt = timestamptzToPtr(r.UpdatedAt)
	return t, nil
}

func (s *TemplateStore) Delete(ctx context.Context, id int) error {
	rowsAffected, err := s.q.DeleteTemplate(ctx, int32(id))
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("template not found")
	}
	return nil
}

