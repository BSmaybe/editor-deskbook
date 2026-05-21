#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  DeskBook — Интерактивный онбординг                             ║
# ║  Скрипт проведёт вас через все возможности системы.             ║
# ║                                                                  ║
# ║  Использование: bash scripts/onboarding.sh [BASE_URL]           ║
# ╚══════════════════════════════════════════════════════════════════╝
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
ADMIN_USER="${SMOKE_ADMIN_USER:-admin}"
ADMIN_PASS="${SMOKE_ADMIN_PASS:-admin123}"
SUFFIX="onboard$(date +%s)"

# ── Цвета ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'

STEP=0
PASS=0
ERRORS=()

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${CYAN}  Шаг ${STEP}: $1${RESET}"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

info() {
  echo -e "${DIM}  ℹ  $1${RESET}"
}

explain() {
  echo -e "${YELLOW}  ▸  $1${RESET}"
}

ok() {
  PASS=$((PASS + 1))
  echo -e "${GREEN}  ✔  $1${RESET}"
}

err() {
  ERRORS+=("Шаг ${STEP}: $1")
  echo -e "${RED}  ✘  $1${RESET}"
}

show_json() {
  echo -e "${DIM}"
  echo "$1" | jq '.' 2>/dev/null || echo "$1"
  echo -e "${RESET}"
}

show_code() {
  echo -e "${BLUE}  ┃  ${MAGENTA}$1${RESET}"
}

divider() {
  echo -e "${DIM}  ─────────────────────────────────────────────${RESET}"
}

pause() {
  echo ""
  echo -e "${YELLOW}  ⏎  Нажмите Enter для продолжения...${RESET}"
  read -r
}

# ── Проверка зависимостей ──
for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}Не найдена команда: ${cmd}. Установите и повторите.${RESET}"
    exit 1
  fi
done

# ── Заголовок ──
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║                                                           ║"
echo "  ║       🏢  DeskBook — Интерактивный Онбординг  🏢         ║"
echo "  ║                                                           ║"
echo "  ║   Редактор карт офисных этажей                            ║"
echo "  ║   Вы пройдёте полный цикл работы с API                   ║"
echo "  ║                                                           ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""
echo -e "${DIM}  Сервисы:"
echo -e "    Go API:      ${BASE_URL}"
echo -e "    React admin: http://localhost:5175"
echo -e "    Swagger UI:  ${BASE_URL}/docs"
echo -e "    PostgreSQL:  localhost:5432${RESET}"
echo ""
echo -e "${BOLD}  Архитектура:${RESET}"
echo -e "${DIM}"
echo "   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐"
echo "   │  React Admin │─────▸│   nginx      │─────▸│   Go API     │"
echo "   │  (Vite)      │ :5175│   /api proxy │ :8000│   (net/http) │"
echo "   └──────────────┘      └──────────────┘      └──────┬───────┘"
echo "                                                       │"
echo "                                                       ▼"
echo "                                                ┌──────────────┐"
echo "                                                │  PostgreSQL  │"
echo "                                                │    :5432     │"
echo "                                                └──────────────┘"
echo -e "${RESET}"

pause

# ══════════════════════════════════════════════════════════════════
# 1. HEALTH
# ══════════════════════════════════════════════════════════════════
step "Проверка доступности API"

explain "Самый первый вызов — убедиться что сервис жив."
show_code "GET /health"

HEALTH_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" "${BASE_URL}/health")
HEALTH_BODY=$(cat /tmp/onboard_body)

if [ "$HEALTH_STATUS" = "200" ]; then
  ok "API доступен (HTTP ${HEALTH_STATUS})"
  show_json "$HEALTH_BODY"
else
  err "API недоступен (HTTP ${HEALTH_STATUS})"
  echo -e "${RED}  Убедитесь что стек запущен: docker compose up -d --build${RESET}"
  exit 1
fi

pause

# ══════════════════════════════════════════════════════════════════
# 2. AUTH
# ══════════════════════════════════════════════════════════════════
step "Авторизация — получение JWT"

