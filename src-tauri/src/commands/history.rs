use rusqlite::params;
use tauri::State;

use crate::db::AppState;
use crate::models::{ActionLogEntry, ActionType, PagedHistory};

#[tauri::command]
pub fn get_history(
    state: State<'_, AppState>,
    page: u32,
    per_page: u32,
) -> Result<PagedHistory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let total: u32 = conn
        .query_row("SELECT COUNT(*) FROM action_log", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let offset = (page.saturating_sub(1)) * per_page;

    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, action, path, console, title, reason, session_id
             FROM action_log
             ORDER BY id DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;

    let mut entries: Vec<ActionLogEntry> = vec![];
    let mut rows = stmt.query(params![per_page, offset]).map_err(|e| e.to_string())?;

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
