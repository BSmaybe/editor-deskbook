package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"

	"deskbook/backend-go/internal/exporter"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrFloorNotFound = errors.New("floor not found")
	ErrNoLayout      = errors.New("no layout found for this floor")
	ErrNoPublished   = errors.New("no published layout")
	ErrNoDraft       = errors.New("no draft to publish")
	ErrNoRevision    = errors.New("no revision to sync desks from")
	ErrConflict      = errors.New("version mismatch")
	ErrInvalidLayout = errors.New("invalid layout")
	ErrUserNotFound  = errors.New("authenticated user not found")
)

const FloorLockTTL = 10 * time.Minute

type LockHeldError struct {
	Username string
}

func (e LockHeldError) Error() string {
	return "Floor is locked by " + e.Username
}

type FloorRefs struct {
	ID          int
	PublishedID sql.NullInt64
	DraftID     sql.NullInt64
}

type LayoutRevision struct {
	ID          int
	FloorID     int
	Status      string
	Version     int
	CreatedAt   sql.NullTime
	UpdatedAt   sql.NullTime
	PublishedAt sql.NullTime
	CreatedBy   sql.NullInt64
	LayoutJSON  sql.NullString
	SemanticSVG sql.NullString
}

type LayoutDocumentResponse struct {
	RevisionID  int                     `json:"revision_id"`
	FloorID     int                     `json:"floor_id"`
	Status      string                  `json:"status"`
	Version     int                     `json:"version"`
	UpdatedAt   *time.Time              `json:"updated_at"`
	PublishedAt *time.Time              `json:"published_at"`
	Layout      exporter.LayoutDocument `json:"layout"`
}

type LayoutDraftPayload struct {
	Version int             `json:"version"`
	Layout  json.RawMessage `json:"layout"`
}

type LayoutDeskSyncResult struct {
	FloorID           int `json:"floor_id"`
	RevisionID        int `json:"revision_id"`
	SourceStatus      string `json:"source_status"`
	Created           int `json:"created"`
	Updated           int `json:"updated"`
	Renamed           int `json:"renamed"`
	TotalLayoutDesks  int `json:"total_layout_desks"`
	UnmatchedExisting int `json:"unmatched_existing"`
	Deleted           int `json:"deleted"`
}

type LayoutRevisionSummary struct {
	RevisionID         int        `json:"revision_id"`
	FloorID            int        `json:"floor_id"`
	Status             string     `json:"status"`
	Version            int        `json:"version"`
	CreatedAt          *time.Time `json:"created_at"`
	UpdatedAt          *time.Time `json:"updated_at"`
	PublishedAt        *time.Time `json:"published_at"`
	CreatedByID        *int       `json:"created_by_id"`
	CreatedByUsername  *string    `json:"created_by_username"`
	IsCurrentPublished bool       `json:"is_current_published"`
	IsCurrentDraft     bool       `json:"is_current_draft"`
}

type AuditLogEntry struct {
	ID         int        `json:"id"`
	FloorID    int        `json:"floor_id"`
	UserID     *int       `json:"user_id"`
	Action     string     `json:"action"`
	RevisionID *int       `json:"revision_id"`
	CreatedAt  *time.Time `json:"created_at"`
	Note       *string    `json:"note"`
}

type FloorLockOut struct {
	FloorID          int       `json:"floor_id"`
	LockedByID       int       `json:"locked_by_id"`
	LockedByUsername string    `json:"locked_by_username"`
	LockedAt         time.Time `json:"locked_at"`
	ExpiresAt        time.Time `json:"expires_at"`
}

type deskSyncStats struct {
	Created           int
	Updated           int
	Renamed           int
	TotalLayoutDesks  int
	UnmatchedExisting int
	UnmatchedIDs      []int
}

