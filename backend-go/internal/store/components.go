package store

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ComponentStore struct {
	pool *pgxpool.Pool
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
	return &ComponentStore{pool: pool}
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
	rows, err := s.pool.Query(ctx, `
		SELECT id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
		FROM global_components
		ORDER BY label
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ComponentOut
	for rows.Next() {
		comp, err := s.scanComponent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, comp)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *ComponentStore) Create(ctx context.Context, id, label, assetType string, viewBox []float64, defaultW, defaultH float64, svgMarkup string) (*ComponentOut, error) {
	viewBoxStr := ViewBoxString(viewBox)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
	`, id, label, assetType, viewBoxStr, defaultW, defaultH, svgMarkup)
	comp, err := s.scanComponent(row)
	if err != nil {
		return nil, err
	}
	return &comp, nil
}

func (s *ComponentStore) Update(ctx context.Context, id, label, assetType string, viewBox []float64, defaultW, defaultH float64, svgMarkup string) (*ComponentOut, error) {
	viewBoxStr := ViewBoxString(viewBox)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE
		  SET label=$2, asset_type=$3, view_box=$4, default_w=$5, default_h=$6, svg_markup=$7, updated_at=now()
		RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
	`, id, label, assetType, viewBoxStr, defaultW, defaultH, svgMarkup)
	comp, err := s.scanComponent(row)
	if err != nil {
		return nil, err
	}
	return &comp, nil
}

func (s *ComponentStore) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM global_components WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("component not found")
	}
	return nil
}

func (s *ComponentStore) scanComponent(row pgx.Row) (ComponentOut, error) {
	var out ComponentOut
	var viewBox string
	err := row.Scan(&out.ID, &out.Label, &out.AssetType, &viewBox, &out.DefaultW, &out.DefaultH, &out.SVGMarkup, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return out, err
	}
	out.ViewBox = ParseViewBoxString(viewBox)
	return out, nil
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
