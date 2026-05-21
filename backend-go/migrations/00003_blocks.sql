-- +goose Up
-- Composite blocks: named groups of canvas objects insertable as one unit
CREATE TABLE IF NOT EXISTS layout_blocks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'custom',
    description TEXT,
    objects_json TEXT NOT NULL DEFAULT '[]',  -- array of desk objects (JSON)
    preview_svg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- +goose Down
DROP TABLE IF EXISTS layout_blocks CASCADE;