type existingDesk struct {
	ID      int
	Label   string
	QRToken sql.NullString
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type LayoutStore struct {
	pool *pgxpool.Pool
}

func NewLayoutStore(pool *pgxpool.Pool) *LayoutStore {
	return &LayoutStore{pool: pool}
}

func (s *LayoutStore) EnsureSchema(ctx context.Context) error {
	statements := []string{
		`
		CREATE TABLE IF NOT EXISTS floor_map_revisions (
			id           SERIAL PRIMARY KEY,
			floor_id     INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
			status       VARCHAR(20) NOT NULL DEFAULT 'draft',
			plan_svg     TEXT,
			desks_json   TEXT NOT NULL DEFAULT '[]',
			zones_json   TEXT NOT NULL DEFAULT '[]',
			version      INTEGER NOT NULL DEFAULT 1,
			created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
			published_at TIMESTAMPTZ,
			created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
		)
		`,
		`CREATE INDEX IF NOT EXISTS idx_fmr_floor_id ON floor_map_revisions(floor_id)`,
		`ALTER TABLE floor_map_revisions ADD COLUMN IF NOT EXISTS layout_json TEXT`,
		`ALTER TABLE floor_map_revisions ADD COLUMN IF NOT EXISTS semantic_svg TEXT`,
		`ALTER TABLE floors ADD COLUMN IF NOT EXISTS published_map_revision_id INTEGER`,
		`ALTER TABLE floors ADD COLUMN IF NOT EXISTS draft_map_revision_id INTEGER`,
		`
		CREATE TABLE IF NOT EXISTS floor_locks (
			id         SERIAL PRIMARY KEY,
			floor_id   INTEGER NOT NULL UNIQUE REFERENCES floors(id) ON DELETE CASCADE,
			locked_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			expires_at TIMESTAMPTZ NOT NULL
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS map_audit_log (
			id          SERIAL PRIMARY KEY,
			floor_id    INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
			user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
			action      VARCHAR(50) NOT NULL,
			revision_id INTEGER,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			note        TEXT
		)
		`,
		`CREATE INDEX IF NOT EXISTS idx_mal_floor_id ON map_audit_log(floor_id)`,
	}
	for _, stmt := range statements {
		if _, err := s.pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *LayoutStore) GetDraftOrPublished(ctx context.Context, floorID int) (LayoutDocumentResponse, error) {
	floor, err := getFloorRefs(ctx, s.pool, floorID, false)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if floor.DraftID.Valid {
		if rev, err := getLayoutRevision(ctx, s.pool, int(floor.DraftID.Int64), false); err == nil {
			return responseFromRevision(rev), nil
		}
	}
	if floor.PublishedID.Valid {
		if rev, err := getLayoutRevision(ctx, s.pool, int(floor.PublishedID.Int64), false); err == nil {
			return responseFromRevision(rev), nil
		}
	}
	return LayoutDocumentResponse{}, ErrNoLayout
}

func (s *LayoutStore) GetPublished(ctx context.Context, floorID int) (LayoutDocumentResponse, error) {
	floor, err := getFloorRefs(ctx, s.pool, floorID, false)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if !floor.PublishedID.Valid {
		return LayoutDocumentResponse{}, ErrNoPublished
	}
	rev, err := getLayoutRevision(ctx, s.pool, int(floor.PublishedID.Int64), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return LayoutDocumentResponse{}, ErrNoPublished
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(rev), nil
}

func (s *LayoutStore) GetPublishedSemanticSVG(ctx context.Context, floorID int) (string, error) {
	floor, err := getFloorRefs(ctx, s.pool, floorID, false)
	if err != nil {
		return "", err
	}
	if !floor.PublishedID.Valid {
		return "", ErrNoPublished
	}
	rev, err := getLayoutRevision(ctx, s.pool, int(floor.PublishedID.Int64), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoPublished
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(rev.SemanticSVG.String) != "" {
		return rev.SemanticSVG.String, nil
	}
	layout := layoutFromRevision(rev)
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidLayout, err)
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE floor_map_revisions
		SET semantic_svg=$2, updated_at=now()
		WHERE id=$1
	`, rev.ID, svg)
	return svg, nil
}

func (s *LayoutStore) SaveDraft(ctx context.Context, floorID int, version int, layoutJSON string, userID sql.NullInt64) (LayoutDocumentResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	defer rollbackQuietly(ctx, tx)

	floor, err := getFloorRefs(ctx, tx, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}

	var rev LayoutRevision
	if floor.DraftID.Valid {
		rev, err = getLayoutRevision(ctx, tx, int(floor.DraftID.Int64), true)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return LayoutDocumentResponse{}, err
		}
		if err == nil {
			if rev.Version != version {
				return LayoutDocumentResponse{}, fmt.Errorf("%w: expected %d, got %d", ErrConflict, rev.Version, version)
			}
			row := tx.QueryRow(ctx, `
				UPDATE floor_map_revisions
				SET layout_json=$2, semantic_svg=NULL, status='draft', updated_at=now()
				WHERE id=$1
				RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
			`, rev.ID, layoutJSON)
			rev, err = scanLayoutRevision(row)
			if err != nil {
				return LayoutDocumentResponse{}, err
			}
			_ = logAuditTx(ctx, tx, floorID, userID, "saved", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, "")
			if err := tx.Commit(ctx); err != nil {
				return LayoutDocumentResponse{}, err
			}
			return responseFromRevision(rev), nil
		}
	}

	draftVersion := 1
	if floor.PublishedID.Valid {
		published, err := getLayoutRevision(ctx, tx, int(floor.PublishedID.Int64), true)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return LayoutDocumentResponse{}, err
		}
		if err == nil {
			draftVersion = published.Version + 1
		}
	}
	if version != draftVersion && version != maxInt(0, draftVersion-1) {
		return LayoutDocumentResponse{}, fmt.Errorf("%w: expected %d (or %d), got %d", ErrConflict, draftVersion, maxInt(0, draftVersion-1), version)
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO floor_map_revisions (floor_id, status, desks_json, zones_json, layout_json, semantic_svg, version, created_by)
		VALUES ($1, 'draft', '[]', '[]', $2, NULL, $3, $4)
		RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
	`, floorID, layoutJSON, draftVersion, nullableIntArg(userID))
	rev, err = scanLayoutRevision(row)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE floors SET draft_map_revision_id=$2 WHERE id=$1`, floorID, rev.ID); err != nil {
		return LayoutDocumentResponse{}, err
	}
	_ = logAuditTx(ctx, tx, floorID, userID, "saved", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, "")
	if err := tx.Commit(ctx); err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(rev), nil
}

func (s *LayoutStore) Publish(ctx context.Context, floorID int, userID sql.NullInt64) (LayoutDocumentResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	defer rollbackQuietly(ctx, tx)

	floor, err := getFloorRefs(ctx, tx, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if !floor.DraftID.Valid {
		return LayoutDocumentResponse{}, ErrNoDraft
	}
	draft, err := getLayoutRevision(ctx, tx, int(floor.DraftID.Int64), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return LayoutDocumentResponse{}, errors.New("draft revision missing")
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if floor.PublishedID.Valid {
		if _, err := tx.Exec(ctx, `UPDATE floor_map_revisions SET status='archived', updated_at=now() WHERE id=$1`, int(floor.PublishedID.Int64)); err != nil {
			return LayoutDocumentResponse{}, err
		}
	}

	layout := layoutFromRevision(draft)
	layout = injectFreshComponentsFromPool(ctx, s.pool, layout)
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		return LayoutDocumentResponse{}, fmt.Errorf("%w: %v", ErrInvalidLayout, err)
	}
	row := tx.QueryRow(ctx, `
		UPDATE floor_map_revisions
		SET semantic_svg=$2, status='published', published_at=now(), updated_at=now()
		WHERE id=$1
		RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
	`, draft.ID, svg)
	published, err := scanLayoutRevision(row)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE floors
		SET published_map_revision_id=$2, draft_map_revision_id=NULL
		WHERE id=$1
	`, floorID, published.ID); err != nil {
		return LayoutDocumentResponse{}, err
	}
	_ = logAuditTx(ctx, tx, floorID, userID, "published", sql.NullInt64{Int64: int64(published.ID), Valid: true}, "")
	if _, err := syncDesksTx(ctx, tx, floorID, published); err != nil {
		return LayoutDocumentResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(published), nil
}

func (s *LayoutStore) SyncDesksForFloor(ctx context.Context, floorID int, source string, cleanup bool, userID sql.NullInt64) (LayoutDeskSyncResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LayoutDeskSyncResult{}, err
	}
	defer rollbackQuietly(ctx, tx)

	floor, err := getFloorRefs(ctx, tx, floorID, true)
	if err != nil {
		return LayoutDeskSyncResult{}, err
	}
	sourceStatus := source
	var revisionID sql.NullInt64
	if source == "draft" && floor.DraftID.Valid {
		revisionID = floor.DraftID
	}
	if !revisionID.Valid && floor.PublishedID.Valid {
		revisionID = floor.PublishedID
		sourceStatus = "published"
	}
	if !revisionID.Valid {
		return LayoutDeskSyncResult{}, ErrNoRevision
	}
	rev, err := getLayoutRevision(ctx, tx, int(revisionID.Int64), true)
	if err != nil {
		return LayoutDeskSyncResult{}, err
	}
	stats, err := syncDesksTx(ctx, tx, floorID, rev)
	if err != nil {
		return LayoutDeskSyncResult{}, err
	}

	deleted := 0
	if cleanup {
		for _, deskID := range stats.UnmatchedIDs {
			tag, err := tx.Exec(ctx, `DELETE FROM desks WHERE id=$1`, deskID)
			if err != nil {
				return LayoutDeskSyncResult{}, err
			}
			deleted += int(tag.RowsAffected())
		}
	}

	note := fmt.Sprintf("source:%s;cleanup:%d;deleted:%d", sourceStatus, boolInt(cleanup), deleted)
	_ = logAuditTx(ctx, tx, floorID, userID, "desks_synced", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, note)
	if err := tx.Commit(ctx); err != nil {
		return LayoutDeskSyncResult{}, err
	}
	return LayoutDeskSyncResult{
		FloorID:           floorID,
		RevisionID:        rev.ID,
		SourceStatus:      sourceStatus,
		Created:           stats.Created,
		Updated:           stats.Updated,
		Renamed:           stats.Renamed,
		TotalLayoutDesks:  stats.TotalLayoutDesks,
		UnmatchedExisting: stats.UnmatchedExisting,
		Deleted:           deleted,
	}, nil
}

func (s *LayoutStore) DiscardDraft(ctx context.Context, floorID int, userID sql.NullInt64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackQuietly(ctx, tx)

	floor, err := getFloorRefs(ctx, tx, floorID, true)
	if err != nil {
		return err
	}
	if floor.DraftID.Valid {
		if _, err := tx.Exec(ctx, `UPDATE floors SET draft_map_revision_id=NULL WHERE id=$1`, floorID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM floor_map_revisions WHERE id=$1`, int(floor.DraftID.Int64)); err != nil {
			return err
		}
	}
	_ = logAuditTx(ctx, tx, floorID, userID, "discarded", sql.NullInt64{}, "")
	return tx.Commit(ctx)
}

func (s *LayoutStore) GetHistory(ctx context.Context, floorID int, limit int) ([]AuditLogEntry, error) {
	if _, err := getFloorRefs(ctx, s.pool, floorID, false); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, floor_id, user_id, action, revision_id, created_at, note
		FROM map_audit_log
		WHERE floor_id=$1
		ORDER BY id DESC
		LIMIT $2
	`, floorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []AuditLogEntry{}
	for rows.Next() {
		var entry AuditLogEntry
		var userID sql.NullInt64
		var revisionID sql.NullInt64
		var createdAt sql.NullTime
		var note sql.NullString
		if err := rows.Scan(&entry.ID, &entry.FloorID, &userID, &entry.Action, &revisionID, &createdAt, &note); err != nil {
			return nil, err
		}
		entry.UserID = nullIntPtr(userID)
		entry.RevisionID = nullIntPtr(revisionID)
		entry.CreatedAt = nullTimePtr(createdAt)
		entry.Note = nullStringPtr(note)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *LayoutStore) ListRevisions(ctx context.Context, floorID int, limit int) ([]LayoutRevisionSummary, error) {
	floor, err := getFloorRefs(ctx, s.pool, floorID, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.floor_id, r.status, r.version, r.created_at, r.updated_at, r.published_at,
		       r.created_by, u.username
		FROM floor_map_revisions r
		LEFT JOIN users u ON u.id = r.created_by
		WHERE r.floor_id=$1
		ORDER BY r.id DESC
		LIMIT $2
	`, floorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	revisions := []LayoutRevisionSummary{}
	for rows.Next() {
		var item LayoutRevisionSummary
		var createdAt, updatedAt, publishedAt sql.NullTime
		var createdBy sql.NullInt64
		var createdByUsername sql.NullString
		if err := rows.Scan(
			&item.RevisionID,
			&item.FloorID,
			&item.Status,
			&item.Version,
			&createdAt,
			&updatedAt,
			&publishedAt,
			&createdBy,
			&createdByUsername,
		); err != nil {
			return nil, err
		}
		item.CreatedAt = nullTimePtr(createdAt)
		item.UpdatedAt = nullTimePtr(updatedAt)
		item.PublishedAt = nullTimePtr(publishedAt)
		item.CreatedByID = nullIntPtr(createdBy)
		item.CreatedByUsername = nullStringPtr(createdByUsername)
		item.IsCurrentPublished = floor.PublishedID.Valid && int(floor.PublishedID.Int64) == item.RevisionID
		item.IsCurrentDraft = floor.DraftID.Valid && int(floor.DraftID.Int64) == item.RevisionID
		revisions = append(revisions, item)
	}
	return revisions, rows.Err()
}

func (s *LayoutStore) GetRevision(ctx context.Context, floorID int, revisionID int) (LayoutDocumentResponse, error) {
	if _, err := getFloorRefs(ctx, s.pool, floorID, false); err != nil {
		return LayoutDocumentResponse{}, err
	}
	rev, err := getLayoutRevision(ctx, s.pool, revisionID, false)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && rev.FloorID != floorID) {
		return LayoutDocumentResponse{}, fmt.Errorf("revision %d not found for floor %d", revisionID, floorID)
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(rev), nil
}

func (s *LayoutStore) RestoreRevisionToDraft(ctx context.Context, floorID int, revisionID int, userID sql.NullInt64) (LayoutDocumentResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	defer rollbackQuietly(ctx, tx)

	floor, err := getFloorRefs(ctx, tx, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}

	var sourceFloorID int
	var planSVG sql.NullString
	var desksJSON sql.NullString
	var zonesJSON sql.NullString
	var layoutJSON sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT floor_id, plan_svg, desks_json, zones_json, layout_json
		FROM floor_map_revisions
		WHERE id=$1
		FOR UPDATE
	`, revisionID).Scan(&sourceFloorID, &planSVG, &desksJSON, &zonesJSON, &layoutJSON)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && sourceFloorID != floorID) {
		return LayoutDocumentResponse{}, fmt.Errorf("revision %d not found for floor %d", revisionID, floorID)
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}

	var draftID int
	if floor.DraftID.Valid {
		draftID = int(floor.DraftID.Int64)
	} else {
		draftVersion := 1
		if floor.PublishedID.Valid {
			if published, err := getLayoutRevision(ctx, tx, int(floor.PublishedID.Int64), true); err == nil {
				draftVersion = published.Version + 1
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return LayoutDocumentResponse{}, err
			}
		}
		row := tx.QueryRow(ctx, `
			INSERT INTO floor_map_revisions (floor_id, status, plan_svg, desks_json, zones_json, layout_json, semantic_svg, version, created_by)
			VALUES ($1, 'draft', $2, COALESCE($3, '[]'), COALESCE($4, '[]'), $5, NULL, $6, $7)
			RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
		`, floorID, nullableStringArg(planSVG), nullableStringArg(desksJSON), nullableStringArg(zonesJSON), nullableStringArg(layoutJSON), draftVersion, nullableIntArg(userID))
		draft, err := scanLayoutRevision(row)
		if err != nil {
			return LayoutDocumentResponse{}, err
		}
		draftID = draft.ID
		if _, err := tx.Exec(ctx, `UPDATE floors SET draft_map_revision_id=$2 WHERE id=$1`, floorID, draftID); err != nil {
			return LayoutDocumentResponse{}, err
		}
	}

	row := tx.QueryRow(ctx, `
		UPDATE floor_map_revisions
		SET status='draft',
		    plan_svg=$2,
		    desks_json=COALESCE($3, '[]'),
		    zones_json=COALESCE($4, '[]'),
		    layout_json=$5,
		    semantic_svg=NULL,
		    updated_at=now()
		WHERE id=$1
		RETURNING id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
	`, draftID, nullableStringArg(planSVG), nullableStringArg(desksJSON), nullableStringArg(zonesJSON), nullableStringArg(layoutJSON))
	draft, err := scanLayoutRevision(row)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	_ = logAuditTx(
		ctx,
		tx,
		floorID,
		userID,
		"rolled_back",
		sql.NullInt64{Int64: int64(draft.ID), Valid: true},
		fmt.Sprintf("restored_from_revision:%d", revisionID),
	)
	if err := tx.Commit(ctx); err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(draft), nil
}

func (s *LayoutStore) UserIDForUsername(ctx context.Context, username string) sql.NullInt64 {
	username = strings.TrimSpace(username)
	if username == "" {
		return sql.NullInt64{}
	}
	var id int64
	if err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE username=$1`, username).Scan(&id); err != nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: id, Valid: true}
}

func (s *LayoutStore) RequireUserID(ctx context.Context, username string) (int, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return 0, ErrUserNotFound
	}
	var id int
	if err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE username=$1`, username).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrUserNotFound
		}
		return 0, err
	}
	return id, nil
}

