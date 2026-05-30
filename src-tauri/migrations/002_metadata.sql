-- IGDB game metadata cache
CREATE TABLE IF NOT EXISTS game_metadata (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title_normalized TEXT    NOT NULL,
    console          TEXT    NOT NULL,
    igdb_id          INTEGER,
    name             TEXT,
    release_year     INTEGER,
    genres           TEXT    DEFAULT '[]',
    summary          TEXT,
    rating           REAL,
    player_count     INTEGER,
    cover_url        TEXT,
    fetched_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(title_normalized, console)
);

CREATE INDEX IF NOT EXISTS idx_metadata_title ON game_metadata(title_normalized, console);

-- No-Intro DAT files imported by the user
CREATE TABLE IF NOT EXISTS dat_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    console     TEXT NOT NULL UNIQUE,
    filename    TEXT NOT NULL,
    version     TEXT,
    date        TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual entries from a DAT file
CREATE TABLE IF NOT EXISTS dat_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dat_file_id INTEGER NOT NULL REFERENCES dat_files(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    crc32       TEXT,
    md5         TEXT,
    sha1        TEXT
);

CREATE INDEX IF NOT EXISTS idx_dat_entries_crc32 ON dat_entries(crc32);
CREATE INDEX IF NOT EXISTS idx_dat_entries_dat   ON dat_entries(dat_file_id);

-- ROM verification results against DAT
CREATE TABLE IF NOT EXISTS rom_verifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rom_cache_id INTEGER NOT NULL REFERENCES rom_cache(id) ON DELETE CASCADE,
    status       TEXT    NOT NULL,
    verified_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(rom_cache_id)
);

-- SteamGridDB thumbnail cache (local file paths)
CREATE TABLE IF NOT EXISTS thumbnail_cache (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title_normalized TEXT NOT NULL,
    console          TEXT NOT NULL,
    local_path       TEXT NOT NULL,
    fetched_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(title_normalized, console)
);
