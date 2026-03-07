#!/usr/bin/env bash
# smoke_test.sh — basic end-to-end smoke tests for DeskBook API
# Usage: bash tests/smoke_test.sh [BASE_URL]
# Default BASE_URL: http://localhost:8000

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
PASS=0
FAIL=0

# Unique suffix to avoid collisions when run repeatedly
SUFFIX="$(date +%s)"
ADMIN_USER="smokeadmin_${SUFFIX}"
ADMIN_PASS="SmokePass1!"
ADMIN_EMAIL="smokeadmin_${SUFFIX}@test.local"
USER_NAME="smokeuser_${SUFFIX}"
USER_PASS="SmokePass2!"
USER_EMAIL="smokeuser_${SUFFIX}@test.local"
ADMIN_SECRET="${ADMIN_REGISTER_SECRET:-}"

# Reserve a date in the future to satisfy policy (min_days_ahead=0)
BOOK_DATE="$(date -v+1d '+%Y-%m-%d' 2>/dev/null || date -d 'tomorrow' '+%Y-%m-%d')"

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

pass() { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1 — $2"; ((FAIL++)); }

http_status() {
    # Returns the HTTP status code for a curl call.  All extra args are passed
    # through to curl.
    curl -s -o /dev/null -w "%{http_code}" "$@"
}

http_body() {
    curl -s -o - "$@"
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1"; exit 1; }
}

require_cmd curl
require_cmd jq

# ──────────────────────────────────────────────────────────────────────────────
# Step 1 — Wait for backend health
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 1: Waiting for backend health at ${BASE_URL}/health ==="
MAX_RETRIES=10
for i in $(seq 1 $MAX_RETRIES); do
    STATUS=$(http_status "${BASE_URL}/health")
    if [ "$STATUS" = "200" ]; then
        pass "Backend health check (attempt $i)"
        break
    fi
    if [ "$i" = "$MAX_RETRIES" ]; then
        fail "Backend health check" "Got HTTP $STATUS after $MAX_RETRIES attempts"
        echo ""
        echo "Results: ${PASS} passed, ${FAIL} failed"
        exit 1
    fi
    echo "  Attempt $i/$MAX_RETRIES — status=$STATUS, waiting 2s..."
    sleep 2
done

# ──────────────────────────────────────────────────────────────────────────────
# Step 2 — Register admin user (needed to create offices/floors/desks)
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 2: Register admin user ==="
REGISTER_ADMIN_BODY="{\"username\":\"${ADMIN_USER}\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\",\"role\":\"admin\",\"admin_secret\":\"${ADMIN_SECRET}\"}"
ADMIN_REG_STATUS=$(http_status -X POST "${BASE_URL}/auth/register" \
    -H "Content-Type: application/json" \
    -d "${REGISTER_ADMIN_BODY}")

if [ "$ADMIN_REG_STATUS" = "201" ]; then
    pass "Admin register (HTTP 201)"
elif [ "$ADMIN_REG_STATUS" = "409" ]; then
    pass "Admin register (already exists — HTTP 409, continuing)"
else
    fail "Admin register" "Expected 201 or 409, got $ADMIN_REG_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 3 — Register regular user
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 3: Register regular user ==="
REGISTER_USER_BODY="{\"username\":\"${USER_NAME}\",\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASS}\",\"role\":\"user\"}"
USER_REG_STATUS=$(http_status -X POST "${BASE_URL}/auth/register" \
    -H "Content-Type: application/json" \
    -d "${REGISTER_USER_BODY}")

if [ "$USER_REG_STATUS" = "201" ]; then
    pass "Regular user register (HTTP 201)"
elif [ "$USER_REG_STATUS" = "409" ]; then
    pass "Regular user register (already exists — HTTP 409, continuing)"
else
    fail "Regular user register" "Expected 201 or 409, got $USER_REG_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 4 — Login as admin → get token
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 4: Login as admin ==="
ADMIN_LOGIN_RESPONSE=$(http_body -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${ADMIN_USER}&password=${ADMIN_PASS}")
ADMIN_TOKEN=$(echo "${ADMIN_LOGIN_RESPONSE}" | jq -r '.access_token // empty')

if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ]; then
    pass "Admin login — got JWT token"
else
    fail "Admin login" "No access_token in response: ${ADMIN_LOGIN_RESPONSE}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 5 — Login as regular user → get token
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 5: Login as regular user ==="
USER_LOGIN_RESPONSE=$(http_body -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${USER_NAME}&password=${USER_PASS}")
USER_TOKEN=$(echo "${USER_LOGIN_RESPONSE}" | jq -r '.access_token // empty')

if [ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ]; then
    pass "User login — got JWT token"
else
    fail "User login" "No access_token in response: ${USER_LOGIN_RESPONSE}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 6 — GET /offices with token
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 6: GET /offices ==="
OFFICES_STATUS=$(http_status "${BASE_URL}/offices" \
    -H "Authorization: Bearer ${USER_TOKEN}")

if [ "$OFFICES_STATUS" = "200" ]; then
    pass "GET /offices returns 200"
else
    fail "GET /offices" "Expected 200, got $OFFICES_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 7 — Create test data (office + floor + desk) as admin
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 7: Create test office/floor/desk as admin ==="

OFFICE_RESPONSE=$(http_body -X POST "${BASE_URL}/offices" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d "{\"name\":\"Smoke Office ${SUFFIX}\",\"address\":\"Test St 1\"}")
OFFICE_ID=$(echo "${OFFICE_RESPONSE}" | jq -r '.id // empty')

if [ -n "$OFFICE_ID" ] && [ "$OFFICE_ID" != "null" ]; then
    pass "Create office (id=$OFFICE_ID)"
else
    fail "Create office" "Response: ${OFFICE_RESPONSE}"
    echo ""
    echo "Results: ${PASS} passed, ${FAIL} failed"
    exit 1
fi

FLOOR_RESPONSE=$(http_body -X POST "${BASE_URL}/floors" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d "{\"office_id\":${OFFICE_ID},\"name\":\"Floor 1\"}")
FLOOR_ID=$(echo "${FLOOR_RESPONSE}" | jq -r '.id // empty')

if [ -n "$FLOOR_ID" ] && [ "$FLOOR_ID" != "null" ]; then
    pass "Create floor (id=$FLOOR_ID)"
else
    fail "Create floor" "Response: ${FLOOR_RESPONSE}"
    echo ""
    echo "Results: ${PASS} passed, ${FAIL} failed"
    exit 1
fi

DESK_RESPONSE=$(http_body -X POST "${BASE_URL}/floors/${FLOOR_ID}/desks-from-map" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d "[{\"label\":\"D1\",\"type\":\"flex\",\"space_type\":\"desk\",\"position_x\":0.1,\"position_y\":0.1}]")
DESK_ID=$(echo "${DESK_RESPONSE}" | jq -r '.[0].id // empty')

if [ -n "$DESK_ID" ] && [ "$DESK_ID" != "null" ]; then
    pass "Create desk (id=$DESK_ID)"
else
    fail "Create desk" "Response: ${DESK_RESPONSE}"
    echo ""
    echo "Results: ${PASS} passed, ${FAIL} failed"
    exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 8 — Create a reservation as regular user
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 8: Create reservation as regular user ==="
RES1_BODY="{\"desk_id\":${DESK_ID},\"user_id\":\"${USER_NAME}\",\"reservation_date\":\"${BOOK_DATE}\",\"start_time\":\"09:00:00\",\"end_time\":\"11:00:00\"}"
RES1_RESPONSE=$(http_body -X POST "${BASE_URL}/reservations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${USER_TOKEN}" \
    -d "${RES1_BODY}")
RES1_ID=$(echo "${RES1_RESPONSE}" | jq -r '.id // empty')
RES1_STATUS_CODE=$(http_status -X POST "${BASE_URL}/reservations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${USER_TOKEN}" \
    -d "${RES1_BODY}" 2>/dev/null || true)

if [ -n "$RES1_ID" ] && [ "$RES1_ID" != "null" ]; then
    pass "Create first reservation (id=$RES1_ID)"
else
    fail "Create first reservation" "Response: ${RES1_RESPONSE}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 9 — Test double-booking protection: overlapping reservation must yield 409
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 9: Double-booking protection (expect HTTP 409) ==="
# This overlaps with the first reservation (09:00-11:00) by sharing 10:00-12:00
OVERLAP_BODY="{\"desk_id\":${DESK_ID},\"user_id\":\"${USER_NAME}\",\"reservation_date\":\"${BOOK_DATE}\",\"start_time\":\"10:00:00\",\"end_time\":\"12:00:00\"}"
OVERLAP_STATUS=$(http_status -X POST "${BASE_URL}/reservations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${USER_TOKEN}" \
    -d "${OVERLAP_BODY}")

if [ "$OVERLAP_STATUS" = "409" ]; then
    pass "Overlapping reservation rejected with HTTP 409"
else
    fail "Overlapping reservation should return 409" "Got HTTP $OVERLAP_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 10 — RBAC: unauthenticated request to /reservations must yield 401
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 10: RBAC — unauthenticated request must yield 401 ==="
UNAUTH_STATUS=$(http_status "${BASE_URL}/reservations")

if [ "$UNAUTH_STATUS" = "401" ]; then
    pass "Unauthenticated GET /reservations returns 401"
else
    fail "Unauthenticated GET /reservations should return 401" "Got HTTP $UNAUTH_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Step 11 — RBAC: admin-only endpoint /analytics requires admin token
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "=== Step 11: RBAC — /analytics requires admin role ==="
ANALYTICS_USER_STATUS=$(http_status "${BASE_URL}/analytics" \
    -H "Authorization: Bearer ${USER_TOKEN}")
ANALYTICS_ADMIN_STATUS=$(http_status "${BASE_URL}/analytics" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")

if [ "$ANALYTICS_USER_STATUS" = "403" ]; then
    pass "Regular user gets 403 on /analytics"
else
    fail "/analytics for regular user should return 403" "Got HTTP $ANALYTICS_USER_STATUS"
fi

if [ "$ANALYTICS_ADMIN_STATUS" = "200" ]; then
    pass "Admin gets 200 on /analytics"
else
    fail "/analytics for admin should return 200" "Got HTTP $ANALYTICS_ADMIN_STATUS"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════"
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
