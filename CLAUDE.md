# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeskBook — a map editor product for office floor plans. The system focuses on an admin editor for creating and publishing interactive floor layouts, with a component library and SVG/HTML export.

Booking, reservations, policies, analytics, and client app are **frozen** (501 placeholders) during the editor migration.

## Running the Project

**Via Docker Compose (recommended):**
```bash
docker compose up --build
```
- Go API: `http://localhost:8000`
- Admin (vanilla JS): `http://localhost:5174`
- Admin React (in dev): `http://localhost:5175`
- PostgreSQL: `localhost:5432`

**React admin dev server (with hot reload):**
```bash
cd frontend/admin-react
npm install
npm run dev
```
Proxies `/api` to `http://localhost:8000`.

## Architecture

```
backend-go/
  cmd/server/     — Go HTTP server (all API endpoints)
  internal/       — exporter (SVG/HTML render), svgimport
  migrations/     — SQL schema (run by docker-compose migrate service)

frontend/
  admin/          — Vanilla JS admin (editor, components) served via nginx
  admin-react/    — React admin app (Vite, in development)
  client/         — Client booking UI (frozen, placeholder)
```

Single Go binary serves ALL API routes. Nginx frontends proxy `/api/` → Go.

## Key Design Decisions

**Auth:** JWT tokens issued by `POST /auth/login`. Admin endpoints require `role: admin` in the token. Token validation uses HMAC-SHA256 (same secret as Python used).

**Database:** PostgreSQL. Schema in `backend-go/migrations/001_schema.sql`. Tables created by the `migrate` compose service on startup.

**Desk types:** `flex` (bookable) or `fixed` (assigned via `assigned_to`).

**Floor plans:** PNG uploaded via `POST /floors/{floor_id}/plan`, stored in `/app/static/`.

**Layout editor:** Full draft/publish workflow with revisions, floor locks, semantic SVG export.

**Components:** Global component library (CRUD at `/components`), used by the layout editor.

## API Conventions

- Auth: Bearer token in `Authorization` header.
- Admin-only endpoints return `403` if token role != admin.
- Frozen modules return `501 Not Implemented`.
- Conflict: `409`. Not found: `404`.
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

## Roadmap Context

See `docs/GO_REACT_EDITOR_MIGRATION.md` for the active migration plan.
