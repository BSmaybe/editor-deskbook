package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"deskbook/backend-go/internal/exporter"
	"deskbook/backend-go/internal/svgimport"
)

const maxBodyBytes = 8 << 20 // 8 MiB

type renderRequest struct {
	Layout json.RawMessage `json:"layout"`
	Title  string          `json:"title"`
}

type errorResponse struct {
	Detail string `json:"detail"`
}

func main() {
	addr := ":" + envDefault("PORT", "8080")
	ctx := context.Background()

	var (
		cs  *componentStore
		ls  *layoutStore
		us  *userStore
		os2 *officeStore
		fs  *floorStore
		ds  *deskStore
		ts  *templateStore
		bs  *blockStore
		is  *inviteStore
	)

	if databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); databaseURL != "" {
		if store, err := newComponentStore(ctx, databaseURL); err != nil {
			log.Printf("component store disabled: %v", err)
		} else {
			cs = store
			defer cs.close()
		}
		if store, err := newLayoutStore(ctx, databaseURL); err != nil {
			log.Printf("layout store disabled: %v", err)
		} else {
			ls = store
			defer ls.close()
		}
		if store, err := newUserStore(ctx, databaseURL); err != nil {
			log.Printf("user store disabled: %v", err)
		} else {
			us = store
			defer us.close()
		}
		if store, err := newOfficeStore(ctx, databaseURL); err != nil {
			log.Printf("office store disabled: %v", err)
		} else {
			os2 = store
			defer os2.close()
		}
		if store, err := newFloorStore(ctx, databaseURL); err != nil {
			log.Printf("floor store disabled: %v", err)
		} else {
			fs = store
			defer fs.close()
		}
		if store, err := newDeskStore(ctx, databaseURL); err != nil {
			log.Printf("desk store disabled: %v", err)
		} else {
			ds = store
			defer ds.close()
		}
		if store, err := newTemplateStore(ctx, databaseURL); err != nil {
			log.Printf("template store disabled: %v", err)
		} else {
			ts = store
			defer ts.close()
		}
		if store, err := newBlockStore(ctx, databaseURL); err != nil {
			log.Printf("block store disabled: %v", err)
		} else {
			bs = store
			defer bs.close()
		}
		if store, err := newInviteStore(ctx, databaseURL); err != nil {
			log.Printf("invite store disabled: %v", err)
		} else {
			is = store
			defer is.close()
		}
		log.Printf("database stores initialized")

		if us != nil {
			seedBootstrapAdmin(ctx, us)
		}
	}

	app := &appServer{components: cs, layouts: ls, users: us, offices: os2, floors: fs, desks: ds, templates: ts, blocks: bs, invites: is}
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", healthHandler)

	// Renderer
	mux.HandleFunc("POST /render/svg", renderSVGHandler)
	mux.HandleFunc("POST /render/html", renderHTMLHandler)

	// Auth
	mux.HandleFunc("POST /auth/register", app.registerHandler)
	mux.HandleFunc("POST /auth/login", app.loginHandler)

	// Invites (admin)
	mux.HandleFunc("POST /admin/invites", app.createInviteHandler)
	mux.HandleFunc("GET /admin/invites", app.listInvitesHandler)
	mux.HandleFunc("DELETE /admin/invites/{invite_id}", app.deleteInviteHandler)
	mux.HandleFunc("GET /invites/{token}", app.getInviteInfoHandler)

	// Users
	mux.HandleFunc("GET /users/me", app.getMeHandler)
	mux.HandleFunc("GET /users", app.listUsersHandler)
	mux.HandleFunc("GET /admin/users", app.adminListUsersHandler)
	mux.HandleFunc("PATCH /admin/users/{username}", app.adminUpdateUserHandler)
	mux.HandleFunc("DELETE /admin/users/{username}", app.adminDeleteUserHandler)

	// Components
	mux.HandleFunc("GET /components", app.listComponentsHandler)
	mux.HandleFunc("POST /components", app.createComponentHandler)
	mux.HandleFunc("PUT /components/{component_id}", app.updateComponentHandler)
	mux.HandleFunc("DELETE /components/{component_id}", app.deleteComponentHandler)

	// Offices
	mux.HandleFunc("GET /offices", app.listOfficesHandler)
	mux.HandleFunc("POST /offices", app.createOfficeHandler)
	mux.HandleFunc("PATCH /offices/{office_id}", app.updateOfficeHandler)
	mux.HandleFunc("DELETE /offices/{office_id}", app.deleteOfficeHandler)

	// Floors CRUD
	mux.HandleFunc("GET /floors", app.listFloorsHandler)
	mux.HandleFunc("POST /floors", app.createFloorHandler)
	mux.HandleFunc("PATCH /floors/{floor_id}", app.updateFloorHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}", app.deleteFloorHandler)
	mux.HandleFunc("POST /floors/{floor_id}/plan", app.uploadFloorPlanHandler)

	// Layout editor
	mux.HandleFunc("GET /floors/{floor_id}/layout", app.getLayoutHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published", app.getPublishedLayoutHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published.svg", app.getPublishedSVGHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/published.html", app.getPublishedHTMLHandler)
	mux.HandleFunc("PUT /floors/{floor_id}/layout/draft", app.saveLayoutDraftHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}/layout/draft", app.discardLayoutDraftHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/import", importLayoutSVGHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/publish", app.publishLayoutHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/sync-desks", app.syncLayoutDesksHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/history", app.getLayoutHistoryHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/revisions", app.listLayoutRevisionsHandler)
	mux.HandleFunc("GET /floors/{floor_id}/layout/revisions/{revision_id}", app.getLayoutRevisionHandler)
	mux.HandleFunc("POST /floors/{floor_id}/layout/revisions/{revision_id}/restore", app.restoreLayoutRevisionHandler)
	mux.HandleFunc("GET /floors/{floor_id}/lock", app.getFloorLockHandler)
	mux.HandleFunc("POST /floors/{floor_id}/lock", app.acquireFloorLockHandler)
	mux.HandleFunc("DELETE /floors/{floor_id}/lock", app.releaseFloorLockHandler)

	// Admin maintenance
	mux.HandleFunc("POST /admin/cleanup/revisions", app.cleanupRevisionsHandler)

	// Templates
	mux.HandleFunc("GET /templates", app.listTemplatesHandler)
	mux.HandleFunc("POST /templates", app.createTemplateHandler)
	mux.HandleFunc("DELETE /templates/{template_id}", app.deleteTemplateHandler)

	// Blocks
	mux.HandleFunc("GET /blocks", app.listBlocksHandler)
	mux.HandleFunc("POST /blocks", app.createBlockHandler)
	mux.HandleFunc("DELETE /blocks/{block_id}", app.deleteBlockHandler)

	// Desks
	mux.HandleFunc("GET /desks", app.listDesksHandler)
	mux.HandleFunc("GET /desks/{desk_id}", app.getDeskHandler)
	mux.HandleFunc("PATCH /desks/{desk_id}", app.updateDeskHandler)
	mux.HandleFunc("DELETE /desks/{desk_id}", app.deleteDeskHandler)

	// Public embed (no auth — read-only published floor plan)
	mux.HandleFunc("GET /embed/floors/{floor_id}", app.embedFloorHandler)


	// Static file serving
	staticDir := envDefault("STATIC_DIR", "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))

	// CORS middleware
	handler := corsMiddleware(logRequests(mux))

	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("DeskBook Go API listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Role")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"message": "ok"})
}

func renderSVGHandler(w http.ResponseWriter, r *http.Request) {
	layout, _, err := decodeRenderRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(svg))
}

func renderHTMLHandler(w http.ResponseWriter, r *http.Request) {
	layout, title, err := decodeRenderRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(title) == "" {
		title = r.URL.Query().Get("title")
	}
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(exporter.RenderHTML(svg, title)))
}

func importLayoutSVGHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminContext(r); err != nil {
		writeAuthError(w, err)
		return
	}
	if _, ok := floorIDFromPath(w, r); !ok {
		return
	}
	raw, err := ioReadLimited(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	result, err := svgimport.Classify(string(raw))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, errorResponse{Detail: err.Error()})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func envDefault(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
