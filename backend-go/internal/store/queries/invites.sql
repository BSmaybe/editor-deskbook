-- name: CreateInvite :one
INSERT INTO invites (token, email, role, created_by, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, token, email, role, created_by, created_at, expires_at, used_at;

-- name: ListInvites :many
SELECT id, token, email, role, created_by, created_at, expires_at, used_at
FROM invites
ORDER BY created_at DESC;

-- name: GetInviteByToken :one
SELECT id, token, email, role, created_by, created_at, expires_at, used_at
FROM invites
WHERE token = $1;

-- name: MarkInviteUsed :exec
UPDATE invites
SET used_at = NOW()
WHERE id = $1;

-- name: DeleteInvite :execrows
DELETE FROM invites WHERE id = $1;
