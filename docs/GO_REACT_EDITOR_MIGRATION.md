# DeskBook Go + React Editor Migration

## Current Target

DeskBook is now scoped as an editor-focused product:

- Admin map editor.
- Building and floor management.
- Component library.
- `layout_json` editing.
- `semantic_svg/html` publishing.
- Minimal auth and operational endpoints.

Booking, profile, analytics, reservations, policies, client app, demo mode, and landing remain frozen until they are re-scoped. Their compatibility routes return `501 Not Implemented`.

## Current Stack

- Backend: one Go API in `backend-go`.
- DB: PostgreSQL.
- Frontend: one React admin app in `frontend/admin-react`.
- Export: Go `layout_json -> semantic_svg/html`.
- Runtime: Docker Compose with `postgres`, `migrate`, `api`, and `admin`.

## Completed Migration Items

- Go renderer and standalone render endpoints.
- Auth register/login and JWT validation for admin editor workflows.
- Offices/buildings CRUD.
- Floors CRUD.
- Component library CRUD.
- Layout draft, publish, import, export, history, revisions, restore, and lock endpoints.
- React admin shell, floor selector, component library, canvas editor, import/history modals, and building/floor management.
- Old booking/client modules reduced to explicit placeholders.

## Active Data Model

- `Office`: building-level location metadata.
- `Floor`: editable storey attached to an office/building.
- `LayoutDocument`: source of truth for maps.
- `LayoutComponent`: reusable visual asset.
- `LayoutDesk`: workplace or non-workplace visual object inside the map.
- Structure elements: `walls`, `boundaries`, `partitions`, `doors`.

## Acceptance Checks

- `bash tests/go_renderer_contract.sh`
- `bash tests/go_components_contract.sh`
- `bash tests/go_layout_contract.sh`
- `bash tests/smoke_test.sh`

The smoke test tracks the current editor-only contour and intentionally expects frozen modules such as `/reservations` and `/analytics` to return `501`.
