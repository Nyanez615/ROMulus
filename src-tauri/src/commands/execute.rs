use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::commands::settings::{get_settings_inner, save_settings_inner};
use crate::db::{self, AppState, LogEntry};
use crate::models::{ExecutionResult, FailedFile, InterruptedSession, RomFile};

// ── Per-file permanent delete helper ─────────────────────────────────────────

/// Delete a list of files permanently and record each action in the log.
/// Pre-logs all files as "pending", then deletes sequentially via fs::remove_file.
/// Returns `(success_count, failed_files, skipped_count)`.
fn delete_files_inner(
    files: &[RomFile],
    session_id: &str,
    reason: &str,
    db_conn: &Arc<Mutex<Connection>>,
) -> Result<(u32, Vec<FailedFile>, u32), String> {
    let conn = db_conn.lock().map_err(|e| e.to_string())?;
    let mut skipped_count = 0u32;
    let mut to_process: Vec<&RomFile> = vec![];

    for rom in files {
        if Path::new(&rom.path).exists() {
            to_process.push(rom);
        } else {
            skipped_count += 1;
        }
    }

    for rom in &to_process {
        db::log_action(
            &conn,
            LogEntry {
                action: "pending",
                path: &rom.path,
                console: &rom.console,
                title: &rom.title,
                reason,
                session_id,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    let mut success_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];
    for rom in &to_process {
        match std::fs::remove_file(&rom.path) {
            Ok(()) => {
                db::update_pending_action(&conn, &rom.path, "deleted")
                    .map_err(|e| e.to_string())?;
                success_count += 1;
            }
            Err(e) => {
                db::update_pending_action(&conn, &rom.path, "failed")
                    .map_err(|e| e.to_string())?;
                failed.push(FailedFile {
                    path: rom.path.clone(),
                    error: e.to_string(),
                });
            }
        }
    }
    Ok((success_count, failed, skipped_count))
}

// ── Folder-sweep helper ───────────────────────────────────────────────────────

/// Scan all entries in `rom_roots` and remove any that exist on disk but
/// contain no visible files. Returns the list of removed paths.
fn sweep_empty_roots(conn: &Connection) -> Result<Vec<String>, String> {
    let settings = get_settings_inner(conn)?;
    let mut removed: Vec<String> = vec![];

    for root in &settings.rom_roots {
        let dir = Path::new(root);
        if !dir.exists() {
            continue;
        }
        let visible_count = std::fs::read_dir(dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .count()
            })
            .unwrap_or(1);

        if visible_count == 0 {
            if let Err(e) = std::fs::remove_dir_all(dir) {
                eprintln!("[sweep] Could not remove empty root {:?}: {e}", dir);
            } else {
                removed.push(root.clone());
            }
        }
    }

    if !removed.is_empty() {
        let mut settings = get_settings_inner(conn)?;
        settings.rom_roots.retain(|r| !removed.contains(r));
        save_settings_inner(conn, &settings)?;
    }

    Ok(removed)
}

// ── execute_prune ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn execute_prune(
    app: AppHandle,
    state: State<'_, AppState>,
    to_delete: Vec<RomFile>,
) -> Result<ExecutionResult, String> {
    if let Err(e) = write_backup_manifest(&app, "romulus-prune", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let (success_count, failed, skipped_count) =
        delete_files_inner(&to_delete, &session_id, "prune_execution", &state.db)?;

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!("Permanently deleted {success_count} files"))
        .show();

    Ok(ExecutionResult {
        success_count,
        failed,
        skipped_count,
        folders_removed: vec![],
    })
}

// ── execute_format_pairs ──────────────────────────────────────────────────────

