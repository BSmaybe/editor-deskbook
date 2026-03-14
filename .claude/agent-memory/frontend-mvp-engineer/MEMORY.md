# Frontend MVP Engineer — Agent Memory

## Project: DO-main (Desk Booking System)

### Stack
- Vanilla JS (ES modules via `type="module"`) for main pages, plain inline `<script>` for standalone pages
- No framework (no React/Vue), no build step
- CSS custom properties in `styles.css`, no Tailwind or component libraries
- Backend: FastAPI at `http://localhost:8000` (hardcoded `API_BASE`)

### Folder Structure
- `frontend/` root — original legacy files (do NOT modify)
- `frontend/client/` — redesigned user-facing app (port 3000): `login.html`, `register.html`, `index.html`, `app.js` (ES module), `checkin.html`, `styles.css`, `Dockerfile`, `nginx.conf`
- `frontend/admin/` — redesigned admin panel (port 3001): `index.html`, `admin.js` (plain script), `styles.css`, `Dockerfile`, `nginx.conf`

### Auth Pattern
- User auth: `user_token` + `user_username` in localStorage
- Admin auth: `admin_token` + `admin_username` in localStorage
- Both use `Authorization: Bearer <token>` via `apiRequest()` helper
- Client: auth guard at top of app.js redirects to `./login.html` if no token
- Admin: shows `#login-overlay` div; hides it and shows `#admin-app` on success

### API Conventions
- `apiRequest(path, options)` centralizes auth headers + error parsing
- Errors: `{ detail: "..." }` (FastAPI default)
- 204 responses return `null`; others `.json()`
- Binary (QR PNG): fetch raw, `resp.blob()`, `URL.createObjectURL()`
- File upload (floor plan): `FormData` + fetch directly (no Content-Type header — browser sets boundary)

### Design System (client/ and admin/ share same tokens)
- Tokens: `--bg`, `--surface`, `--border`, `--text`, `--text-2`, `--accent`, `--accent-hover`, `--success-bg/text`, `--danger-bg/text`, `--radius`, `--shadow`, `--shadow-md`
- Buttons: `.btn .btn-primary/secondary/danger .btn-block .btn-sm`
- Form: `.field` (label+input flex col), `.stack` (flex col gap 16px)
- Auth: `.auth-page` (full-screen gradient), `.auth-card` (max-w 380px card)
- Badges: `.badge.available/busy/checked-in/not-checked-in`
- Messages: `.message.info/success/error`, auto-remove after 6s
- Cards: `.card` — white surface, 1px border, radius, shadow (added in Phase 3 to admin/styles.css)

### Admin Layout
- `.admin-layout`: CSS grid 220px sidebar + 1fr main
- `.sidebar`: dark #1e293b, sticky 100vh
- Tab switching: `.nav-item[data-tab]` shows `#tab-{name}`, hides others
- `admin.js` is NOT a module — uses traditional function syntax (no `import/export`)

### Component Patterns
- `makeDeleteBtn(label, onClick)` → `.btn.btn-danger.btn-sm`
- `makeCancelBtn(reservationId)` → wraps makeDeleteBtn
- QR: fetch blob from `/desks/{id}/qr`, `window.open(URL.createObjectURL(blob))`
- `.btn-row` for action button groups in table cells
- State: `const state = { offices, floors, desks, ... }` plain object

### nginx
- client: `index login.html` (root → login)
- admin: `index index.html`

### Phase 2 Features (implemented)
- `checkin.html`: `?token=` from URL, pre-fills from localStorage, `POST /checkin/{token}?user_id=`
- Admin QR button per desk row
- My Bookings: `checked_in_at` badge

