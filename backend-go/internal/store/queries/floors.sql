-- name: ListFloors :many
SELECT id, office_id, name, plan_url FROM floors ORDER BY id;

-- name: ListFloorsByOffice :many
SELECT id, office_id, name, plan_url FROM floors WHERE office_id = $1 ORDER BY id;

-- name: CheckOfficeExists :one
SELECT EXISTS(SELECT 1 FROM offices WHERE id = $1);

-- name: CreateFloor :one
INSERT INTO floors (office_id, name)
VALUES ($1, $2)
RETURNING id, office_id, name, plan_url;

-- name: UpdateFloor :one
UPDATE floors
SET name = COALESCE(sqlc.narg('name'), name)
WHERE id = $1
RETURNING id, office_id, name, plan_url;

-- name: SetFloorPlanURL :execrows
UPDATE floors
SET plan_url = $2
WHERE id = $1;

-- name: DeleteFloor :execrows
DELETE FROM floors WHERE id = $1;
