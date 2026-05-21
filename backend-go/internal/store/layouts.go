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
	"deskbook/backend-go/internal/store/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	FloorID           int    `json:"floor_id"`
	RevisionID        int    `json:"revision_id"`
	SourceStatus      string `json:"source_status"`
	Created           int    `json:"created"`
	Updated           int    `json:"updated"`
	Renamed           int    `json:"renamed"`
	TotalLayoutDesks  int    `json:"total_layout_desks"`
	UnmatchedExisting int    `json:"unmatched_existing"`
	Deleted           int    `json:"deleted"`
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

type LayoutStore struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewLayoutStore(pool *pgxpool.Pool) *LayoutStore {
	return &LayoutStore{
		pool: pool,
		q:    db.New(pool),
	}
}

func mapFloorRefs(row db.GetFloorRefsRow) FloorRefs {
	return FloorRefs{
		ID:          int(row.ID),
		PublishedID: int4ToNullInt64(row.PublishedMapRevisionID),
		DraftID:     int4ToNullInt64(row.DraftMapRevisionID),
	}
}

func mapFloorRefsForUpdate(row db.GetFloorRefsForUpdateRow) FloorRefs {
	return FloorRefs{
		ID:          int(row.ID),
		PublishedID: int4ToNullInt64(row.PublishedMapRevisionID),
		DraftID:     int4ToNullInt64(row.DraftMapRevisionID),
	}
}

