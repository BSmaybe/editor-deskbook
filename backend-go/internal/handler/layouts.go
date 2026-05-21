package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"deskbook/backend-go/internal/exporter"
	"deskbook/backend-go/internal/store"
)

// decodeLayoutDraftPayload parses and validates the PUT /layout/draft payload,
// normalises the layout document, and returns the client version + canonical JSON.
func decodeLayoutDraftPayload(r *http.Request) (int, string, error) {
	raw, err := IoReadLimited(r, maxBodyBytes)
	if err != nil {
		return 0, "", err
	}
	var body store.LayoutDraftPayload
	if err := json.Unmarshal(raw, &body); err != nil {
		return 0, "", err
	}
	if len(strings.TrimSpace(string(body.Layout))) == 0 || string(body.Layout) == "null" {
		return 0, "", errors.New("layout is required")
	}
	doc, err := exporter.ParseLayoutJSON(body.Layout)
	if err != nil {
		return 0, "", err
	}
	normalizeLayoutDocument(&doc)
	encoded, err := json.Marshal(doc)
	if err != nil {
		return 0, "", err
	}
	return body.Version, string(encoded), nil
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

func writeLayoutResponse(w http.ResponseWriter, resp store.LayoutDocumentResponse, err error, fallback404 string) {
	if err != nil {
		writeLayoutError(w, err, fallback404)
		return
	}
	WriteJSON(w, http.StatusOK, resp)
}

func writeLayoutError(w http.ResponseWriter, err error, fallback404 string) {
	switch {
	case errors.Is(err, store.ErrFloorNotFound):
		WriteError(w, http.StatusNotFound, err)
	case errors.Is(err, store.ErrNoLayout), errors.Is(err, store.ErrNoPublished),
		errors.Is(err, store.ErrNoDraft), errors.Is(err, store.ErrNoRevision):
		if fallback404 != "" {
			WriteError(w, http.StatusNotFound, errors.New(fallback404))
			return
		}
		WriteError(w, http.StatusNotFound, err)
	case errors.Is(err, store.ErrConflict):
		WriteError(w, http.StatusConflict, err)
	case errors.Is(err, store.ErrInvalidLayout):
		WriteError(w, http.StatusUnprocessableEntity, err)
	case errors.As(err, new(store.LockHeldError)):
		WriteError(w, http.StatusLocked, err)
	default:
		WriteError(w, http.StatusInternalServerError, err)
	}
}

func intQuery(r *http.Request, name string, fallback, minValue, maxValue int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get(name)))
	if err != nil {
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

// --- Layout Read Handlers ---

func (s *Server) GetLayoutHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	resp, err := s.Layouts.GetDraftOrPublished(r.Context(), floorID)
	writeLayoutResponse(w, resp, err, "No layout found for this floor")
}

func (s *Server) GetPublishedLayoutHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	resp, err := s.Layouts.GetPublished(r.Context(), floorID)
	writeLayoutResponse(w, resp, err, "No published layout")
}

func (s *Server) GetPublishedSVGHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	svg, err := s.Layouts.GetPublishedSemanticSVG(r.Context(), floorID)
	if err != nil {
		writeLayoutError(w, err, "No published SVG")
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(svg))
}

func (s *Server) GetPublishedHTMLHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	svg, err := s.Layouts.GetPublishedSemanticSVG(r.Context(), floorID)
	if err != nil {
		writeLayoutError(w, err, "No published layout")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(exporter.RenderHTML(svg, fmt.Sprintf("DeskBook floor %d", floorID))))
}

// EmbedFloorHandler serves the published floor plan without authentication —
// suitable for iframes and public links.
func (s *Server) EmbedFloorHandler(w http.ResponseWriter, r *http.Request) {
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		http.Error(w, "layout store unavailable", http.StatusServiceUnavailable)
		return
	}
	svg, err := s.Layouts.GetPublishedSemanticSVG(r.Context(), floorID)
	if err != nil {
		http.Error(w, "No published layout", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Frame-Options", "ALLOWALL")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(exporter.RenderHTML(svg, fmt.Sprintf("Floor plan — %d", floorID))))
}

// --- Layout Write Handlers ---

func (s *Server) SaveLayoutDraftHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	version, layoutJSON, err := decodeLayoutDraftPayload(r)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, err)
		return
	}
	userID := s.Layouts.UserIDForUsername(r.Context(), authCtx.Username)
	resp, err := s.Layouts.SaveDraft(r.Context(), floorID, version, layoutJSON, userID)
	writeLayoutResponse(w, resp, err, "")
}

func (s *Server) PublishLayoutHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	userID := s.Layouts.UserIDForUsername(r.Context(), authCtx.Username)
	resp, err := s.Layouts.Publish(r.Context(), floorID, userID)
	writeLayoutResponse(w, resp, err, "")
}

