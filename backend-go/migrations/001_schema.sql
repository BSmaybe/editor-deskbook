-- DeskBook schema (migrated from SQLAlchemy models)

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(120) UNIQUE NOT NULL,
    email VARCHAR(320) UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    full_name VARCHAR(255),
    department VARCHAR(120),
    position VARCHAR(120),
    phone VARCHAR(30),
    user_status VARCHAR(20) NOT NULL DEFAULT 'available',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_users_role CHECK (role IN ('admin', 'user')),
    CONSTRAINT ck_users_user_status CHECK (user_status IN ('available', 'busy', 'away'))
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS offices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    address VARCHAR(300)
);

CREATE TABLE IF NOT EXISTS floors (
    id SERIAL PRIMARY KEY,
    office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    plan_url VARCHAR(500),
    published_map_revision_id INTEGER,
    draft_map_revision_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_floors_office_id ON floors(office_id);

CREATE TABLE IF NOT EXISTS desks (
    id SERIAL PRIMARY KEY,
    floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    label VARCHAR(40) NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'flex',
    space_type VARCHAR(30) NOT NULL DEFAULT 'desk',
    assigned_to VARCHAR(120),
    position_x DOUBLE PRECISION,
    position_y DOUBLE PRECISION,
    w DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    h DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    qr_token VARCHAR(36) UNIQUE NOT NULL,
    CONSTRAINT ck_desks_type CHECK (type IN ('flex', 'fixed')),
    CONSTRAINT ck_desks_space_type CHECK (space_type IN ('desk','meeting_room','call_room','open_space','lounge'))
);
CREATE INDEX IF NOT EXISTS idx_desks_floor_id ON desks(floor_id);

CREATE TABLE IF NOT EXISTS reservations (
    id SERIAL PRIMARY KEY,
    desk_id INTEGER NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
    user_id VARCHAR(120) NOT NULL,
    reservation_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    checked_in_at TIMESTAMPTZ,
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT ck_reservations_status CHECK (status IN ('active', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_reservations_desk_date ON reservations(desk_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);

CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    office_id INTEGER REFERENCES offices(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    min_days_ahead INTEGER NOT NULL DEFAULT 0,
    max_days_ahead INTEGER NOT NULL DEFAULT 30,
    min_duration_minutes INTEGER,
    max_duration_minutes INTEGER,
    no_show_timeout_minutes INTEGER NOT NULL DEFAULT 15,
    max_bookings_per_day INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_policies_days_positive CHECK (min_days_ahead >= 0 AND max_days_ahead >= 0),
    CONSTRAINT ck_policies_days_order CHECK (min_days_ahead <= max_days_ahead),
    CONSTRAINT ck_policies_max_bookings_per_day CHECK (max_bookings_per_day >= 1)
);
CREATE INDEX IF NOT EXISTS idx_policies_office_id ON policies(office_id);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS favorite_desks (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(120) NOT NULL,
    desk_id INTEGER NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
    CONSTRAINT uq_favorite_desk UNIQUE (user_id, desk_id)
);
CREATE INDEX IF NOT EXISTS ix_favorite_desks_user_id ON favorite_desks(user_id);

CREATE TABLE IF NOT EXISTS floor_map_revisions (
    id SERIAL PRIMARY KEY,
    floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    plan_svg TEXT,
    desks_json TEXT NOT NULL DEFAULT '[]',
    zones_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    layout_json TEXT,
    semantic_svg TEXT,
    CONSTRAINT ck_fmr_status CHECK (status IN ('draft','published','archived'))
);
CREATE INDEX IF NOT EXISTS idx_fmr_floor_id ON floor_map_revisions(floor_id);

-- Add FK from floors to floor_map_revisions (deferred to avoid circular dep)
ALTER TABLE floors DROP CONSTRAINT IF EXISTS fk_floor_published_rev;
ALTER TABLE floors ADD CONSTRAINT fk_floor_published_rev
    FOREIGN KEY (published_map_revision_id) REFERENCES floor_map_revisions(id) ON DELETE SET NULL;
ALTER TABLE floors DROP CONSTRAINT IF EXISTS fk_floor_draft_rev;
ALTER TABLE floors ADD CONSTRAINT fk_floor_draft_rev
    FOREIGN KEY (draft_map_revision_id) REFERENCES floor_map_revisions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS floor_locks (
    id SERIAL PRIMARY KEY,
    floor_id INTEGER NOT NULL UNIQUE REFERENCES floors(id) ON DELETE CASCADE,
    locked_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS map_audit_log (
    id SERIAL PRIMARY KEY,
    floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    revision_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_mal_floor_id ON map_audit_log(floor_id);

CREATE TABLE IF NOT EXISTS global_components (
    id VARCHAR(120) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    asset_type VARCHAR(30) NOT NULL DEFAULT 'asset',
    view_box VARCHAR(100) NOT NULL DEFAULT '0 0 100 60',
    default_w DOUBLE PRECISION NOT NULL DEFAULT 100,
    default_h DOUBLE PRECISION NOT NULL DEFAULT 60,
    svg_markup TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
