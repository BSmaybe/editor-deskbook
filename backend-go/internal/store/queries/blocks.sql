-- name: ListBlocks :many
SELECT id, name, category, COALESCE(description, '')::TEXT as description, objects_json, COALESCE(preview_svg, '')::TEXT as preview_svg, created_at, updated_at
FROM layout_blocks
ORDER BY updated_at DESC;

-- name: CreateBlock :one
INSERT INTO layout_blocks (name, category, description, objects_json, preview_svg)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, category, description, objects_json, preview_svg, created_at, updated_at;

-- name: DeleteBlock :execrows
DELETE FROM layout_blocks WHERE id = $1;