func (s *Server) SyncLayoutDesksHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	source := strings.TrimSpace(r.URL.Query().Get("source"))
	if source == "" {
		source = "published"
	}
	if source != "published" && source != "draft" {
		WriteError(w, http.StatusUnprocessableEntity, errors.New("source must be published or draft"))
		return
	}
	cleanup := strings.EqualFold(r.URL.Query().Get("cleanup"), "true")
	userID := s.Layouts.UserIDForUsername(r.Context(), authCtx.Username)
	resp, err := s.Layouts.SyncDesksForFloor(r.Context(), floorID, source, cleanup, userID)
	if err != nil {
		writeLayoutError(w, err, "")
		return
	}
	WriteJSON(w, http.StatusOK, resp)
}

func (s *Server) DiscardLayoutDraftHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	userID := s.Layouts.UserIDForUsername(r.Context(), authCtx.Username)
	if err := s.Layouts.DiscardDraft(r.Context(), floorID, userID); err != nil {
		writeLayoutError(w, err, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- History & Revisions ---

func (s *Server) GetLayoutHistoryHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	entries, err := s.Layouts.GetHistory(r.Context(), floorID, 50)
	if err != nil {
		writeLayoutError(w, err, "")
		return
	}
	WriteJSON(w, http.StatusOK, entries)
}

func (s *Server) ListLayoutRevisionsHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	limit := intQuery(r, "limit", 100, 1, 300)
	revisions, err := s.Layouts.ListRevisions(r.Context(), floorID, limit)
	if err != nil {
		writeLayoutError(w, err, "")
		return
	}
	WriteJSON(w, http.StatusOK, revisions)
}

func (s *Server) GetLayoutRevisionHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	revisionID, ok := RevisionIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	resp, err := s.Layouts.GetRevision(r.Context(), floorID, revisionID)
	writeLayoutResponse(w, resp, err, "")
}

func (s *Server) RestoreLayoutRevisionHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	revisionID, ok := RevisionIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	userID := s.Layouts.UserIDForUsername(r.Context(), authCtx.Username)
	resp, err := s.Layouts.RestoreRevisionToDraft(r.Context(), floorID, revisionID, userID)
	writeLayoutResponse(w, resp, err, "")
}

func (s *Server) CleanupRevisionsHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	days := intQuery(r, "older_than_days", 90, 1, 3650)
	deleted, err := s.Layouts.CleanupArchivedRevisions(r.Context(), days)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]int{"deleted_revisions": deleted, "older_than_days": days})
}

// --- Lock Handlers ---

func (s *Server) GetFloorLockHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	lock, locked, err := s.Layouts.GetLock(r.Context(), floorID)
	if err != nil {
		writeLayoutError(w, err, "")
		return
	}
	if !locked {
		WriteJSON(w, http.StatusOK, map[string]bool{"locked": false})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"locked":             true,
		"floor_id":           lock.FloorID,
		"locked_by_id":       lock.LockedByID,
		"locked_by_username": lock.LockedByUsername,
		"locked_at":          lock.LockedAt,
		"expires_at":         lock.ExpiresAt,
	})
}

func (s *Server) AcquireFloorLockHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	userID, err := s.Layouts.RequireUserID(r.Context(), authCtx.Username)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	lock, err := s.Layouts.AcquireLock(r.Context(), floorID, userID)
	if err != nil {
		writeLayoutError(w, err, "")
		return
	}
	// Broadcast the lock event via SSE
	s.LockBroker.Broadcast(floorID, LockEvent{
		Locked:           true,
		FloorID:          floorID,
		LockedByUsername: lock.LockedByUsername,
	})
	WriteJSON(w, http.StatusOK, lock)
}

func (s *Server) ReleaseFloorLockHandler(w http.ResponseWriter, r *http.Request) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if s.Layouts == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("layout store is not configured"))
		return
	}
	userID, err := s.Layouts.RequireUserID(r.Context(), authCtx.Username)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	if err := s.Layouts.ReleaseLock(r.Context(), floorID, userID); err != nil {
		writeLayoutError(w, err, "")
		return
	}
	// Broadcast the unlock event via SSE
	s.LockBroker.Broadcast(floorID, LockEvent{
		Locked:  false,
		FloorID: floorID,
	})
	w.WriteHeader(http.StatusNoContent)
}

// --- SSE ---

// FloorLockSSEHandler streams real-time lock status events for a given floor.
// Clients receive JSON events whenever the lock is acquired or released.
func (s *Server) FloorLockSSEHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	floorID, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		WriteError(w, http.StatusInternalServerError, errors.New("streaming not supported"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	ch := s.LockBroker.Subscribe(floorID)
	defer s.LockBroker.Unsubscribe(floorID, ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			_, _ = io.WriteString(w, "data: "+string(data)+"\n\n")
			flusher.Flush()
		}
	}
}
