-- name: GetUserByUsername :one
SELECT id, username, email, hashed_password, role, created_at, full_name, department, position, phone, user_status, is_active
FROM users
WHERE username = $1;

-- name: GetUserEmailID :one
SELECT id FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT id, username, email, hashed_password, role, created_at, full_name, department, position, phone, user_status, is_active
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (username, email, hashed_password, role)
VALUES ($1, $2, $3, $4)
RETURNING id, username, email, hashed_password, role, created_at, full_name, department, position, phone, user_status, is_active;

-- name: ListUsers :many
SELECT id, username, email, hashed_password, role, created_at, full_name, department, position, phone, user_status, is_active
FROM users
ORDER BY id;

-- name: UpdateUserRole :one
UPDATE users
SET role = $2, is_active = $3
WHERE username = $1
RETURNING id, username, email, hashed_password, role, created_at, full_name, department, position, phone, user_status, is_active;

-- name: DeleteUser :execrows
DELETE FROM users WHERE username = $1;
