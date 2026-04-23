-- Wall Framing Designer schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    password_salt  TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    units_mode    TEXT NOT NULL DEFAULT 'ftin',  -- 'ftin' or 'inches'
    data_json     TEXT NOT NULL,                 -- full project document
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS framing_presets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    stud_nominal   TEXT NOT NULL,     -- '2x4', '2x6', etc.
    stud_width_in  REAL NOT NULL,     -- actual width (thickness), e.g. 1.5
    stud_depth_in  REAL NOT NULL,     -- actual depth, e.g. 3.5
    spacing_oc_in  REAL NOT NULL,
    top_plates     INTEGER NOT NULL DEFAULT 2,
    bottom_plates  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS opening_presets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    kind              TEXT NOT NULL,   -- 'door' or 'window'
    rough_width_in    REAL NOT NULL,
    rough_height_in   REAL NOT NULL,
    head_height_in    REAL NOT NULL,
    sill_height_in    REAL NOT NULL DEFAULT 0,
    header_depth_in   REAL NOT NULL DEFAULT 3.5
);
