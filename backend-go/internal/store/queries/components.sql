-- name: ListComponents :many
SELECT id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at
FROM global_components
ORDER BY label;

-- name: CreateComponent :one
INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at;

-- name: UpsertComponent :one
INSERT INTO global_components (id, label, asset_type, view_box, default_w, default_h, svg_markup)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      asset_type = EXCLUDED.asset_type,
      view_box = EXCLUDED.view_box,
      default_w = EXCLUDED.default_w,
      default_h = EXCLUDED.default_h,
      svg_markup = EXCLUDED.svg_markup,
      updated_at = NOW()
RETURNING id, label, asset_type, view_box, default_w, default_h, svg_markup, created_at, updated_at;

-- name: DeleteComponent :execrows
DELETE FROM global_components WHERE id = $1;