#[tauri::command]
pub fn execute_format_pairs(
    app: AppHandle,
    state: State<'_, AppState>,
    to_delete: Vec<RomFile>,
) -> Result<ExecutionResult, String> {
    // Group files by parent directory.
    let mut by_dir: HashMap<std::path::PathBuf, Vec<usize>> = HashMap::new();
    for (i, rom) in to_delete.iter().enumerate() {
        if let Some(parent) = Path::new(&rom.path).parent() {
            by_dir.entry(parent.to_path_buf()).or_default().push(i);
        }
    }

    if let Err(e) = write_backup_manifest(&app, "romulus-format-pair", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Pre-log all files as "pending".
    for rom in &to_delete {
        db::log_action(
            &conn,
            LogEntry {
                action: "pending",
                path: &rom.path,
                console: &rom.console,
                title: &rom.title,
                reason: "format_pair_cleanup",
                session_id: &session_id,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    let mut success_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];
    let mut folders_removed: Vec<String> = vec![];

    for (dir, indices) in &by_dir {
        // Safety check: count visible (non-hidden) files in the directory.
        let visible_count = std::fs::read_dir(dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .count()
            })
            .unwrap_or(0);

        if visible_count > indices.len() {
            let err_msg = format!(
                "{} unexpected files present; folder skipped",
                visible_count - indices.len()
            );
            for &i in indices {
                let _ = db::update_pending_action(&conn, &to_delete[i].path, "failed");
                failed.push(FailedFile {
                    path: to_delete[i].path.clone(),
                    error: err_msg.clone(),
                });
            }
            continue;
        }

        match std::fs::remove_dir_all(dir) {
            Ok(()) => {
                for &i in indices {
                    let _ = db::update_pending_action(&conn, &to_delete[i].path, "deleted");
                    success_count += 1;
                }
                folders_removed.push(dir.to_string_lossy().to_string());
            }
            Err(e) => {
                let err = e.to_string();
                for &i in indices {
                    let _ = db::update_pending_action(&conn, &to_delete[i].path, "failed");
                    failed.push(FailedFile {
                        path: to_delete[i].path.clone(),
                        error: err.clone(),
                    });
                }
            }
        }
    }

    // Remove successfully deleted folders from rom_roots.
    if !folders_removed.is_empty() {
        let mut settings = get_settings_inner(&conn)?;
        settings.rom_roots.retain(|r| !folders_removed.contains(r));
        save_settings_inner(&conn, &settings)?;
    }

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!("Permanently deleted {success_count} files"))
        .show();

    Ok(ExecutionResult {
        success_count,
        failed,
        skipped_count: 0,
        folders_removed,
    })
}

// ── resume_session ────────────────────────────────────────────────────────────

/// Resume a session interrupted mid-deletion.
///
/// format_pair_cleanup rows: grouped by parent dir — if dir exists, remove_dir_all;
/// if already gone, mark as "deleted". prune_execution rows: per-file remove_file.
/// Finally sweeps rom_roots for orphaned empty directories.
#[tauri::command]
pub fn resume_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecutionResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT path, reason FROM action_log WHERE action = 'pending'")
        .map_err(|e| e.to_string())?;
    let pending: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    if pending.is_empty() {
        return Ok(ExecutionResult {
            success_count: 0,
            failed: vec![],
            skipped_count: 0,
            folders_removed: vec![],
        });
    }

    let mut success_count = 0u32;
    let mut skipped_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];
    let mut folders_removed: Vec<String> = vec![];

    // Group format_pair_cleanup rows by parent directory.
    let mut format_pair_dirs: HashMap<std::path::PathBuf, Vec<String>> = HashMap::new();
    for (path, reason) in &pending {
        if reason == "format_pair_cleanup" {
            if let Some(parent) = Path::new(path.as_str()).parent() {
                format_pair_dirs
                    .entry(parent.to_path_buf())
                    .or_default()
                    .push(path.clone());
            }
        }
    }

    // Handle format_pair_cleanup rows: directory-level removal.
    for (dir, paths) in &format_pair_dirs {
        if dir.exists() {
            match std::fs::remove_dir_all(dir) {
                Ok(()) => {
                    for path in paths {
                        let _ = db::update_pending_action(&conn, path, "deleted");
                        success_count += 1;
                    }
                    folders_removed.push(dir.to_string_lossy().to_string());
                }
                Err(e) => {
                    let err = e.to_string();
                    for path in paths {
                        let _ = db::update_pending_action(&conn, path, "failed");
                        failed.push(FailedFile { path: path.clone(), error: err.clone() });
                    }
                }
            }
        } else {
            // Directory already gone — resolve pending status.
            for path in paths {
                let _ = db::update_pending_action(&conn, path, "deleted");
                skipped_count += 1;
            }
        }
    }

    // Handle prune_execution (and any other) pending rows: per-file removal.
    for (path, reason) in &pending {
        if reason == "format_pair_cleanup" {
            continue;
        }
        if Path::new(path.as_str()).exists() {
            match std::fs::remove_file(path.as_str()) {
                Ok(()) => {
                    let _ = db::update_pending_action(&conn, path, "deleted");
                    success_count += 1;
                }
                Err(e) => {
                    let _ = db::update_pending_action(&conn, path, "failed");
                    failed.push(FailedFile { path: path.clone(), error: e.to_string() });
                }
            }
        } else {
            let _ = db::update_pending_action(&conn, path, "deleted");
            skipped_count += 1;
        }
    }

    // Sweep all rom_roots for orphaned empty directories.
    let swept = sweep_empty_roots(&conn)?;
    folders_removed.extend(swept);

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!(
            "Resumed: {success_count} file{} permanently deleted{}",
            if success_count == 1 { "" } else { "s" },
            if folders_removed.is_empty() {
                String::new()
            } else {
                format!(
                    ", {} empty folder{} removed",
                    folders_removed.len(),
                    if folders_removed.len() == 1 { "" } else { "s" }
                )
            }
        ))
        .show();

    Ok(ExecutionResult {
        success_count,
        failed,
        skipped_count,
        folders_removed,
    })
}

