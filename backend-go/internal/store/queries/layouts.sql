-- name: GetFloorRefs :one
SELECT id, published_map_revision_id, draft_map_revision_id FROM floors WHERE id = $1;

-- name: GetFloorRefsForUpdate :one
SELECT id, published_map_revision_id, draft_map_revision_id FROM floors WHERE id = $1 FOR UPDATE;

-- name: GetLayoutRevision :one
SELECT id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
FROM floor_map_revisions
WHERE id = $1;

-- name: GetLayoutRevisionForUpdate :one
SELECT id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
FROM floor_map_revisions
WHERE id = $1 FOR UPDATE;

-- name: UpdateSemanticSVG :exec
UPDATE floor_map_revisions
SET semantic_svg = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateDraftLayout :one
UPDATE floor_map_revisions
SET layout_json = $2, semantic_svg = NULL, status = 'draft', updated_at = now()
WHERE id = $1
RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg;

-- name: InsertDraftLayout :one
INSERT INTO floor_map_revisions (floor_id, status, desks_json, zones_json, layout_json, semantic_svg, version, created_by)
VALUES ($1, 'draft', '[]', '[]', $2, NULL, $3, $4)
RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg;

-- name: SetFloorDraftRevision :exec
UPDATE floors SET draft_map_revision_id = $2 WHERE id = $1;

-- name: ArchiveRevision :exec
UPDATE floor_map_revisions SET status = 'archived', updated_at = now() WHERE id = $1;

-- name: PublishRevision :one
UPDATE floor_map_revisions
SET semantic_svg = $2, status = 'published', published_at = now(), updated_at = now()
WHERE id = $1
RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg;

-- name: SetFloorPublishedRevision :exec
UPDATE floors SET published_map_revision_id = $2, draft_map_revision_id = NULL WHERE id = $1;

-- name: ClearFloorDraftRevision :exec
UPDATE floors SET draft_map_revision_id = NULL WHERE id = $1;

-- name: DeleteRevision :exec
DELETE FROM floor_map_revisions WHERE id = $1;

-- name: GetAuditHistory :many
SELECT id, floor_id, user_id, action, revision_id, created_at, note
FROM map_audit_log
WHERE floor_id = $1
ORDER BY id DESC
LIMIT $2;

-- name: ListRevisions :many
SELECT r.id, r.floor_id, r.status, r.version, r.created_at, r.updated_at, r.published_at, r.created_by, u.username
FROM floor_map_revisions r
LEFT JOIN users u ON u.id = r.created_by
WHERE r.floor_id = $1
ORDER BY r.id DESC
LIMIT $2;

-- name: GetRevisionDataForRestore :one
SELECT floor_id, plan_svg, desks_json, zones_json, layout_json
FROM floor_map_revisions
WHERE id = $1 FOR UPDATE;

-- name: InsertDraftForRestore :one
INSERT INTO floor_map_revisions (floor_id, status, plan_svg, desks_json, zones_json, layout_json, semantic_svg, version, created_by)
VALUES ($1, 'draft', $2, COALESCE($3, '[]'), COALESCE($4, '[]'), $5, NULL, $6, $7)
RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg;

-- name: UpdateDraftForRestore :one
UPDATE floor_map_revisions
SET status = 'draft',
    plan_svg = $2,
    desks_json = COALESCE($3, '[]'),
    zones_json = COALESCE($4, '[]'),
    layout_json = $5,
    semantic_svg = NULL,
    updated_at = now()
WHERE id = $1
RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg;

-- name: GetLockForUpdate :one
SELECT l.floor_id, l.locked_by, COALESCE(u.username, '')::TEXT as username, l.locked_at, l.expires_at
FROM floor_locks l
LEFT JOIN users u ON u.id = l.locked_by
WHERE l.floor_id = $1
FOR UPDATE OF l;

-- name: InsertLock :one
INSERT INTO floor_locks (floor_id, locked_by, locked_at, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING floor_id, locked_by, locked_at, expires_at;

-- name: UpdateLock :one
UPDATE floor_locks
SET locked_by = $2, locked_at = $3, expires_at = $4
WHERE floor_id = $1
RETURNING floor_id, locked_by, locked_at, expires_at;

-- name: ReleaseLock :exec
DELETE FROM floor_locks WHERE floor_id = $1 AND locked_by = $2;

-- name: GetLock :one
SELECT l.floor_id, l.locked_by, COALESCE(u.username, '')::TEXT as username, l.locked_at, l.expires_at
FROM floor_locks l
LEFT JOIN users u ON u.id = l.locked_by
WHERE l.floor_id = $1;

-- name: DeleteExpiredLockForFloor :exec
DELETE FROM floor_locks WHERE floor_id = $1 AND expires_at <= $2;

-- name: CleanupArchivedRevisions :execrows
DELETE FROM floor_map_revisions
WHERE status = 'archived' AND updated_at < $1
AND id NOT IN (
  SELECT COALESCE(published_map_revision_id, 0) FROM floors
  UNION
  SELECT COALESCE(draft_map_revision_id, 0) FROM floors
);

-- name: ListExistingDesksForSync :many
SELECT id, label, qr_token FROM desks WHERE floor_id = $1;

-- name: InsertDeskForSync :exec
INSERT INTO desks (floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token)
VALUES ($1, $2, $3, 'desk', $4, $5, $6, $7, $8, $9);

-- name: UpdateDeskForSync :exec
UPDATE desks
SET label = $2,
    type = $3,
    space_type = 'desk',
    assigned_to = $4,
    position_x = $5,
    position_y = $6,
    w = $7,
    h = $8,
    qr_token = COALESCE(NULLIF(qr_token, ''), $9)
WHERE id = $1;

-- name: LogAudit :exec
INSERT INTO map_audit_log (floor_id, user_id, action, revision_id, note)
VALUES ($1, $2, $3, $4, $5);

-- name: GetExpiredLocks :many
SELECT floor_id FROM floor_locks WHERE expires_at <= $1;

-- name: DeleteExpiredLocks :exec
DELETE FROM floor_locks WHERE expires_at <= $1;
