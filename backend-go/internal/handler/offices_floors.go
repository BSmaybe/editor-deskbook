package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"deskbook/backend-go/internal/store"
)

func (s *Server) ListOfficesHandler(w http.ResponseWriter, r *http.Request) {
	if s.Offices == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	offices, err := s.Offices.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if offices == nil {
		offices = []store.OfficeRow{}
	}
	WriteJSON(w, http.StatusOK, offices)
}

func (s *Server) CreateOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if s.Offices == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	var p struct {
		Name    string  `json:"name"`
		Address *string `json:"address"`
	}
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	if p.Name == "" {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("name is required"))
		return
	}
	office, err := s.Offices.Create(r.Context(), p.Name, p.Address)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, office)
}

func (s *Server) UpdateOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if s.Offices == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := IntPathValue(w, r, "office_id")
	if !ok {
		return
	}
	var p struct {
		Name    *string `json:"name"`
		Address *string `json:"address"`
	}
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	office, err := s.Offices.Update(r.Context(), id, p.Name, p.Address)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if office == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("office not found"))
		return
	}
	WriteJSON(w, http.StatusOK, office)
}

func (s *Server) DeleteOfficeHandler(w http.ResponseWriter, r *http.Request) {
	if s.Offices == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := IntPathValue(w, r, "office_id")
	if !ok {
		return
	}
	if err := s.Offices.Delete(r.Context(), id); err != nil {
		if err == store.ErrNotFound {
			WriteError(w, http.StatusNotFound, fmt.Errorf("office not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ListFloorsHandler(w http.ResponseWriter, r *http.Request) {
	if s.Floors == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	var officeID *int
	if v := r.URL.Query().Get("office_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid office_id"))
			return
		}
		officeID = &id
	}
	floors, err := s.Floors.List(r.Context(), officeID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if floors == nil {
		floors = []store.FloorRow{}
	}
	WriteJSON(w, http.StatusOK, floors)
}

func (s *Server) CreateFloorHandler(w http.ResponseWriter, r *http.Request) {
	if s.Floors == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	var p struct {
		OfficeID int    `json:"office_id"`
		Name     string `json:"name"`
	}
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	if p.Name == "" || p.OfficeID == 0 {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("office_id and name are required"))
		return
	}
	floor, err := s.Floors.Create(r.Context(), p.OfficeID, p.Name)
	if err != nil {
		if err.Error() == "office not found" {
			WriteError(w, http.StatusNotFound, err)
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusCreated, floor)
}

func (s *Server) UpdateFloorHandler(w http.ResponseWriter, r *http.Request) {
	if s.Floors == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	var p struct {
		Name *string `json:"name"`
	}
	if err := DecodeJSONBody(r, &p); err != nil {
		WriteError(w, http.StatusBadRequest, err)
		return
	}
	floor, err := s.Floors.Update(r.Context(), id, p.Name)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if floor == nil {
		WriteError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
		return
	}
	WriteJSON(w, http.StatusOK, floor)
}

func (s *Server) DeleteFloorHandler(w http.ResponseWriter, r *http.Request) {
	if s.Floors == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if err := s.Floors.Delete(r.Context(), id); err != nil {
		if err == store.ErrNotFound {
			WriteError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) UploadFloorPlanHandler(w http.ResponseWriter, r *http.Request) {
	if s.Floors == nil {
		WriteError(w, http.StatusServiceUnavailable, fmt.Errorf("database not configured"))
		return
	}
	if _, err := s.requireActiveAuth(r); err != nil {
		WriteAuthError(w, err)
		return
	}
	id, ok := FloorIDFromPath(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("invalid multipart form"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("file field required"))
		return
	}
	defer file.Close()

	staticDir := EnvDefault("STATIC_DIR", "static")
	if err := os.MkdirAll(staticDir, 0o755); err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	allowedExts := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".pdf": true}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".png"
	}
	if !allowedExts[ext] {
		WriteError(w, http.StatusBadRequest, fmt.Errorf("unsupported file type: only PNG, JPEG, PDF are accepted"))
		return
	}
	filename := fmt.Sprintf("floor_%d_plan%s", id, ext)
	path := filepath.Join(staticDir, filename)
	dst, err := os.Create(path)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	planURL := "/static/" + filename
	if err := s.Floors.SetPlanURL(r.Context(), id, planURL); err != nil {
		if err == store.ErrNotFound {
			WriteError(w, http.StatusNotFound, fmt.Errorf("floor not found"))
			return
		}
		WriteError(w, http.StatusInternalServerError, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"plan_url": planURL})
}
