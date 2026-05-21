#!/usr/bin/env bash
# Contract check for Go layout draft/publish/export API.
# Requires an existing admin user (set via SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS).

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
ADMIN_USER="${SMOKE_ADMIN_USER:-admin}"
ADMIN_PASS="${SMOKE_ADMIN_PASS:-admin123}"
PASS=0
FAIL=0
SUFFIX="$(date +%s)$RANDOM"

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1 — $2"; FAIL=$((FAIL + 1)); }

http_status() {
  curl -sS -o /tmp/go_layout_body.$$ -w "%{http_code}" "$@" || true
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
echo "=== Go layout health ==="
if curl -fsS "${BASE_URL}/health" >/dev/null; then
  pass "GET /health"
else
  fail "GET /health" "Go service is not reachable at ${BASE_URL}"
  exit 1
fi

echo ""
echo "=== Admin token and fixtures ==="
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

# Create second admin via invite for lock tests
INVITE2_BODY="$(http_body -X POST "${BASE_URL}/admin/invites" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"layout2_${SUFFIX}@test.local\",\"role\":\"admin\",\"expires_in_hours\":1}")"
INVITE2_TOKEN="$(echo "$INVITE2_BODY" | jq -r '.token // empty')"

ADMIN2_USER="layoutadmin2_${SUFFIX}"
REG2_BODY="$(jq -n --arg u "$ADMIN2_USER" --arg e "layout2_${SUFFIX}@test.local" --arg t "$INVITE2_TOKEN" \
  '{username:$u,email:$e,password:"LayoutPass2!",invite_token:$t}')"
REG2_STATUS="$(http_status -X POST "${BASE_URL}/auth/register" -H "Content-Type: application/json" -d "$REG2_BODY")"
if [ "$REG2_STATUS" = "201" ]; then
  pass "Register second admin via invite"
else
  fail "Register second admin" "HTTP ${REG2_STATUS}: $(cat /tmp/go_layout_body.$$)"
fi

LOGIN2_BODY="$(curl -fsS -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=${ADMIN2_USER}" \
  --data-urlencode "password=LayoutPass2!")"
TOKEN2="$(echo "$LOGIN2_BODY" | jq -r '.access_token // empty')"
if [ -n "$TOKEN2" ]; then
  pass "Login second admin"
else
  fail "Login second admin" "$LOGIN2_BODY"
fi

OFFICE_BODY="$(curl -fsS -X POST "${BASE_URL}/offices" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Go Layout Office ${SUFFIX}\",\"address\":\"Migration test\"}")"
OFFICE_ID="$(echo "$OFFICE_BODY" | jq -r '.id // empty')"
FLOOR_BODY="$(curl -fsS -X POST "${BASE_URL}/floors" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"office_id\":${OFFICE_ID},\"name\":\"Go Layout Floor\"}")"
FLOOR_ID="$(echo "$FLOOR_BODY" | jq -r '.id // empty')"
if [ -n "$FLOOR_ID" ] && [ "$FLOOR_ID" != "null" ]; then
  pass "Create floor fixture (id=${FLOOR_ID})"
else
  fail "Create floor fixture" "$FLOOR_BODY"
fi

echo ""
echo "=== Floor locks ==="
LOCK_NO_AUTH_STATUS="$(http_status "${BASE_URL}/floors/${FLOOR_ID}/lock")"
if [ "$LOCK_NO_AUTH_STATUS" = "401" ]; then
  pass "GET /lock requires auth"
else
  fail "GET /lock auth guard" "HTTP ${LOCK_NO_AUTH_STATUS}"
fi

LOCK_EMPTY_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}")"
if echo "$LOCK_EMPTY_BODY" | jq -e '.locked == false' >/dev/null; then
  pass "GET /lock returns unlocked state"
else
  fail "GET /lock unlocked state" "$LOCK_EMPTY_BODY"
fi

