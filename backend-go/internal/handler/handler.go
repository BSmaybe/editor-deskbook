package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"deskbook/backend-go/internal/auth"
	"deskbook/backend-go/internal/exporter"
	"deskbook/backend-go/internal/store"
	"deskbook/backend-go/internal/svgimport"
)

const maxBodyBytes = 8 << 20 // 8 MiB

var (
	ErrAccountDisabled = errors.New("account disabled")
	ErrForbidden       = errors.New("forbidden")
	ErrUnauthorized    = errors.New("unauthorized")
)

type Server struct {
	Components *store.ComponentStore
	Layouts    *store.LayoutStore
	Users      *store.UserStore
	Offices    *store.OfficeStore
	Floors     *store.FloorStore
	Desks      *store.DeskStore
	Templates  *store.TemplateStore
	Blocks     *store.BlockStore
	Invites    *store.InviteStore

	LockBroker *LockBroker
}

func NewServer(
	cs *store.ComponentStore,
	ls *store.LayoutStore,
	us *store.UserStore,
	os2 *store.OfficeStore,
	fs *store.FloorStore,
	ds *store.DeskStore,
	ts *store.TemplateStore,
	bs *store.BlockStore,
	is *store.InviteStore,
) *Server {
	return &Server{
		Components: cs,
		Layouts:    ls,
		Users:      us,
		Offices:    os2,
		Floors:     fs,
		Desks:      ds,
		Templates:  ts,
		Blocks:     bs,
		Invites:    is,
		LockBroker: NewLockBroker(),
	}
}

type renderRequest struct {
	Layout json.RawMessage `json:"layout"`
	Title  string          `json:"title"`
}

type errorResponse struct {
	Detail string `json:"detail"`
}

type AuthContext struct {
	Username string
	Role     string
}

func (s *Server) requireActiveAuth(r *http.Request) (AuthContext, error) {
	var token string
	bearer := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(bearer, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(bearer, "Bearer "))
	} else if qToken := r.URL.Query().Get("token"); qToken != "" {
		token = qToken
	}

	if token == "" {
		return AuthContext{}, errors.New("missing token")
	}

	secret := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if secret == "" {
		secret = "change-me-in-production"
	}

	claims, err := auth.VerifyToken(token, secret)
	if err != nil {
		return AuthContext{}, err
	}

	if s.Users != nil {
		user, dbErr := s.Users.GetByUsername(r.Context(), claims.Username)
		if dbErr != nil {
			return AuthContext{}, fmt.Errorf("failed to verify account status")
		}
		if user == nil || !user.IsActive {
			return AuthContext{}, ErrAccountDisabled
		}
	}

	return AuthContext{
		Username: claims.Username,
		Role:     claims.Role,
	}, nil
}

