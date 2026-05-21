package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"deskbook/backend-go/internal/handler"
	"deskbook/backend-go/internal/store"
	"deskbook/backend-go/migrations"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	// Set up structured logging
	var logHandler slog.Handler
	if os.Getenv("APP_ENV") == "production" {
		logHandler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	} else {
		logHandler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	}
	slog.SetDefault(slog.New(logHandler))

	addr := ":" + handler.EnvDefault("PORT", "8080")

	// Set up graceful shutdown context
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var (
		pool *pgxpool.Pool
		cs   *store.ComponentStore
		ls   *store.LayoutStore
		us   *store.UserStore
		os2  *store.OfficeStore
		fs   *store.FloorStore
		ds   *store.DeskStore
		ts   *store.TemplateStore
		bs   *store.BlockStore
		is   *store.InviteStore
	)

	if databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); databaseURL != "" {
		// 1. Run migrations using goose
		db, err := sql.Open("pgx", databaseURL)
		if err != nil {
			slog.Error("failed to open database for migrations", "error", err)
			os.Exit(1)
		}

		goose.SetBaseFS(migrations.EmbedFS)
		if err := goose.SetDialect("postgres"); err != nil {
			slog.Error("failed to set goose dialect", "error", err)
			db.Close()
			os.Exit(1)
		}

		slog.Info("running database migrations")
		if err := goose.Up(db, "."); err != nil {
			slog.Error("migration failed", "error", err)
			db.Close()
			os.Exit(1)
		}
		db.Close()
		slog.Info("database migrations completed successfully")

		// 2. Setup connection pool for runtime stores
		var errPool error
		pool, errPool = pgxpool.New(ctx, databaseURL)
		if errPool != nil {
			slog.Error("failed to connect to database pool", "error", errPool)
			os.Exit(1)
		}

		if err := pool.Ping(ctx); err != nil {
			slog.Error("failed to ping database pool", "error", err)
			pool.Close()
			os.Exit(1)
		}

		slog.Info("database connection pool established")

		cs = store.NewComponentStore(pool)
		if err := cs.EnsureSchema(ctx); err != nil {
			slog.Warn("component schema ensure error", "error", err)
		}

		ls = store.NewLayoutStore(pool)
		if err := ls.EnsureSchema(ctx); err != nil {
			slog.Warn("layout schema ensure error", "error", err)
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
		slog.Warn("DATABASE_URL not set, database stores are disabled")
	}

	// Create and start the server
	server := handler.NewServer(cs, ls, us, os2, fs, ds, ts, bs, is)
	server.StartLockJanitor(ctx)

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Run HTTP server in a goroutine
	go func() {
		slog.Info("DeskBook Go API listening", "addr", addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server ListenAndServe error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for OS interrupt signal
	<-ctx.Done()
	slog.Info("shutting down HTTP server gracefully...")

	// Attempt graceful shutdown with 10s timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server Shutdown forced", "error", err)
	} else {
		slog.Info("HTTP server gracefully stopped")
	}

	if pool != nil {
		slog.Info("closing database connection pool...")
		pool.Close()
		slog.Info("database connection pool closed")
	}
	slog.Info("shutdown complete")
}

func seedBootstrapAdmin(ctx context.Context, s *store.UserStore) {
	email := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))
	password := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"))
	if email == "" || password == "" {
		return
	}
	users, err := s.List(ctx)
	if err != nil {
		slog.Error("bootstrap: cannot list users", "error", err)
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
		slog.Error("bootstrap: bcrypt error", "error", err)
		return
	}
	if _, err := s.Create(ctx, username, email, string(hashed), "admin"); err != nil {
		slog.Error("bootstrap: create admin error", "error", err)
		return
	}
	slog.Info("bootstrap: created admin user", "username", username, "email", email)
}
