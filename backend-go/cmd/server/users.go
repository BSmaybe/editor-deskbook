package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type userStore struct {
	pool *pgxpool.Pool
}

func newUserStore(ctx context.Context, databaseURL string) (*userStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &userStore{pool: pool}, nil
}

func (s *userStore) close() { s.pool.Close() }

type userRow struct {
	ID             int        `json:"id"`
	Username       string     `json:"username"`
	Email          string     `json:"email"`
	HashedPassword string     `json:"-"`
	Role           string     `json:"role"`
	CreatedAt      *time.Time `json:"created_at"`
	FullName       *string    `json:"full_name"`
	Department     *string    `json:"department"`
	Position       *string    `json:"position"`
	Phone          *string    `json:"phone"`
	UserStatus     string     `json:"user_status"`
	IsActive       bool       `json:"is_active"`
}

type userPublic struct {
	ID         int     `json:"id"`
	Username   string  `json:"username"`
	Email      string  `json:"email"`
	Role       string  `json:"role"`
	FullName   *string `json:"full_name"`
	Department *string `json:"department"`
	Position   *string `json:"position"`
	Phone      *string `json:"phone"`
	UserStatus string  `json:"user_status"`
	IsActive   bool    `json:"is_active"`
}

func (u *userRow) toPublic() userPublic {
	return userPublic{
		ID: u.ID, Username: u.Username, Email: u.Email, Role: u.Role,
		FullName: u.FullName, Department: u.Department, Position: u.Position,
		Phone: u.Phone, UserStatus: u.UserStatus, IsActive: u.IsActive,
	}
}

func (s *userStore) getByUsername(ctx context.Context, username string) (*userRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users WHERE username = $1`, username)
	var u userRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *userStore) getByEmail(ctx context.Context, email string) (*userRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1`, email)
	var id int
	err := row.Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &userRow{ID: id}, nil
}

func (s *userStore) getByID(ctx context.Context, id int) (*userRow, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users WHERE id = $1`, id)
	var u userRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *userStore) create(ctx context.Context, username, email, hashedPw, role string) (*userRow, error) {
	row := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, hashed_password, role)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, username, email, hashed_password, role, created_at,
		           full_name, department, position, phone, user_status, is_active`,
		username, email, hashedPw, role)
	var u userRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	return &u, err
}

func (s *userStore) list(ctx context.Context) ([]userRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, username, email, hashed_password, role, created_at,
		        full_name, department, position, phone, user_status, is_active
		 FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []userRow
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
			&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive); err != nil {
			return nil, err
		}
		result = append(result, u)
	}
	return result, rows.Err()
}