### Phase 3 Features (implemented in admin/)
- **Placement editor** (`#placement-panel` in `#tab-floors`): select floor → PNG loads; click anywhere on plan → local `pendingDesks` entry added (not saved); sidebar list shows editable fields per desk (label, type, zone, assigned_to, delete button); "Сохранить план" → `POST /floors/{id}/desks-from-map` with full array; "Очистить всё" resets; click marker to delete
  - On floor load, existing server desks populate `pendingDesks[]` as initial state — user edits and re-saves all at once
  - No `POST /desks` or `PATCH /desks/{id}` used in placement editor
  - `deskFloorSelect`, `deskLabel`, `deskType`, `deskZone`, `deskAssigned` removed from both HTML and JS
  - `#tab-desks` is now read-only (table + refresh only, no create form)
- **Reservation filters** (`#tab-reservations`): filter bar (office, date-from, date-to, user, status); builds URLSearchParams appended to `GET /reservations`; Apply and Reset buttons wired to `loadReservations()`
- **Analytics tab** (`#tab-analytics`): KPI cards, occupancy progress bars per office, top desks table, top users table; calls `GET /analytics`; auto-loads on tab switch and inside `loadAll()`

### Populate selects pattern (admin)
- `populateOfficeSelects()` fills: `floorOfficeSelect`, `policyOfficeSelect`, `#filter-office`
  - `#filter-office` gets placeholder "Все офисы"; others get "Выберите офис"
- `populateFloorSelects()` fills: `planFloorSelect`, `#placement-floor-select` (deskFloorSelect removed)

### Phase 4 Features (implemented in client/)
- **Profile edit** (`profile.html`): `GET /users/{username}` pre-fills form on load; `PATCH /users/{username}/profile` saves; hero name displays `full_name` with username as fallback; status badge rendered via `renderStatusBadge()` using `.status-badge .status-available/busy/away` classes
- **Colleague card in map popup** (`app.js`): `fetchColleagueCard(bookedBy, popup)` is async, called from `showMapPopup` only when `booked.user_id !== _username`; renders `.colleague-card` with avatar initials, name, position, department, phone, status badge; guards against popup closed during fetch using `popup.isConnected`; graceful fallback to username-only if `/users/{id}` fails

### Design System Additions (Phase 4)
- `.status-badge` + `.status-available/busy/away` — pill badge with `::before` dot indicator
- `.profile-form` — 2-col grid; `.field-full` spans both columns; collapses to 1-col at 768px
- `.colleague-card` — flex row, border, 8px radius, `var(--bg-2)` background
- `.colleague-card-avatar` — 40x40px circle, `var(--primary)` bg, white initials
- `.colleague-card-info`, `.colleague-card-name`, `.colleague-card-row` — flex column info panel
- Profile `apiFetch` is extended from old read-only version: now accepts `options` arg with method/body for PATCH

### Phase 5 UX Improvements (implemented in client/)
- **localStorage restore** (`dk_office`, `dk_floor` keys): saved on select change, restored in `init()` after `loadOffices()`; validates saved floor still exists in `state.floors` before restoring
- **Floor plan card always visible**: `#floor-plan-card` has no `style="display:none"` in HTML; `renderFloorPlan(null)` shows placeholder; `loadFloors()` calls `renderFloorPlan(null)` instead of hiding card; placeholder text differs: null floor → "Выберите офис и этаж...", floor without plan → "У этого этажа нет плана."
- **Colleague click → desk highlight**: `_highlightedDeskId` module-level var; `highlightDesk(deskId)` adds `.highlighted` + amber pulse + SVG dashed line from 50%/50% to marker position; click same colleague again toggles off; `renderPlanMarkers` resets state on re-render; only colleagues with desk `position_x` are clickable; IIFE closure captures `r`/`item` in loop

### Design System Additions (Phase 5)
- `.plan-marker.highlighted` — amber `#f59e0b` bg with `!important`, scale(1.3), `pulse-highlight` keyframe animation
- `.colleague-item.active-colleague` — `var(--primary-light)` bg + `var(--primary-border)` border

