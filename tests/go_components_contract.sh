#!/usr/bin/env bash
# Contract check for Go component library API.
# Requires an existing admin user (set via SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS).

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
ADMIN_USER="${SMOKE_ADMIN_USER:-admin}"
ADMIN_PASS="${SMOKE_ADMIN_PASS:-admin123}"
PASS=0
FAIL=0
SUFFIX="$(date +%s)$RANDOM"
COMPONENT_ID="go-component-${SUFFIX}"

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1 — $2"; FAIL=$((FAIL + 1)); }

http_status() {
  curl -sS -o /tmp/go_comp_body.$$ -w "%{http_code}" "$@" || true
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1"; exit 1; }
}

require_cmd curl
require_cmd jq

echo ""
echo "=== Go components health ==="
if curl -fsS "${BASE_URL}/health" >/dev/null; then
  pass "GET /health"
else
  fail "GET /health" "Go service is not reachable at ${BASE_URL}"
  exit 1
fi

echo ""
echo "=== Admin token ==="
LOGIN_BODY="$(curl -fsS -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=${ADMIN_USER}" \
  --data-urlencode "password=${ADMIN_PASS}")"
TOKEN="$(echo "$LOGIN_BODY" | jq -r '.access_token // empty')"
if [ -n "$TOKEN" ]; then
  pass "Login admin"
else
  fail "Login admin" "$LOGIN_BODY"
  exit 1
fi

echo ""
echo "=== Component CRUD ==="
if curl -fsS "${BASE_URL}/components" >/dev/null; then
  pass "GET /components"
else
  fail "GET /components" "component store is not reachable"
fi

PAYLOAD="$(jq -n --arg id "$COMPONENT_ID" '{
  id: $id,
  label: "Go component contract",
  asset_type: "asset",
  view_box: [0, 0, 40, 20],
  default_w: 80,
  default_h: 40,
  svg_markup: "<rect x=\"0\" y=\"0\" width=\"40\" height=\"20\" rx=\"3\" fill=\"#dbeafe\" stroke=\"#2563eb\" stroke-width=\"1.5\"/>"
}')"

NO_AUTH_STATUS="$(http_status -X POST "${BASE_URL}/components" -H "Content-Type: application/json" -d "$PAYLOAD")"
if [ "$NO_AUTH_STATUS" = "401" ]; then
  pass "POST /components requires auth"
else
  fail "POST /components auth guard" "HTTP ${NO_AUTH_STATUS}"
fi

CREATE_STATUS="$(http_status -X POST "${BASE_URL}/components" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"
if [ "$CREATE_STATUS" = "201" ]; then
  pass "POST /components creates custom component"
else
  fail "POST /components" "HTTP ${CREATE_STATUS}: $(cat /tmp/go_comp_body.$$)"
fi

if curl -fsS "${BASE_URL}/components" | jq -e --arg id "$COMPONENT_ID" 'any(.[]; .id == $id)' >/dev/null; then
  pass "GET /components includes created component"
else
  fail "GET /components created component" "missing ${COMPONENT_ID}"
fi

UPDATE_PAYLOAD="$(echo "$PAYLOAD" | jq '.label = "Go component contract updated"')"
UPDATE_STATUS="$(http_status -X PUT "${BASE_URL}/components/${COMPONENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$UPDATE_PAYLOAD")"
if [ "$UPDATE_STATUS" = "200" ]; then
  pass "PUT /components/{id}"
else
  fail "PUT /components/{id}" "HTTP ${UPDATE_STATUS}: $(cat /tmp/go_comp_body.$$)"
fi

UNSAFE_PAYLOAD="$(echo "$PAYLOAD" | jq --arg id "unsafe-${SUFFIX}" '.id = $id | .svg_markup = "<script>alert(1)</script>"')"
UNSAFE_STATUS="$(http_status -X POST "${BASE_URL}/components" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$UNSAFE_PAYLOAD")"
if [ "$UNSAFE_STATUS" = "422" ]; then
  pass "Unsafe SVG is rejected"
else
  fail "Unsafe SVG rejection" "HTTP ${UNSAFE_STATUS}"
fi

DELETE_STATUS="$(http_status -X DELETE "${BASE_URL}/components/${COMPONENT_ID}" -H "Authorization: Bearer ${TOKEN}")"
if [ "$DELETE_STATUS" = "200" ]; then
  pass "DELETE /components/{id}"
else
  fail "DELETE /components/{id}" "HTTP ${DELETE_STATUS}: $(cat /tmp/go_comp_body.$$)"
fi

rm -f /tmp/go_comp_body.$$

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