explain "DeskBook использует JWT (HS256). Логин принимает form-urlencoded."
explain "Токен содержит claims: sub (username), role (admin/user), exp."
show_code "POST /auth/login  (username=${ADMIN_USER})"

LOGIN_BODY=$(curl -fsS -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=${ADMIN_USER}" \
  --data-urlencode "password=${ADMIN_PASS}" 2>/dev/null || echo '{"error":"failed"}')
TOKEN=$(echo "$LOGIN_BODY" | jq -r '.access_token // empty')

if [ -n "$TOKEN" ]; then
  ok "Токен получен"
  # Decode JWT payload
  PAYLOAD=$(echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null || echo '{}')
  explain "Содержимое токена (payload):"
  show_json "$PAYLOAD"
  info "Все последующие запросы используют заголовок: Authorization: Bearer <token>"
else
  err "Не удалось получить токен: ${LOGIN_BODY}"
  exit 1
fi
AUTH=(-H "Authorization: Bearer ${TOKEN}")

pause

# ══════════════════════════════════════════════════════════════════
# 3. ME
# ══════════════════════════════════════════════════════════════════
step "Текущий пользователь — GET /users/me"

explain "Возвращает профиль авторизованного пользователя."
show_code "GET /users/me"

ME_BODY=$(curl -fsS "${BASE_URL}/users/me" "${AUTH[@]}")
ok "Профиль получен"
show_json "$ME_BODY"

pause

# ══════════════════════════════════════════════════════════════════
# 4. INVITES
# ══════════════════════════════════════════════════════════════════
step "Система приглашений"

explain "Регистрация — только по invite. Админ создаёт invite на email,"
explain "пользователь переходит по ссылке /?invite=<token> и регистрируется."
explain "Invite одноразовый, может иметь срок действия."
divider

echo -e "${BOLD}  4a. Создание invite${RESET}"
show_code "POST /admin/invites  {email, role, expires_in_hours}"

INVITE_EMAIL="onboard_${SUFFIX}@demo.local"
INVITE_BODY=$(curl -fsS -X POST "${BASE_URL}/admin/invites" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${INVITE_EMAIL}\",\"role\":\"user\",\"expires_in_hours\":1}")
INVITE_TOKEN=$(echo "$INVITE_BODY" | jq -r '.token // empty')

if [ -n "$INVITE_TOKEN" ]; then
  ok "Invite создан для ${INVITE_EMAIL}"
  show_json "$INVITE_BODY"
  info "Ссылка для пользователя: http://localhost:5175/?invite=${INVITE_TOKEN}"
else
  err "Ошибка создания invite: ${INVITE_BODY}"
fi

divider
echo -e "${BOLD}  4b. Публичная информация об invite${RESET}"
show_code "GET /invites/{token}"

INVITE_INFO=$(curl -fsS "${BASE_URL}/invites/${INVITE_TOKEN}")
ok "Информация доступна (без авторизации)"
show_json "$INVITE_INFO"

divider
echo -e "${BOLD}  4c. Регистрация пользователя${RESET}"
show_code "POST /auth/register  {username, email, password, invite_token}"

REG_BODY=$(jq -n \
  --arg u "onboard_${SUFFIX}" \
  --arg e "$INVITE_EMAIL" \
  --arg t "$INVITE_TOKEN" \
  '{username:$u, email:$e, password:"Demo1234!", invite_token:$t}')
REG_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X POST "${BASE_URL}/auth/register" \
  -H "Content-Type: application/json" -d "$REG_BODY")

if [ "$REG_STATUS" = "201" ]; then
  ok "Пользователь зарегистрирован (HTTP 201)"
  show_json "$(cat /tmp/onboard_body)"
else
  err "Регистрация: HTTP ${REG_STATUS}"
fi

divider
echo -e "${BOLD}  4d. Повторное использование invite${RESET}"
REUSE_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/register" \
  -H "Content-Type: application/json" -d "$REG_BODY")
if [ "$REUSE_STATUS" != "201" ]; then
  ok "Повторное использование заблокировано (HTTP ${REUSE_STATUS})"
