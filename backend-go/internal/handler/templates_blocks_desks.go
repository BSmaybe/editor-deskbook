package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"deskbook/backend-go/internal/store"
)

// --- Templates ---

func (s *Server) ListTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	if s.Templates == nil {
		WriteJSON(w, http.StatusOK, []store.LayoutTemplate{})
		return
	}
	list, err := s.Templates.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) CreateTemplateHandler(w http.ResponseWriter, r *http.Request) {
	if s.Templates == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("templates store not available"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}

	var body struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Category    string          `json:"category"`
		Layout      json.RawMessage `json:"layout"`
	}
	if err := DecodeJSONBody(r, &body); err != nil {
		WriteError(w, http.StatusBadRequest, errors.New("invalid JSON"))
		return
	}
	if body.Name == "" || len(body.Layout) == 0 {
		WriteError(w, http.StatusBadRequest, errors.New("name and layout are required"))
		return
	}
	if body.Category == "" {
		body.Category = "custom"
	}

	t := store.LayoutTemplate{
		Name:        body.Name,
		Description: body.Description,
		Category:    body.Category,
		LayoutJSON:  string(body.Layout),
	}
	t, err := s.Templates.Create(r.Context(), t)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, t)
}

func (s *Server) DeleteTemplateHandler(w http.ResponseWriter, r *http.Request) {
	if s.Templates == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("templates store not available"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("template_id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, errors.New("invalid template_id"))
		return
	}
	if err := s.Templates.Delete(r.Context(), id); err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Blocks ---

func (s *Server) ListBlocksHandler(w http.ResponseWriter, r *http.Request) {
	if s.Blocks == nil {
		WriteJSON(w, http.StatusOK, []store.LayoutBlock{})
		return
	}
	list, err := s.Blocks.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) CreateBlockHandler(w http.ResponseWriter, r *http.Request) {
	if s.Blocks == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("blocks store not available"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	var body struct {
		Name        string          `json:"name"`
		Category    string          `json:"category"`
		Description string          `json:"description"`
		Objects     json.RawMessage `json:"objects"`
		PreviewSVG  string          `json:"preview_svg"`
	}
	if err := DecodeJSONBody(r, &body); err != nil {
		WriteError(w, http.StatusBadRequest, errors.New("invalid JSON"))
		return
	}
	if body.Name == "" || len(body.Objects) == 0 {
		WriteError(w, http.StatusBadRequest, errors.New("name and objects are required"))
		return
	}
	if body.Category == "" {
		body.Category = "custom"
	}
	b := store.LayoutBlock{
		Name:        body.Name,
		Category:    body.Category,
		Description: body.Description,
		Objects:     body.Objects,
		PreviewSVG:  body.PreviewSVG,
	}
	b, err := s.Blocks.Create(r.Context(), b)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, b)
}

func (s *Server) DeleteBlockHandler(w http.ResponseWriter, r *http.Request) {
	if s.Blocks == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("blocks store not available"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("block_id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, errors.New("invalid block_id"))
		return
	}
	if err := s.Blocks.Delete(r.Context(), id); err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Desks ---

func (s *Server) ListDesksHandler(w http.ResponseWriter, r *http.Request) {
	if s.Desks == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	var floorID *int
	if v := r.URL.Query().Get("floor_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid floor_id"))
			return
		}
		floorID = &id
	}
	desks, err := s.Desks.List(r.Context(), floorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if desks == nil {
		desks = []store.DeskRow{}
	}
	WriteJSON(w, http.StatusOK, desks)
}

func (s *Server) GetDeskHandler(w http.ResponseWriter, r *http.Request) {
	if s.Desks == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	desk, err := s.Desks.GetByID(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if desk == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
		return
	}
	WriteJSON(w, http.StatusOK, desk)
}

func (s *Server) UpdateDeskHandler(w http.ResponseWriter, r *http.Request) {
	if s.Desks == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	var p struct {
		Label      *string  `json:"label"`
		Type       *string  `json:"type"`
		SpaceType  *string  `json:"space_type"`
		AssignedTo *string  `json:"assigned_to"`
		PositionX  *float64 `json:"position_x"`
		PositionY  *float64 `json:"position_y"`
		W          *float64 `json:"w"`
		H          *float64 `json:"h"`
	}
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	desk, err := s.Desks.Update(r.Context(), id, p.Label, p.Type, p.SpaceType, p.AssignedTo, p.PositionX, p.PositionY, p.W, p.H)
	if errors.Is(err, store.ErrNotFound) {
		WriteError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, desk)
}

func (s *Server) DeleteDeskHandler(w http.ResponseWriter, r *http.Request) {
	if s.Desks == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, err := strconv.Atoi(r.PathValue("desk_id"))
	if err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid desk_id"))
		return
	}
	if err := s.Desks.Delete(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, fmt.Errorf("desk not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