func (s *Server) requireActiveAdmin(r *http.Request) (AuthContext, error) {
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		return AuthContext{}, err
	}
	if authCtx.Role != "admin" {
		return AuthContext{}, ErrForbidden
	}
	return authCtx, nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", healthHandler)

	// Renderer
	mux.HandleFunc("POST /render/svg", renderSVGHandler)
	mux.HandleFunc("POST /render/html", renderHTMLHandler)

	// Auth
	mux.HandleFunc("POST /auth/register", s.RegisterHandler)
	mux.HandleFunc("POST /auth/login", s.LoginHandler)

	// Invites (admin)
	mux.HandleFunc("POST /admin/invites", s.CreateInviteHandler)
	mux.HandleFunc("GET /admin/invites", s.ListInvitesHandler)
	mux.HandleFunc("DELETE /admin/invites/{invite_id}", s.DeleteInviteHandler)
	mux.HandleFunc("GET /invites/{token}", s.GetInviteInfoHandler)

	// Users
	mux.HandleFunc("GET /users/me", s.GetMeHandler)
	mux.HandleFunc("GET /users", s.ListUsersHandler)
	mux.HandleFunc("GET /admin/users", s.AdminListUsersHandler)
	mux.HandleFunc("PATCH /admin/users/{username}", s.AdminUpdateUserHandler)
	mux.HandleFunc("DELETE /admin/users/{username}", s.AdminDeleteUserHandler)

	// Components
	mux.HandleFunc("GET /components", s.ListComponentsHandler)
	mux.HandleFunc("POST /components", s.CreateComponentHandler)
	mux.HandleFunc("PUT /components/{component_id}", s.UpdateComponentHandler)
	mux.HandleFunc("DELETE /components/{component_id}", s.DeleteComponentHandler)

	// Offices
	mux.HandleFunc("GET /offices", s.ListOfficesHandler)
	mux.HandleFunc("POST /offices", s.CreateOfficeHandler)
	mux.HandleFunc("PATCH /offices/{office_id}", s.UpdateOfficeHandler)
	mux.HandleFunc("DELETE /offices/{office_id}", s.DeleteOfficeHandler)

	// Floors CRUD
	mux.HandleFunc("GET /floors", s.ListFloorsHandler)
	mux.HandleFunc("POST /floors", s.CreateFloorHandler)
	mux.HandleFunc("PATCH /floors/{floor_id}", s.UpdateFloorHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}", s.DeleteFloorHandler)
	mux.HandleFunc("POST /floors/{floor_id}/plan", s.UploadFloorPlanHandler)

	// Layout editor
	mux.HandleFunc("GET /floors/{floor_id}/layout", s.GetLayoutHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published", s.GetPublishedLayoutHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published.svg", s.GetPublishedSVGHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published.html", s.GetPublishedHTMLHandler)
	mux.HandleFunc("PUT /floors/{floor_id}/layout/draft", s.SaveLayoutDraftHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}/layout/draft", s.DiscardLayoutDraftHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/import", s.ImportLayoutSVGHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/publish", s.PublishLayoutHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/sync-desks", s.SyncLayoutDesksHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/history", s.GetLayoutHistoryHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/revisions", s.ListLayoutRevisionsHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/revisions/{revision_id}", s.GetLayoutRevisionHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/revisions/{revision_id}/restore", s.RestoreLayoutRevisionHandler)
	mux.HandleFunc("GET /floors/{floor_id}/lock", s.GetFloorLockHandler)
	mux.HandleFunc("POST /floors/{floor_id}/lock", s.AcquireFloorLockHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}/lock", s.ReleaseFloorLockHandler)

	// SSE Real-time locks
	mux.HandleFunc("GET /floors/{floor_id}/lock/sse", s.FloorLockSSEHandler)

	// Admin maintenance
	mux.HandleFunc("POST /admin/cleanup/revisions", s.CleanupRevisionsHandler)

	// Templates
	mux.HandleFunc("GET /templates", s.ListTemplatesHandler)
	mux.HandleFunc("POST /templates", s.CreateTemplateHandler)
	mux.HandleFunc("DELETE /templates/{template_id}", s.DeleteTemplateHandler)

	// Blocks
	mux.HandleFunc("GET /blocks", s.ListBlocksHandler)
	mux.HandleFunc("POST /blocks", s.CreateBlockHandler)
	mux.HandleFunc("DELETE /blocks/{block_id}", s.DeleteBlockHandler)

	// Desks
	mux.HandleFunc("GET /desks", s.ListDesksHandler)
	mux.HandleFunc("GET /desks/{desk_id}", s.GetDeskHandler)
	mux.HandleFunc("PATCH /desks/{desk_id}", s.UpdateDeskHandler)
	mux.HandleFunc("DELETE /desks/{desk_id}", s.DeleteDeskHandler)

	// Public embed
	mux.HandleFunc("GET /embed/floors/{floor_id}", s.EmbedFloorHandler)

	// Swagger UI
	mux.Handle("/docs", SwaggerUIHandler())
	mux.Handle("/docs/", SwaggerUIHandler())

	// Static files
	staticDir := EnvDefault("STATIC_DIR", "static")
	mux.Handle("GET /static/", secureStaticHandler(staticDir))

	return s.corsMiddleware(logRequests(mux))
}

func (s *Server) StartLockJanitor(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.checkAndCleanupExpiredLocks(ctx)
			}
		}
	}()
}

