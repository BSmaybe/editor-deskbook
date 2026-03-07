# Backend API Builder Memory

## Stack (DO-main project)
- FastAPI 0.111.0 + SQLAlchemy 2.0.30 (ORM, mapped_column style)
- PostgreSQL via psycopg2-binary; no Alembic — uses `Base.metadata.create_all` at startup
- Pydantic v2 (ConfigDict, model_dump, model_post_init)
- JWT auth via python-jose; bcrypt via bcrypt package (not passlib)
- APScheduler 3.10.4 (AsyncIOScheduler) for background jobs

## Project Structure
- `/backend/app/models.py` — SQLAlchemy ORM models
- `/backend/app/schemas.py` — Pydantic request/response schemas
- `/backend/app/crud.py` — all DB operations (no raw SQL)
- `/backend/app/main.py` — FastAPI routes + lifespan (scheduler, create_all)
- `/backend/app/auth.py` — JWT helpers + require_admin + get_current_user dependencies
- `/backend/app/database.py` — engine, SessionLocal, Base, get_db
- `/backend/app/config.py` — pydantic-settings config

## Key Conventions
- Response schemas inherit from Base schemas; read-only fields (id, qr_token, checked_in_at) added only on the response class, NOT on Create/Update schemas
- `model_post_init` used for field normalization (strip whitespace)
- CRUD raises `KeyError("entity_name")` for not-found, `ValueError("message")` for business rule violations; routes catch and convert to HTTPException
- user_id in reservations is a plain string (username), NOT a FK to users.id — intentional design for frontend compatibility
- `require_admin` is a FastAPI dependency injected via `dependencies=[Depends(require_admin)]`
- `get_current_user` is a FastAPI dependency that returns `models.User`; inject as a parameter (not in `dependencies=[]`) when you need the user object in the handler
- Startup migrations run via `engine.connect()` + `text(...)` BEFORE `Base.metadata.create_all` in lifespan; wrapped in try/except to avoid breaking startup
- `sqlalchemy.text` must be imported at the top of main.py when used in lifespan migrations

## Phase 2 Features Added
- `Desk.qr_token`: UUID string generated in `crud.create_desk` via `str(uuid.uuid4())`
- `Reservation.checked_in_at`: nullable timezone-aware DateTime
- `GET /desks/{desk_id}/qr`: admin-only, returns PNG StreamingResponse via qrcode lib
- `POST /checkin/{qr_token}?user_id=`: public check-in endpoint
- `cancel_noshow_reservations`: scheduled every 1 min, walks Reservation->Desk->Floor->Office->Policy chain for per-office timeout

## Phase 3 Features Added
- `POST /reservations` now enforces Policy rules (min/max_days_ahead, min/max_duration_minutes) before creating a booking
  - Policy lookup: desk -> floor -> office -> Policy.office_id match; skips if no policy found
  - Raises ValueError (caught as 409) with Russian-language user-facing messages
- `GET /reservations` accepts 5 new query params: user_id, date_from, date_to, office_id, status
  - office_id filter joins Reservation -> Desk -> Floor to filter by office
  - Results ordered by reservation_date DESC, id DESC
- `GET /analytics` (admin-only): returns AnalyticsResponse with total_today, total_active, total_cancelled, noshow_rate, occupancy_by_office, top_desks, top_users
- New schemas in schemas.py: DeskStat, UserStat, AnalyticsResponse (placed before Message class)

## Phase 4 Features Added (User Profiles)
- `User` model extended with: full_name (VARCHAR 255), department (VARCHAR 120), position (VARCHAR 120), phone (VARCHAR 30), user_status (VARCHAR 20, default 'available')
- `user_status` CHECK constraint: `IN ('available', 'busy', 'away')` — named `ck_users_user_status`
- Startup migration in lifespan runs `ALTER TABLE users ADD COLUMN IF NOT EXISTS ...` for each new column before `create_all`
- New schemas: `UserPublic` (public-safe, no email/hashed_password), `UserProfileUpdate` (PATCH body)
- `UserResponse` extended with the 5 new profile fields
- New CRUD functions: `get_users(db)`, `update_user_profile(db, username, data)`
- New endpoints (all JWT-required, added AFTER auth block, BEFORE health):
  - `GET /users` — list all users, any authenticated user
  - `GET /users/{username}` — get one user by username, 404 if not found
  - `PATCH /users/{username}/profile` — update profile; employee can only edit own (403 if different username); admin can edit any

## Phase 5 Features Added (Favorite Desks)
- `FavoriteDesk` model: uses classic `Column` style (not mapped_column); requires `Column` and `UniqueConstraint` added to sqlalchemy imports in models.py
- Startup migration creates `favorite_desks` table + index inside the existing `engine.connect()` block, before `Base.metadata.create_all`
- Favorites endpoints registered BEFORE `GET /users/{username}` to prevent "me" being swallowed by the path parameter
- FastAPI 0.111 rejects `status_code=204` without `response_class=Response` — fix: add `response_class=Response` to the decorator, return `Response(status_code=204)`, and import `Response` from `fastapi.responses`

## Phase 6 Features Added (Batch Reservations)
- `POST /reservations/batch` — creates one reservation per date, partial-success semantics
- New schemas: `ReservationBatchCreate` (desk_id, dates, start_time, end_time), `ReservationBatchResult` (created, skipped, errors)
  - `start_time`/`end_time` typed as `time` (not str) for direct reuse with `create_reservation`; Pydantic v2 coerces "HH:MM" strings automatically
- CRUD `create_reservations_batch`: loops over dates, calls `create_reservation` per date, catches ValueError -> skipped, KeyError re-raised, any other Exception -> errors; `db.rollback()` called after each failure to keep the session clean
- Route registered BEFORE `POST /reservations/{reservation_id}/cancel` (line order matters in FastAPI); integer path param type means "batch" would be rejected anyway but explicit ordering is cleaner
- Returns HTTP 409 (with skipped/errors detail) when zero reservations were created; HTTP 200 otherwise even if some dates were skipped

## Patterns
- Background scheduler: AsyncIOScheduler started in lifespan, `run_noshow_check` creates its own SessionLocal session (not injected)
- qrcode imported lazily inside endpoint handler to avoid import-time failure if package missing
- `SessionLocal` is exported from database.py and imported directly in main.py for the scheduler job
- `func` and `desc` are imported from sqlalchemy in crud.py; `func` is also in models.py separately (both needed independently)
- Analytics duration computation uses integer arithmetic on .hour/.minute (not timedelta) to avoid time arithmetic pitfalls with time objects
- Analytics queries use scalar() for counts; occupancy loops over offices rather than a group-by-office aggregate
- Batch/multi-item CRUD: use `db.rollback()` after each per-item failure to keep the SQLAlchemy session usable; do NOT use a single transaction for partial-success semantics
