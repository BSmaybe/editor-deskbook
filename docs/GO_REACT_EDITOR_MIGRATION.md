# DeskBook Go + React Editor Migration

## Target

DeskBook should become a focused map editor product:

- Admin map editor.
- Component library.
- `layout_json` editing.
- `semantic_svg/html` publishing.
- Minimal auth and operational endpoints.

Booking, profile, analytics, reservations, policies, client app and landing are frozen for this migration. They should stay available only as placeholders until removed or re-scoped.

## Current Stack

- Frontend: plain HTML/CSS/JavaScript.
- Admin/client serving: Nginx containers.
- Backend API: FastAPI/Python.
- DB: PostgreSQL.
- SVG/XML renderer: Go service in `backend-go`.
- Runtime: Docker Compose.

## Target Stack

- Backend: Go service owning editor/component/layout APIs.
- DB: PostgreSQL.
- Frontend: React admin app focused on map editor and component library.
- Export: Go `layout_json -> semantic_svg/html`.
- Legacy app: static placeholder screens for non-editor areas.

## Go Backend Migration Plan

1. Keep FastAPI as compatibility runtime.
2. Move renderer first: done in `backend-go`.
3. Move component library API to Go: `/components` in `backend-go`.
4. Move layout draft/publish APIs to Go:
   - `GET /floors/{floor_id}/layout`
   - `PUT /floors/{floor_id}/layout/draft`
   - `POST /floors/{floor_id}/layout/publish`
   - `POST /floors/{floor_id}/layout/import`
   - `GET /floors/{floor_id}/layout/published.svg`
   - `GET /floors/{floor_id}/layout/published.html`
   - done in `backend-go`; includes `published`, `DELETE draft`, `sync-desks`, `history`, `revisions`, `restore`, SVG import classification, and floor lock compatibility endpoints for the current editor.
5. Move auth validation needed by admin editor.
6. Remove FastAPI routes not used by editor or replace with `501 Not Implemented` placeholders.

## React Migration Plan

1. Create a new React admin app next to the current static admin.
   - done as `frontend/admin-react` with a separate `admin-react` compose service on port `5175`.
2. Port UI in this order:
   - shell/navigation,
   - floor selector/import,
   - component library,
   - SVG canvas/editor,
   - properties panel,
   - publish/download flows.
3. Keep the data model identical during migration:
   - `LayoutDocument`
   - `LayoutComponent`
   - `LayoutDesk`
   - structure elements (`walls/boundaries/partitions/doors`)
4. Move canvas logic into dedicated modules:
   - geometry,
   - selection,
   - component rendering,
   - import/export,
   - editor state.
5. Replace old static admin only after parity checks pass.

## What Becomes Placeholder

- Client booking UI.
- Profile.
- Reservations.
- Policies.
- Analytics.
- Users/departments beyond minimal admin auth.
- Landing/demo flows unless needed for sales demo.

Each placeholder should clearly say: `Module frozen during editor migration`.

## Migration Branch

Branch: `codex/go-react-editor-migration`

Use this branch as the isolated migration line. For a real backup, make a WIP commit after review of the dirty file set.

## Acceptance Checks

- Go renderer contract passes.
- Component CRUD contract passes against Go service.
- Existing smoke test keeps passing while FastAPI compatibility remains.
- Exported HTML/SVG stays pretty-formatted and uses explicit non-black fills.
- Editor/component library remains usable in current admin until React replacement is ready.
