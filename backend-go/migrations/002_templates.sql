-- Floor layout templates
CREATE TABLE IF NOT EXISTS layout_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(60) NOT NULL DEFAULT 'custom',
    layout_json TEXT NOT NULL,
    preview_svg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