ACQUIRE_LOCK_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}")"
ACQUIRE_LOCK_BODY="$(cat /tmp/go_layout_body.$$)"
if [ "$ACQUIRE_LOCK_STATUS" = "200" ] && echo "$ACQUIRE_LOCK_BODY" | jq -e ".floor_id == ${FLOOR_ID}" >/dev/null; then
  pass "POST /lock acquires floor lock"
else
  fail "POST /lock" "HTTP ${ACQUIRE_LOCK_STATUS}: ${ACQUIRE_LOCK_BODY}"
fi

LOCK_CONFLICT_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/lock" -H "Authorization: Bearer ${TOKEN2}")"
if [ "$LOCK_CONFLICT_STATUS" = "423" ]; then
  pass "POST /lock returns 423 when another admin holds lock"
else
  fail "POST /lock conflict" "HTTP ${LOCK_CONFLICT_STATUS}: $(cat /tmp/go_layout_body.$$)"
fi

LOCKED_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/lock" -H "Authorization: Bearer ${TOKEN2}")"
if echo "$LOCKED_BODY" | jq -e '.locked == true' >/dev/null; then
  pass "GET /lock returns current lock owner"
else
  fail "GET /lock locked state" "$LOCKED_BODY"
fi

RELEASE_LOCK_STATUS="$(http_status -X DELETE "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}")"
LOCK_RELEASED_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}")"
if [ "$RELEASE_LOCK_STATUS" = "204" ] && echo "$LOCK_RELEASED_BODY" | jq -e '.locked == false' >/dev/null; then
  pass "DELETE /lock releases own floor lock"
else
  fail "DELETE /lock" "delete=${RELEASE_LOCK_STATUS} body=${LOCK_RELEASED_BODY}"
fi

echo ""
echo "=== SVG layout import ==="
IMPORT_SVG='<svg viewBox="0 0 500 300" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="480" height="280" fill="#eef2ff" stroke="#1d4ed8" stroke-width="3"/>
  <line x1="30" y1="40" x2="470" y2="40" stroke="#111827" stroke-width="5"/>
  <line x1="80" y1="100" x2="420" y2="100" stroke="#64748b" stroke-width="1.2"/>
  <polyline points="250,240 255,235 260,240" fill="none" stroke="#111827" stroke-width="1"/>
  <defs><line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="5"/></defs>
</svg>'
IMPORT_NO_AUTH_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/import" -H "Content-Type: image/svg+xml" -d "$IMPORT_SVG")"
if [ "$IMPORT_NO_AUTH_STATUS" = "401" ]; then
  pass "POST /layout/import requires auth"
else
  fail "POST /layout/import auth guard" "HTTP ${IMPORT_NO_AUTH_STATUS}"
fi

IMPORT_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/import" \
  "${AUTH[@]}" \
  -H "Content-Type: image/svg+xml" \
  -d "$IMPORT_SVG")"
IMPORT_BODY="$(cat /tmp/go_layout_body.$$)"
if [ "$IMPORT_STATUS" = "200" ] && echo "$IMPORT_BODY" | jq -e '.vb == [0,0,500,300] and .stats.walls >= 1 and .stats.boundaries >= 1 and .stats.partitions >= 1 and .stats.doors >= 1 and .walls[0].conf >= 0.8' >/dev/null; then
  pass "POST /layout/import classifies SVG structure"
else
  fail "POST /layout/import" "HTTP ${IMPORT_STATUS}: ${IMPORT_BODY}"
fi

IMPORT_BAD_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/import" \
  "${AUTH[@]}" \
  -H "Content-Type: image/svg+xml" \
  -d '<html></html>')"
if [ "$IMPORT_BAD_STATUS" = "400" ]; then
  pass "POST /layout/import rejects non-SVG XML"
else
  fail "POST /layout/import invalid SVG guard" "HTTP ${IMPORT_BAD_STATUS}: $(cat /tmp/go_layout_body.$$)"
fi

