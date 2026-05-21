-- name: ListOffices :many
SELECT id, name, address FROM offices ORDER BY id;

-- name: CreateOffice :one
INSERT INTO offices (name, address)
VALUES ($1, $2)
RETURNING id, name, address;

-- name: UpdateOffice :one
UPDATE offices
SET name = COALESCE(sqlc.narg('name'), name),
    address = COALESCE(sqlc.narg('address'), address)
WHERE id = $1
RETURNING id, name, address;

-- name: DeleteOffice :execrows
DELETE FROM offices WHERE id = $1;