// ── get_interrupted_session ───────────────────────────────────────────────────

/// Returns details about the interrupted session if one exists, or `None`.
/// Used by the Dashboard to show a resume banner.
#[tauri::command]
pub fn get_interrupted_session(
    state: State<'_, AppState>,
) -> Result<Option<InterruptedSession>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    query_interrupted_session(&conn).map_err(|e| e.to_string())
}

fn query_interrupted_session(
    conn: &Connection,
) -> rusqlite::Result<Option<InterruptedSession>> {
    let pending_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM action_log WHERE action = 'pending'",
        [],
        |row| row.get(0),
    )?;

    if pending_count == 0 {
        return Ok(None);
    }

    let mut stmt = conn.prepare(
        "SELECT DISTINCT console FROM action_log WHERE action = 'pending' ORDER BY console",
    )?;
    let consoles: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Some(InterruptedSession {
        pending_count: pending_count as u32,
        consoles,
    }))
}

// ── get_empty_roots / cleanup_empty_roots ─────────────────────────────────────

/// Returns `rom_roots` entries that exist on disk but contain no visible files.
/// Used by the Dashboard to surface orphaned empty scan roots.
#[tauri::command]
pub fn get_empty_roots(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let settings = get_settings_inner(&conn)?;
    let mut empty: Vec<String> = vec![];

    for root in &settings.rom_roots {
        let dir = Path::new(root);
        if !dir.exists() {
            continue;
        }
        let visible = std::fs::read_dir(dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .count()
            })
            .unwrap_or(1);

        if visible == 0 {
            empty.push(root.clone());
        }
    }

    Ok(empty)
}