LAYOUT_BODY="$(jq -n '{
  version: 0,
  layout: {
    v: 2,
    vb: [0, 0, 500, 300],
    building_id: "go-building",
    storey_id: "1",
    zone_id: "go-zone",
    components: [
      {
        id: "go-custom-component",
        label: "Go custom asset",
        asset_type: "asset",
        source: "custom",
        view_box: [0, 0, 40, 20],
        default_w: 80,
        default_h: 40,
        svg_markup: "<rect class=\"asset-fill\" x=\"0\" y=\"0\" width=\"40\" height=\"20\" rx=\"3\" fill=\"#f8fafc\" stroke=\"#64748b\" stroke-width=\"1.5\"/>"
      }
    ],
    boundaries: [
      {
        id: "go-zone-boundary",
        pts: [[10, 10], [490, 10], [490, 290], [10, 290]],
        thick: 4,
        closed: true,
        label: "Go Zone",
        color: "#1d4ed8"
      }
    ],
    walls: [],
    partitions: [],
    doors: [],
    desks: [
      {
        id: "go-desk-1",
        label: "GO-SVG-1",
        inventory_number: "INV-GO-1",
        workplace_id: "go-wp-1",
        building_id: "go-building",
        storey_id: "1",
        zone_id: "go-zone",
        component_id: "workplace-desk-chair",
        symbol_id: "workplace-desk-chair",
        asset_type: "workplace",
        bookable: true,
        fixed: false,
        status: "available",
        x: 80,
        y: 80,
        w: 120,
        h: 60,
        r: 0
      },
      {
        id: "go-chair-1",
        label: "GO-CHAIR",
        component_id: "chair",
        symbol_id: "chair",
        asset_type: "chair",
        bookable: false,
        x: 240,
        y: 80,
        w: 50,
        h: 50,
        r: 0
      },
      {
        id: "go-custom-asset-1",
        label: "GO-CUSTOM",
        component_id: "go-custom-component",
        symbol_id: "go-custom-component",
        asset_type: "asset",
        bookable: false,
        x: 320,
        y: 85,
        w: 80,
        h: 40,
        r: 0
      }
    ]
  }
}')"

echo ""
echo "=== Layout draft/publish/export ==="
NO_AUTH_STATUS="$(http_status -X PUT "${BASE_URL}/floors/${FLOOR_ID}/layout/draft" -H "Content-Type: application/json" -d "$LAYOUT_BODY")"
if [ "$NO_AUTH_STATUS" = "401" ]; then
  pass "PUT /layout/draft requires auth"
else
  fail "PUT /layout/draft auth guard" "HTTP ${NO_AUTH_STATUS}"
fi

DRAFT_STATUS="$(http_status -X PUT "${BASE_URL}/floors/${FLOOR_ID}/layout/draft" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "$LAYOUT_BODY")"
if [ "$DRAFT_STATUS" = "200" ]; then
  pass "PUT /layout/draft saves draft"
else
  fail "PUT /layout/draft" "HTTP ${DRAFT_STATUS}: $(cat /tmp/go_layout_body.$$)"
fi

GET_DRAFT_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout" "${AUTH[@]}")"
if echo "$GET_DRAFT_BODY" | jq -e '.status == "draft" and .layout.desks[0].label == "GO-SVG-1"' >/dev/null; then
  pass "GET /layout returns draft"
else
  fail "GET /layout" "$GET_DRAFT_BODY"
fi

PUBLISH_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/publish" "${AUTH[@]}")"
SVG_STATUS="$(http_status "${BASE_URL}/floors/${FLOOR_ID}/layout/published.svg" "${AUTH[@]}")"
HTML_STATUS="$(http_status "${BASE_URL}/floors/${FLOOR_ID}/layout/published.html" "${AUTH[@]}")"
if [ "$PUBLISH_STATUS" = "200" ] && [ "$SVG_STATUS" = "200" ] && [ "$HTML_STATUS" = "200" ]; then
  pass "Publish and exported SVG/HTML return 200"
else
  fail "Publish/export" "publish=${PUBLISH_STATUS} svg=${SVG_STATUS} html=${HTML_STATUS}"