func (s *LayoutStore) AcquireLock(ctx context.Context, floorID int, userID int) (FloorLockOut, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FloorLockOut{}, err
	}
	defer rollbackQuietly(ctx, tx)

	if _, err := getFloorRefs(ctx, tx, floorID, true); err != nil {
		return FloorLockOut{}, err
	}

	now := time.Now().UTC()
	expiresAt := now.Add(FloorLockTTL)
	var existing FloorLockOut
	err = tx.QueryRow(ctx, `
		SELECT l.floor_id, l.locked_by, COALESCE(u.username, ''), l.locked_at, l.expires_at
		FROM floor_locks l
		LEFT JOIN users u ON u.id = l.locked_by
		WHERE l.floor_id=$1
		FOR UPDATE OF l
	`, floorID).Scan(
		&existing.FloorID,
		&existing.LockedByID,
		&existing.LockedByUsername,
		&existing.LockedAt,
		&existing.ExpiresAt,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return FloorLockOut{}, err
	}
	if err == nil && existing.LockedByID != userID && existing.ExpiresAt.After(now) {
		return FloorLockOut{}, LockHeldError{Username: lockUsername(existing.LockedByUsername, existing.LockedByID)}
	}

	var lock FloorLockOut
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO floor_locks (floor_id, locked_by, locked_at, expires_at)
			VALUES ($1, $2, $3, $4)
			RETURNING floor_id, locked_by, locked_at, expires_at
		`, floorID, userID, now, expiresAt).Scan(
			&lock.FloorID,
			&lock.LockedByID,
			&lock.LockedAt,
			&lock.ExpiresAt,
		)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE floor_locks
			SET locked_by=$2, locked_at=$3, expires_at=$4
			WHERE floor_id=$1
			RETURNING floor_id, locked_by, locked_at, expires_at
		`, floorID, userID, now, expiresAt).Scan(
			&lock.FloorID,
			&lock.LockedByID,
			&lock.LockedAt,
			&lock.ExpiresAt,
		)
	}
	if err != nil {
		return FloorLockOut{}, err
	}
	lock.LockedByUsername = lockUsername(usernameForUserID(ctx, tx, userID), userID)
	if err := tx.Commit(ctx); err != nil {
		return FloorLockOut{}, err
	}
	return lock, nil
}