func mapGetLayoutRevisionRow(r db.GetLayoutRevisionRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapGetLayoutRevisionForUpdateRow(r db.GetLayoutRevisionForUpdateRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapInsertDraftLayoutRow(r db.InsertDraftLayoutRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapUpdateDraftLayoutRow(r db.UpdateDraftLayoutRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapPublishRevisionRow(r db.PublishRevisionRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapInsertDraftForRestoreRow(r db.InsertDraftForRestoreRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapUpdateDraftForRestoreRow(r db.UpdateDraftForRestoreRow) LayoutRevision {
	return LayoutRevision{
		ID:          int(r.ID),
		FloorID:     int(r.FloorID),
		Status:      r.Status,
		Version:     int(r.Version),
		CreatedAt:   sql.NullTime{Time: r.CreatedAt.Time, Valid: r.CreatedAt.Valid},
		UpdatedAt:   sql.NullTime{Time: r.UpdatedAt.Time, Valid: r.UpdatedAt.Valid},
		PublishedAt: sql.NullTime{Time: r.PublishedAt.Time, Valid: r.PublishedAt.Valid},
		CreatedBy:   int4ToNullInt64(r.CreatedBy),
		LayoutJSON:  sql.NullString{String: r.LayoutJson.String, Valid: r.LayoutJson.Valid},
		SemanticSVG: sql.NullString{String: r.SemanticSvg.String, Valid: r.SemanticSvg.Valid},
	}
}

func mapGetLockForUpdateRow(l db.GetLockForUpdateRow) FloorLockOut {
	return FloorLockOut{
		FloorID:          int(l.FloorID),
		LockedByID:       int(l.LockedBy),
		LockedByUsername: l.Username,
		LockedAt:         l.LockedAt.Time,
		ExpiresAt:        l.ExpiresAt.Time,
	}
}

func mapGetLockRow(l db.GetLockRow) FloorLockOut {
	return FloorLockOut{
		FloorID:          int(l.FloorID),
		LockedByID:       int(l.LockedBy),
		LockedByUsername: l.Username,
		LockedAt:         l.LockedAt.Time,
		ExpiresAt:        l.ExpiresAt.Time,
	}
}

func mapInsertLockRow(l db.InsertLockRow) FloorLockOut {
	return FloorLockOut{
		FloorID:    int(l.FloorID),
		LockedByID: int(l.LockedBy),
		LockedAt:   l.LockedAt.Time,
		ExpiresAt:  l.ExpiresAt.Time,
	}
}

func mapUpdateLockRow(l db.UpdateLockRow) FloorLockOut {
	return FloorLockOut{
		FloorID:    int(l.FloorID),
		LockedByID: int(l.LockedBy),
		LockedAt:   l.LockedAt.Time,
		ExpiresAt:  l.ExpiresAt.Time,
	}
}

func mapListExistingDesksForSync(rows []db.ListExistingDesksForSyncRow) []existingDesk {
	out := make([]existingDesk, len(rows))
	for i, r := range rows {
		out[i] = existingDesk{
			ID:      int(r.ID),
			Label:   r.Label,
			QRToken: sql.NullString{String: r.QrToken, Valid: r.QrToken != ""},
		}
	}
	return out
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
	floor, err := getFloorRefs(ctx, s.q, floorID, false)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if floor.DraftID.Valid {
		if rev, err := getLayoutRevision(ctx, s.q, int(floor.DraftID.Int64), false); err == nil {
			return responseFromRevision(rev), nil
		}
	}
	if floor.PublishedID.Valid {
		if rev, err := getLayoutRevision(ctx, s.q, int(floor.PublishedID.Int64), false); err == nil {
			return responseFromRevision(rev), nil
		}
	}
	return LayoutDocumentResponse{}, ErrNoLayout
}

func (s *LayoutStore) GetPublished(ctx context.Context, floorID int) (LayoutDocumentResponse, error) {
	floor, err := getFloorRefs(ctx, s.q, floorID, false)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if !floor.PublishedID.Valid {
		return LayoutDocumentResponse{}, ErrNoPublished
	}
	rev, err := getLayoutRevision(ctx, s.q, int(floor.PublishedID.Int64), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return LayoutDocumentResponse{}, ErrNoPublished
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	return responseFromRevision(rev), nil
}

func (s *LayoutStore) GetPublishedSemanticSVG(ctx context.Context, floorID int) (string, error) {
	floor, err := getFloorRefs(ctx, s.q, floorID, false)
	if err != nil {
		return "", err
	}
	if !floor.PublishedID.Valid {
		return "", ErrNoPublished
	}
	rev, err := getLayoutRevision(ctx, s.q, int(floor.PublishedID.Int64), false)
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
	err = s.q.UpdateSemanticSVG(ctx, db.UpdateSemanticSVGParams{
		ID:          int32(rev.ID),
		SemanticSvg: stringToText(svg),
	})
	if err != nil {
		return "", err
	}
	return svg, nil
}

func (s *LayoutStore) SaveDraft(ctx context.Context, floorID int, version int, layoutJSON string, userID sql.NullInt64) (LayoutDocumentResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	defer rollbackQuietly(ctx, tx)

	txq := s.q.WithTx(tx)

	floor, err := getFloorRefs(ctx, txq, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}

	var rev LayoutRevision
	if floor.DraftID.Valid {
		rev, err = getLayoutRevision(ctx, txq, int(floor.DraftID.Int64), true)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return LayoutDocumentResponse{}, err
		}
		if err == nil {
			if rev.Version != version {
				return LayoutDocumentResponse{}, fmt.Errorf("%w: expected %d, got %d", ErrConflict, rev.Version, version)
			}
			row, err := txq.UpdateDraftLayout(ctx, db.UpdateDraftLayoutParams{
				ID:         int32(rev.ID),
				LayoutJson: stringToText(layoutJSON),
			})
			if err != nil {
				return LayoutDocumentResponse{}, err
			}
			rev = mapUpdateDraftLayoutRow(row)
			_ = logAuditTx(ctx, txq, floorID, userID, "saved", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, "")
			if err := tx.Commit(ctx); err != nil {
				return LayoutDocumentResponse{}, err
			}
			return responseFromRevision(rev), nil
		}
	}

	draftVersion := 1
	if floor.PublishedID.Valid {
		published, err := getLayoutRevision(ctx, txq, int(floor.PublishedID.Int64), true)
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

	row, err := txq.InsertDraftLayout(ctx, db.InsertDraftLayoutParams{
		FloorID:    int32(floorID),
		LayoutJson: stringToText(layoutJSON),
		Version:    int32(draftVersion),
		CreatedBy:  nullInt64ToInt4(userID),
	})
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	rev = mapInsertDraftLayoutRow(row)

	if err := txq.SetFloorDraftRevision(ctx, db.SetFloorDraftRevisionParams{
		ID:                 int32(floorID),
		DraftMapRevisionID: pgtype.Int4{Int32: int32(rev.ID), Valid: true},
	}); err != nil {
		return LayoutDocumentResponse{}, err
	}

	_ = logAuditTx(ctx, txq, floorID, userID, "saved", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, "")
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

	txq := s.q.WithTx(tx)

	floor, err := getFloorRefs(ctx, txq, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if !floor.DraftID.Valid {
		return LayoutDocumentResponse{}, ErrNoDraft
	}
	draft, err := getLayoutRevision(ctx, txq, int(floor.DraftID.Int64), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return LayoutDocumentResponse{}, errors.New("draft revision missing")
	}
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	if floor.PublishedID.Valid {
		if err := txq.ArchiveRevision(ctx, int32(floor.PublishedID.Int64)); err != nil {
			return LayoutDocumentResponse{}, err
		}
	}

	layout := layoutFromRevision(draft)
	layout = injectFreshComponentsFromPool(ctx, s.q, layout)
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		return LayoutDocumentResponse{}, fmt.Errorf("%w: %v", ErrInvalidLayout, err)
	}

	row, err := txq.PublishRevision(ctx, db.PublishRevisionParams{
		ID:          int32(draft.ID),
		SemanticSvg: stringToText(svg),
	})
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	published := mapPublishRevisionRow(row)

	if err := txq.SetFloorPublishedRevision(ctx, db.SetFloorPublishedRevisionParams{
		ID:                     int32(floorID),
		PublishedMapRevisionID: pgtype.Int4{Int32: int32(published.ID), Valid: true},
	}); err != nil {
		return LayoutDocumentResponse{}, err
	}

	_ = logAuditTx(ctx, txq, floorID, userID, "published", sql.NullInt64{Int64: int64(published.ID), Valid: true}, "")
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

	txq := s.q.WithTx(tx)

	floor, err := getFloorRefs(ctx, txq, floorID, true)
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
	rev, err := getLayoutRevision(ctx, txq, int(revisionID.Int64), true)
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
			rowsAffected, err := txq.DeleteDesk(ctx, int32(deskID))
			if err != nil {
				return LayoutDeskSyncResult{}, err
			}
			deleted += int(rowsAffected)
		}
	}

	note := fmt.Sprintf("source:%s;cleanup:%d;deleted:%d", sourceStatus, boolInt(cleanup), deleted)
	_ = logAuditTx(ctx, txq, floorID, userID, "desks_synced", sql.NullInt64{Int64: int64(rev.ID), Valid: true}, note)
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

	txq := s.q.WithTx(tx)

	floor, err := getFloorRefs(ctx, txq, floorID, true)
	if err != nil {
		return err
	}
	if floor.DraftID.Valid {
		if err := txq.ClearFloorDraftRevision(ctx, int32(floorID)); err != nil {
			return err
		}
		if err := txq.DeleteRevision(ctx, int32(floor.DraftID.Int64)); err != nil {
			return err
		}
	}
	_ = logAuditTx(ctx, txq, floorID, userID, "discarded", sql.NullInt64{}, "")
	return tx.Commit(ctx)
}

func (s *LayoutStore) GetHistory(ctx context.Context, floorID int, limit int) ([]AuditLogEntry, error) {
	if _, err := getFloorRefs(ctx, s.q, floorID, false); err != nil {
		return nil, err
	}
	rows, err := s.q.GetAuditHistory(ctx, db.GetAuditHistoryParams{
		FloorID: int32(floorID),
		Limit:   int32(limit),
	})
	if err != nil {
		return nil, err
	}
	entries := make([]AuditLogEntry, len(rows))
	for i, r := range rows {
		entries[i] = AuditLogEntry{
			ID:         int(r.ID),
			FloorID:    int(r.FloorID),
			UserID:     int4ToPtr(r.UserID),
			Action:     r.Action,
			RevisionID: int4ToPtr(r.RevisionID),
			CreatedAt:  timestamptzToPtr(r.CreatedAt),
			Note:       textToPtr(r.Note),
		}
	}
	return entries, nil
}

func (s *LayoutStore) ListRevisions(ctx context.Context, floorID int, limit int) ([]LayoutRevisionSummary, error) {
	floor, err := getFloorRefs(ctx, s.q, floorID, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListRevisions(ctx, db.ListRevisionsParams{
		FloorID: int32(floorID),
		Limit:   int32(limit),
	})
	if err != nil {
		return nil, err
	}
	revisions := make([]LayoutRevisionSummary, len(rows))
	for i, r := range rows {
		revisions[i] = LayoutRevisionSummary{
			RevisionID:         int(r.ID),
			FloorID:            int(r.FloorID),
			Status:             r.Status,
			Version:            int(r.Version),
			CreatedAt:          timestamptzToPtr(r.CreatedAt),
			UpdatedAt:          timestamptzToPtr(r.UpdatedAt),
			PublishedAt:        timestamptzToPtr(r.PublishedAt),
			CreatedByID:        int4ToPtr(r.CreatedBy),
			CreatedByUsername:  textToPtr(r.Username),
			IsCurrentPublished: floor.PublishedID.Valid && int(floor.PublishedID.Int64) == int(r.ID),
			IsCurrentDraft:     floor.DraftID.Valid && int(floor.DraftID.Int64) == int(r.ID),
		}
	}
	return revisions, nil
}

func (s *LayoutStore) GetRevision(ctx context.Context, floorID int, revisionID int) (LayoutDocumentResponse, error) {
	if _, err := getFloorRefs(ctx, s.q, floorID, false); err != nil {
		return LayoutDocumentResponse{}, err
	}
	rev, err := getLayoutRevision(ctx, s.q, revisionID, false)
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

	txq := s.q.WithTx(tx)

	floor, err := getFloorRefs(ctx, txq, floorID, true)
	if err != nil {
		return LayoutDocumentResponse{}, err
	}

	sourceData, err := txq.GetRevisionDataForRestore(ctx, int32(revisionID))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && int(sourceData.FloorID) != floorID) {
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
			if published, err := getLayoutRevision(ctx, txq, int(floor.PublishedID.Int64), true); err == nil {
				draftVersion = published.Version + 1
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return LayoutDocumentResponse{}, err
			}
		}
		row, err := txq.InsertDraftForRestore(ctx, db.InsertDraftForRestoreParams{
			FloorID:    int32(floorID),
			PlanSvg:    sourceData.PlanSvg,
			Column3:    sourceData.DesksJson,
			Column4:    sourceData.ZonesJson,
			LayoutJson: sourceData.LayoutJson,
			Version:    int32(draftVersion),
			CreatedBy:  nullInt64ToInt4(userID),
		})
		if err != nil {
			return LayoutDocumentResponse{}, err
		}
		draftID = int(row.ID)
		if err := txq.SetFloorDraftRevision(ctx, db.SetFloorDraftRevisionParams{
			ID:                 int32(floorID),
			DraftMapRevisionID: pgtype.Int4{Int32: int32(draftID), Valid: true},
		}); err != nil {
			return LayoutDocumentResponse{}, err
		}
	}

	row, err := txq.UpdateDraftForRestore(ctx, db.UpdateDraftForRestoreParams{
		ID:         int32(draftID),
		PlanSvg:    sourceData.PlanSvg,
		DesksJson:  sourceData.DesksJson,
		ZonesJson:  sourceData.ZonesJson,
		LayoutJson: sourceData.LayoutJson,
	})
	if err != nil {
		return LayoutDocumentResponse{}, err
	}
	draft := mapUpdateDraftForRestoreRow(row)

	_ = logAuditTx(
		ctx,
		txq,
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
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(u.ID), Valid: true}
}

func (s *LayoutStore) RequireUserID(ctx context.Context, username string) (int, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return 0, ErrUserNotFound
	}
	u, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrUserNotFound
		}
		return 0, err
	}
	return int(u.ID), nil
}

func (s *LayoutStore) AcquireLock(ctx context.Context, floorID int, userID int) (FloorLockOut, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FloorLockOut{}, err
	}
	defer rollbackQuietly(ctx, tx)

	txq := s.q.WithTx(tx)

	if _, err := getFloorRefs(ctx, txq, floorID, true); err != nil {
		return FloorLockOut{}, err
	}

	now := time.Now().UTC()
	expiresAt := now.Add(FloorLockTTL)
	var existing FloorLockOut
	row, err := txq.GetLockForUpdate(ctx, int32(floorID))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return FloorLockOut{}, err
	}
	if err == nil {
		existing = mapGetLockForUpdateRow(row)
		if existing.LockedByID != userID && existing.ExpiresAt.After(now) {
			return FloorLockOut{}, LockHeldError{Username: lockUsername(existing.LockedByUsername, existing.LockedByID)}
		}
	}

	var lock FloorLockOut
	if errors.Is(err, pgx.ErrNoRows) {
		res, err := txq.InsertLock(ctx, db.InsertLockParams{
			FloorID:   int32(floorID),
			LockedBy:  int32(userID),
			LockedAt:  timeToTimestamptz(now),
			ExpiresAt: timeToTimestamptz(expiresAt),
		})
		if err != nil {
			return FloorLockOut{}, err
		}
		lock = mapInsertLockRow(res)
	} else {
		res, err := txq.UpdateLock(ctx, db.UpdateLockParams{
			FloorID:   int32(floorID),
			LockedBy:  int32(userID),
			LockedAt:  timeToTimestamptz(now),
			ExpiresAt: timeToTimestamptz(expiresAt),
		})
		if err != nil {
			return FloorLockOut{}, err
		}
		lock = mapUpdateLockRow(res)
	}
	lock.LockedByUsername = lockUsername(usernameForUserID(ctx, txq, userID), userID)
	if err := tx.Commit(ctx); err != nil {
		return FloorLockOut{}, err
	}
	return lock, nil
}

