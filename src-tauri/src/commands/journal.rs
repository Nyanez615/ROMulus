use tauri::State;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{PlayEntry, PlayStats, PlayStatus};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Minimal ISO 8601 UTC — matches the SQLite default format
    let (y, mo, d, h, mi, s) = epoch_to_ymd_hms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn epoch_to_ymd_hms(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    // Days since 1970-01-01
    let (y, mo, d) = days_to_ymd(days);
    (y, mo, d, h, m, s)
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    let mut y = 1970u64;
    loop {
        let dy = if is_leap(y) { 366 } else { 365 };
        if days < dy { break; }
        days -= dy;
        y += 1;
    }
    let months = [31u64, if is_leap(y) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 1u64;
    for &dm in &months {
        if days < dm { break; }
        days -= dm;
        mo += 1;
    }
    (y, mo, days + 1)
}

fn is_leap(y: u64) -> bool { y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400)) }

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlayEntry> {
    let status_str: String = row.get(3)?;
    let status = match status_str.as_str() {
        "backlog"   => PlayStatus::Backlog,
        "testing"   => PlayStatus::Testing,
        "playing"   => PlayStatus::Playing,
        "completed" => PlayStatus::Completed,
        "dropped"   => PlayStatus::Dropped,
        _           => PlayStatus::Backlog,
    };
    let rating_raw: Option<i64> = row.get(4)?;
    Ok(PlayEntry {
        id: row.get(0)?,
        title_normalized: row.get(1)?,
        console: row.get(2)?,
        status,
        rating: rating_raw.map(|v| v as u8),
        notes: row.get(5)?,
        compat_notes: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        synced_at: row.get(9)?,
        display_title: row.get(10)?,
        community_score: row.get(11)?,
        critic_score: row.get(12)?,
    })
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_play_entry(
    state: State<'_, AppState>,
    title_normalized: String,
    console: String,
    status: PlayStatus,
    rating: Option<u8>,
    notes: Option<String>,
    compat_notes: Option<String>,
    display_title: Option<String>,
) -> Result<PlayEntry, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = now_iso();

    let status_str = match &status {
        PlayStatus::Backlog   => "backlog",
        PlayStatus::Testing   => "testing",
        PlayStatus::Playing   => "playing",
        PlayStatus::Completed => "completed",
        PlayStatus::Dropped   => "dropped",
    };

    // Preserve existing UUID on update; generate fresh one on insert
    let existing_id: Option<String> = conn.query_row(
        "SELECT id FROM play_journal WHERE title_normalized=?1 AND console=?2",
        rusqlite::params![title_normalized, console],
        |r| r.get(0),
    ).ok();
    let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    conn.execute(
        "INSERT INTO play_journal (id, title_normalized, console, status, rating, notes, compat_notes, display_title, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(title_normalized, console) DO UPDATE SET
           status=excluded.status,
           rating=excluded.rating,
           notes=excluded.notes,
           compat_notes=excluded.compat_notes,
           display_title=COALESCE(excluded.display_title, play_journal.display_title),
           updated_at=excluded.updated_at,
           deleted_at=NULL",
        rusqlite::params![id, title_normalized, console, status_str, rating.map(|v| v as i64), notes, compat_notes, display_title, now],
    ).map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT pj.id, pj.title_normalized, pj.console, pj.status, pj.rating,
                pj.notes, pj.compat_notes, pj.created_at, pj.updated_at, pj.synced_at,
                COALESCE(gm.name, pj.display_title, rc.title), gm.rating, gm.critic_rating
         FROM play_journal pj
         LEFT JOIN game_metadata gm ON gm.title_normalized=pj.title_normalized AND gm.console=pj.console
         LEFT JOIN (SELECT title_normalized, console, MIN(title) AS title FROM rom_cache GROUP BY title_normalized, console) rc
                ON rc.title_normalized=pj.title_normalized AND rc.console=pj.console
         WHERE pj.title_normalized=?1 AND pj.console=?2",
        rusqlite::params![title_normalized, console],
        row_to_entry,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_play_entry(
    state: State<'_, AppState>,
    title_normalized: String,
    console: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    conn.execute(
        "UPDATE play_journal SET deleted_at=?1 WHERE title_normalized=?2 AND console=?3",
        rusqlite::params![now, title_normalized, console],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_play_entries(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
    status_filter: Option<Vec<String>>,
) -> Result<Vec<PlayEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT pj.id, pj.title_normalized, pj.console, pj.status, pj.rating,
                pj.notes, pj.compat_notes, pj.created_at, pj.updated_at, pj.synced_at,
                COALESCE(gm.name, pj.display_title, rc.title), gm.rating, gm.critic_rating
         FROM play_journal pj
         LEFT JOIN game_metadata gm ON gm.title_normalized=pj.title_normalized AND gm.console=pj.console
         LEFT JOIN (SELECT title_normalized, console, MIN(title) AS title FROM rom_cache GROUP BY title_normalized, console) rc
                ON rc.title_normalized=pj.title_normalized AND rc.console=pj.console
         WHERE pj.deleted_at IS NULL",
    );

    // Build console IN clause
    if let Some(ref cs) = consoles {
        if !cs.is_empty() {
            let placeholders: Vec<String> = (1..=cs.len()).map(|i| format!("?{}", i + 1)).collect();
            sql.push_str(&format!(" AND pj.console IN ({})", placeholders.join(",")));
        }
    }

    // Build status IN clause
    let status_offset = consoles.as_ref().map(|v| v.len()).unwrap_or(0) + 1;
    if let Some(ref sf) = status_filter {
        if !sf.is_empty() {
            let placeholders: Vec<String> = (1..=sf.len()).map(|i| format!("?{}", i + status_offset)).collect();
            sql.push_str(&format!(" AND pj.status IN ({})", placeholders.join(",")));
        }
    }

    sql.push_str(" ORDER BY pj.updated_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // Build params vec dynamically
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(ref cs) = consoles {
        for c in cs { params.push(Box::new(c.clone())); }
    }
    if let Some(ref sf) = status_filter {
        for s in sf { params.push(Box::new(s.clone())); }
    }

    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let entries = stmt
        .query_map(param_refs.as_slice(), row_to_entry)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(entries)
}

#[tauri::command]
pub fn get_play_stats(state: State<'_, AppState>) -> Result<PlayStats, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT
           COUNT(CASE WHEN status='backlog'   THEN 1 END),
           COUNT(CASE WHEN status='testing'   THEN 1 END),
           COUNT(CASE WHEN status='playing'   THEN 1 END),
           COUNT(CASE WHEN status='completed' THEN 1 END),
           COUNT(CASE WHEN status='dropped'   THEN 1 END),
           COUNT(CASE WHEN rating IS NOT NULL THEN 1 END),
           AVG(CASE WHEN rating IS NOT NULL THEN CAST(rating AS REAL) END)
         FROM play_journal WHERE deleted_at IS NULL",
        [],
        |row| Ok(PlayStats {
            backlog:     row.get::<_, i64>(0)? as u32,
            testing:     row.get::<_, i64>(1)? as u32,
            playing:     row.get::<_, i64>(2)? as u32,
            completed:   row.get::<_, i64>(3)? as u32,
            dropped:     row.get::<_, i64>(4)? as u32,
            total_rated: row.get::<_, i64>(5)? as u32,
            avg_rating:  row.get(6)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_play_journal(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT pj.id, pj.title_normalized, pj.console, pj.status, pj.rating,
                pj.notes, pj.compat_notes, pj.created_at, pj.updated_at, pj.synced_at,
                pj.display_title, NULL, NULL
         FROM play_journal pj WHERE pj.deleted_at IS NULL ORDER BY pj.updated_at DESC",
    ).map_err(|e| e.to_string())?;

    let entries: Vec<PlayEntry> = stmt
        .query_map([], row_to_entry)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_journal_to_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let json = export_play_journal(state)?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_journal_from_file(state: State<'_, AppState>, path: String) -> Result<u32, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    import_play_journal(state, json)
}

#[tauri::command]
pub fn import_play_journal(
    state: State<'_, AppState>,
    json: String,
) -> Result<u32, String> {
    let entries: Vec<PlayEntry> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;

    for entry in &entries {
        let status_str = match &entry.status {
            PlayStatus::Backlog   => "backlog",
            PlayStatus::Testing   => "testing",
            PlayStatus::Playing   => "playing",
            PlayStatus::Completed => "completed",
            PlayStatus::Dropped   => "dropped",
        };
        conn.execute(
            "INSERT INTO play_journal (id, title_normalized, console, status, rating, notes, compat_notes, display_title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(title_normalized, console) DO UPDATE SET
               status=excluded.status,
               rating=excluded.rating,
               notes=excluded.notes,
               compat_notes=excluded.compat_notes,
               display_title=COALESCE(excluded.display_title, play_journal.display_title),
               updated_at=excluded.updated_at",
            rusqlite::params![
                entry.id, entry.title_normalized, entry.console, status_str,
                entry.rating.map(|v| v as i64), entry.notes, entry.compat_notes,
                entry.display_title, entry.created_at, entry.updated_at,
            ],
        ).map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(count)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn set_entry_direct(
        conn: &rusqlite::Connection,
        title: &str,
        console: &str,
        status: &str,
        rating: Option<i64>,
    ) {
        let id = Uuid::new_v4().to_string();
        let now = "2026-01-01T00:00:00Z";
        conn.execute(
            "INSERT INTO play_journal (id, title_normalized, console, status, rating, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(title_normalized, console) DO UPDATE SET status=excluded.status, rating=excluded.rating, updated_at=excluded.updated_at",
            rusqlite::params![id, title, console, status, rating, now],
        ).unwrap();
    }

    #[test]
    fn play_stats_counts_by_status() {
        let conn = db::open_in_memory();
        set_entry_direct(&conn, "mario", "GBA", "playing", Some(4));
        set_entry_direct(&conn, "zelda", "GBA", "completed", Some(5));
        set_entry_direct(&conn, "metroid", "GBA", "backlog", None);

        let stats: PlayStats = conn.query_row(
            "SELECT COUNT(CASE WHEN status='backlog' THEN 1 END), COUNT(CASE WHEN status='testing' THEN 1 END),
                    COUNT(CASE WHEN status='playing' THEN 1 END), COUNT(CASE WHEN status='completed' THEN 1 END),
                    COUNT(CASE WHEN status='dropped' THEN 1 END), COUNT(CASE WHEN rating IS NOT NULL THEN 1 END),
                    AVG(CASE WHEN rating IS NOT NULL THEN CAST(rating AS REAL) END)
             FROM play_journal WHERE deleted_at IS NULL",
            [],
            |row| Ok(PlayStats {
                backlog: row.get::<_, i64>(0)? as u32,
                testing: row.get::<_, i64>(1)? as u32,
                playing: row.get::<_, i64>(2)? as u32,
                completed: row.get::<_, i64>(3)? as u32,
                dropped: row.get::<_, i64>(4)? as u32,
                total_rated: row.get::<_, i64>(5)? as u32,
                avg_rating: row.get(6)?,
            }),
        ).unwrap();

        assert_eq!(stats.backlog, 1);
        assert_eq!(stats.playing, 1);
        assert_eq!(stats.completed, 1);
        assert_eq!(stats.total_rated, 2);
        assert!((stats.avg_rating.unwrap() - 4.5).abs() < 0.01);
    }

    #[test]
    fn soft_delete_hides_entry() {
        let conn = db::open_in_memory();
        let now = "2026-01-01T00:00:00Z";
        set_entry_direct(&conn, "mario", "GBA", "playing", None);
        conn.execute(
            "UPDATE play_journal SET deleted_at=?1 WHERE title_normalized='mario' AND console='GBA'",
            [now],
        ).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM play_journal WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn upsert_preserves_id() {
        let conn = db::open_in_memory();
        let id = Uuid::new_v4().to_string();
        let now = "2026-01-01T00:00:00Z";

        conn.execute(
            "INSERT INTO play_journal (id, title_normalized, console, status, updated_at) VALUES (?1,'mario','GBA','backlog',?2)",
            rusqlite::params![id, now],
        ).unwrap();

        conn.execute(
            "INSERT INTO play_journal (id, title_normalized, console, status, updated_at)
             VALUES ('new-uuid','mario','GBA','playing',?1)
             ON CONFLICT(title_normalized,console) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
            [now],
        ).unwrap();

        let stored_id: String = conn.query_row(
            "SELECT id FROM play_journal WHERE title_normalized='mario' AND console='GBA'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stored_id, id, "original UUID must be preserved on update");
    }

    #[test]
    fn unique_constraint_per_title_console() {
        let conn = db::open_in_memory();
        set_entry_direct(&conn, "mario", "GBA", "playing", None);
        set_entry_direct(&conn, "mario", "SNES", "backlog", None);
        set_entry_direct(&conn, "zelda", "GBA", "completed", None);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM play_journal", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn now_iso_produces_valid_format() {
        let ts = now_iso();
        // Must be "YYYY-MM-DDTHH:MM:SSZ" — 20 chars
        assert_eq!(ts.len(), 20);
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.chars().nth(4), Some('-'));
        assert_eq!(ts.chars().nth(10), Some('T'));
    }
}
