package handler

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"deskbook/backend-go/internal/auth"
	"deskbook/backend-go/internal/store"
	"golang.org/x/crypto/bcrypt"
)

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

type createInvitePayload struct {
	Email     string `json:"email"`
	Role      string `json:"role"`
	ExpiresIn *int   `json:"expires_in_hours"`
}

func (s *Server) RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil || s.Invites == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	var p registerPayload
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	p.Username = strings.TrimSpace(p.Username)
	p.Email = strings.TrimSpace(strings.ToLower(p.Email))
	p.InviteToken = strings.TrimSpace(p.InviteToken)
	if p.Username == "" || p.Email == "" || p.Password == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("username, email and password are required"))
		return
	}
	if p.InviteToken == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("invite_token is required"))
		return
	}

	ctx := r.Context()
	inv, err := s.validateInviteToken(ctx, p.InviteToken, p.Email)
	if err != nil {
		WriteError(w, http.StatusForbidden, err)
		return
	}

	existing, _ := s.Users.GetByUsername(ctx, p.Username)
	if existing != nil {
		WriteError(w, http.StatusConflict, fmt.Errorf("username already taken"))
		return
	}
	existingEmail, _ := s.Users.GetByEmail(ctx, p.Email)
	if existingEmail != nil {
		WriteError(w, http.StatusConflict, fmt.Errorf("email already registered"))
		return
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	user, err := s.Users.Create(ctx, p.Username, p.Email, string(hashed), inv.Role)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	_ = s.Invites.MarkUsed(ctx, inv.ID)
	WriteJSON(w, http.StatusCreated, user.ToPublic())
}

var dummyHash = []byte("$2a$10$325u.Hl2mJ5Fq1k58sT0U.2L3qV0qg9f05w3k58sT0U.2L3qV0qg9")

func (s *Server) LoginHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	contentType := r.Header.Get("Content-Type")
	var username, password string

	if strings.Contains(contentType, "application/x-www-form-urlencoded") {
		if err := r.ParseForm(); err != nil {
			WriteError(w, http.StatusBadRequest, err)
			return
		}
		username = r.FormValue("username")
		password = r.FormValue("password")
	} else {
		var p loginPayload
		if err := DecodeJSONBody(r, &p); err != nil {
			WriteError(w, http.StatusBadRequest, err)
			return
		}
		username = p.Username
		password = p.Password
	}

	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("username and password are required"))
		return
	}

	user, err := s.Users.GetByUsername(r.Context(), username)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}

	hashToCheck := dummyHash
	if user != nil {
		hashToCheck = []byte(user.HashedPassword)
	}
	if user == nil || bcrypt.CompareHashAndPassword(hashToCheck, []byte(password)) != nil {
		WriteJSON(w, http.StatusUnauthorized, errorResponse{Detail: "Incorrect username or password"})
		return
	}
	if !user.IsActive {
		WriteJSON(w, http.StatusForbidden, errorResponse{Detail: "Account is disabled"})
		return
	}

	secret := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if secret == "" {
		secret = "change-me-in-production"
	}
	expMinutes := 43200 // 30 days
	if v := os.Getenv("ACCESS_TOKEN_EXPIRE_MINUTES"); v != "" {
		if m, err := strconv.Atoi(v); err == nil && m > 0 {
			expMinutes = m
		}
	}

	token, err := auth.IssueToken(user.Username, user.Role, secret, expMinutes)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}

	WriteJSON(w, http.StatusOK, tokenResponse{AccessToken: token, TokenType: "bearer"})
}

func (s *Server) CreateInviteHandler(w http.ResponseWriter, r *http.Request) {
	if s.Invites == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	authCtx, err := s.requireActiveAdmin(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	var p createInvitePayload
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	p.Email = strings.TrimSpace(strings.ToLower(p.Email))
	if p.Email == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("email is required"))
		return
	}
	if p.Role == "" {
		p.Role = "user"
	}
	if p.Role != "admin" && p.Role != "user" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("role must be 'admin' or 'user'"))
		return
	}

	var expiresAt *time.Time
	if p.ExpiresIn != nil && *p.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(*p.ExpiresIn) * time.Hour)
		expiresAt = &t
	}

	creator, _ := s.Users.GetByUsername(r.Context(), authCtx.Username)
	if creator == nil {
		WriteError(w, http.StatusInternalServerError, fmt.Errorf("creator not found"))
		return
	}

	inv, err := s.Invites.Create(r.Context(), p.Email, p.Role, creator.ID, expiresAt)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, inv)
}

func (s *Server) ListInvitesHandler(w http.ResponseWriter, r *http.Request) {
	if s.Invites == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	invites, err := s.Invites.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if invites == nil {
		invites = []store.InviteRow{}
	}
	WriteJSON(w, http.StatusOK, invites)
}

func (s *Server) DeleteInviteHandler(w http.ResponseWriter, r *http.Request) {
	if s.Invites == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := IntPathValue(w, r, "invite_id")
	if !ok {
		return
	}
	if err := s.Invites.Delete(r.Context(), id); err != nil {
		if err == store.ErrNotFound {
			WriteError(w, http.StatusNotFound, fmt.Errorf("invite not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) GetInviteInfoHandler(w http.ResponseWriter, r *http.Request) {
	if s.Invites == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	token := strings.TrimSpace(r.PathValue("token"))
	if token == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("token is required"))
		return
	}
	inv, err := s.Invites.GetByToken(r.Context(), token)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if inv == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("invite not found"))
		return
	}
	if inv.UsedAt != nil {
		WriteError(w, http.StatusGone, fmt.Errorf("invite already used"))
		return
	}
	if inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
		WriteError(w, http.StatusGone, fmt.Errorf("invite expired"))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{
		"email": inv.Email,
		"role":  inv.Role,
	})
}

func (s *Server) validateInviteToken(ctx context.Context, token, email string) (*store.InviteRow, error) {
	if s.Invites == nil {
		return nil, fmt.Errorf("database not configured")
	}
	inv, err := s.Invites.GetByToken(ctx, token)
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
