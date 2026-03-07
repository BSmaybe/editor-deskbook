# DevOps/QA Agent Memory — DeskBook Project

## Stack
- Backend: FastAPI (Python 3.11), PostgreSQL 16, SQLAlchemy 2 (no Alembic — inline create_all + startup DDL), JWT auth (HS256)
- Frontend client: Nginx static (port 5173), plain HTML/CSS/JS
- Frontend admin: Nginx static (port 5174), plain HTML/CSS/JS
- API: http://localhost:8000

## Service Names (docker-compose)
- `postgres` (NOT `db`), `backend`, `client`, `admin`
- DATABASE_URL must use `@postgres:5432` not `@db:5432`

## API Proxy Pattern (established 2026-03-04)
Both nginx.conf files: `location /api/ { proxy_pass http://backend:8000/; }`
All JS/HTML files use `const API_BASE = "/api"` — never hardcode localhost:8000.

## Auth Conventions
- Register: POST /auth/register — JSON body {username, email, password, role, admin_secret?}
- Login: POST /auth/login — form-urlencoded (OAuth2PasswordRequestForm), returns {access_token, token_type}
- Admin registration requires ADMIN_REGISTER_SECRET env var to be set and matched
- JWT in `Authorization: Bearer <token>`

## RBAC (current backend state)
- GET /offices, GET /desks — public (no auth required)
- GET /reservations — auth required; regular users see only their own (enforced server-side)
- POST /offices, /floors, /desks-from-map — admin only (require_admin dependency)
- GET /analytics — admin only (403 for regular user)
- POST /reservations — any authenticated user; user_id overridden from JWT token

## DB Initialization
No Alembic. Startup runs create_all() + manual ALTER TABLE IF NOT EXISTS statements in lifespan(). Schema auto-created on first run.

## Key Files
- docker-compose.yml, .env, .env.example — project root
- backend/app/main.py — all routes + lifespan startup
- backend/app/config.py — pydantic-settings (reads .env)
- frontend/client/nginx.conf, frontend/admin/nginx.conf — include /api/ proxy
- tests/smoke_test.sh — bash smoke test (requires curl + jq)

## Smoke Test
`tests/smoke_test.sh` — run as: `bash tests/smoke_test.sh [BASE_URL]`
Set ADMIN_REGISTER_SECRET env var to enable admin registration. Tests 11 steps.

## Legacy Files (do not modify)
`/frontend/app.js`, `/frontend/admin.js` etc. are pre-split leftovers not built by docker-compose.

See: debugging.md for security audit findings (2026-03-03)