func (s *Server) checkAndCleanupExpiredLocks(ctx context.Context) {
	if s.Layouts == nil {
		return
	}
	floorIDs, err := s.Layouts.GetAndCleanupExpiredLocks(ctx)
	if err != nil {
		log.Printf("janitor: failed to cleanup expired locks: %v", err)
		return
	}
	for _, id := range floorIDs {
		log.Printf("janitor: lock expired for floor %d, broadcasting unlock", id)
		s.LockBroker.Broadcast(id, LockEvent{
			Locked:  false,
			FloorID: id,
		})
	}
}


func healthHandler(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"message": "ok"})
}

func renderSVGHandler(w http.ResponseWriter, r *http.Request) {
	layout, _, err := decodeRenderRequest(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, err)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(svg))
}

func renderHTMLHandler(w http.ResponseWriter, r *http.Request) {
	layout, title, err := decodeRenderRequest(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(title) == "" {
		title = r.URL.Query().Get("title")
	}
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(exporter.RenderHTML(svg, title)))
}

func (s *Server) ImportLayoutSVGHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	if _, ok := FloorIDFromPath(w, r); !ok {
		return
	}
	raw, err := IoReadLimited(r, maxBodyBytes)
	if err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	result, err := svgimport.Classify(string(raw))
	if err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	WriteJSON(w, http.StatusOK, result)
}

func decodeRenderRequest(r *http.Request) (exporter.LayoutDocument, string, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		return exporter.LayoutDocument{}, "", err
	}
	if len(raw) > maxBodyBytes {
		return exporter.LayoutDocument{}, "", fmt.Errorf("request body exceeds %d bytes", maxBodyBytes)
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return exporter.LayoutDocument{}, "", errors.New("empty request body")
	}

	var wrapped renderRequest
	if err := json.Unmarshal(raw, &wrapped); err == nil && len(wrapped.Layout) > 0 {
		layout, err := exporter.ParseLayoutJSON(wrapped.Layout)
		return layout, wrapped.Title, err
	}
	layout, err := exporter.ParseLayoutJSON(raw)
	return layout, "", err
}

func secureStaticHandler(dir string) http.Handler {
	fs := http.StripPrefix("/static/", http.FileServer(http.Dir(dir)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		fs.ServeHTTP(w, r)
	})
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	allowedOrigins := map[string]bool{}
	if raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS")); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimSpace(o); o != "" {
				allowedOrigins[o] = true
			}
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if len(allowedOrigins) > 0 {
			if allowedOrigins[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, status int, err error) {
	WriteJSON(w, status, errorResponse{Detail: err.Error()})
}

func WriteAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrAccountDisabled):
		WriteError(w, http.StatusForbidden, err)
	case errors.Is(err, ErrForbidden):
		WriteError(w, http.StatusForbidden, err)
	default:
		WriteError(w, http.StatusUnauthorized, err)
	}
}

func DecodeJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes)).Decode(dst)
}

func IoReadLimited(r *http.Request, limit int64) ([]byte, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("request body exceeds %d bytes", limit)
	}
	return raw, nil
}

func EnvDefault(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func IntPathValue(w http.ResponseWriter, r *http.Request, name string) (int, bool) {
	v, err := strconv.Atoi(strings.TrimSpace(r.PathValue(name)))
	if err != nil || v <= 0 {
		WriteError(w, http.StatusBadRequest, errors.New("invalid "+name))
		return 0, false
	}
	return v, true
}

func FloorIDFromPath(w http.ResponseWriter, r *http.Request) (int, bool) {
	floorID, err := strconv.Atoi(strings.TrimSpace(r.PathValue("floor_id")))
	if err != nil || floorID <= 0 {
		WriteError(w, http.StatusBadRequest, errors.New("invalid floor id"))
		return 0, false
	}
	return floorID, true
}

func RevisionIDFromPath(w http.ResponseWriter, r *http.Request) (int, bool) {
	revisionID, err := strconv.Atoi(strings.TrimSpace(r.PathValue("revision_id")))
	if err != nil || revisionID <= 0 {
		WriteError(w, http.StatusBadRequest, errors.New("invalid revision id"))
		return 0, false
	}
	return revisionID, true
}

