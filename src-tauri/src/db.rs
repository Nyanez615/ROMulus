use rusqlite::{Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::models::{RomFile, RomGroup, ScanStatus};

// ── AppState ─────────────────────────────────────────────────────────────────

/// Application-wide shared state managed by Tauri.
/// `db` and `scan_cache` use `Arc<Mutex<>>` so background tokio tasks
/// can clone the Arc and access them without lifetime constraints.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub scan_cache: Arc<Mutex<ScanCache>>,
    /// Held here so the OS watcher isn't dropped after scan_roots returns.
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Default)]
pub struct ScanCache {
    pub roms: Vec<RomFile>,
    pub groups: Vec<RomGroup>,
    pub status: ScanStatus,
    pub enrichment: crate::models::EnrichmentStatus,
    // verification is updated via events from verify_roms background task;
    // stored here so get_enrichment_status-style polling is available if needed.
    pub verification: crate::models::VerificationStatus,
}

// ── Migrations ───────────────────────────────────────────────────────────────

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/001_initial.sql")),
        M::up(include_str!("../migrations/002_metadata.sql")),
        M::up(include_str!("../migrations/003_onboarding.sql")),
        M::up(include_str!("../migrations/004_permanent_delete.sql")),
        M::up(include_str!("../migrations/005_known_tags.sql")),
        M::up(include_str!("../migrations/006_short_console_names.sql")),
        M::up(include_str!("../migrations/007_clean_language_tags.sql")),
        M::up(include_str!("../migrations/008_fix_known_tags.sql")),
    ])
}

// ── Initialisation ───────────────────────────────────────────────────────────

pub fn open(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("romulus.db");

    let mut conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    migrations()
        .to_latest(&mut conn)
        .map_err(|e| format!("Migration failed: {e}"))?;

    Ok(conn)
}

/// In-memory connection for unit tests.
#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    migrations().to_latest(&mut conn).unwrap();
    conn
}

// ── Settings helpers ─────────────────────────────────────────────────────────

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

// ── Action log helpers ────────────────────────────────────────────────────────

pub struct LogEntry<'a> {
    pub action: &'a str,
    pub path: &'a str,
    pub console: &'a str,
    pub title: &'a str,
    pub reason: &'a str,
    pub session_id: &'a str,
}

pub fn log_action(conn: &Connection, entry: LogEntry<'_>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO action_log (action, path, console, title, reason, session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            entry.action,
            entry.path,
            entry.console,
            entry.title,
            entry.reason,
            entry.session_id,
        ],
    )?;
    Ok(())
}

pub fn update_pending_action(
    conn: &Connection,
    path: &str,
    new_action: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE action_log SET action = ?1 WHERE path = ?2 AND action = 'pending'",
        [new_action, path],
    )?;
    Ok(())
}

pub fn has_pending_actions(conn: &Connection) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM action_log WHERE action = 'pending'",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_cleanly() {
        let conn = open_in_memory();
        // Verify all tables exist
        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(tables.contains(&"rom_cache".to_string()));
        assert!(tables.contains(&"action_log".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"onboarding".to_string()));
        assert!(tables.contains(&"game_metadata".to_string()));
        assert!(tables.contains(&"dat_files".to_string()));
    }

    #[test]
    fn migration_006_short_console_names_column_exists() {
        let conn = open_in_memory();
        // The ALTER TABLE in migration 006 should succeed; query the column to confirm.
        let val: i64 = conn
            .query_row("SELECT short_console_names FROM user_preferences WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(val, 0); // default is false
    }

    #[test]
    fn settings_round_trip() {
        let conn = open_in_memory();
        set_setting(&conn, "theme", "dark").unwrap();
        let val = get_setting(&conn, "theme").unwrap();
        assert_eq!(val, Some("dark".to_string()));
    }

    #[test]
    fn migration_005_known_tags_table_exists() {
        let conn = open_in_memory();
        // Verify known_tags table was created by migration 005
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='known_tags'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn onboarding_row_exists() {
        let conn = open_in_memory();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM onboarding WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }
}