func (s *LayoutStore) ReleaseLock(ctx context.Context, floorID int, userID int) error {
	return s.q.ReleaseLock(ctx, db.ReleaseLockParams{
		FloorID:  int32(floorID),
		LockedBy: int32(userID),
	})
}

func (s *LayoutStore) GetLock(ctx context.Context, floorID int) (FloorLockOut, bool, error) {
	l, err := s.q.GetLock(ctx, int32(floorID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FloorLockOut{}, false, nil
		}
		return FloorLockOut{}, false, err
	}
	lock := mapGetLockRow(l)
	now := time.Now().UTC()
	if !lock.ExpiresAt.After(now) {
		if err := s.q.DeleteExpiredLockForFloor(ctx, db.DeleteExpiredLockForFloorParams{
			FloorID:   int32(floorID),
			ExpiresAt: timeToTimestamptz(now),
		}); err != nil {
			return FloorLockOut{}, false, err
		}
		return FloorLockOut{}, false, nil
	}
	lock.LockedByUsername = lockUsername(lock.LockedByUsername, lock.LockedByID)
	return lock, true, nil
}

func (s *LayoutStore) CleanupArchivedRevisions(ctx context.Context, olderThanDays int) (int, error) {
	cutoff := time.Now().AddDate(0, 0, -olderThanDays)
	rowsAffected, err := s.q.CleanupArchivedRevisions(ctx, timeToTimestamptz(cutoff))
	if err != nil {
		return 0, err
	}
	return int(rowsAffected), nil
}