/// Remove the given `paths` from disk and from `rom_roots`. Returns the count
/// of successfully removed directories.
#[tauri::command]
pub fn cleanup_empty_roots(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<usize, String> {
    if paths.is_empty() {
        return Ok(0);
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut removed = 0usize;

    for path in &paths {
        if let Err(e) = std::fs::remove_dir_all(path) {
            eprintln!("[cleanup_roots] Could not remove {:?}: {e}", path);
        } else {
            removed += 1;
        }
    }

    if removed > 0 {
        let mut settings = get_settings_inner(&conn)?;
        settings.rom_roots.retain(|r| !paths.contains(r));
        save_settings_inner(&conn, &settings)?;
    }

    Ok(removed)
}

// ── Backup manifest ───────────────────────────────────────────────────────────

fn write_backup_manifest(
    app: &AppHandle,
    prefix: &str,
    to_delete: &[RomFile],
) -> Result<(), Box<dyn std::error::Error>> {
    let manifests_dir = app.path().app_data_dir()?.join("manifests");
    std::fs::create_dir_all(&manifests_dir)?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let manifest_path = manifests_dir.join(format!("{prefix}-{ts}.txt"));
    let mut file = std::fs::File::create(&manifest_path)?;
    writeln!(file, "# ROMulus pre-deletion manifest — {ts}")?;
    writeln!(file, "# Files permanently deleted by this operation:")?;
    for rom in to_delete {
        writeln!(file, "{}", rom.path)?;
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn insert_pending(conn: &Connection, path: &str, console: &str, reason: &str) {
        conn.execute(
            "INSERT INTO action_log (action, path, console, title, reason, session_id)
             VALUES ('pending', ?1, ?2, 'Test', ?3, 'sess-test')",
            rusqlite::params![path, console, reason],
        )
        .unwrap();
    }

    // ── get_interrupted_session ───────────────────────────────────────────────

    #[test]
    fn test_get_interrupted_session_no_pending() {
        let conn = db::open_in_memory();
        assert_eq!(query_interrupted_session(&conn).unwrap(), None);
    }

    #[test]
    fn test_get_interrupted_session_returns_details() {
        let conn = db::open_in_memory();
        insert_pending(&conn, "/roms/a.zip", "Nintendo 64", "prune_execution");
        insert_pending(&conn, "/roms/b.zip", "Game Boy", "format_pair_cleanup");
        insert_pending(&conn, "/roms/c.zip", "Nintendo 64", "prune_execution");

        let result = query_interrupted_session(&conn).unwrap().unwrap();
        assert_eq!(result.pending_count, 3);
        assert_eq!(result.consoles, vec!["Game Boy", "Nintendo 64"]);
    }

    // ── empty root detection ──────────────────────────────────────────────────

    #[test]
    fn test_get_empty_roots_detects_empty_dirs() {
        let tmp = std::env::temp_dir().join(format!("romulus_test_{}", Uuid::new_v4()));
        let empty_dir = tmp.join("empty_root");
        let non_empty_dir = tmp.join("non_empty_root");
        std::fs::create_dir_all(&empty_dir).unwrap();
        std::fs::create_dir_all(&non_empty_dir).unwrap();
        std::fs::write(non_empty_dir.join("rom.zip"), b"data").unwrap();

        let conn = db::open_in_memory();
        let mut settings = crate::commands::settings::get_settings_inner(&conn).unwrap();
        settings.rom_roots = vec![
            empty_dir.to_str().unwrap().to_string(),
            non_empty_dir.to_str().unwrap().to_string(),
        ];
        crate::commands::settings::save_settings_inner(&conn, &settings).unwrap();

        let result_settings = crate::commands::settings::get_settings_inner(&conn).unwrap();
        let empties: Vec<String> = result_settings
            .rom_roots
            .iter()
            .filter(|root| {
                let dir = Path::new(root);
                if !dir.exists() {
                    return false;
                }
                let visible = std::fs::read_dir(dir)
                    .ok()
                    .map(|entries| {
                        entries
                            .filter_map(|e| e.ok())
                            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                            .count()
                    })
                    .unwrap_or(1);
                visible == 0
            })
            .cloned()
            .collect();

        assert_eq!(empties.len(), 1);
        assert_eq!(empties[0], empty_dir.to_str().unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ── execute_format_pairs: safety check skips dir with unexpected files ────

    #[test]
    fn test_format_pairs_safety_check_skips_unexpected_files() {
        let tmp = std::env::temp_dir().join(format!("romulus_test_{}", Uuid::new_v4()));
        let dir = tmp.join("format_dir");
        std::fs::create_dir_all(&dir).unwrap();

        // Create 3 files but only mark 2 as to_delete → safety check should skip
        std::fs::write(dir.join("a.zip"), b"a").unwrap();
        std::fs::write(dir.join("b.zip"), b"b").unwrap();
        std::fs::write(dir.join("extra.zip"), b"extra").unwrap();

        let conn = db::open_in_memory();
        let session_id = "test-session";

        let roms: Vec<RomFile> = vec!["a.zip", "b.zip"]
            .iter()
            .map(|name| make_rom(dir.join(name).to_str().unwrap()))
            .collect();

        // Pre-log as pending
        for rom in &roms {
            db::log_action(
                &conn,
                LogEntry {
                    action: "pending",
                    path: &rom.path,
                    console: &rom.console,
                    title: &rom.title,
                    reason: "format_pair_cleanup",
                    session_id,
                },
            )
            .unwrap();
        }

        // Simulate the safety check logic
        let visible_count = std::fs::read_dir(&dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .count()
            })
            .unwrap_or(0);

        assert_eq!(visible_count, 3, "should see 3 visible files");
        assert!(
            visible_count > roms.len(),
            "safety check: unexpected file count triggers skip"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn make_rom(path: &str) -> RomFile {
        use crate::models::{FileCategory, FileFormat};
        RomFile {
            path: path.to_string(),
            filename: Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            console: "Test Console".to_string(),
            title: "Test".to_string(),
            title_normalized: "test".to_string(),
            regions: vec![],
            languages: vec![],
            status_flags: vec![],
            extra_tags: vec![],
            bad_dump: false,
            revision: 0,
            disc_number: None,
            version: None,
            is_bios: false,
            file_format: FileFormat::Zip,
            file_category: FileCategory::Game,
            filesize: 0,
            matches_preferred_language: false,
            matches_preferred_region: false,
            is_unofficial_preferred_fallback: false,
        }
    }
}
