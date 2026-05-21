package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// --- JWT / Auth ---

func TestIssueAndParseJWT(t *testing.T) {
	t.Setenv("SECRET_KEY", "test-secret-key")

	token := issueJWT("alice", "admin")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 parts, got %d", len(parts))
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	auth, err := requireAuthContext(req)
	if err != nil {
		t.Fatalf("requireAuthContext failed: %v", err)
	}
	if auth.Username != "alice" {
		t.Errorf("expected username=alice, got %q", auth.Username)
	}
	if auth.Role != "admin" {
		t.Errorf("expected role=admin, got %q", auth.Role)
	}
}

func TestRequireAuthContext_MissingToken(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	_, err := requireAuthContext(req)
	if err == nil {
		t.Fatal("expected error for missing token")
	}
}

func TestRequireAuthContext_InvalidToken(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid-token")
	_, err := requireAuthContext(req)
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestRequireAuthContext_WrongSecret(t *testing.T) {
	t.Setenv("SECRET_KEY", "secret-a")
	token := issueJWT("alice", "admin")

	t.Setenv("SECRET_KEY", "secret-b")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	_, err := requireAuthContext(req)
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}

func TestRequireAdmin_NonAdmin(t *testing.T) {
	t.Setenv("SECRET_KEY", "test-key")
	token := issueJWT("bob", "user")

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	err := requireAdmin(req)
	if err == nil {
		t.Fatal("expected error for non-admin")
	}
}

func TestRequireAdmin_Admin(t *testing.T) {
	t.Setenv("SECRET_KEY", "test-key")
	token := issueJWT("alice", "admin")

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	if err := requireAdmin(req); err != nil {
		t.Fatalf("expected no error for admin, got: %v", err)
	}
}

// --- Health endpoint ---

func TestHealthHandler(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/health", nil)
	healthHandler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["message"] != "ok" {
		t.Errorf("expected message=ok, got %q", body["message"])
	}
}

// --- CORS middleware ---

func TestCORSMiddleware_DevMode(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Origin", "http://localhost:5175")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("expected wildcard CORS in dev mode, got %q", got)
	}
}

func TestCORSMiddleware_StrictMode(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com,https://admin.example.com")
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Errorf("expected allowed origin, got %q", got)
	}

	req2 := httptest.NewRequest("GET", "/", nil)
	req2.Header.Set("Origin", "https://evil.com")
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if got := w2.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no CORS header for unknown origin, got %q", got)
	}
}

func TestCORSMiddleware_Preflight(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))

	req := httptest.NewRequest("OPTIONS", "/offices", nil)
	req.Header.Set("Origin", "http://localhost:5175")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 204 {
		t.Errorf("expected 204 for preflight, got %d", w.Code)
	}
}

// --- Handlers with nil stores (service unavailable / auth guards) ---

func newTestApp() *appServer {
	return &appServer{}
}

func adminToken(t *testing.T) string {
	t.Helper()
	t.Setenv("SECRET_KEY", "test-key")
	return issueJWT("admin", "admin")
}

func userToken(t *testing.T) string {
	t.Helper()
	t.Setenv("SECRET_KEY", "test-key")
	return issueJWT("user1", "user")
}

func TestListOffices_NoStore(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/offices", nil)
	app.listOfficesHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestCreateOffice_NoAuth(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/offices", strings.NewReader(`{"name":"Test"}`))
	req.Header.Set("Content-Type", "application/json")
	app.createOfficeHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503 (store nil checked before auth), got %d", w.Code)
	}
}