else
  err "Invite не одноразовый!"
fi

pause

# ══════════════════════════════════════════════════════════════════
# 5. OFFICES
# ══════════════════════════════════════════════════════════════════
step "Здания (offices)"

explain "Здания — верхний уровень иерархии: Здание → Этаж → Layout → Рабочие места"
show_code "POST /offices  {name, address}"

OFFICE_BODY=$(curl -fsS -X POST "${BASE_URL}/offices" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Демо-офис ${SUFFIX}\",\"address\":\"ул. Тестовая, 42\"}")
OFFICE_ID=$(echo "$OFFICE_BODY" | jq -r '.id // empty')

if [ -n "$OFFICE_ID" ]; then
  ok "Здание создано (id=${OFFICE_ID})"
  show_json "$OFFICE_BODY"
else
  err "Ошибка создания здания: ${OFFICE_BODY}"
fi

explain "Проверяем список зданий:"
show_code "GET /offices"
OFFICES_LIST=$(curl -fsS "${BASE_URL}/offices")
OFFICES_COUNT=$(echo "$OFFICES_LIST" | jq 'length')
ok "Всего зданий: ${OFFICES_COUNT}"

pause

# ══════════════════════════════════════════════════════════════════
# 6. FLOORS
# ══════════════════════════════════════════════════════════════════
step "Этажи (floors)"

explain "Этаж привязан к зданию. На этаж загружается план (PNG/JPG/SVG)"
explain "и создаётся layout (карта с объектами)."
show_code "POST /floors  {office_id, name}"

FLOOR_BODY=$(curl -fsS -X POST "${BASE_URL}/floors" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"office_id\":${OFFICE_ID},\"name\":\"Этаж 3\"}")
FLOOR_ID=$(echo "$FLOOR_BODY" | jq -r '.id // empty')

if [ -n "$FLOOR_ID" ]; then
  ok "Этаж создан (id=${FLOOR_ID})"
  show_json "$FLOOR_BODY"
else
  err "Ошибка создания этажа: ${FLOOR_BODY}"
fi

explain "Фильтрация по зданию:"
show_code "GET /floors?office_id=${OFFICE_ID}"
FLOORS_LIST=$(curl -fsS "${BASE_URL}/floors?office_id=${OFFICE_ID}")
ok "Этажей в здании: $(echo "$FLOORS_LIST" | jq 'length')"

pause

# ══════════════════════════════════════════════════════════════════
# 7. COMPONENTS
# ══════════════════════════════════════════════════════════════════
step "Библиотека компонентов"

explain "Компоненты — переиспользуемые SVG-элементы карты (стол, кресло, и т.д.)."
explain "Есть встроенные (workplace-desk-chair, chair...) и пользовательские."
explain "asset_type определяет поведение: 'workplace' → синхронизируется в desks."
divider

echo -e "${BOLD}  7a. Список компонентов${RESET}"
show_code "GET /components"
COMP_LIST=$(curl -fsS "${BASE_URL}/components")
COMP_COUNT=$(echo "$COMP_LIST" | jq 'length')
ok "Компонентов: ${COMP_COUNT}"
explain "Встроенные типы:"
echo "$COMP_LIST" | jq -r '.[].id' | head -10 | while read -r cid; do
  echo -e "${DIM}    • ${cid}${RESET}"
done

divider
echo -e "${BOLD}  7b. Создание пользовательского компонента${RESET}"
show_code "POST /components  {id, label, asset_type, view_box, svg_markup, ...}"

COMP_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X POST "${BASE_URL}/components" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"onboard-printer-${SUFFIX}\",
    \"label\": \"Принтер\",
    \"asset_type\": \"printer\",
    \"view_box\": [0,0,60,40],
    \"default_w\": 60,
    \"default_h\": 40,
    \"svg_markup\": \"<rect x=\\\"2\\\" y=\\\"2\\\" width=\\\"56\\\" height=\\\"36\\\" rx=\\\"4\\\" fill=\\\"#94a3b8\\\" stroke=\\\"#475569\\\" stroke-width=\\\"1.5\\\"/>\"
  }")