fi

SVG_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/published.svg" "${AUTH[@]}")"
if [[ "$SVG_BODY" == *"<defs>"* && "$SVG_BODY" == *"symbol id=\"workplace-desk-chair\""* && "$SVG_BODY" == *"symbol id=\"go-custom-component\""* && "$SVG_BODY" == *"class=\"workplace\""* && "$SVG_BODY" == *"data-workplace-id=\"go-wp-1\""* && "$SVG_BODY" == *"data-inventory-number=\"INV-GO-1\""* && "$SVG_BODY" == *"class=\"asset asset-chair\""* ]]; then
  pass "Published SVG contains semantic component/workplace data"
else
  fail "Published SVG contract" "missing semantic markers"
fi

HTML_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/published.html" "${AUTH[@]}")"
if [[ "$HTML_BODY" == *"<!DOCTYPE html>"* && "$HTML_BODY" == *".workplace:hover"* && "$HTML_BODY" == *"deskbook:workplace-click"* && "$HTML_BODY" == *"<svg"* ]]; then
  pass "Published HTML contains wrapper and interaction hook"
else
  fail "Published HTML contract" "missing wrapper or click hook"
fi

DESKS_AFTER_LAYOUT="$(http_body "${BASE_URL}/desks?floor_id=${FLOOR_ID}" "${AUTH[@]}")"
if echo "$DESKS_AFTER_LAYOUT" | jq -e 'any(.[]; .label == "GO-SVG-1") and (any(.[]; .label == "GO-CHAIR") | not) and (any(.[]; .label == "GO-CUSTOM") | not)' >/dev/null; then
  pass "Publish syncs workplace desks only"
else
  fail "Desk sync asset filtering" "$DESKS_AFTER_LAYOUT"
fi

echo ""
echo "=== Layout history and revisions ==="
HISTORY_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/history" "${AUTH[@]}")"
if echo "$HISTORY_BODY" | jq -e 'any(.[]; .action == "published") and any(.[]; .action == "saved")' >/dev/null; then
  pass "GET /layout/history includes saved and published audit entries"
else
  fail "GET /layout/history" "$HISTORY_BODY"
fi

REVISIONS_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/revisions?limit=20" "${AUTH[@]}")"
REVISION_ID="$(echo "$REVISIONS_BODY" | jq -r 'map(select(.is_current_published == true))[0].revision_id // empty')"
if [ -n "$REVISION_ID" ] && echo "$REVISIONS_BODY" | jq -e 'any(.[]; .status == "published" and .is_current_published == true)' >/dev/null; then
  pass "GET /layout/revisions marks current published revision"
else
  fail "GET /layout/revisions" "$REVISIONS_BODY"
fi

REVISION_BODY="$(http_body "${BASE_URL}/floors/${FLOOR_ID}/layout/revisions/${REVISION_ID}" "${AUTH[@]}")"
if echo "$REVISION_BODY" | jq -e '.revision_id == ('"$REVISION_ID"') and .layout.desks[0].label == "GO-SVG-1"' >/dev/null; then
  pass "GET /layout/revisions/{id} returns revision layout"
else
  fail "GET /layout/revisions/{id}" "$REVISION_BODY"
fi

RESTORE_STATUS="$(http_status -X POST "${BASE_URL}/floors/${FLOOR_ID}/layout/revisions/${REVISION_ID}/restore" "${AUTH[@]}")"
RESTORED_BODY="$(cat /tmp/go_layout_body.$$)"
if [ "$RESTORE_STATUS" = "200" ] && echo "$RESTORED_BODY" | jq -e '.status == "draft" and .layout.desks[0].label == "GO-SVG-1"' >/dev/null; then
  pass "POST /layout/revisions/{id}/restore creates draft"
else
  fail "POST /layout/revisions/{id}/restore" "HTTP ${RESTORE_STATUS}: ${RESTORED_BODY}"
fi

rm -f /tmp/go_layout_body.$$

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
