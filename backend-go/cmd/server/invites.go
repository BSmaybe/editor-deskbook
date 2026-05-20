package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type inviteStore struct {
	pool *pgxpool.Pool
}

func newInviteStore(ctx context.Context, databaseURL string) (*inviteStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &inviteStore{pool: pool}, nil
}

func (s *inviteStore) close() { s.pool.Close() }

type inviteRow struct {
	ID        int        `json:"id"`
	Token     string     `json:"token"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	CreatedBy *int       `json:"created_by"`
	CreatedAt *time.Time `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at"`
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *inviteStore) create(ctx context.Context, email, role string, createdBy int, expiresAt *time.Time) (*inviteRow, error) {
	token, err := generateToken()
	if err != nil {
		return nil, err
	}
	row := s.pool.QueryRow(ctx,
		`INSERT INTO invites (token, email, role, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, token, email, role, created_by, created_at, expires_at, used_at`,
		token, email, role, createdBy, expiresAt)
	var inv inviteRow
	err = row.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
		&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt)
	return &inv, err
}

func (s *inviteStore) list(ctx context.Context) ([]inviteRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, token, email, role, created_by, created_at, expires_at, used_at
		 FROM invites ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []inviteRow
	for rows.Next() {
		var inv inviteRow
		if err := rows.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
			&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt); err != nil {
			return nil, err
		}
		result = append(result, inv)
	}
	return result, rows.Err()
}

func (s *inviteStore) getByToken(ctx context.Context, token string) (*inviteRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, token, email, role, created_by, created_at, expires_at, used_at
		 FROM invites WHERE token = $1`, token)
	var inv inviteRow
	err := row.Scan(&inv.ID, &inv.Token, &inv.Email, &inv.Role, &inv.CreatedBy,
		&inv.CreatedAt, &inv.ExpiresAt, &inv.UsedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &inv, err
}

func (s *inviteStore) markUsed(ctx context.Context, id int) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE invites SET used_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *inviteStore) delete(ctx context.Context, id int) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM invites WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- Handlers ---

type createInvitePayload struct {
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	ExpiresIn *int    `json:"expires_in_hours"`
}

func (app *appServer) createInviteHandler(w http.ResponseWriter, r *http.Request) {
	if app.invites == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	auth, err := app.requireActiveAdmin(r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	var p createInvitePayload
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	p.Email = strings.TrimSpace(strings.ToLower(p.Email))
	if p.Email == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("email is required"))
		return
	}
	if p.Role == "" {
		p.Role = "user"
	}
	if p.Role != "admin" && p.Role != "user" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("role must be 'admin' or 'user'"))
		return
	}

	var expiresAt *time.Time
	if p.ExpiresIn != nil && *p.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(*p.ExpiresIn) * time.Hour)
		expiresAt = &t
	}

	creator, _ := app.users.getByUsername(r.Context(), auth.Username)
	if creator == nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("creator not found"))
		return
	}

	inv, err := app.invites.create(r.Context(), p.Email, p.Role, creator.ID, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (app *appServer) listInvitesHandler(w http.ResponseWriter, r *http.Request) {
	if app.invites == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAdmin(r); err != nil {
		writeAuthError(w, err)
		return
	}
	invites, err := app.invites.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if invites == nil {
		invites = []inviteRow{}
	}
	writeJSON(w, http.StatusOK, invites)
}

func (app *appServer) deleteInviteHandler(w http.ResponseWriter, r *http.Request) {
	if app.invites == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAdmin(r); err != nil {
		writeAuthError(w, err)
		return
	}
	id, ok := intPathValue(w, r, "invite_id")
	if !ok {
		return
	}
	if err := app.invites.delete(r.Context(), id); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("invite not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// getInviteInfoHandler returns public info about an invite (email, role) so the registration page can prefill.
func (app *appServer) getInviteInfoHandler(w http.ResponseWriter, r *http.Request) {
	if app.invites == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	token := strings.TrimSpace(r.PathValue("token"))
	if token == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("token is required"))
		return
	}
	inv, err := app.invites.getByToken(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if inv == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("invite not found"))
		return
	}
	if inv.UsedAt != nil {
		writeError(w, http.StatusGone, fmt.Errorf("invite already used"))
		return
	}
	if inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
		writeError(w, http.StatusGone, fmt.Errorf("invite expired"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"email": inv.Email,
		"role":  inv.Role,
	})
}

func intPathValue(w http.ResponseWriter, r *http.Request, name string) (int, bool) {
	v, err := strconv.Atoi(strings.TrimSpace(r.PathValue(name)))
	if err != nil || v <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("invalid "+name))
		return 0, false
	}
	return v, true
}

// validateInviteToken checks the token is valid, unused, not expired, and email matches.
func (app *appServer) validateInviteToken(ctx context.Context, token, email string) (*inviteRow, error) {
	if app.invites == nil {
		return nil, fmt.Errorf("database not configured")
	}
	inv, err := app.invites.getByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	if inv == nil {
		return nil, fmt.Errorf("invalid invite token")
	}
	if inv.UsedAt != nil {
		return nil, fmt.Errorf("invite already used")
	}
	if inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("invite expired")
	}
	if strings.ToLower(inv.Email) != strings.ToLower(email) {
		return nil, fmt.Errorf("email does not match invite")
	}
	return inv, nil
}
