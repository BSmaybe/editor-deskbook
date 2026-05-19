# DeskBook Go API

This module owns the DeskBook editor API: auth, invites, offices, floors, components, blocks, templates, desks, layout draft/publish, SVG import, and semantic SVG/HTML export.

## Contract

- Input: `layout_json` (`LayoutDocument`).
- Output SVG: formatted semantic SVG/XML with `<defs>/<symbol>`, `background`, `structure`, `building/storey/zone/workplace`, `data-*` attributes, and reusable `<use>` references.
- Output HTML: formatted standalone HTML wrapper with hover CSS and `deskbook:workplace-click` event support.

## Local Usage

If Go is installed:

```bash
cd backend-go
go test ./...
go run ./cmd/server
```

If Go is not installed locally, use Docker:

```bash
docker run --rm -v "$PWD/backend-go:/src" -w /src golang:1.23-alpine go test ./...
```

## HTTP API

The service exposes:

- `GET /health`
- `POST /render/svg`, `POST /render/html`
- `POST /auth/register`, `POST /auth/login`
- `POST /admin/invites`, `GET /admin/invites`, `DELETE /admin/invites/{invite_id}`
- `GET /invites/{token}`
- `GET /users/me`, `GET /users`, `GET /admin/users`, `PATCH /admin/users/{username}`, `DELETE /admin/users/{username}`
- `GET/POST /offices`, `PATCH/DELETE /offices/{office_id}`
- `GET/POST /floors`, `PATCH/DELETE /floors/{floor_id}`, `POST /floors/{floor_id}/plan`
- `GET/POST /components`, `PUT/DELETE /components/{component_id}`
- `GET/POST /blocks`, `DELETE /blocks/{block_id}`
- `GET/POST /templates`, `DELETE /templates/{template_id}`
- `GET/PATCH/DELETE /desks/{desk_id}`, `GET /desks`
- `GET /floors/{floor_id}/layout`, `PUT /floors/{floor_id}/layout/draft`, `DELETE /floors/{floor_id}/layout/draft`
- `POST /floors/{floor_id}/layout/import`, `POST /floors/{floor_id}/layout/publish`
- `POST /floors/{floor_id}/layout/sync-desks`
- `GET /floors/{floor_id}/layout/history`, `GET /floors/{floor_id}/layout/revisions`
- `GET /floors/{floor_id}/layout/revisions/{revision_id}`, `POST .../restore`
- `GET /floors/{floor_id}/layout/published`, `GET .../published.svg`, `GET .../published.html`
- `GET/POST/DELETE /floors/{floor_id}/lock`
- `GET /embed/floors/{floor_id}`
- `POST /admin/cleanup/revisions`

Admin write operations validate HS256 JWTs using `SECRET_KEY` and require `role=admin`. Registration is invite-only.

Run through compose:

```bash
docker compose up -d --build
curl http://localhost:8000/health
bash tests/smoke_test.sh
```