### Phase 6 Features — Favorites (implemented in client/)
- `state.favorites` is a `Set<number>` of desk IDs
- `loadFavorites()` calls `GET /users/me/favorites` → populates `state.favorites`; called in `init()` before `loadMyBookings()`
- `renderPlanMarkers` adds `.favorite` class to marker if `state.favorites.has(d.id)` (after mine/available/busy block)
- `showSidePanel` renders star button `#_sp_fav` in header; click handler calls `POST` or `DELETE /users/me/favorites/{id}`, updates `state.favorites`, toggles `.favorite` on marker, updates button text/title without full re-render
- `_favFilterActive` boolean + `renderPlanMarkersFiltered()` wrapper: filters `state.desks` to favorites only when active; replaces direct `renderPlanMarkers(floorPlanOverlay, state.desks)` calls in `refreshAvailability` and `renderFloorPlan`
- `fav-filter-btn` in `index.html` (4th slot in second grid-4); toggles `.btn-primary`/`.btn-secondary` and star symbol
- `profile.html`: favorites card with `#favorites-list`; `loadFavoriteDesks()` renders `.booking-list` of favorite desks; `removeFav(btn, deskId)` calls `DELETE` and removes item from DOM; called at end of init sequence
- CSS: `.plan-marker.favorite` — amber `#fbbf24` border; `::after` pseudo-element shows `★` at top-right corner (top:-8px right:-8px)

### Design System Additions (Phase 6)
- `.plan-marker.favorite` — `border-color: #fbbf24`
- `.plan-marker.favorite::after` — absolute `★` at top:-8px right:-8px, color `#f59e0b`, pointer-events none

### Phase 7 Features — Colleague Search (implemented in client/)
- Search bar `#colleague-search-bar` added in `#floor-plan-card` between `card-header` and `.map-workspace` in `index.html`
- IIFE `initColleagueSearch()` in `app.js` (between Events and Init sections): debounced 300ms input → `GET /users/search?q=&limit=10`; renders dropdown with avatar/name/sub; `mousedown` + `e.preventDefault()` prevents blur before click
- On result select: looks up `state.floorReservations.find(r => r.user_id === u.username)` → calls `highlightDesk(resv.desk_id)`; shows `addMessage` if no booking on current floor
- Escape key + clear button both call `clearSearch()` which also resets highlight via `highlightDesk(null)`
- Outside click closes dropdown via `document.addEventListener("click", ...)` checking `e.target.closest("#colleague-search-bar")`
- CSS classes: `.search-bar`, `.search-input-wrap`, `#colleague-search`, `.search-clear-btn`, `.search-dropdown`, `.search-result-item`, `.search-result-avatar`, `.search-result-info`, `.search-result-name`, `.search-result-sub`, `.search-empty`
- Lucide `search` icon inside `.search-input-wrap` — initialized by existing `lucide.createIcons()` in `init()`

### Phase 8 Features (implemented in client/)

#### Space-type filter pills
- `#space-filter-bar` in `index.html` between `#map-legend` and `.search-bar`
- `_activeSpaceFilters = new Set()` module-level; cleared on every `renderPlanMarkers()` call (floor change resets filter)
- `renderSpaceFilter(desks)` — called from end of `renderPlanMarkers()`; hides bar if ≤1 type; renders "Все" pill + one pill per type; re-renders itself on every click to update active states
- `applySpaceFilter()` — iterates `.plan-marker` elements; toggles `.filtered-out`; empty set = show all
- Multiple selection: clicking selected pill deselects it; "Все" clears all
- CSS: `.space-filter-bar`, `.space-filter-pill`, `.space-filter-pill.active`, `.space-filter-pill-dot`, `.plan-marker.filtered-out {opacity:0.12; pointer-events:none}`

