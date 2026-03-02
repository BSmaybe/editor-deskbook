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

### Known Patterns to Watch
- `admin.js` must NOT use ES module syntax (loaded as plain `<script>`)
- `app.js` in client uses `type="module"` — ES2020+ fine
- Set `tr.innerHTML` first, then `querySelector` + `append` buttons (innerHTML clears listeners)
- Floor select disabled until office selected
- Admin init validates saved token via `/offices` before showing UI
