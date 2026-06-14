CREATE TABLE play_journal (
    id               TEXT PRIMARY KEY,
    title_normalized TEXT NOT NULL,
    console          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'backlog',
    rating           INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    notes            TEXT,
    compat_notes     TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    synced_at        TEXT,
    deleted_at       TEXT,
    UNIQUE (title_normalized, console)
);
CREATE INDEX idx_play_journal_console ON play_journal(console);
CREATE INDEX idx_play_journal_status  ON play_journal(status);
CREATE INDEX idx_play_journal_updated ON play_journal(updated_at);