#### Recurring booking UI
- Only shown when `avail?.available` — injected via `mapSidePanel.append(recurSection)` at end of `showSidePanel()`
- Toggle: `.recur-toggle-btn` (▶ icon rotates 90deg when `.open`) + `.recur-body` (display:none/.open=block)
- Default: Mon–Fri pre-selected; end date = today+60d
- Date generation: loop from `max(selectedDate, tomorrow)` to endDate; `cursor.getDay()` checked against `_selectedDays`
- `reserveBatch(deskId, dates, startTime, endTime)` → `POST /api/reservations/batch` → `{ created, skipped, errors }`
- Validation: `endDate < minDate` (not `<= today` — avoids timezone comparison bug)
- CSS: `.recur-section`, `.recur-toggle-btn`, `.recur-toggle-icon`, `.recur-body.open`, `.recur-days`, `.recur-day-btn.active`, `.recur-end-row`

### Phase 9 Features (Iteration 3 — implemented in admin/)
- **`is_active` on User model**: `Boolean NOT NULL DEFAULT TRUE` column; migration added to `_profile_migrations`; `UserResponse` and `UserPublic` schemas include `is_active: bool = True`; `UserAdminUpdate` schema added at end of schemas.py
- **Admin user endpoints**: `GET /admin/users`, `PATCH /admin/users/{username}`, `DELETE /admin/users/{username}` — all use `Depends(require_admin)`
- DELETE 204 pattern in FastAPI: use `status_code=204` with `-> Response` return type and `return Response(status_code=204)` — do NOT use `response_class=Response` on the decorator (causes assertion error)
- **Users tab** (`#tab-users`): nav item with `data-lucide="user-cog"`; table with ID/login/email/name/dept/role/status/active/actions columns; inline `onchange="adminSetRole()"` and `onclick="adminToggleActive()"` / `onclick="adminDeleteUser()"` handlers (global functions)
- **Client-side pagination utility** (`admin.js`): `_pages{}`, `PAGE_SIZE=15`, `pageSlice(arr, tableId)`, `renderPagination(containerId, total, tableId)`, `changePage(tableId, delta)` — wired via inline `onclick` in rendered HTML; `changePage` dispatches to loader functions by tableId key
- **Pagination applied to**: offices, floors, policies, reservations, departments, users — each table card wrapped in `.card style="overflow:hidden"` div with `<div id="{name}-pagination">` after the `.table-wrapper`
- **loadDepartments refactor**: extracted `_allDepartments[]` + `renderDepartmentsTable()` to support pageSlice (same pattern as users)
- **Analytics additions**: CSV export button `#export-reservations-csv` next to refresh button; bar chart `#desks-chart` div between occupancy card and the desks/users grid; bar chart rendered inline in `loadAnalytics()` using pure HTML/CSS — no Chart.js

### Known Patterns to Watch
- `admin.js` must NOT use ES module syntax (loaded as plain `<script>`)
- `app.js` in client uses `type="module"` — ES2020+ fine
- Set `tr.innerHTML` first, then `querySelector` + `append` buttons (innerHTML clears listeners)
- Admin init validates saved token via `/offices` before showing UI
- `initPlacementEditor()` called in both authenticated and unauthenticated branches of `init()` so the change listener + save/clear buttons are always wired before `loadAll()` populates the select
- Placement overlay uses `overlay.onclick = fn` (assignment, not addEventListener) to avoid stacking duplicate handlers on re-render; `renderPlacementEditor` only removes `.map-marker` children, does NOT reassign `overlay.onclick`
- Marker onclick uses IIFE closure `(function(idx){...})(i)` to capture the correct index at time of creation, since `forEach` index `i` would otherwise be stale on click
- `renderFloorPlan(null)` is the canonical "no floor" call — always visible card with placeholder, never `display:none`
- `renderPlanMarkers` resets `_highlightedDeskId`, removes `#desk-pointer-line` SVG, clears `_activeSpaceFilters`, and calls `renderSpaceFilter` + `applySpaceFilter` on every re-render
- `renderPlanMarkersFiltered()` is the canonical call for rendering markers — wraps `renderPlanMarkers` with favorites filter logic
- Date validation: always compare `endDate < minDate` (Date objects from "YYYY-MM-DDT00:00:00") not `<= today` to avoid time-of-day edge cases
