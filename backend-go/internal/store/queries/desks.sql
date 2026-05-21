-- name: ListDesks :many
SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
FROM desks
ORDER BY id;

-- name: ListDesksByFloor :many
SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
FROM desks
WHERE floor_id = $1
ORDER BY id;

-- name: GetDeskByID :one
SELECT id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token
FROM desks
WHERE id = $1;

-- name: UpdateDesk :one
UPDATE desks
SET label = COALESCE(sqlc.narg('label'), label),
    type = COALESCE(sqlc.narg('type'), type),
    space_type = COALESCE(sqlc.narg('space_type'), space_type),
    assigned_to = COALESCE(sqlc.narg('assigned_to'), assigned_to),
    position_x = COALESCE(sqlc.narg('position_x'), position_x),
    position_y = COALESCE(sqlc.narg('position_y'), position_y),
    w = COALESCE(sqlc.narg('w'), w),
    h = COALESCE(sqlc.narg('h'), h)
WHERE id = $1
RETURNING id, floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token;

-- name: DeleteDesk :execrows
DELETE FROM desks WHERE id = $1;
