-- Onboarding wizard state (singleton row)
CREATE TABLE IF NOT EXISTS onboarding (
    id                        INTEGER PRIMARY KEY CHECK (id = 1),
    terms_accepted            INTEGER NOT NULL DEFAULT 0,
    crash_reporting_opted_in  INTEGER NOT NULL DEFAULT 0,
    preferences_configured    INTEGER NOT NULL DEFAULT 0,
    roots_added               INTEGER NOT NULL DEFAULT 0,
    first_scan_complete       INTEGER NOT NULL DEFAULT 0,
    completed_at              TEXT
);

INSERT OR IGNORE INTO onboarding (id) VALUES (1);