if [ "$COMP_STATUS" = "201" ]; then
  ok "Компонент 'Принтер' создан (HTTP 201)"
else
  err "Создание компонента: HTTP ${COMP_STATUS}"
fi

divider
echo -e "${BOLD}  7c. Валидация: SVG с <script> отклоняется${RESET}"
XSS_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X POST "${BASE_URL}/components" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"xss-test\",
    \"label\": \"XSS\",
    \"asset_type\": \"asset\",
    \"view_box\": [0,0,40,40],
    \"default_w\": 40,
    \"default_h\": 40,
    \"svg_markup\": \"<script>alert(1)</script>\"
  }")
if [ "$XSS_STATUS" = "422" ]; then
  ok "XSS-атака заблокирована (HTTP 422)"
  show_json "$(cat /tmp/onboard_body)"
else
  err "XSS-валидация: ожидали 422, получили ${XSS_STATUS}"
fi

pause

# ══════════════════════════════════════════════════════════════════
# 8. FLOOR LOCK
# ══════════════════════════════════════════════════════════════════
step "Блокировка этажа (floor lock)"

explain "Предотвращает одновременное редактирование одного этажа."
explain "TTL — 10 минут, после чего блокировка истекает автоматически."
divider

echo -e "${BOLD}  8a. Захват блокировки${RESET}"
show_code "POST /floors/${FLOOR_ID}/lock"

LOCK_BODY=$(curl -fsS -X POST "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}")
ok "Этаж заблокирован"
show_json "$LOCK_BODY"

divider
echo -e "${BOLD}  8b. Проверка статуса${RESET}"
show_code "GET /floors/${FLOOR_ID}/lock"

LOCK_STATUS_BODY=$(curl -fsS "${BASE_URL}/floors/${FLOOR_ID}/lock")
show_json "$LOCK_STATUS_BODY"

divider
echo -e "${BOLD}  8c. Снятие блокировки${RESET}"
show_code "DELETE /floors/${FLOOR_ID}/lock"
curl -fsS -X DELETE "${BASE_URL}/floors/${FLOOR_ID}/lock" "${AUTH[@]}" >/dev/null
ok "Блокировка снята"

pause

# ══════════════════════════════════════════════════════════════════
# 9. LAYOUT: DRAFT → PUBLISH
# ══════════════════════════════════════════════════════════════════
step "Layout: черновик → публикация → экспорт"

explain "Ключевой workflow редактора:"
echo -e "${DIM}"
echo "    ┌─────────────────────────────────────────────────────┐"
echo "    │  PUT /layout/draft       → создаёт/обновляет draft  │"
echo "    │  POST /layout/publish    → draft → published        │"
echo "    │                            old published → archived  │"
echo "    │  GET /layout/published.svg  → семантический SVG     │"
echo "    │  GET /layout/published.html → standalone HTML       │"
echo "    └─────────────────────────────────────────────────────┘"
echo -e "${RESET}"
explain "Layout содержит: границы (boundaries), стены, двери, объекты (desks)."
explain "Только объекты с asset_type=workplace попадают в таблицу desks."
divider

echo -e "${BOLD}  9a. Сохранение черновика${RESET}"
show_code "PUT /floors/${FLOOR_ID}/layout/draft"