func (s *LayoutStore) ReleaseLock(ctx context.Context, floorID int, userID int) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM floor_locks
		WHERE floor_id=$1 AND locked_by=$2
	`, floorID, userID)
	return err
}

func (s *LayoutStore) GetLock(ctx context.Context, floorID int) (FloorLockOut, bool, error) {
	var lock FloorLockOut
	err := s.pool.QueryRow(ctx, `
		SELECT l.floor_id, l.locked_by, COALESCE(u.username, ''), l.locked_at, l.expires_at
		FROM floor_locks l
		LEFT JOIN users u ON u.id = l.locked_by
		WHERE l.floor_id=$1
	`, floorID).Scan(
		&lock.FloorID,
		&lock.LockedByID,
		&lock.LockedByUsername,
		&lock.LockedAt,
		&lock.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return FloorLockOut{}, false, nil
	}
	if err != nil {
		return FloorLockOut{}, false, err
	}
	now := time.Now().UTC()
	if !lock.ExpiresAt.After(now) {
		if _, err := s.pool.Exec(ctx, `DELETE FROM floor_locks WHERE floor_id=$1 AND expires_at <= $2`, floorID, now); err != nil {
			return FloorLockOut{}, false, err
		}
		return FloorLockOut{}, false, nil
	}
	lock.LockedByUsername = lockUsername(lock.LockedByUsername, lock.LockedByID)
	return lock, true, nil
}

func (s *LayoutStore) CleanupArchivedRevisions(ctx context.Context, olderThanDays int) (int, error) {
	cutoff := time.Now().AddDate(0, 0, -olderThanDays)
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM floor_map_revisions
		 WHERE status = 'archived' AND updated_at < $1
		 AND id NOT IN (
		   SELECT COALESCE(published_map_revision_id, 0) FROM floors
		   UNION
		   SELECT COALESCE(draft_map_revision_id, 0) FROM floors
		 )`, cutoff)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func usernameForUserID(ctx context.Context, q rowQuerier, userID int) string {
	var username string
	if err := q.QueryRow(ctx, `SELECT username FROM users WHERE id=$1`, userID).Scan(&username); err != nil {
		return ""
	}
	return username
}

