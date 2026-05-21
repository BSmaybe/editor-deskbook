# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeskBook — a map editor product for office floor plans. The system focuses on an admin editor for creating and publishing interactive floor layouts, with a component library and SVG/HTML export.

## Running the Project

**Via Docker Compose (recommended):**
```bash
docker compose up --build
```
- Go API: `http://localhost:8000`
- Admin (React): `http://localhost:5175`
- Swagger UI: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

First admin is bootstrapped from env vars `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_USERNAME`.

**React admin dev server (with hot reload):**
```bash
cd frontend/admin-react
npm install
npm run dev
```
Proxies `/api` to `http://localhost:8000`.

**Frontend tooling:**
```bash
npm run lint          # ESLint
npm run format        # Prettier
npm run test          # Vitest unit tests
npm run build         # Production build
```

## Architecture

```
backend-go/
  cmd/server/          — Entry point: slog setup, pgxpool, goose migrations, graceful shutdown
  internal/handler/    — HTTP handlers; NewServer() registers all routes
  internal/store/      — Repository layer: ComponentStore, LayoutStore, UserStore, ...
  internal/store/db/   — sqlc-generated code (Querier, models, SQL methods)
  internal/store/queries/ — SQL templates for sqlc
  internal/auth/       — JWT utilities (HS256)
  internal/exporter/   — layout_json → semantic SVG/HTML
  internal/svgimport/  — SVG import and element classification
  migrations/          — goose SQL files (embedded into binary via migrations.go)

frontend/
  admin-react/         — React admin app (Vite + React 18, sole frontend)
  admin-react/src/lib/ — Canvas hooks: useViewport, useGrid, useSelection, useUndoRedo

scripts/
  backup.sh            — PostgreSQL backup with retention
  restore.sh           — PostgreSQL restore from backup
  gen-secrets.sh       — Generate production .env with random secrets
```

Single Go binary serves ALL API routes. Nginx frontend proxies `/api/` → Go.

## Key Design Decisions

**Auth:** JWT tokens issued by `POST /auth/login`. Admin endpoints require `role: admin` in the token. Token validation uses HMAC-SHA256.

**Registration:** Invite-only. Admin creates invite for a specific email → user registers via `?invite=<token>` link. Single-use.

**Database:** PostgreSQL. Schema in `backend-go/migrations/00001_schema.sql`. Tables created by the `migrate` compose service on startup using embedded goose migrations.

**Desk types:** `flex` (bookable) or `fixed` (assigned via `assigned_to`).

**Floor plans:** PNG/JPG/SVG uploaded via `POST /floors/{floor_id}/plan`, stored in `/app/static/`.

**Layout editor:** Full draft/publish workflow with revisions, floor locks, semantic SVG export. Canvas editor uses SVG viewBox pan/zoom (no CSS transforms). Default scale: 50 canvas units = 1 metre (`pixels_per_meter = 50`).

**Components:** Global component library (CRUD at `/components`), used by the layout editor.

**Logging:** `log/slog`. Text format by default; JSON when `APP_ENV=production`.

## Adding a New Endpoint

1. Add handler in `backend-go/internal/handler/` (file by domain: `offices_floors.go`, `layouts.go`, ...)
2. Register route in `internal/handler/handler.go`
3. Add CRUD method in `internal/store/` + SQL in `internal/store/queries/`
4. Update OpenAPI spec and copy:
   `cp backend-go/openapi.yaml backend-go/internal/handler/swagger-ui/openapi.yaml`
5. Add test

## Adding a Migration

1. Create `backend-go/migrations/NNNNN_description.sql` (goose format)
2. File is picked up automatically via `embed.FS` in `migrations/migrations.go`
3. Applied on next server start

## API Conventions

- Auth: Bearer token in `Authorization` header.
- Admin-only endpoints return `403` if token role != admin.
- Conflict: `409`. Not found: `404`. Locked: `423`.
- Error bodies: `{"detail": "..."}`.
- CORS: all origins allowed in dev.

## Contract Tests

```bash
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh
```

All tests target `http://localhost:8000` by default.

## Documentation

- `docs/TECH_LEAD_HANDOFF_QA.md` — onboarding Q&A for new engineers.
- `docs/API.md` — full API documentation with request/response examples.
- `backend-go/README.md` — backend package overview, endpoint list, export contract.
