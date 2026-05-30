-- App settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- User language & region preferences (singleton row)
CREATE TABLE IF NOT EXISTS user_preferences (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    preferred_languages TEXT NOT NULL DEFAULT '[]',
    preferred_regions   TEXT NOT NULL DEFAULT '[]'
);
INSERT OR IGNORE INTO user_preferences (id) VALUES (1);

-- Configured ROM root folders
CREATE TABLE IF NOT EXISTS rom_roots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Parsed ROM file cache (mtime-based incremental scan)
CREATE TABLE IF NOT EXISTS rom_cache (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    path             TEXT    NOT NULL UNIQUE,
    console          TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    title_normalized TEXT    NOT NULL,
    regions          TEXT    NOT NULL DEFAULT '[]',
    languages        TEXT    NOT NULL DEFAULT '[]',
    status_flags     TEXT    NOT NULL DEFAULT '[]',
    extra_tags       TEXT    NOT NULL DEFAULT '[]',
    bad_dump         INTEGER NOT NULL DEFAULT 0,
    revision         INTEGER NOT NULL DEFAULT 0,
    disc_number      INTEGER,
    version          TEXT,
    is_bios          INTEGER NOT NULL DEFAULT 0,
    file_format      TEXT    NOT NULL DEFAULT 'zip',
    filesize         INTEGER NOT NULL DEFAULT 0,
    file_category    TEXT    NOT NULL DEFAULT 'game',
    mtime            INTEGER NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rom_cache_console    ON rom_cache(console);
CREATE INDEX IF NOT EXISTS idx_rom_cache_normalized ON rom_cache(title_normalized);

-- Whole-folder format pair preferences (NES Headered vs Headerless, etc.)
CREATE TABLE IF NOT EXISTS format_preferences (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    console_group    TEXT NOT NULL UNIQUE,
    preferred_folder TEXT NOT NULL
);

-- Append-only action log
CREATE TABLE IF NOT EXISTS action_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
    action     TEXT NOT NULL,
    path       TEXT NOT NULL,
    console    TEXT NOT NULL,
    title      TEXT NOT NULL,
    reason     TEXT NOT NULL,
    session_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_log_session   ON action_log(session_id);
CREATE INDEX IF NOT EXISTS idx_action_log_timestamp ON action_log(timestamp);