func lockUsername(username string, userID int) string {
	if value := strings.TrimSpace(username); value != "" {
		return value
	}
	return strconv.Itoa(userID)
}

func getFloorRefs(ctx context.Context, q rowQuerier, floorID int, lock bool) (FloorRefs, error) {
	stmt := `SELECT id, published_map_revision_id, draft_map_revision_id FROM floors WHERE id=$1`
	if lock {
		stmt += ` FOR UPDATE`
	}
	var floor FloorRefs
	if err := q.QueryRow(ctx, stmt, floorID).Scan(&floor.ID, &floor.PublishedID, &floor.DraftID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FloorRefs{}, ErrFloorNotFound
		}
		return FloorRefs{}, err
	}
	return floor, nil
}

func getLayoutRevision(ctx context.Context, q rowQuerier, revisionID int, lock bool) (LayoutRevision, error) {
	stmt := `
		SELECT id, floor_id, status, version, created_at, updated_at, published_at, created_by, layout_json, semantic_svg
		FROM floor_map_revisions
		WHERE id=$1
	`
	if lock {
		stmt += ` FOR UPDATE`
	}
	return scanLayoutRevision(q.QueryRow(ctx, stmt, revisionID))
}

func scanLayoutRevision(row pgx.Row) (LayoutRevision, error) {
	var rev LayoutRevision
	err := row.Scan(
		&rev.ID,
		&rev.FloorID,
		&rev.Status,
		&rev.Version,
		&rev.CreatedAt,
		&rev.UpdatedAt,
		&rev.PublishedAt,
		&rev.CreatedBy,
		&rev.LayoutJSON,
		&rev.SemanticSVG,
	)
	return rev, err
}

