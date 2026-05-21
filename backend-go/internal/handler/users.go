package handler

import (
	"fmt"
	"net/http"
	"strings"

	"deskbook/backend-go/internal/store"
)

func (s *Server) ListUsersHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	users, err := s.Users.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	var result []store.UserPublic
	for _, u := range users {
		if search != "" {
			if !strings.Contains(strings.ToLower(u.Username), search) &&
				(u.FullName == nil || !strings.Contains(strings.ToLower(*u.FullName), search)) {
				continue
			}
		}
		result = append(result, u.ToPublic())
	}
	if result == nil {
		result = []store.UserPublic{}
	}
	WriteJSON(w, http.StatusOK, result)
}

func (s *Server) AdminListUsersHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	users, err := s.Users.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	result := make([]store.UserPublic, 0, len(users))
	for _, u := range users {
		result = append(result, u.ToPublic())
	}
	WriteJSON(w, http.StatusOK, result)
}

func (s *Server) AdminUpdateUserHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	username := r.PathValue("username")
	var payload struct {
		Role     *string `json:"role"`
		IsActive *bool   `json:"is_active"`
	}
	if err := DecodeJSONBody(r, &payload); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	existing, _ := s.Users.GetByUsername(r.Context(), username)
	if existing == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("user not found"))
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
	updated, err := s.Users.UpdateRole(r.Context(), username, role, isActive)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, updated.ToPublic())
}

func (s *Server) AdminDeleteUserHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAdmin(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	username := r.PathValue("username")
	if err := s.Users.Delete(r.Context(), username); err != nil {
		if err == store.ErrNotFound {
			WriteError(w, http.StatusNotFound, fmt.Errorf("user not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) GetMeHandler(w http.ResponseWriter, r *http.Request) {
	if s.Users == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	authCtx, err := s.requireActiveAuth(r)
	if err != nil {
		WriteAuthError(w, err)
		return
	}
	user, err := s.Users.GetByUsername(r.Context(), authCtx.Username)
	if err != nil || user == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("user not found"))
		return
	}
	WriteJSON(w, http.StatusOK, user.ToPublic())
}
