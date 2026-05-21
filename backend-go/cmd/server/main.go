package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"deskbook/backend-go/internal/handler"
	"deskbook/backend-go/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	addr := ":" + handler.EnvDefault("PORT", "8080")
	ctx := context.Background()

	var (
		cs  *store.ComponentStore
		ls  *store.LayoutStore
		us  *store.UserStore
		os2 *store.OfficeStore
		fs  *store.FloorStore
		ds  *store.DeskStore
		ts  *store.TemplateStore
		bs  *store.BlockStore
		is  *store.InviteStore
	)

	if databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); databaseURL != "" {
		pool, err := pgxpool.New(ctx, databaseURL)
		if err != nil {
			log.Fatalf("failed to connect to database: %v", err)
		}
		defer pool.Close()

		if err := pool.Ping(ctx); err != nil {
			log.Fatalf("failed to ping database: %v", err)
		}

		log.Printf("database connection established")

		cs = store.NewComponentStore(pool)
		if err := cs.EnsureSchema(ctx); err != nil {
			log.Printf("component schema error: %v", err)
		}

		ls = store.NewLayoutStore(pool)
		if err := ls.EnsureSchema(ctx); err != nil {
			log.Printf("layout schema error: %v", err)
		}

		us = store.NewUserStore(pool)
		os2 = store.NewOfficeStore(pool)
		fs = store.NewFloorStore(pool)
		ds = store.NewDeskStore(pool)
		ts = store.NewTemplateStore(pool)
		bs = store.NewBlockStore(pool)
		is = store.NewInviteStore(pool)

		if us != nil {
			seedBootstrapAdmin(ctx, us)
		}
	} else {
		log.Println("warning: DATABASE_URL not set, database stores are disabled")
	}

	// Create and start the refactored server
	server := handler.NewServer(cs, ls, us, os2, fs, ds, ts, bs, is)
	server.StartLockJanitor(ctx)

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("DeskBook Go API listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func seedBootstrapAdmin(ctx context.Context, s *store.UserStore) {
	email := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))
	password := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"))
	if email == "" || password == "" {
		return
	}
	users, err := s.List(ctx)
	if err != nil {
		log.Printf("bootstrap: cannot list users: %v", err)
		return
	}
	for _, u := range users {
		if u.Role == "admin" {
			return
		}
	}
	username := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_USERNAME"))
	if username == "" {
		username = "admin"
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("bootstrap: bcrypt error: %v", err)
		return
	}
	if _, err := s.Create(ctx, username, email, string(hashed), "admin"); err != nil {
		log.Printf("bootstrap: create admin error: %v", err)
		return
	}
	log.Printf("bootstrap: created admin user %q (%s)", username, email)
}