func responseFromRevision(rev LayoutRevision) LayoutDocumentResponse {
	return LayoutDocumentResponse{
		RevisionID:  rev.ID,
		FloorID:     rev.FloorID,
		Status:      rev.Status,
		Version:     rev.Version,
		UpdatedAt:   nullTimePtr(rev.UpdatedAt),
		PublishedAt: nullTimePtr(rev.PublishedAt),
		Layout:      layoutFromRevision(rev),
	}
}

func layoutFromRevision(rev LayoutRevision) exporter.LayoutDocument {
	if !rev.LayoutJSON.Valid || strings.TrimSpace(rev.LayoutJSON.String) == "" {
		return defaultLayoutDocument()
	}
	doc, err := exporter.ParseLayoutJSON([]byte(rev.LayoutJSON.String))
	if err != nil {
		return defaultLayoutDocument()
	}
	normalizeLayoutDocument(&doc)
	return doc
}

func injectFreshComponentsFromPool(ctx context.Context, pool *pgxpool.Pool, layout exporter.LayoutDocument) exporter.LayoutDocument {
	rows, err := pool.Query(ctx, `SELECT id, label, asset_type, view_box, default_w, default_h, svg_markup FROM global_components`)
	if err != nil {
		return layout
	}
	defer rows.Close()
	fresh := map[string]exporter.LayoutComponent{}
	for rows.Next() {
		var (
			id, label, assetType, svgMarkup string
			viewBoxStr                        string
			defaultW, defaultH                float64
		)
		if err := rows.Scan(&id, &label, &assetType, &viewBoxStr, &defaultW, &defaultH, &svgMarkup); err != nil {
			continue
		}
		var vb []float64
		parts := strings.Fields(viewBoxStr)
		for _, p := range parts {
			if v, err := strconv.ParseFloat(p, 64); err == nil {
				vb = append(vb, v)
			}
		}
		if len(vb) < 4 {
			vb = []float64{0, 0, defaultW, defaultH}
		}
		fresh[id] = exporter.LayoutComponent{
			ID:        id,
			Label:     label,
			AssetType: assetType,
			ViewBox:   vb,
			DefaultW:  defaultW,
			DefaultH:  defaultH,
			SVGMarkup: svgMarkup,
		}
	}
	if len(fresh) == 0 {
		return layout
	}
	byID := map[string]exporter.LayoutComponent{}
	for _, c := range layout.Components {
		byID[c.ID] = c
	}
	for id, fc := range fresh {
		if existing, ok := byID[id]; ok {
			existing.SVGMarkup = fc.SVGMarkup
			existing.ViewBox = fc.ViewBox
			existing.DefaultW = fc.DefaultW
			existing.DefaultH = fc.DefaultH
			byID[id] = existing
		} else {
			byID[id] = fc
		}
	}
	merged := make([]exporter.LayoutComponent, 0, len(byID))
	for _, c := range byID {
		merged = append(merged, c)
	}
	layout.Components = merged
	return layout
}