LAYOUT_JSON=$(jq -n --arg bid "demo-building-${SUFFIX}" '{
  version: 0,
  layout: {
    v: 2,
    vb: [0, 0, 800, 500],
    building_id: $bid,
    storey_id: "3",
    zone_id: "main",
    components: [],
    boundaries: [
      {id:"b-main", pts:[[20,20],[780,20],[780,480],[20,480]], thick:4, closed:true, label:"Open Space", color:"#2563eb"}
    ],
    walls: [
      {id:"w-1", pts:[[20,250],[400,250]], thick:6, color:"#1e293b"}
    ],
    partitions: [
      {id:"p-1", pts:[[400,250],[400,480]], thick:2, color:"#94a3b8"}
    ],
    doors: [
      {id:"d-1", x:395, y:245, w:30, h:10, r:0}
    ],
    desks: [
      {
        id:"wp-1", label:"A-001", inventory_number:"INV-001",
        workplace_id:"wp-1", building_id:$bid, storey_id:"3", zone_id:"main",
        component_id:"workplace-desk-chair", symbol_id:"workplace-desk-chair",
        asset_type:"workplace", bookable:true, fixed:false, status:"available",
        x:60, y:60, w:120, h:60, r:0
      },
      {
        id:"wp-2", label:"A-002", inventory_number:"INV-002",
        workplace_id:"wp-2", building_id:$bid, storey_id:"3", zone_id:"main",
        component_id:"workplace-desk-chair", symbol_id:"workplace-desk-chair",
        asset_type:"workplace", bookable:true, fixed:false, status:"available",
        x:220, y:60, w:120, h:60, r:0
      },
      {
        id:"wp-3", label:"A-003", inventory_number:"INV-003",
        workplace_id:"wp-3", building_id:$bid, storey_id:"3", zone_id:"main",
        component_id:"workplace-desk-chair", symbol_id:"workplace-desk-chair",
        asset_type:"workplace", bookable:false, fixed:true, status:"available",
        assigned_to:"Иванов А.С.",
        x:60, y:300, w:120, h:60, r:0
      },
      {
        id:"chair-1", label:"Кресло-1",
        component_id:"chair", symbol_id:"chair",
        asset_type:"chair", bookable:false,
        x:400, y:60, w:50, h:50, r:0
      }
    ]
  }
}')

DRAFT_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X PUT \
  "${BASE_URL}/floors/${FLOOR_ID}/layout/draft" "${AUTH[@]}" \
  -H "Content-Type: application/json" -d "$LAYOUT_JSON")

if [ "$DRAFT_STATUS" = "200" ]; then
  ok "Черновик сохранён (HTTP 200)"
  explain "Layout содержит: 3 workplace + 1 chair + 1 boundary + 1 wall + 1 partition + 1 door"
else
  err "Сохранение draft: HTTP ${DRAFT_STATUS}: $(cat /tmp/onboard_body)"
fi

divider
echo -e "${BOLD}  9b. Оптимистичная блокировка (version conflict)${RESET}"
explain "Если два человека редактируют одновременно, второй получит 409 Conflict."
show_code "PUT /layout/draft  {version: 0}  → 409 (version устарела)"

CONFLICT_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X PUT \
  "${BASE_URL}/floors/${FLOOR_ID}/layout/draft" "${AUTH[@]}" \
  -H "Content-Type: application/json" -d "$LAYOUT_JSON")

if [ "$CONFLICT_STATUS" = "409" ]; then
  ok "Конфликт версий обнаружен (HTTP 409)"
  show_json "$(cat /tmp/onboard_body)"
else
  err "Ожидали 409 Conflict, получили ${CONFLICT_STATUS}"
fi

divider
echo -e "${BOLD}  9c. Публикация${RESET}"
show_code "POST /floors/${FLOOR_ID}/layout/publish"

PUBLISH_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X POST \
  "${BASE_URL}/floors/${FLOOR_ID}/layout/publish" "${AUTH[@]}")

if [ "$PUBLISH_STATUS" = "200" ]; then
  ok "Layout опубликован"
else
  err "Публикация: HTTP ${PUBLISH_STATUS}"
fi

divider
echo -e "${BOLD}  9d. Синхронизация рабочих мест${RESET}"
explain "При публикации объекты workplace автоматически синхронизируются в таблицу desks."
explain "Кресла, растения и прочий декор НЕ попадают в desks."
show_code "GET /desks?floor_id=${FLOOR_ID}"

DESKS_BODY=$(curl -fsS "${BASE_URL}/desks?floor_id=${FLOOR_ID}")
DESK_COUNT=$(echo "$DESKS_BODY" | jq 'length')
DESK_LABELS=$(echo "$DESKS_BODY" | jq -r '.[].label' | tr '\n' ', ' | sed 's/,$//')