func usernameForUserID(ctx context.Context, q db.Querier, userID int) string {
	u, err := q.GetUserByID(ctx, int32(userID))
	if err != nil {
		return ""
	}
	return u.Username
}

func lockUsername(username string, userID int) string {
	if value := strings.TrimSpace(username); value != "" {
		return value
	}
	return strconv.Itoa(userID)
}

func getFloorRefs(ctx context.Context, q db.Querier, floorID int, lock bool) (FloorRefs, error) {
	if lock {
		row, err := q.GetFloorRefsForUpdate(ctx, int32(floorID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return FloorRefs{}, ErrFloorNotFound
			}
			return FloorRefs{}, err
		}
		return mapFloorRefsForUpdate(row), nil
	}
	row, err := q.GetFloorRefs(ctx, int32(floorID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FloorRefs{}, ErrFloorNotFound
		}
		return FloorRefs{}, err
	}
	return mapFloorRefs(row), nil
}

func getLayoutRevision(ctx context.Context, q db.Querier, revisionID int, lock bool) (LayoutRevision, error) {
	if lock {
		row, err := q.GetLayoutRevisionForUpdate(ctx, int32(revisionID))
		if err != nil {
			return LayoutRevision{}, err
		}
		return mapGetLayoutRevisionForUpdateRow(row), nil
	}
	row, err := q.GetLayoutRevision(ctx, int32(revisionID))
	if err != nil {
		return LayoutRevision{}, err
	}
	return mapGetLayoutRevisionRow(row), nil
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

func injectFreshComponentsFromPool(ctx context.Context, q db.Querier, layout exporter.LayoutDocument) exporter.LayoutDocument {
	comps, err := q.ListComponents(ctx)
	if err != nil {
		return layout
	}
	fresh := map[string]exporter.LayoutComponent{}
	for _, c := range comps {
		var vb []float64
		parts := strings.Fields(c.ViewBox)
		for _, p := range parts {
			if v, err := strconv.ParseFloat(p, 64); err == nil {
				vb = append(vb, v)
			}
		}
		if len(vb) < 4 {
			vb = []float64{0, 0, c.DefaultW, c.DefaultH}
		}
		fresh[c.ID] = exporter.LayoutComponent{
			ID:        c.ID,
			Label:     c.Label,
			AssetType: c.AssetType,
			ViewBox:   vb,
			DefaultW:  c.DefaultW,
			DefaultH:  c.DefaultH,
			SVGMarkup: c.SvgMarkup,
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
	txq := db.New(tx)
	layout := layoutFromRevision(rev)
	vbx, vby, vbw, vbh := effectiveLayoutViewBox(layout)
	existingRows, err := txq.ListExistingDesksForSync(ctx, int32(floorID))
	if err != nil {
		return deskSyncStats{}, err
	}
	existing := mapListExistingDesksForSync(existingRows)

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
		qrToken := uuidV4()

		assignedToText := pgtype.Text{}
		if val := strings.TrimSpace(layoutDesk.AssignedTo); val != "" {
			assignedToText = pgtype.Text{String: val, Valid: true}
		}

		if desk == nil {
			err = txq.InsertDeskForSync(ctx, db.InsertDeskForSyncParams{
				FloorID:    int32(floorID),
				Label:      label,
				Type:       deskType,
				AssignedTo: assignedToText,
				PositionX:  pgtype.Float8{Float64: positionX, Valid: true},
				PositionY:  pgtype.Float8{Float64: positionY, Valid: true},
				W:          width,
				H:          height,
				QrToken:    qrToken,
			})
			if err != nil {
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
		err = txq.UpdateDeskForSync(ctx, db.UpdateDeskForSyncParams{
			ID:         int32(desk.ID),
			Label:      label,
			Type:       deskType,
			AssignedTo: assignedToText,
			PositionX:  pgtype.Float8{Float64: positionX, Valid: true},
			PositionY:  pgtype.Float8{Float64: positionY, Valid: true},
			W:          width,
			H:          height,
			QrToken:    qrToken,
		})
		if err != nil {
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

func logAuditTx(ctx context.Context, q db.Querier, floorID int, userID sql.NullInt64, action string, revisionID sql.NullInt64, note string) error {
	return q.LogAudit(ctx, db.LogAuditParams{
		FloorID:    int32(floorID),
		UserID:     nullInt64ToInt4(userID),
		Action:     action,
		RevisionID: nullInt64ToInt4(revisionID),
		Note:       stringToText(note),
	})
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
	expired, err := s.q.GetExpiredLocks(ctx, timeToTimestamptz(now))
	if err != nil {
		return nil, err
	}
	var floorIDs []int
	if len(expired) > 0 {
		err = s.q.DeleteExpiredLocks(ctx, timeToTimestamptz(now))
		if err != nil {
			return nil, err
		}
		floorIDs = make([]int, len(expired))
		for i, id := range expired {
			floorIDs[i] = int(id)
		}
	}
	return floorIDs, nil
}
