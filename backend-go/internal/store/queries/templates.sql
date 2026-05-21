-- name: ListTemplates :many
SELECT id, name, COALESCE(description, '')::TEXT as description, category, layout_json, created_at, updated_at
FROM layout_templates
ORDER BY updated_at DESC;

-- name: CreateTemplate :one
INSERT INTO layout_templates (name, description, category, layout_json)
VALUES ($1, $2, $3, $4)
RETURNING id, name, description, category, layout_json, created_at, updated_at;

-- name: DeleteTemplate :execrows
DELETE FROM layout_templates WHERE id = $1;