if [ "$DESK_COUNT" -eq 3 ]; then
  ok "Создано ${DESK_COUNT} рабочих места: ${DESK_LABELS}"
  explain "Кресло (chair) не попало в desks — это декоративный объект."
else
  err "Ожидали 3 рабочих места, получили ${DESK_COUNT}"
fi

pause

# ══════════════════════════════════════════════════════════════════
# 10. EXPORT
# ══════════════════════════════════════════════════════════════════
step "Экспорт: SVG и HTML"

explain "Семантический SVG содержит data-атрибуты для интеграции:"
explain "  data-building-id, data-storey-id, data-workplace-id и др."
explain "HTML-обёртка добавляет hover-подсветку и JS-события."
divider

echo -e "${BOLD}  10a. Экспорт SVG${RESET}"
show_code "GET /floors/${FLOOR_ID}/layout/published.svg"

SVG_BODY=$(curl -fsS "${BASE_URL}/floors/${FLOOR_ID}/layout/published.svg")
SVG_LINES=$(echo "$SVG_BODY" | wc -l | tr -d ' ')

if echo "$SVG_BODY" | grep -q 'class="workplace"'; then
  ok "SVG получен (${SVG_LINES} строк)"
  explain "Содержит элементы class=\"workplace\" с data-* атрибутами"
  info "Откройте в браузере: ${BASE_URL}/floors/${FLOOR_ID}/layout/published.svg"
else
  err "SVG не содержит workplace-элементов"
fi

divider
echo -e "${BOLD}  10b. Экспорт HTML${RESET}"
show_code "GET /floors/${FLOOR_ID}/layout/published.html"

HTML_BODY=$(curl -fsS "${BASE_URL}/floors/${FLOOR_ID}/layout/published.html")

if echo "$HTML_BODY" | grep -q 'deskbook:workplace-click'; then
  ok "HTML получен с событием deskbook:workplace-click"
  info "Откройте в браузере: ${BASE_URL}/floors/${FLOOR_ID}/layout/published.html"
  explain "Клик по рабочему месту генерирует CustomEvent с detail: {id, inventory_number, ...}"
else
  err "HTML не содержит workplace-click события"
fi

divider
echo -e "${BOLD}  10c. Embed (встраиваемый виджет)${RESET}"
show_code "GET /embed/floors/${FLOOR_ID}"
EMBED_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/embed/floors/${FLOOR_ID}")
if [ "$EMBED_STATUS" = "200" ]; then
  ok "Embed-страница доступна (для iframe-встраивания)"
  info "URL: ${BASE_URL}/embed/floors/${FLOOR_ID}"
else
  err "Embed: HTTP ${EMBED_STATUS}"
fi

pause

# ══════════════════════════════════════════════════════════════════
# 11. REVISIONS & HISTORY
# ══════════════════════════════════════════════════════════════════
step "Ревизии и аудит-лог"

explain "Каждое сохранение/публикация создаёт ревизию. Можно восстановить любую."
divider

echo -e "${BOLD}  11a. Список ревизий${RESET}"
show_code "GET /floors/${FLOOR_ID}/layout/revisions"

REVISIONS=$(curl -fsS "${BASE_URL}/floors/${FLOOR_ID}/layout/revisions" "${AUTH[@]}")
REV_COUNT=$(echo "$REVISIONS" | jq 'length')
ok "Ревизий: ${REV_COUNT}"
echo "$REVISIONS" | jq '[.[] | {id, status, version, updated_at}]'

divider
echo -e "${BOLD}  11b. Аудит-лог${RESET}"
show_code "GET /floors/${FLOOR_ID}/layout/history"

HISTORY=$(curl -fsS "${BASE_URL}/floors/${FLOOR_ID}/layout/history" "${AUTH[@]}")
ok "Записей в аудит-логе: $(echo "$HISTORY" | jq 'length')"
show_json "$HISTORY"

pause

# ══════════════════════════════════════════════════════════════════
# 12. ADMIN
# ══════════════════════════════════════════════════════════════════
step "Административные функции"

