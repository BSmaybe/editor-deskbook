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
- `/backend/app/auth.py` — JWT helpers + require_admin dependency
- `/backend/app/database.py` — engine, SessionLocal, Base, get_db
- `/backend/app/config.py` — pydantic-settings config

## Key Conventions
- Response schemas inherit from Base schemas; read-only fields (id, qr_token, checked_in_at) added only on the response class, NOT on Create/Update schemas
- `model_post_init` used for field normalization (strip whitespace)
- CRUD raises `KeyError("entity_name")` for not-found, `ValueError("message")` for business rule violations; routes catch and convert to HTTPException
- user_id in reservations is a plain string (username), NOT a FK to users.id — intentional design for frontend compatibility
- `require_admin` is a FastAPI dependency injected via `dependencies=[Depends(require_admin)]`

## Phase 2 Features Added
- `Desk.qr_token`: UUID string generated in `crud.create_desk` via `str(uuid.uuid4())`
- `Reservation.checked_in_at`: nullable timezone-aware DateTime
- `GET /desks/{desk_id}/qr`: admin-only, returns PNG StreamingResponse via qrcode lib
- `POST /checkin/{qr_token}?user_id=`: public check-in endpoint
- `cancel_noshow_reservations`: scheduled every 1 min, walks Reservation->Desk->Floor->Office->Policy chain for per-office timeout

## Patterns
- Background scheduler: AsyncIOScheduler started in lifespan, `run_noshow_check` creates its own SessionLocal session (not injected)
- qrcode imported lazily inside endpoint handler to avoid import-time failure if package missing
- `SessionLocal` is exported from database.py and imported directly in main.py for the scheduler job
