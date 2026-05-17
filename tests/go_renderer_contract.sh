#!/usr/bin/env bash
# Contract check for the Go semantic SVG/HTML renderer.
# Usage:
#   docker compose up -d --build
#   bash tests/go_renderer_contract.sh [BASE_URL]

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1 — $2"; FAIL=$((FAIL + 1)); }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1"; exit 1; }
}

assert_contains() {
    local file="$1"
    local needle="$2"
    local label="$3"
    if grep -Fq "$needle" "$file"; then
        pass "$label"
    else
        fail "$label" "missing: $needle"
    fi
}

assert_not_contains() {
    local file="$1"
    local needle="$2"
    local label="$3"
    if grep -Fq "$needle" "$file"; then
        fail "$label" "unexpected: $needle"
    else
        pass "$label"
    fi
}

require_cmd curl
require_cmd grep
require_cmd wc

LAYOUT_JSON="$TMP_DIR/layout.json"
SVG_OUT="$TMP_DIR/published.svg"
HTML_OUT="$TMP_DIR/published.html"

cat > "$LAYOUT_JSON" <<'JSON'
{
  "v": 2,
  "vb": [0, 0, 700, 500],
  "building_id": "alfarabi",
  "storey_id": "2",
  "zone_id": "a9",
  "bg_url": "/static/floor.svg",
  "components": [
    {
      "id": "custom-desk",
      "label": "Custom desk",
      "asset_type": "workplace",
      "source": "custom",
      "view_box": [0, 0, 33, 22],
      "default_w": 33,
      "default_h": 22,
      "svg_markup": "<rect x=\"0\" y=\"0\" width=\"33\" height=\"22\" rx=\"2\" fill=\"#dbeafe\" stroke=\"#2563eb\" stroke-width=\"1.5\"/>"
    }
  ],
  "boundaries": [
    {
      "id": "zone-a9",
      "pts": [[0, 0], [100, 0], [100, 60]],
      "thick": 1.5,
      "color": "#1d4ed8",
      "closed": true
    }
  ],
  "desks": [
    {
      "id": "desk-1",
      "label": "D-1",
      "inventory_number": "INV-3452",
      "workplace_id": "bcchub-wp3452",
      "component_id": "custom-desk",
      "symbol_id": "custom-desk",
      "asset_type": "workplace",
      "building_id": "alfarabi",
      "storey_id": "2",
      "zone_id": "a9",
      "x": 100,
      "y": 200,
      "w": 33,
      "h": 22,
      "r": 15
    }
  ]
}
JSON

echo ""
echo "=== Go renderer health ==="
if curl -fsS "$BASE_URL/health" >/dev/null; then
    pass "GET /health"
else
    fail "GET /health" "renderer is not reachable at $BASE_URL"
    exit 1
fi

echo ""
echo "=== Semantic SVG contract ==="
curl -fsS -X POST "$BASE_URL/render/svg" \
    -H "Content-Type: application/json" \
    --data-binary "@$LAYOUT_JSON" > "$SVG_OUT"

assert_contains "$SVG_OUT" "<defs>" "SVG contains defs"
assert_contains "$SVG_OUT" "class=\"asset-fill\" x=\"2\" y=\"2\" width=\"96\" height=\"56\" rx=\"8\" fill=\"#dbeafe\"" "SVG built-in symbols have explicit fill"
assert_contains "$SVG_OUT" "class=\"asset-outline\" x=\"2\" y=\"2\" width=\"96\" height=\"56\" rx=\"8\" stroke=\"#2563eb\"" "SVG built-in symbols have explicit stroke"
assert_contains "$SVG_OUT" "<symbol id=\"custom-desk\"" "SVG contains custom symbol"
assert_contains "$SVG_OUT" "class=\"background\"" "SVG contains background layer"
assert_contains "$SVG_OUT" "class=\"structure\"" "SVG contains structure layer"
assert_contains "$SVG_OUT" "class=\"building\"" "SVG contains building group"
assert_contains "$SVG_OUT" "class=\"storey\"" "SVG contains storey group"
assert_contains "$SVG_OUT" "class=\"zone\"" "SVG contains zone group"
assert_contains "$SVG_OUT" "class=\"workplace\"" "SVG contains workplace group"
assert_contains "$SVG_OUT" "data-workplace-id=\"bcchub-wp3452\"" "SVG contains workplace data id"
assert_contains "$SVG_OUT" "data-inventory-number=\"INV-3452\"" "SVG contains inventory number"
assert_contains "$SVG_OUT" "data-building=\"alfarabi\"" "SVG contains building data"
assert_contains "$SVG_OUT" "data-storey=\"2\"" "SVG contains storey data"
assert_contains "$SVG_OUT" "data-zone=\"a9\"" "SVG contains zone data"
assert_contains "$SVG_OUT" "transform=\"translate(100 200) rotate(15 16.5 11)\"" "SVG contains translate/rotate transform"
assert_contains "$SVG_OUT" "component-instance" "SVG contains scaled component instance"

echo ""
echo "=== Semantic HTML contract ==="
curl -fsS -X POST "$BASE_URL/render/html" \
    -H "Content-Type: application/json" \
    --data-binary "{\"title\":\"Office Layout\",\"layout\":$(cat "$LAYOUT_JSON")}" > "$HTML_OUT"

assert_contains "$HTML_OUT" "<!DOCTYPE html>" "HTML contains doctype"
assert_contains "$HTML_OUT" ".workplace:hover" "HTML contains hover CSS"
assert_contains "$HTML_OUT" "cursor: pointer" "HTML contains pointer cursor"
assert_contains "$HTML_OUT" "deskbook:workplace-click" "HTML contains click event"
assert_contains "$HTML_OUT" "inventoryNumber" "HTML click detail contains inventory number"
assert_contains "$HTML_OUT" "      <svg" "HTML contains indented SVG block"
assert_not_contains "$HTML_OUT" "transform: scale" "HTML hover does not override SVG transforms"
assert_not_contains "$HTML_OUT" "translateY(-5px)" "HTML hover does not move component internals"

LINE_COUNT="$(wc -l < "$HTML_OUT" | tr -d ' ')"
if [ "$LINE_COUNT" -ge 40 ]; then
    pass "HTML is pretty-formatted (${LINE_COUNT} lines)"
else
    fail "HTML is pretty-formatted" "only ${LINE_COUNT} lines"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