explain "Управление пользователями, cleanup ревизий."
divider

echo -e "${BOLD}  12a. Список пользователей (admin)${RESET}"
show_code "GET /admin/users"

USERS=$(curl -fsS "${BASE_URL}/admin/users" "${AUTH[@]}")
USER_COUNT=$(echo "$USERS" | jq 'length')
ok "Пользователей: ${USER_COUNT}"
echo "$USERS" | jq '[.[] | {username, role, is_active, email}]'

divider
echo -e "${BOLD}  12b. Cleanup ревизий${RESET}"
show_code "POST /admin/cleanup/revisions?older_than_days=1"

CLEANUP=$(curl -fsS -X POST "${BASE_URL}/admin/cleanup/revisions?older_than_days=365" "${AUTH[@]}")
ok "Cleanup выполнен"
show_json "$CLEANUP"

divider
echo -e "${BOLD}  12c. Swagger UI${RESET}"
explain "Интерактивная документация API доступна в браузере."
info "URL: ${BASE_URL}/docs"
explain "Все методы описаны на русском с примерами запросов и ответов."

pause

# ══════════════════════════════════════════════════════════════════
# 13. RENDER API
# ══════════════════════════════════════════════════════════════════
step "Рендеринг произвольного layout"

explain "POST /render/svg и /render/html принимают layout_json напрямую."
explain "Не требуют авторизации — удобно для preview в редакторе."
show_code "POST /render/svg  {layout: {...}}"

RENDER_BODY=$(jq -n '{
  title: "Демо-рендер",
  layout: {
    v: 2,
    vb: [0,0,200,100],
    building_id: "demo",
    storey_id: "1",
    zone_id: "z",
    components: [],
    boundaries: [{id:"b1",pts:[[5,5],[195,5],[195,95],[5,95]],thick:2,closed:true,label:"Room",color:"#3b82f6"}],
    walls: [],
    partitions: [],
    doors: [],
    desks: [{
      id:"d1",label:"D-1",component_id:"workplace-desk-chair",symbol_id:"workplace-desk-chair",
      asset_type:"workplace",x:50,y:30,w:80,h:40,r:0,bookable:true
    }]
  }
}')

RENDER_STATUS=$(curl -sS -o /tmp/onboard_body -w "%{http_code}" -X POST "${BASE_URL}/render/svg" \
  -H "Content-Type: application/json" -d "$RENDER_BODY")

if [ "$RENDER_STATUS" = "200" ]; then
  ok "SVG отрендерен (HTTP 200)"
  RENDER_SVG_LINES=$(cat /tmp/onboard_body | wc -l | tr -d ' ')
  info "Размер: ${RENDER_SVG_LINES} строк SVG"
else
  err "Рендеринг: HTTP ${RENDER_STATUS}"
fi

pause

# ══════════════════════════════════════════════════════════════════
# 14. PERMISSIONS CHECK
# ══════════════════════════════════════════════════════════════════
step "Проверка разграничения прав"

explain "Обычный пользователь может редактировать карты, но не может"
explain "управлять приглашениями и пользователями (admin-only)."
divider