func normalizeLayoutDocument(doc *exporter.LayoutDocument) {
	if doc.Version == 0 {
		doc.Version = 2
	}
	if len(doc.ViewBox) != 4 || doc.ViewBox[2] <= 0 || doc.ViewBox[3] <= 0 {
		doc.ViewBox = []float64{0, 0, 1000, 1000}
	}
	if doc.Components == nil {
		doc.Components = []exporter.LayoutComponent{}
	}
	if doc.Walls == nil {
		doc.Walls = []exporter.StructureElement{}
	}
	if doc.Boundaries == nil {
		doc.Boundaries = []exporter.StructureElement{}
	}
	if doc.Partitions == nil {
		doc.Partitions = []exporter.StructureElement{}
	}
	if doc.Doors == nil {
		doc.Doors = []exporter.StructureElement{}
	}
	if doc.Desks == nil {
		doc.Desks = []exporter.LayoutDesk{}
	}
}

func defaultLayoutDocument() exporter.LayoutDocument {
	doc := exporter.LayoutDocument{
		Version: 2,
		ViewBox: []float64{0, 0, 1000, 1000},
	}
	normalizeLayoutDocument(&doc)
	return doc
}

func syncDesksTx(ctx context.Context, tx pgx.Tx, floorID int, rev LayoutRevision) (deskSyncStats, error) {
	layout := layoutFromRevision(rev)
	vbx, vby, vbw, vbh := effectiveLayoutViewBox(layout)
	existing, err := listExistingDesks(ctx, tx, floorID)
	if err != nil {
		return deskSyncStats{}, err
	}

	byExact := map[string][]*existingDesk{}
	byNorm := map[string][]*existingDesk{}
	for i := range existing {
		desk := &existing[i]
		key := strings.TrimSpace(desk.Label)
		byExact[key] = append(byExact[key], desk)
		if norm := normalizedLabel(key); norm != "" {
			byNorm[norm] = append(byNorm[norm], desk)
		}
	}

	seenLabels := map[string]bool{}
	usedExisting := map[int]bool{}
	stats := deskSyncStats{}
	pickUnused := func(items []*existingDesk) *existingDesk {
		for _, item := range items {
			if !usedExisting[item.ID] {
				return item
			}
		}
		return nil
	}

	for _, layoutDesk := range layout.Desks {
		assetType := strings.TrimSpace(layoutDesk.AssetType)
		if assetType == "" {
			assetType = "workplace"
		}
		if assetType != "workplace" {
			continue
		}
		label := strings.TrimSpace(layoutDesk.Label)
		if label == "" || seenLabels[label] {
			continue
		}
		seenLabels[label] = true
		stats.TotalLayoutDesks++

		desk := pickUnused(byExact[label])
		if desk == nil {
			desk = pickUnused(byNorm[normalizedLabel(label)])
		}

		deskType := "flex"
		if layoutDesk.Fixed {
			deskType = "fixed"
		}
		positionX := clamp((layoutDesk.X-vbx)/vbw, 0, 1)
		positionY := clamp((layoutDesk.Y-vby)/vbh, 0, 1)
		width := clamp(layoutDesk.W/vbw, 0.01, 1)
		height := clamp(layoutDesk.H/vbh, 0.01, 1)
		assignedTo := nullableString(strings.TrimSpace(layoutDesk.AssignedTo))
		qrToken := uuidV4()

		if desk == nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO desks (floor_id, label, type, space_type, assigned_to, position_x, position_y, w, h, qr_token)
				VALUES ($1, $2, $3, 'desk', $4, $5, $6, $7, $8, $9)
			`, floorID, label, deskType, assignedTo, positionX, positionY, width, height, qrToken); err != nil {
				return stats, err
			}
			stats.Created++
			continue
		}

		usedExisting[desk.ID] = true
		stats.Updated++
		if strings.TrimSpace(desk.Label) != label {
			stats.Renamed++
		}
		if _, err := tx.Exec(ctx, `
			UPDATE desks
			SET label=$2,
				type=$3,
				space_type='desk',
				assigned_to=$4,
				position_x=$5,
				position_y=$6,
				w=$7,
				h=$8,
				qr_token=COALESCE(NULLIF(qr_token, ''), $9)
			WHERE id=$1
		`, desk.ID, label, deskType, assignedTo, positionX, positionY, width, height, qrToken); err != nil {
			return stats, err
		}
	}

	for _, desk := range existing {
		if !usedExisting[desk.ID] {
			stats.UnmatchedIDs = append(stats.UnmatchedIDs, desk.ID)
		}
	}
	stats.UnmatchedExisting = len(stats.UnmatchedIDs)
	return stats, nil
}

func listExistingDesks(ctx context.Context, tx pgx.Tx, floorID int) ([]existingDesk, error) {
	rows, err := tx.Query(ctx, `SELECT id, label, qr_token FROM desks WHERE floor_id=$1`, floorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []existingDesk{}
	for rows.Next() {
		var desk existingDesk
		if err := rows.Scan(&desk.ID, &desk.Label, &desk.QRToken); err != nil {
			return nil, err
		}
		out = append(out, desk)
	}
	return out, rows.Err()
}

func effectiveLayoutViewBox(layout exporter.LayoutDocument) (float64, float64, float64, float64) {
	vx, vy, vw, vh := 0.0, 0.0, 1000.0, 1000.0
	if len(layout.ViewBox) >= 4 && layout.ViewBox[2] > 0 && layout.ViewBox[3] > 0 {
		vx, vy, vw, vh = layout.ViewBox[0], layout.ViewBox[1], layout.ViewBox[2], layout.ViewBox[3]
	}
	boxes := [][4]float64{}
	for _, desk := range layout.Desks {
		if desk.W <= 0 || desk.H <= 0 {
			continue
		}
		boxes = append(boxes, [4]float64{desk.X, desk.Y, desk.X + desk.W, desk.Y + desk.H})
	}
	if len(boxes) == 0 {
		return vx, vy, math.Max(vw, 1), math.Max(vh, 1)
	}
	minX, minY, maxX, maxY := boxes[0][0], boxes[0][1], boxes[0][2], boxes[0][3]
	for _, box := range boxes[1:] {
		minX = math.Min(minX, box[0])
		minY = math.Min(minY, box[1])
		maxX = math.Max(maxX, box[2])
		maxY = math.Max(maxY, box[3])
	}
	spanW := math.Max(1, maxX-minX)
	spanH := math.Max(1, maxY-minY)
	outOfViewBox := minX < vx-vw*0.12 || maxX > vx+vw*1.12 || minY < vy-vh*0.12 || maxY > vy+vh*1.12
	defaultLike := math.Abs(vx) < 1e-6 && math.Abs(vy) < 1e-6 && math.Abs(vw-1000) < 1e-6 && math.Abs(vh-1000) < 1e-6
	if outOfViewBox || defaultLike {
		return minX, minY, spanW, spanH
	}
	return vx, vy, vw, vh
}

func logAuditTx(ctx context.Context, tx pgx.Tx, floorID int, userID sql.NullInt64, action string, revisionID sql.NullInt64, note string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO map_audit_log (floor_id, user_id, action, revision_id, note)
		VALUES ($1, $2, $3, $4, $5)
	`, floorID, nullableIntArg(userID), action, nullableIntArg(revisionID), nullableString(note))
	return err
}

