# Frontend MVP Engineer — Agent Memory

## Project: DO-main (Desk Booking System)

### Stack
- Vanilla JS (ES modules via `type="module"`) for main pages, plain inline `<script>` for standalone pages
- No framework (no React/Vue), no build step
- CSS custom properties in `styles.css`, no Tailwind or component libraries
- Backend: FastAPI at `http://localhost:8000` (hardcoded `API_BASE`)

### File Locations
- `frontend/index.html` + `frontend/app.js` — user-facing SPA
- `frontend/admin.html` + `frontend/admin.js` — admin panel (separate page)
- `frontend/checkin.html` — standalone QR check-in landing page (Phase 2, plain inline script)
- `frontend/styles.css` — shared stylesheet for all pages

### Auth Pattern
- User auth: token stored in `localStorage` as `user_token`, username as `user_username`
- Admin auth: token stored as `admin_token`, username as `admin_username`
- Both use `Authorization: Bearer <token>` header via `apiRequest()` helper
- For standalone pages without `apiRequest()`, fetch directly with explicit headers

### API Conventions
- `apiRequest(path, options)` helper centralizes auth headers + error parsing
- Errors follow `{ detail: "..." }` (FastAPI default)
- 204 responses return `null`; others return `.json()`
- Binary responses (QR PNG): fetch raw, use `resp.blob()` then `URL.createObjectURL()`

### Component Patterns
- Reusable button factories: `makeDeleteBtn(label, onClick)`, `makeQrBtn(desk)` in admin.js
- Badge helper function `checkinBadge(checkedInAt)` returns a `<span>` DOM node
- `.btn-row` CSS class for horizontal button groups in table action cells
- State is a plain object (`const state = { offices, floors, desks, ... }`) — no reactive framework

### CSS Conventions
- Badge variants: `.badge.available`, `.badge.busy`, `.badge.checked-in`, `.badge.not-checked-in`
- Standalone page layout: `.checkin-page` (full-viewport flex centering) + `.login-card` (shared modal card)
- `.hidden` class toggles visibility (display:none)
- `.button.small`, `.button.secondary`, `.button.danger` modifier classes

### Phase 2 Features (implemented)
- `checkin.html`: reads `?token=` from URL, pre-fills username from localStorage, calls `POST /checkin/{token}?user_id={username}`
- Admin QR button: fetches `GET /desks/{id}/qr` as blob, opens object URL in new tab
- My Bookings: shows `checked_in_at` status badge per booking (green if checked in, grey if not)

### Known Patterns to Watch
- `admin.js` uses `type="module"` script; standalone pages must use plain `<script>` (no module imports)
- Table action cells are built with `tr.innerHTML = ...` then querySelector; append buttons after innerHTML is set
- Floor select in user app is disabled until an office is selected
