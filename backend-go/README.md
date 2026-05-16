# DeskBook Go Renderer

This module is the first Go migration step. It mirrors the current Python semantic map export contract and starts moving editor-focused APIs out of FastAPI.

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

## HTTP Renderer

The optional service exposes:

- `GET /health`
- `POST /render/svg`
- `POST /render/html`
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

Component write operations, draft/publish layout operations, and floor lock writes validate FastAPI-compatible HS256 JWTs using `SECRET_KEY` and require `role=admin`. Published layout/SVG/HTML reads and floor lock reads require a valid JWT with any role.

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

Run through compose without affecting the normal Python backend:

```bash
docker compose up -d --build renderer-go
curl http://localhost:8010/health
curl -X POST http://localhost:8010/render/svg \
  -H 'Content-Type: application/json' \
  --data-binary @layout.json > published.svg
bash ../tests/go_renderer_contract.sh
bash ../tests/go_components_contract.sh
bash ../tests/go_layout_contract.sh
```

## Migration Plan

1. Keep Python API as the runtime owner.
2. Use this Go renderer as a parity target for `layout_json -> semantic_svg/html`.
3. Run the Go HTTP service in Compose for parity checks and incremental routing.
4. FastAPI publish/export can use the Go renderer by setting `GO_RENDERER_URL=http://renderer-go:8080`.
5. Move editor/component APIs to Go behind the same contracts before replacing FastAPI.