func TestListFloors_NoStore(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/floors", nil)
	app.listFloorsHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestListDesks_NoAuth(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/desks", nil)
	app.listDesksHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestListTemplates_EmptyWhenNoStore(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/templates", nil)
	app.listTemplatesHandler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var body []layoutTemplate
	json.NewDecoder(w.Body).Decode(&body)
	if len(body) != 0 {
		t.Errorf("expected empty array, got %d items", len(body))
	}
}

func TestListBlocks_EmptyWhenNoStore(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/blocks", nil)
	app.listBlocksHandler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestCreateTemplate_NoAuth(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/templates", strings.NewReader(`{"name":"T","layout":{}}`))
	req.Header.Set("Content-Type", "application/json")
	app.createTemplateHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestCreateBlock_NoAuth(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/blocks", strings.NewReader(`{"name":"B","objects":[{}]}`))
	req.Header.Set("Content-Type", "application/json")
	app.createBlockHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestCreateInvite_RequiresAdmin(t *testing.T) {
	app := newTestApp()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/admin/invites", strings.NewReader(`{"email":"a@b.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+userToken(t))
	app.createInviteHandler(w, req)

	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

// --- Component validation ---

func TestValidateComponentPayload_Valid(t *testing.T) {
	p := componentPayload{
		ID:        "my-desk",
		Label:     "My Desk",
		AssetType: "asset",
		ViewBox:   []float64{0, 0, 100, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<rect x="0" y="0" width="100" height="60" fill="#ddd"/>`,
	}
	if err := validateComponentPayload(p); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestValidateComponentPayload_BadID(t *testing.T) {
	p := componentPayload{
		ID:        "has space",
		Label:     "Desk",
		AssetType: "asset",
		ViewBox:   []float64{0, 0, 100, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<rect/>`,
	}
	if err := validateComponentPayload(p); err == nil {
		t.Fatal("expected error for bad ID")
	}
}

func TestValidateComponentPayload_BadAssetType(t *testing.T) {
	p := componentPayload{
		ID:        "desk-1",
		Label:     "Desk",
		AssetType: "unknown",
		ViewBox:   []float64{0, 0, 100, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<rect/>`,
	}
	if err := validateComponentPayload(p); err == nil {
		t.Fatal("expected error for bad asset type")
	}
}

func TestValidateComponentPayload_UnsafeSVG(t *testing.T) {
	p := componentPayload{
		ID:        "desk-1",
		Label:     "Desk",
		AssetType: "asset",
		ViewBox:   []float64{0, 0, 100, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<script>alert(1)</script>`,
	}
	if err := validateComponentPayload(p); err == nil {
		t.Fatal("expected error for unsafe SVG")
	}
}

func TestValidateComponentPayload_BadViewBox(t *testing.T) {
	p := componentPayload{
		ID:        "desk-1",
		Label:     "Desk",
		AssetType: "asset",
		ViewBox:   []float64{0, 0, -10, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<rect/>`,
	}
	if err := validateComponentPayload(p); err == nil {
		t.Fatal("expected error for negative viewbox width")
	}
}

func TestValidateComponentPayload_EmptyLabel(t *testing.T) {
	p := componentPayload{
		ID:        "desk-1",
		Label:     "",
		AssetType: "asset",
		ViewBox:   []float64{0, 0, 100, 60},
		DefaultW:  100,
		DefaultH:  60,
		SVGMarkup: `<rect/>`,
	}
	if err := validateComponentPayload(p); err == nil {
		t.Fatal("expected error for empty label")
	}
}

// --- viewBox parsing ---

func TestViewBoxString(t *testing.T) {
	result := viewBoxString([]float64{0, 0, 100, 60})
	if result != "0 0 100 60" {
		t.Errorf("expected '0 0 100 60', got %q", result)
	}
}

func TestParseViewBoxString(t *testing.T) {
	result := parseViewBoxString("10 20 300 200")
	if len(result) != 4 || result[0] != 10 || result[2] != 300 {
		t.Errorf("unexpected result: %v", result)
	}
}

func TestParseViewBoxString_Invalid(t *testing.T) {
	result := parseViewBoxString("bad data")
	if len(result) != 4 || result[2] != 100 || result[3] != 60 {
		t.Errorf("expected default [0 0 100 60] for invalid input, got %v", result)
	}
}

// --- Layout utility functions ---

func TestNormalizedLabel(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"D-123", "D123"},
		{"desk 5a", "DESK5A"},
		{"  spaces  ", "SPACES"},
		{"Стол-42", "СТОЛ42"},
		{"", ""},
	}
	for _, tc := range tests {
		got := normalizedLabel(tc.input)
		if got != tc.expected {
			t.Errorf("normalizedLabel(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestClamp(t *testing.T) {
	tests := []struct {
		value, lo, hi, expected float64
	}{
		{0.5, 0, 1, 0.5},
		{-1, 0, 1, 0},
		{2, 0, 1, 1},
	}
	for _, tc := range tests {
		got := clamp(tc.value, tc.lo, tc.hi)
		if got != tc.expected {
			t.Errorf("clamp(%v, %v, %v) = %v, want %v", tc.value, tc.lo, tc.hi, got, tc.expected)
		}
	}
}

func TestClamp_NaN(t *testing.T) {
	nan := math.NaN()
	got := clamp(nan, 0, 1)
	if got != 0 {
		t.Errorf("clamp(NaN) = %v, want 0", got)
	}
}

func TestMaxInt(t *testing.T) {
	if maxInt(3, 5) != 5 {
		t.Error("maxInt(3,5) should be 5")
	}
	if maxInt(7, 2) != 7 {
		t.Error("maxInt(7,2) should be 7")
	}
}

func TestBoolInt(t *testing.T) {
	if boolInt(true) != 1 {
		t.Error("boolInt(true) should be 1")
	}
	if boolInt(false) != 0 {
		t.Error("boolInt(false) should be 0")
	}
}

func TestUuidV4_Format(t *testing.T) {
	id := uuidV4()
	parts := strings.Split(id, "-")
	if len(parts) != 5 {
		t.Fatalf("expected 5 uuid parts, got %d: %q", len(parts), id)
	}
	if len(id) != 36 {
		t.Errorf("expected 36 chars, got %d: %q", len(id), id)
	}
}

func TestUuidV4_Unique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		id := uuidV4()
		if seen[id] {
			t.Fatalf("duplicate uuid: %q", id)
		}
		seen[id] = true
	}
}

func TestIntQuery(t *testing.T) {
	req := httptest.NewRequest("GET", "/?limit=50", nil)
	got := intQuery(req, "limit", 100, 1, 300)
	if got != 50 {
		t.Errorf("expected 50, got %d", got)
	}

	req2 := httptest.NewRequest("GET", "/", nil)
	got2 := intQuery(req2, "limit", 100, 1, 300)
	if got2 != 100 {
		t.Errorf("expected fallback 100, got %d", got2)
	}

	req3 := httptest.NewRequest("GET", "/?limit=999", nil)
	got3 := intQuery(req3, "limit", 100, 1, 300)
	if got3 != 300 {
		t.Errorf("expected clamped 300, got %d", got3)
	}

	req4 := httptest.NewRequest("GET", "/?limit=-5", nil)
	got4 := intQuery(req4, "limit", 100, 1, 300)
	if got4 != 1 {
		t.Errorf("expected min 1, got %d", got4)
	}
}

func TestEnvDefault(t *testing.T) {
	t.Setenv("TEST_ENV_VAR", "hello")
	if got := envDefault("TEST_ENV_VAR", "world"); got != "hello" {
		t.Errorf("expected 'hello', got %q", got)
	}
	t.Setenv("TEST_ENV_VAR", "")
	if got := envDefault("TEST_ENV_VAR", "world"); got != "world" {
		t.Errorf("expected 'world', got %q", got)
	}
}

// --- writeAuthError routing ---

func TestWriteAuthError_Forbidden(t *testing.T) {
	w := httptest.NewRecorder()
	writeAuthError(w, errForbidden)
	if w.Code != 403 {
		t.Errorf("expected 403 for errForbidden, got %d", w.Code)
	}
}

func TestWriteAuthError_Disabled(t *testing.T) {
	w := httptest.NewRecorder()
	writeAuthError(w, errAccountDisabled)
	if w.Code != 403 {
		t.Errorf("expected 403 for errAccountDisabled, got %d", w.Code)
	}
}

func TestWriteAuthError_Unauthorized(t *testing.T) {
	w := httptest.NewRecorder()
	writeAuthError(w, fmt.Errorf("missing bearer token"))
	if w.Code != 401 {
		t.Errorf("expected 401 for generic auth error, got %d", w.Code)
	}
}

// --- writeLayoutError routing ---

func TestWriteLayoutError_FloorNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	writeLayoutError(w, errFloorNotFound, "")
	if w.Code != 404 {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestWriteLayoutError_Conflict(t *testing.T) {
	w := httptest.NewRecorder()
	writeLayoutError(w, errConflict, "")
	if w.Code != 409 {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestWriteLayoutError_Locked(t *testing.T) {
	w := httptest.NewRecorder()
	writeLayoutError(w, lockHeldError{Username: "alice"}, "")
	if w.Code != 423 {
		t.Errorf("expected 423, got %d", w.Code)
	}
}

func TestWriteLayoutError_InvalidLayout(t *testing.T) {
	w := httptest.NewRecorder()
	writeLayoutError(w, errInvalidLayout, "")
	if w.Code != 422 {
		t.Errorf("expected 422, got %d", w.Code)
	}
}

// --- normalizeLayoutDocument ---

func TestNormalizeLayoutDocument_Defaults(t *testing.T) {
	doc := defaultLayoutDocument()
	if doc.Version != 2 {
		t.Errorf("expected version=2, got %d", doc.Version)
	}
	if len(doc.ViewBox) != 4 {
		t.Errorf("expected viewBox len=4, got %d", len(doc.ViewBox))
	}
	if doc.Components == nil {
		t.Error("expected non-nil Components")
	}
	if doc.Walls == nil {
		t.Error("expected non-nil Walls")
	}
	if doc.Desks == nil {
		t.Error("expected non-nil Desks")
	}
}

// --- Render endpoints (no DB needed) ---

func TestRenderSVGHandler_EmptyBody(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/render/svg", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	renderSVGHandler(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for empty body, got %d", w.Code)
	}
}

func TestRenderSVGHandler_ValidLayout(t *testing.T) {
	layout := `{"v":2,"vb":[0,0,100,80],"desks":[{"id":"d1","label":"D1","component_id":"workplace-desk-chair","asset_type":"workplace","x":10,"y":10,"w":20,"h":10}]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/render/svg", strings.NewReader(layout))
	req.Header.Set("Content-Type", "application/json")
	renderSVGHandler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "svg") {
		t.Errorf("expected SVG content-type, got %q", ct)
	}
	if !strings.Contains(w.Body.String(), "<svg") {
		t.Error("response should contain <svg")
	}
}

func TestRenderHTMLHandler_ValidLayout(t *testing.T) {
	body := `{"title":"Test","layout":{"v":2,"vb":[0,0,100,80],"desks":[{"id":"d1","label":"D1","component_id":"workplace-desk-chair","asset_type":"workplace","x":10,"y":10,"w":20,"h":10}]}}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/render/html", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	renderHTMLHandler(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "<!DOCTYPE html>") {
		t.Error("response should contain HTML doctype")
	}
}

func TestRenderSVGHandler_InvalidJSON(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/render/svg", strings.NewReader("{bad json"))
	req.Header.Set("Content-Type", "application/json")
	renderSVGHandler(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

// --- FloorID / RevisionID path parsing ---

func TestFloorIDFromPath_Invalid(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/floors/abc/layout", nil)
	req.SetPathValue("floor_id", "abc")
	_, ok := floorIDFromPath(w, req)
	if ok {
		t.Error("expected ok=false for non-numeric floor_id")
	}
	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestFloorIDFromPath_Negative(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/floors/-1/layout", nil)
	req.SetPathValue("floor_id", "-1")
	_, ok := floorIDFromPath(w, req)
	if ok {
		t.Error("expected ok=false for negative floor_id")
	}
}

func TestFloorIDFromPath_Valid(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/floors/42/layout", nil)
	req.SetPathValue("floor_id", "42")
	id, ok := floorIDFromPath(w, req)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if id != 42 {
		t.Errorf("expected 42, got %d", id)
	}
}

// --- lockHeldError ---

func TestLockHeldError_Message(t *testing.T) {
	err := lockHeldError{Username: "alice"}
	if !strings.Contains(err.Error(), "alice") {
		t.Errorf("expected error to contain username, got %q", err.Error())
	}
}

func TestLockUsername(t *testing.T) {
	if got := lockUsername("alice", 1); got != "alice" {
		t.Errorf("expected 'alice', got %q", got)
	}
	if got := lockUsername("", 42); got != "42" {
		t.Errorf("expected '42', got %q", got)
	}
	if got := lockUsername("  ", 7); got != "7" {
		t.Errorf("expected '7', got %q", got)
	}
}

// --- ComponentID regex ---

func TestComponentIDRegex(t *testing.T) {
	valid := []string{"desk-1", "my_component", "A", "workplace-desk-chair", "col.1:v2"}
	for _, id := range valid {
		if !componentIDRE.MatchString(id) {
			t.Errorf("expected %q to be valid component ID", id)
		}
	}
	invalid := []string{"", "1starts-with-digit", "has space", "a/b"}
	for _, id := range invalid {
		if componentIDRE.MatchString(id) {
			t.Errorf("expected %q to be invalid component ID", id)
		}
	}
}

// --- writeJSON / writeError ---

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 201, map[string]string{"id": "test"})
	if w.Code != 201 {
		t.Errorf("expected 201, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("expected JSON content type, got %q", ct)
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, 400, fmt.Errorf("bad request"))
	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}
	var body errorResponse
	json.NewDecoder(w.Body).Decode(&body)
	if body.Detail != "bad request" {
		t.Errorf("expected 'bad request', got %q", body.Detail)
	}
}
