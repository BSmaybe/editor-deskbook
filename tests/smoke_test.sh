#!/usr/bin/env bash
# Editor-only smoke test for the Go API.
# Usage: bash tests/smoke_test.sh [BASE_URL]
# Requires an existing admin user (set via SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS
# env vars, or defaults to admin / admin123).

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
ADMIN_USER="${SMOKE_ADMIN_USER:-admin}"
ADMIN_PASS="${SMOKE_ADMIN_PASS:-admin123}"
PASS=0
FAIL=0
SUFFIX="$(date +%s)$RANDOM"

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1 - $2"; FAIL=$((FAIL + 1)); }

http_status() {
  curl -sS -o /tmp/deskbook_smoke_body.$$ -w "%{http_code}" "$@" || true
}

http_body() {
  curl -sS -o - "$@"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1"; exit 1; }
}

require_cmd curl
require_cmd jq

echo ""
echo "=== Health ==="
if [ "$(http_status "${BASE_URL}/health")" = "200" ]; then
  pass "GET /health"
else
  fail "GET /health" "service is not reachable at ${BASE_URL}"
  exit 1
fi

echo ""
echo "=== Auth ==="
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

AUTH=(-H "Authorization: Bearer ${TOKEN}")

echo ""
echo "=== Invites ==="
INVITE_BODY="$(http_body -X POST "${BASE_URL}/admin/invites" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke_${SUFFIX}@test.local\",\"role\":\"user\",\"expires_in_hours\":1}")"
INVITE_TOKEN="$(echo "$INVITE_BODY" | jq -r '.token // empty')"
if [ -n "$INVITE_TOKEN" ]; then
  pass "Create invite"
else
  fail "Create invite" "$INVITE_BODY"
fi

INVITE_INFO_STATUS="$(http_status "${BASE_URL}/invites/${INVITE_TOKEN}")"
if [ "$INVITE_INFO_STATUS" = "200" ]; then
  pass "Get invite info"
else
  fail "Get invite info" "HTTP ${INVITE_INFO_STATUS}"
fi

REG_BODY="$(jq -n \
  --arg username "smoke_${SUFFIX}" \
  --arg email "smoke_${SUFFIX}@test.local" \
  --arg token "$INVITE_TOKEN" \
  '{username:$username,email:$email,password:"SmokePass1!",invite_token:$token}')"
REG_STATUS="$(http_status -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" -d "$REG_BODY")"
if [ "$REG_STATUS" = "201" ]; then
  pass "Register via invite"
else
  fail "Register via invite" "HTTP ${REG_STATUS}: $(cat /tmp/deskbook_smoke_body.$$)"
fi

REUSE_STATUS="$(http_status -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" -d "$REG_BODY")"
if [ "$REUSE_STATUS" != "201" ]; then
  pass "Invite single-use (reuse blocked)"
else
  fail "Invite single-use" "Expected non-201, got ${REUSE_STATUS}"
fi

echo ""
echo "=== Buildings and floors ==="
OFFICE_BODY="$(http_body -X POST "${BASE_URL}/offices" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Building ${SUFFIX}\",\"address\":\"Smoke address\"}")"
OFFICE_ID="$(echo "$OFFICE_BODY" | jq -r '.id // empty')"
if [ -n "$OFFICE_ID" ]; then
  pass "Create office"
else
  fail "Create office" "$OFFICE_BODY"
fi

PATCH_OFFICE_STATUS="$(http_status -X PATCH "${BASE_URL}/offices/${OFFICE_ID}" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Building ${SUFFIX} Updated\",\"address\":\"Smoke address updated\"}")"
if [ "$PATCH_OFFICE_STATUS" = "200" ]; then
  pass "Update office"
else
  fail "Update office" "HTTP ${PATCH_OFFICE_STATUS}: $(cat /tmp/deskbook_smoke_body.$$)"
fi

FLOOR_BODY="$(http_body -X POST "${BASE_URL}/floors" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"office_id\":${OFFICE_ID},\"name\":\"Floor 1\"}")"
FLOOR_ID="$(echo "$FLOOR_BODY" | jq -r '.id // empty')"
FLOOR_DELETE_BODY="$(http_body -X POST "${BASE_URL}/floors" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"office_id\":${OFFICE_ID},\"name\":\"Temporary floor\"}")"
FLOOR_DELETE_ID="$(echo "$FLOOR_DELETE_BODY" | jq -r '.id // empty')"
if [ -n "$FLOOR_ID" ] && [ -n "$FLOOR_DELETE_ID" ]; then
  pass "Create floors"
