# DeskBook Go API

This module owns the current DeskBook editor API: auth, offices, floors, components, layout draft/publish, SVG import, and semantic SVG/HTML export.

## Contract

- Input: `layout_json` (`LayoutDocument`).
- Output SVG: formatted semantic SVG/XML with `<defs>/<symbol>`, `background`, `structure`, `building/storey/zone/workplace`, `data-*` attributes, and reusable `<use>` references.
- Output HTML: formatted standalone HTML wrapper with hover CSS and `deskbook:workplace-click` event support.

## Local Usage

If Go is installed:

```bash
cd backend-go
go test ./...
go run ./cmd/render-layout ../sample-layout.json > published.svg
go run ./cmd/render-layout -html ../sample-layout.json > published.html
go run ./cmd/server
```

If Go is not installed locally, use Docker:

```bash
docker run --rm -v "$PWD/backend-go:/src" -w /src golang:1.23-alpine go test ./...
```

## HTTP API

The service exposes:

- `GET /health`
- `POST /render/svg`
- `POST /render/html`
- `POST /auth/register`
- `POST /auth/login`
- `GET /offices`
- `POST /offices`
- `PATCH /offices/{office_id}`
- `DELETE /offices/{office_id}`
- `GET /floors`
- `POST /floors`
- `PATCH /floors/{floor_id}`
- `DELETE /floors/{floor_id}`
- `GET /components`
- `POST /components`
- `PUT /components/{component_id}`
- `DELETE /components/{component_id}`
- `GET /floors/{floor_id}/layout`
- `GET /floors/{floor_id}/layout/published`
- `PUT /floors/{floor_id}/layout/draft`
- `DELETE /floors/{floor_id}/layout/draft`
- `POST /floors/{floor_id}/layout/import`
- `POST /floors/{floor_id}/layout/publish`
- `POST /floors/{floor_id}/layout/sync-desks`
- `GET /floors/{floor_id}/layout/history`
- `GET /floors/{floor_id}/layout/revisions`
- `GET /floors/{floor_id}/layout/revisions/{revision_id}`
- `POST /floors/{floor_id}/layout/revisions/{revision_id}/restore`
- `GET /floors/{floor_id}/layout/published.svg`
- `GET /floors/{floor_id}/layout/published.html`
- `GET /floors/{floor_id}/lock`
- `POST /floors/{floor_id}/lock`
- `DELETE /floors/{floor_id}/lock`

Admin write operations validate HS256 JWTs using `SECRET_KEY` and require `role=admin`. Frozen booking/client modules return `501 Not Implemented` placeholders during the editor migration.

Request body can be either raw `LayoutDocument` JSON or wrapped:

```json
{
  "title": "Office Layout",
  "layout": {
    "v": 2,
    "vb": [0, 0, 1000, 1000],
    "desks": []
  }
}
```

Run through compose:

```bash
docker compose up -d --build
curl http://localhost:8000/health
curl -X POST http://localhost:8000/render/svg \
  -H 'Content-Type: application/json' \
  --data-binary @layout.json > published.svg
bash ../tests/go_renderer_contract.sh
bash ../tests/go_components_contract.sh
bash ../tests/go_layout_contract.sh
```

## Migration Plan

The active migration target is an editor-only product with one Go API and one React admin UI. Booking, reservations, policies, analytics, landing, and client app remain frozen until they are re-scoped.