func rollbackQuietly(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func nullIntPtr(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	out := int(value.Int64)
	return &out
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableStringArg(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullableIntArg(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}

func normalizedLabel(value string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(value) {
		upper := unicode.ToUpper(r)
		if unicode.IsDigit(upper) || (upper >= 'A' && upper <= 'Z') || (upper >= 'А' && upper <= 'Я') || upper == 'Ё' {
			b.WriteRune(upper)
		}
	}
	return b.String()
}

func clamp(value, lo, hi float64) float64 {
	if value < lo || math.IsNaN(value) || math.IsInf(value, 0) {
		return lo
	}
	if value > hi {
		return hi
	}
	return value
}

func uuidV4() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("go-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexed := hex.EncodeToString(b[:])
	return hexed[0:8] + "-" + hexed[8:12] + "-" + hexed[12:16] + "-" + hexed[16:20] + "-" + hexed[20:32]
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (s *LayoutStore) GetAndCleanupExpiredLocks(ctx context.Context) ([]int, error) {
	now := time.Now().UTC()
	rows, err := s.pool.Query(ctx, `SELECT floor_id FROM floor_locks WHERE expires_at <= $1`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var floorIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		floorIDs = append(floorIDs, id)
	}
	if len(floorIDs) > 0 {
		_, err = s.pool.Exec(ctx, `DELETE FROM floor_locks WHERE expires_at <= $1`, now)
		if err != nil {
			return nil, err
		}
	}
	return floorIDs, nil
}