else
  fail "Create floors" "floor=${FLOOR_BODY} temp=${FLOOR_DELETE_BODY}"
fi

PATCH_FLOOR_STATUS="$(http_status -X PATCH "${BASE_URL}/floors/${FLOOR_ID}" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"name\":\"Floor 1 Updated\"}")"
DELETE_FLOOR_STATUS="$(http_status -X DELETE "${BASE_URL}/floors/${FLOOR_DELETE_ID}" "${AUTH[@]}")"
if [ "$PATCH_FLOOR_STATUS" = "200" ] && [ "$DELETE_FLOOR_STATUS" = "204" ]; then
  pass "Update and delete floor"
else
  fail "Update/delete floor" "patch=${PATCH_FLOOR_STATUS} delete=${DELETE_FLOOR_STATUS}"
fi

FLOORS_BODY="$(http_body "${BASE_URL}/floors?office_id=${OFFICE_ID}" "${AUTH[@]}")"
if echo "$FLOORS_BODY" | jq -e 'length == 1 and .[0].name == "Floor 1 Updated"' >/dev/null; then
  pass "List floors by office"
else
  fail "List floors by office" "$FLOORS_BODY"
fi

echo ""
echo "=== Layout draft, publish, export ==="
LAYOUT_BODY="$(jq -n --arg suffix "$SUFFIX" '{
  version: 0,
  layout: {
    v: 2,
    vb: [0, 0, 500, 300],
    building_id: ("smoke-building-" + $suffix),
    storey_id: "1",
    zone_id: "main",
    components: [],
    boundaries: [
      {id:"boundary-main", pts:[[10,10],[490,10],[490,290],[10,290]], thick:4, closed:true, label:"Main", color:"#2563eb"}
    ],
    walls: [],
    partitions: [],
    doors: [],
    desks: [
      {
        id:"smoke-workplace-1",
        label:"SMOKE-1",
        inventory_number:"INV-SMOKE-1",
        workplace_id:"smoke-wp-1",
        building_id:("smoke-building-" + $suffix),
        storey_id:"1",
        zone_id:"main",
        component_id:"workplace-desk-chair",
        symbol_id:"workplace-desk-chair",
        asset_type:"workplace",
        bookable:true,
        fixed:false,
        status:"available",
        x:80,
        y:80,
        w:120,
        h:60,
        r:0
      },
      {
        id:"smoke-chair-1",
        label:"SMOKE-CHAIR",
        component_id:"chair",
        symbol_id:"chair",
        asset_type:"chair",
        bookable:false,
        x:240,
        y:80,
        w:50,
        h:50,
        r:0
      }
    ]
  }
}')"

DRAFT_STATUS="$(http_status -X PUT "${BASE_URL}/floors/${FLOOR_ID}/layout/draft" "${AUTH[@]}" -H "Content-Type: application/json" -d "$LAYOUT_BODY")"
PUBLISH_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/publish" "${AUTH[@]}")"
SVG_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/published.svg" "${AUTH[@]}")"
HTML_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/published.html" "${AUTH[@]}")"
if [ "$DRAFT_STATUS" = "200" ] && [ "$PUBLISH_STATUS" = "200" ] && [[ "$SVG_BODY" == *"class=\"workplace\""* ]] && [[ "$HTML_BODY" == *"deskbook:workplace-click"* ]]; then
  pass "Save, publish, and export layout"
else
  fail "Layout draft/publish/export" "draft=${DRAFT_STATUS} publish=${PUBLISH_STATUS}"
fi

DESKS_BODY="$(http_body "${BASE_URL}/desks?floor_id=${FLOOR_ID}")"
if echo "$DESKS_BODY" | jq -e 'any(.[]; .label == "SMOKE-1") and (any(.[]; .label == "SMOKE-CHAIR") | not)' >/dev/null; then
  pass "Publish syncs workplace objects only"
else
  fail "Desk sync from layout" "$DESKS_BODY"
fi

echo ""
echo "=== Cleanup ==="
DELETE_OFFICE_STATUS="$(http_status -X DELETE "${BASE_URL}/offices/${OFFICE_ID}" "${AUTH[@]}")"
if [ "$DELETE_OFFICE_STATUS" = "204" ]; then
  pass "Cleanup office"
else
  fail "Cleanup office" "HTTP ${DELETE_OFFICE_STATUS}: $(cat /tmp/deskbook_smoke_body.$$)"
fi

rm -f /tmp/deskbook_smoke_body.$$

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