func (s *userStore) updateRole(ctx context.Context, username, role string, isActive bool) (*userRow, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE users SET role = $2, is_active = $3 WHERE username = $1
		 RETURNING id, username, email, hashed_password, role, created_at,
		           full_name, department, position, phone, user_status, is_active`, username, role, isActive)
	var u userRow
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.HashedPassword, &u.Role, &u.CreatedAt,
		&u.FullName, &u.Department, &u.Position, &u.Phone, &u.UserStatus, &u.IsActive)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func (s *userStore) delete(ctx context.Context, username string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- Auth handlers ---

type registerPayload struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	InviteToken string `json:"invite_token"`
}

type loginPayload struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

func (app *appServer) registerHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil || app.invites == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	var p registerPayload
	if err := decodeJSONBody(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	p.Username = strings.TrimSpace(p.Username)
	p.Email = strings.TrimSpace(strings.ToLower(p.Email))
	p.InviteToken = strings.TrimSpace(p.InviteToken)
	if p.Username == "" || p.Email == "" || p.Password == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("username, email and password are required"))
		return
	}
	if p.InviteToken == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invite_token is required"))
		return
	}

	ctx := r.Context()
	inv, err := app.validateInviteToken(ctx, p.InviteToken, p.Email)
	if err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}

	if existing, _ := app.users.getByUsername(ctx, p.Username); existing != nil {
		writeError(w, http.StatusConflict, fmt.Errorf("username already taken"))
		return
	}
	if existing, _ := app.users.getByEmail(ctx, p.Email); existing != nil {
		writeError(w, http.StatusConflict, fmt.Errorf("email already registered"))
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	user, err := app.users.create(ctx, p.Username, p.Email, string(hashed), inv.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	_ = app.invites.markUsed(ctx, inv.ID)
	writeJSON(w, http.StatusCreated, user.toPublic())
}

func (app *appServer) loginHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	contentType := r.Header.Get("Content-Type")
	var username, password string

	if strings.Contains(contentType, "application/x-www-form-urlencoded") {
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		username = r.FormValue("username")
		password = r.FormValue("password")
	} else {
		var p loginPayload
		if err := decodeJSONBody(r, &p); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		username = p.Username
		password = p.Password
	}

	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("username and password are required"))
		return
	}

	user, err := app.users.getByUsername(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if user == nil || bcrypt.CompareHashAndPassword([]byte(user.HashedPassword), []byte(password)) != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Detail: "Incorrect username or password"})
		return
	}
	if !user.IsActive {
		writeJSON(w, http.StatusForbidden, errorResponse{Detail: "Account is disabled"})
		return
	}
	token := issueJWT(user.Username, user.Role)
	writeJSON(w, http.StatusOK, tokenResponse{AccessToken: token, TokenType: "bearer"})
}

func (app *appServer) listUsersHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAuth(r); err != nil {
		writeAuthError(w, err)
		return
	}
	users, err := app.users.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	var result []userPublic
	for _, u := range users {
		if search != "" {
			if !strings.Contains(strings.ToLower(u.Username), search) &&
				(u.FullName == nil || !strings.Contains(strings.ToLower(*u.FullName), search)) {
				continue
			}
		}
		result = append(result, u.toPublic())
	}
	if result == nil {
		result = []userPublic{}
	}
	writeJSON(w, http.StatusOK, result)
}

func (app *appServer) adminListUsersHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAdmin(r); err != nil {
		writeAuthError(w, err)
		return
	}
	users, err := app.users.list(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	result := make([]userPublic, 0, len(users))
	for _, u := range users {
		result = append(result, u.toPublic())
	}
	writeJSON(w, http.StatusOK, result)
}

func (app *appServer) adminUpdateUserHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAdmin(r); err != nil {
		writeAuthError(w, err)
		return
	}
	username := r.PathValue("username")
	var payload struct {
		Role     *string `json:"role"`
		IsActive *bool   `json:"is_active"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	existing, _ := app.users.getByUsername(r.Context(), username)
	if existing == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("user not found"))
		return
	}
	role := existing.Role
	isActive := existing.IsActive
	if payload.Role != nil {
		role = *payload.Role
	}
	if payload.IsActive != nil {
		isActive = *payload.IsActive
	}
	updated, err := app.users.updateRole(r.Context(), username, role, isActive)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, updated.toPublic())
}

func (app *appServer) adminDeleteUserHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := app.requireActiveAdmin(r); err != nil {
		writeAuthError(w, err)
		return
	}
	username := r.PathValue("username")
	if err := app.users.delete(r.Context(), username); err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, fmt.Errorf("user not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (app *appServer) getMeHandler(w http.ResponseWriter, r *http.Request) {
	if app.users == nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	auth, err := app.requireActiveAuth(r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	user, err := app.users.getByUsername(r.Context(), auth.Username)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("user not found"))
		return
	}
	writeJSON(w, http.StatusOK, user.toPublic())
}

// --- Bootstrap ---

func seedBootstrapAdmin(ctx context.Context, store *userStore) {
	email := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))
	password := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"))
	if email == "" || password == "" {
		return
	}
	users, err := store.list(ctx)
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
	if _, err := store.create(ctx, username, email, string(hashed), "admin"); err != nil {
		log.Printf("bootstrap: create admin error: %v", err)
		return
	}
	log.Printf("bootstrap: created admin user %q (%s)", username, email)
}

// --- JWT issue ---

func issueJWT(username, role string) string {
	secret := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if secret == "" {
		secret = "change-me-in-production"
	}
	expMinutes := 43200 // 30 days; override with ACCESS_TOKEN_EXPIRE_MINUTES env var
	if v := os.Getenv("ACCESS_TOKEN_EXPIRE_MINUTES"); v != "" {
		if m, err := strconv.Atoi(v); err == nil && m > 0 {
			expMinutes = m
		}
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	now := time.Now().Unix()
	claims := map[string]any{
		"sub":  username,
		"role": role,
		"exp":  now + int64(expMinutes*60),
	}
	claimsJSON, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := header + "." + payload
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig
}

// --- helpers ---

func decodeJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

