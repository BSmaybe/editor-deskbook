package handler

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"deskbook/backend-go/internal/exporter"
	"deskbook/backend-go/internal/store"
)

var (
	componentIDRE      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$`)
	assetTypes         = map[string]bool{
		"workplace": true, "desk": true, "chair": true, "meeting_table": true, "conference_set": true,
		"call_room": true, "lounge": true, "sofa": true, "plant": true, "storage": true,
		"printer": true, "reception": true, "column": true, "asset": true,
	}
	builtinComponentIDs = map[string]bool{
		"workplace-desk-chair": true, "chair": true, "desk-short": true, "desk-long": true,
		"sit-stand-desk": true, "bench-4": true, "meeting-table": true, "round-table": true,
		"conference-chair": true, "conference-set": true, "phone-booth": true, "focus-room": true,
		"sofa": true, "lounge-chair": true, "plant": true, "storage-cabinet": true,
		"locker-bank": true, "printer": true, "reception-desk": true, "column": true,
	}
)

type componentPayload struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	AssetType string    `json:"asset_type"`
	ViewBox   []float64 `json:"view_box"`
	DefaultW  float64   `json:"default_w"`
	DefaultH  float64   `json:"default_h"`
	SVGMarkup string    `json:"svg_markup"`
}

func (s *Server) ListComponentsHandler(w http.ResponseWriter, r *http.Request) {
	if s.Components == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}
	out, err := s.Components.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if out == nil {
		out = []store.ComponentOut{}
	}
	WriteJSON(w, http.StatusOK, out)
}

func (s *Server) CreateComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	var body componentPayload
	if err := DecodeJSONBody(r, &body); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	if err := validateComponentPayload(body); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if builtinComponentIDs[body.ID] {
		WriteError(w, http.StatusConflict, errors.New("component with this ID already exists"))
		return
	}
	if s.Components == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}

	comp, err := s.Components.Create(r.Context(), body.ID, body.Label, body.AssetType, body.ViewBox, body.DefaultW, body.DefaultH, body.SVGMarkup)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			WriteError(w, http.StatusConflict, errors.New("component with this ID already exists"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, comp)
}

func (s *Server) UpdateComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	componentID := strings.TrimSpace(r.PathValue("component_id"))
	var body componentPayload
	if err := DecodeJSONBody(r, &body); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	if body.ID != componentID {
		WriteError(w, http.StatusBadRequest, errors.New("component ID cannot be changed"))
		return
	}
	if err := validateComponentPayload(body); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if s.Components == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}

	comp, err := s.Components.Update(r.Context(), body.ID, body.Label, body.AssetType, body.ViewBox, body.DefaultW, body.DefaultH, body.SVGMarkup)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, comp)
}

func (s *Server) DeleteComponentHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	if s.Components == nil {
		WriteError(w, http.StatusServiceUnavailable, errors.New("component store is not configured"))
		return
	}
	componentID := strings.TrimSpace(r.PathValue("component_id"))
	if err := s.Components.Delete(r.Context(), componentID); err != nil {
		if err.Error() == "component not found" {
			WriteError(w, http.StatusNotFound, err)
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

func validateComponentPayload(body componentPayload) error {
	if !componentIDRE.MatchString(body.ID) {
		return errors.New("invalid component id")
	}
	if strings.TrimSpace(body.Label) == "" || len(body.Label) > 120 {
		return errors.New("label is required and must be at most 120 characters")
	}
	if !assetTypes[body.AssetType] {
		return errors.New("invalid asset_type")
	}
	if len(body.ViewBox) != 4 || body.ViewBox[2] <= 0 || body.ViewBox[3] <= 0 {
		return errors.New("view_box must be [x, y, width, height] with positive size")
	}
	if body.DefaultW <= 0 || body.DefaultW > 10000 || body.DefaultH <= 0 || body.DefaultH > 10000 {
		return errors.New("default size is out of range")
	}
	if err := exporter.ValidateSVGFragment(body.SVGMarkup); err != nil {
		return fmt.Errorf("unsafe svg_markup: %w", err)
	}
	return nil
}
