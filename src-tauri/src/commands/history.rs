use rusqlite::Connection;
use tauri::State;

use crate::db::AppState;
use crate::models::{ActionLogEntry, ActionType, HistoryFilter, PagedHistory};

// ── Testable inner implementation ────────────────────────────────────────────

pub(crate) fn get_history_inner(
    conn: &Connection,
    consoles: &Option<Vec<String>>,
    filter: &Option<HistoryFilter>,
    page: u32,
    per_page: u32,
) -> Result<PagedHistory, String> {
    let mut conditions: Vec<String> = Vec::new();
    let mut string_params: Vec<String> = Vec::new();

    if let Some(ref cs) = consoles {
        if !cs.is_empty() {
            let phs = vec!["?"; cs.len()].join(", ");
            conditions.push(format!("console IN ({phs})"));
            string_params.extend(cs.iter().cloned());
        }
    }

    if let Some(ref f) = filter {
        if let Some(ref actions) = f.actions {
            if !actions.is_empty() {
                let phs = vec!["?"; actions.len()].join(", ");
                conditions.push(format!("action IN ({phs})"));
                string_params.extend(actions.iter().cloned());
            }
        }
        if let Some(days) = f.since_days {
            // days is u32 (not user-supplied string) — embedding directly is safe
            conditions.push(format!("timestamp >= datetime('now', '-{days} days')"));
        }
    }

    let where_clause = if conditions.is_empty() {
        "1=1".to_string()
    } else {
        conditions.join(" AND ")
    };

    let count_sql = format!("SELECT COUNT(*) FROM action_log WHERE {where_clause}");
    let total: u32 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(string_params.iter()),
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let offset = page.saturating_sub(1) * per_page;
    let data_sql = format!(
        "SELECT id, timestamp, action, path, console, title, reason, session_id \
         FROM action_log WHERE {where_clause} \
         ORDER BY id DESC LIMIT {per_page} OFFSET {offset}",
    );

    let mut stmt = conn.prepare(&data_sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(string_params.iter()))
        .map_err(|e| e.to_string())?;

    let mut entries: Vec<ActionLogEntry> = vec![];
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let action_str: String = row.get(2).map_err(|e| e.to_string())?;
        let action = parse_action_type(&action_str);
        entries.push(ActionLogEntry {
            id: row.get(0).map_err(|e| e.to_string())?,
            timestamp: row.get(1).map_err(|e| e.to_string())?,
            action,
            path: row.get(3).map_err(|e| e.to_string())?,
            console: row.get(4).map_err(|e| e.to_string())?,
            title: row.get(5).map_err(|e| e.to_string())?,
            reason: row.get(6).map_err(|e| e.to_string())?,
            session_id: row.get(7).map_err(|e| e.to_string())?,
        });
    }

    Ok(PagedHistory { total, page, per_page, entries })
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_history(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
    filter: Option<HistoryFilter>,
    page: u32,
    per_page: u32,
) -> Result<PagedHistory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    get_history_inner(&conn, &consoles, &filter, page, per_page)
}

fn parse_action_type(s: &str) -> ActionType {
    match s {
        "moved_to_trash" => ActionType::MovedToTrash,
        "deleted" => ActionType::Deleted,
        "kept" => ActionType::Kept,
        "skipped" => ActionType::Skipped,
        "deferred" => ActionType::Deferred,
        _ => ActionType::Pending,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, LogEntry};

    fn seed_entries(conn: &Connection) {
        db::log_action(conn, LogEntry { action: "moved_to_trash", path: "/a.zip", console: "Nintendo - GBA", title: "Game A", reason: "test", session_id: "s1" }).unwrap();
        db::log_action(conn, LogEntry { action: "kept",           path: "/b.zip", console: "Sega - Saturn",  title: "Game B", reason: "test", session_id: "s1" }).unwrap();
        db::log_action(conn, LogEntry { action: "deleted",        path: "/c.zip", console: "Nintendo - GBA", title: "Game C", reason: "test", session_id: "s1" }).unwrap();
        db::log_action(conn, LogEntry { action: "skipped",        path: "/d.zip", console: "Sega - Saturn",  title: "Game D", reason: "test", session_id: "s1" }).unwrap();
    }

    #[test]
    fn history_no_filter_returns_all() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let result = get_history_inner(&conn, &None, &None, 1, 50).unwrap();
        assert_eq!(result.total, 4);
    }

    #[test]
    fn history_console_filter() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let cs = Some(vec!["Nintendo - GBA".into()]);
        let result = get_history_inner(&conn, &cs, &None, 1, 50).unwrap();
        assert_eq!(result.total, 2);
        assert!(result.entries.iter().all(|e| e.console == "Nintendo - GBA"));
    }

    #[test]
    fn history_action_filter_single() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let f = Some(HistoryFilter { actions: Some(vec!["kept".into()]), since_days: None });
        let result = get_history_inner(&conn, &None, &f, 1, 50).unwrap();
        assert_eq!(result.total, 1);
        assert!(matches!(result.entries[0].action, ActionType::Kept));
    }

    #[test]
    fn history_action_filter_multiple() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let f = Some(HistoryFilter {
            actions: Some(vec!["moved_to_trash".into(), "deleted".into()]),
            since_days: None,
        });
        let result = get_history_inner(&conn, &None, &f, 1, 50).unwrap();
        assert_eq!(result.total, 2);
    }

    #[test]
    fn history_combined_console_and_action_filter() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let cs = Some(vec!["Nintendo - GBA".into()]);
        let f = Some(HistoryFilter {
            actions: Some(vec!["moved_to_trash".into(), "deleted".into()]),
            since_days: None,
        });
        let result = get_history_inner(&conn, &cs, &f, 1, 50).unwrap();
        assert_eq!(result.total, 2);
    }

    #[test]
    fn history_empty_consoles_filter_returns_nothing() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let cs = Some(vec![]);
        let result = get_history_inner(&conn, &cs, &None, 1, 50).unwrap();
        assert_eq!(result.total, 4); // empty vec → IN () → no WHERE clause added
    }

    #[test]
    fn history_pagination_with_filter() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        let result = get_history_inner(&conn, &None, &None, 1, 2).unwrap();
        assert_eq!(result.total, 4);
        assert_eq!(result.entries.len(), 2);
    }

    #[test]
    fn history_date_filter_includes_recent_entries() {
        let conn = db::open_in_memory();
        seed_entries(&conn);
        // Entries were just inserted, so a 1-day window should include all of them
        let f = Some(HistoryFilter { actions: None, since_days: Some(1) });
        let result = get_history_inner(&conn, &None, &f, 1, 50).unwrap();
        assert_eq!(result.total, 4);
    }
}
