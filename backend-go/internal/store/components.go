package store

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ComponentStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

type ComponentOut struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	AssetType string    `json:"asset_type"`
	ViewBox   []float64 `json:"view_box"`
	DefaultW  float64   `json:"default_w"`
	DefaultH  float64   `json:"default_h"`
	SVGMarkup string    `json:"svg_markup"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func NewComponentStore(pool *pgxpool.Pool) *ComponentStore {
	return &ComponentStore{
		pool: pool,
		q:    db.New(pool),
	}
}

func mapDBComponentToComponentOut(c db.GlobalComponent) ComponentOut {
	return ComponentOut{
		ID:        c.ID,
		Label:     c.Label,
		AssetType: c.AssetType,
		ViewBox:   ParseViewBoxString(c.ViewBox),
		DefaultW:  c.DefaultW,
		DefaultH:  c.DefaultH,
		SVGMarkup: c.SvgMarkup,
		CreatedAt: c.CreatedAt.Time,
		UpdatedAt: c.UpdatedAt.Time,
	}
}

func (s *ComponentStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS global_components (
			id          VARCHAR(120) PRIMARY KEY,
			label       VARCHAR(120) NOT NULL,
			asset_type  VARCHAR(30) NOT NULL DEFAULT 'asset',
			view_box    VARCHAR(100) NOT NULL DEFAULT '0 0 100 60',
			default_w   DOUBLE PRECISION NOT NULL DEFAULT 100,
			default_h   DOUBLE PRECISION NOT NULL DEFAULT 60,
			svg_markup  TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	return err
}

func (s *ComponentStore) List(ctx context.Context) ([]ComponentOut, error) {
	comps, err := s.q.ListComponents(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]ComponentOut, len(comps))
	for i, c := range comps {
		out[i] = mapDBComponentToComponentOut(c)
	}
	return out, nil
}

func (s *ComponentStore) Create(ctx context.Context, id, label, assetType string, viewBox []float64, defaultW, defaultH float64, svgMarkup string) (*ComponentOut, error) {
	viewBoxStr := ViewBoxString(viewBox)
	c, err := s.q.CreateComponent(ctx, db.CreateComponentParams{
		ID:        id,
		Label:     label,
		AssetType: assetType,
		ViewBox:   viewBoxStr,
		DefaultW:  defaultW,
		DefaultH:  defaultH,
		SvgMarkup: svgMarkup,
	})
	if err != nil {
		return nil, err
	}
	comp := mapDBComponentToComponentOut(c)
	return &comp, nil
}

func (s *ComponentStore) Update(ctx context.Context, id, label, assetType string, viewBox []float64, defaultW, defaultH float64, svgMarkup string) (*ComponentOut, error) {
	viewBoxStr := ViewBoxString(viewBox)
	c, err := s.q.UpsertComponent(ctx, db.UpsertComponentParams{
		ID:        id,
		Label:     label,
		AssetType: assetType,
		ViewBox:   viewBoxStr,
		DefaultW:  defaultW,
		DefaultH:  defaultH,
		SvgMarkup: svgMarkup,
	})
	if err != nil {
		return nil, err
	}
	comp := mapDBComponentToComponentOut(c)
	return &comp, nil
}

func (s *ComponentStore) Delete(ctx context.Context, id string) error {
	rowsAffected, err := s.q.DeleteComponent(ctx, id)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("component not found")
	}
	return nil
}

func ParseViewBoxString(value string) []float64 {
	parts := strings.Fields(value)
	out := make([]float64, 0, 4)
	for _, part := range parts {
		n, err := strconv.ParseFloat(part, 64)
		if err == nil {
			out = append(out, n)
		}
	}
	if len(out) != 4 || out[2] <= 0 || out[3] <= 0 {
		return []float64{0, 0, 100, 60}
	}
	return out
}

func ViewBoxString(value []float64) string {
	if len(value) != 4 {
		return "0 0 100 60"
	}
	parts := make([]string, 4)
	for i := 0; i < 4; i++ {
		parts[i] = strconv.FormatFloat(value[i], 'f', -1, 64)
	}
	return strings.Join(parts, " ")
}