USER_LOGIN_BODY=$(curl -fsS -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=onboard_${SUFFIX}" \
  --data-urlencode "password=Demo1234!" 2>/dev/null)
USER_TOKEN=$(echo "$USER_LOGIN_BODY" | jq -r '.access_token // empty')
USER_AUTH=(-H "Authorization: Bearer ${USER_TOKEN}")

echo -e "${BOLD}  14a. User → создание компонента${RESET}"
show_code "POST /components  (от имени обычного user)"
USER_COMP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/components" "${USER_AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"user-test-${SUFFIX}\",\"label\":\"Test\",\"asset_type\":\"asset\",\"view_box\":[0,0,20,20],\"default_w\":20,\"default_h\":20,\"svg_markup\":\"<rect width=\\\"20\\\" height=\\\"20\\\"/>\"}")
if [ "$USER_COMP_STATUS" = "201" ]; then
  ok "Пользователь может создавать компоненты (HTTP 201)"
else
  err "Ожидали 201, получили ${USER_COMP_STATUS}"
fi

echo -e "${BOLD}  14b. User → создание invite${RESET}"
show_code "POST /admin/invites  (от имени обычного user)"
USER_INVITE_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/admin/invites" "${USER_AUTH[@]}" \
  -H "Content-Type: application/json" -d "{\"email\":\"blocked@test.local\",\"role\":\"user\"}")
if [ "$USER_INVITE_STATUS" = "403" ]; then
  ok "Admin-only операция заблокирована (HTTP 403)"
else
  err "Ожидали 403, получили ${USER_INVITE_STATUS}"
fi

echo -e "${BOLD}  14c. User → список пользователей (admin endpoint)${RESET}"
show_code "GET /admin/users  (от имени обычного user)"
USER_ADMIN_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/admin/users" "${USER_AUTH[@]}")
if [ "$USER_ADMIN_STATUS" = "403" ]; then
  ok "Admin-only endpoint заблокирован (HTTP 403)"
else
  err "Ожидали 403, получили ${USER_ADMIN_STATUS}"
fi

pause

# ══════════════════════════════════════════════════════════════════
# CLEANUP
# ══════════════════════════════════════════════════════════════════
step "Очистка тестовых данных"

explain "Удаляем всё что создали во время онбординга."

curl -sS -X DELETE "${BASE_URL}/components/onboard-printer-${SUFFIX}" "${AUTH[@]}" >/dev/null 2>&1 || true
curl -sS -X DELETE "${BASE_URL}/components/user-test-${SUFFIX}" "${AUTH[@]}" >/dev/null 2>&1 || true
curl -sS -X DELETE "${BASE_URL}/offices/${OFFICE_ID}" "${AUTH[@]}" >/dev/null 2>&1 || true
curl -sS -X DELETE "${BASE_URL}/admin/users/onboard_${SUFFIX}" "${AUTH[@]}" >/dev/null 2>&1 || true

ok "Тестовые данные удалены"
rm -f /tmp/onboard_body

# ══════════════════════════════════════════════════════════════════
# ИТОГИ
# ══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${CYAN}  Результаты онбординга${RESET}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "${GREEN}  Пройдено: ${PASS} проверок${RESET}"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "${RED}  Ошибки: ${#ERRORS[@]}${RESET}"
  for e in "${ERRORS[@]}"; do
    echo -e "${RED}    • ${e}${RESET}"
  done
fi

echo ""
echo -e "${BOLD}  Что вы узнали:${RESET}"
echo -e "${DIM}"
echo "    1.  Health check — как убедиться что API жив"
echo "    2.  JWT авторизация — login, decode token, Bearer header"
echo "    3.  Invite-only регистрация — создание → ссылка → регистрация"
echo "    4.  Иерархия: Здание → Этаж → Layout → Рабочие места"
echo "    5.  Компоненты — библиотека SVG-элементов с XSS-валидацией"
echo "    6.  Floor lock — блокировка от параллельного редактирования"
echo "    7.  Layout workflow — draft → publish → archived"
echo "    8.  Оптимистичная блокировка (version conflict)"
echo "    9.  Desk sync — workplace из layout → таблица desks"
echo "    10. Экспорт SVG/HTML с семантическими data-атрибутами"
echo "    11. Ревизии и аудит-лог"
echo "    12. Разграничение прав admin/user"
echo "    13. Рендеринг произвольного layout без авторизации"
echo -e "${RESET}"
echo -e "${BOLD}  Полезные ссылки:${RESET}"
echo -e "${DIM}"
echo "    Swagger UI:     ${BASE_URL}/docs"
echo "    Admin UI:       http://localhost:5175"
echo "    API docs:       docs/API.md"
echo "    Tech Lead QA:   docs/TECH_LEAD_HANDOFF_QA.md"
echo -e "${RESET}"
echo ""

if [ ${#ERRORS[@]} -gt 0 ]; then
  exit 1
fi
