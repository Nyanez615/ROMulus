use std::collections::{HashMap, HashSet};
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
use crate::models::{DeleteMode, ExecutionResult, FailedFile, InterruptedSession, RomFile};

// ── Staging-dir trash helper ──────────────────────────────────────────────────

/// Move all `paths` into per-parent staging directories, then trash each staging
/// dir with one OS call → one Finder sound per unique parent (typically one).
///
/// Falls back to a direct `trash::delete` for any file whose `fs::rename` fails
/// (e.g. a file locked by OneDrive sync). Updates action_log rows from
/// `"pending"` → `"moved_to_trash"` or `"failed"` for every path.
fn trash_via_staging(
    paths: &[&str],
    conn: &Connection,
) -> Result<(u32, Vec<FailedFile>), String> {
    // Group paths by their parent directory.
    let mut by_parent: HashMap<std::path::PathBuf, Vec<&str>> = HashMap::new();
    for &path in paths {
        if let Some(parent) = Path::new(path).parent() {
            by_parent.entry(parent.to_path_buf()).or_default().push(path);
        }
    }

    let mut success_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];

    for (parent_dir, group) in &by_parent {
        // Use a short UUID suffix to avoid collisions with pre-existing staging dirs.
        let uid = &Uuid::new_v4().to_string()[..8];
        let staging_dir =
            parent_dir.join(format!("ROMulus Cleanup ({} files) {}", group.len(), uid));

        // If staging dir creation fails, fall back to per-file trash for this group.
        if std::fs::create_dir(&staging_dir).is_err() {
            for &path in group {
                trash_single(path, conn, &mut success_count, &mut failed);
            }
            continue;
        }

        // Rename each file into the staging dir (same-volume → atomic, instant).
        let mut staged: Vec<&str> = vec![];
        let mut rename_failed: Vec<&str> = vec![];

        for &path in group {
            let src = Path::new(path);
            let filename = src.file_name().unwrap_or_default();
            let dst = staging_dir.join(filename);
            if std::fs::rename(src, &dst).is_ok() {
                staged.push(path);
            } else {
                rename_failed.push(path);
            }
        }

        // Trash the staging dir — one OS call covers all staged files.
        if !staged.is_empty() {
            match trash::delete(&staging_dir) {
                Ok(()) => {
                    for &path in &staged {
                        let _ = db::update_pending_action(conn, path, "moved_to_trash");
                        success_count += 1;
                    }
                }
                Err(e) => {
                    // Staging dir trash failed; files are in the staging dir, not at
                    // their original paths. Mark all as failed.
                    let err = e.to_string();
                    eprintln!("[staging] trash staging dir failed: {err}");
                    for &path in &staged {
                        let _ = db::update_pending_action(conn, path, "failed");
                        failed.push(FailedFile { path: path.to_string(), error: err.clone() });
                    }
                }
            }
        }

        // Fall back to per-file trash for files that couldn't be renamed.
        for &path in &rename_failed {
            trash_single(path, conn, &mut success_count, &mut failed);
        }
    }

    Ok((success_count, failed))
}

/// Trash a single file directly (fallback for locked / cross-volume files).
fn trash_single(
    path: &str,
    conn: &Connection,
    success_count: &mut u32,
    failed: &mut Vec<FailedFile>,
) {
    match trash::delete(Path::new(path)) {
        Ok(()) => {
            let _ = db::update_pending_action(conn, path, "moved_to_trash");
            *success_count += 1;
        }
        Err(e) => {
            let _ = db::update_pending_action(conn, path, "failed");
            failed.push(FailedFile { path: path.to_string(), error: e.to_string() });
        }
    }
}

// ── Shared deletion helper ────────────────────────────────────────────────────

/// Delete a list of files and record each action in the log.
///
/// Trash mode: pre-logs all files as "pending", then uses staging dirs so the
/// entire batch produces one Finder sound per unique parent directory.
/// Permanent mode: pre-logs all as "pending", then deletes sequentially.
///
/// Returns `(success_count, failed_files, skipped_count)`.
fn delete_files_inner(
    files: &[RomFile],
    mode: &DeleteMode,
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

    // Pre-log ALL files as "pending" before any filesystem operation.
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

    match mode {
        DeleteMode::Trash => {
            let paths: Vec<&str> = to_process.iter().map(|r| r.path.as_str()).collect();
            let (success_count, failed) = trash_via_staging(&paths, &conn)?;
            Ok((success_count, failed, skipped_count))
        }
        DeleteMode::Permanent => {
            let mut success_count = 0u32;
            let mut failed: Vec<FailedFile> = vec![];
            for rom in &to_process {
                match std::fs::remove_file(&rom.path) {
                    Ok(()) => {
                        db::update_pending_action(&conn, &rom.path, "moved_to_trash")
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
    }
}

// ── Folder-cleanup helper ─────────────────────────────────────────────────────

/// For each directory in `source_dirs`: if it contains no visible (non-hidden)
/// entries, remove it with `remove_dir_all` and remove it from `rom_roots`.
fn cleanup_empty_source_dirs(
    source_dirs: &HashSet<std::path::PathBuf>,
    conn: &Connection,
) -> Result<Vec<String>, String> {
    let mut removed: Vec<String> = vec![];

    for dir in source_dirs {
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
                eprintln!("[cleanup] Could not remove dir {:?}: {e}", dir);
            } else {
                removed.push(dir.to_string_lossy().to_string());
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
    mode: DeleteMode,
    onedrive_acknowledged: bool,
) -> Result<ExecutionResult, String> {
    if !onedrive_acknowledged {
        let has_onedrive = to_delete
            .iter()
            .any(|r| r.path.contains("CloudStorage") || r.path.contains("OneDrive"));
        if has_onedrive {
            return Err(
                "OneDrive paths detected. Acknowledge the cloud sync warning before proceeding."
                    .into(),
            );
        }
    }

    if let Err(e) = write_backup_manifest(&app, "romulus-prune", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let (success_count, failed, skipped_count) =
        delete_files_inner(&to_delete, &mode, &session_id, "prune_execution", &state.db)?;

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!("Moved {success_count} files to Trash"))
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
    mode: DeleteMode,
) -> Result<ExecutionResult, String> {
    let source_dirs: HashSet<std::path::PathBuf> = to_delete
        .iter()
        .filter_map(|r| Path::new(&r.path).parent().map(|p| p.to_path_buf()))
        .collect();

    if let Err(e) = write_backup_manifest(&app, "romulus-format-pair", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let (success_count, failed, skipped_count) =
        delete_files_inner(&to_delete, &mode, &session_id, "format_pair_cleanup", &state.db)?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let folders_removed = cleanup_empty_source_dirs(&source_dirs, &conn)?;

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!(
            "Format pair cleanup: removed {success_count} files{}",
            if folders_removed.is_empty() {
                String::new()
            } else {
                format!(
                    ", {} folder{} deleted",
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

// ── resume_session ────────────────────────────────────────────────────────────

/// Resume a session that was interrupted mid-deletion.
///
/// Reads all `"pending"` rows from `action_log` and re-attempts deletion via
/// the staging-dir approach. For `format_pair_cleanup` items, also runs the
/// empty-folder cleanup on affected parent directories. Finally sweeps all
/// `rom_roots` for orphaned empty directories (e.g. a format folder whose
/// files were all deleted in the interrupted run but whose directory was never
/// removed).
#[tauri::command]
pub fn resume_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecutionResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Collect all pending rows: (path, reason).
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

    // Collect parent dirs of format_pair_cleanup entries before any deletion.
    let format_pair_source_dirs: HashSet<std::path::PathBuf> = pending
        .iter()
        .filter(|(_, reason)| reason == "format_pair_cleanup")
        .filter_map(|(path, _)| Path::new(path.as_str()).parent().map(|d| d.to_path_buf()))
        .collect();

    // Split into files that still exist vs. already gone.
    let mut skipped_count = 0u32;
    let mut to_trash: Vec<&str> = vec![];
    for (path, _) in &pending {
        if Path::new(path.as_str()).exists() {
            to_trash.push(path.as_str());
        } else {
            // Already deleted in a prior run — just resolve the pending status.
            let _ = db::update_pending_action(&conn, path, "moved_to_trash");
            skipped_count += 1;
        }
    }

    let (success_count, failed) = if to_trash.is_empty() {
        (0, vec![])
    } else {
        trash_via_staging(&to_trash, &conn)?
    };

    // Folder cleanup for format_pair_cleanup items.
    let mut folders_removed = cleanup_empty_source_dirs(&format_pair_source_dirs, &conn)?;

    // Sweep all rom_roots for orphaned empty directories (handles the case where
    // file deletion completed but folder cleanup was never reached).
    let swept = sweep_empty_roots(&conn)?;
    folders_removed.extend(swept);

    let _ = app
        .notification()
        .builder()
        .title("ROMulus")
        .body(format!(
            "Resumed: {success_count} file{} moved to Trash{}",
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
    let desktop = app.path().desktop_dir()?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let manifest_path = desktop.join(format!("{prefix}-{ts}.txt"));
    let mut file = std::fs::File::create(&manifest_path)?;
    writeln!(file, "# ROMulus pre-deletion manifest — {ts}")?;
    writeln!(file, "# Files moved to Trash or deleted by this operation:")?;
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

    // ── Helper: insert a pending action_log row ───────────────────────────────

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
        // Consoles are distinct and alphabetically sorted.
        assert_eq!(result.consoles, vec!["Game Boy", "Nintendo 64"]);
    }

    // ── staging dir — file grouping and rename ────────────────────────────────

    #[test]
    fn test_staging_dir_created_per_parent() {
        let tmp = std::env::temp_dir().join(format!("romulus_test_{}", Uuid::new_v4()));
        let dir_a = tmp.join("dir_a");
        let dir_b = tmp.join("dir_b");
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::create_dir_all(&dir_b).unwrap();

        // Create dummy files.
        let file_a1 = dir_a.join("rom_a1.zip");
        let file_a2 = dir_a.join("rom_a2.zip");
        let file_b1 = dir_b.join("rom_b1.zip");
        std::fs::write(&file_a1, b"a1").unwrap();
        std::fs::write(&file_a2, b"a2").unwrap();
        std::fs::write(&file_b1, b"b1").unwrap();

        // Group paths by parent (mirrors the internal grouping in trash_via_staging).
        let paths = [
            file_a1.to_str().unwrap(),
            file_a2.to_str().unwrap(),
            file_b1.to_str().unwrap(),
        ];
        let mut by_parent: HashMap<std::path::PathBuf, Vec<&str>> = HashMap::new();
        for &path in &paths {
            if let Some(parent) = Path::new(path).parent() {
                by_parent.entry(parent.to_path_buf()).or_default().push(path);
            }
        }

        // Verify we get exactly two parent groups.
        assert_eq!(by_parent.len(), 2);

        // For each group, create a staging dir and rename files into it.
        let mut staging_dirs: Vec<std::path::PathBuf> = vec![];
        for (parent, group) in &by_parent {
            let uid = &Uuid::new_v4().to_string()[..8];
            let staging_dir = parent.join(format!("ROMulus Cleanup ({} files) {}", group.len(), uid));
            std::fs::create_dir(&staging_dir).unwrap();

            for &path in group {
                let filename = Path::new(path).file_name().unwrap();
                std::fs::rename(path, staging_dir.join(filename)).unwrap();
            }

            // Files should now be inside the staging dir.
            let entries: Vec<_> = std::fs::read_dir(&staging_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .collect();
            assert_eq!(entries.len(), group.len(), "staging dir should contain exactly the group's files");

            staging_dirs.push(staging_dir);
        }

        // Cleanup: remove the whole tmp tree.
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ── empty root detection ──────────────────────────────────────────────────

    #[test]
    fn test_get_empty_roots_detects_empty_dirs() {
        let tmp = std::env::temp_dir().join(format!("romulus_test_{}", Uuid::new_v4()));
        let empty_dir = tmp.join("empty_root");
        let non_empty_dir = tmp.join("non_empty_root");
        std::fs::create_dir_all(&empty_dir).unwrap();
        std::fs::create_dir_all(&non_empty_dir).unwrap();
        // Put a visible file in non_empty_dir.
        std::fs::write(non_empty_dir.join("rom.zip"), b"data").unwrap();

        // Set both as rom_roots in an in-memory DB.
        let conn = db::open_in_memory();
        let mut settings = crate::commands::settings::get_settings_inner(&conn).unwrap();
        settings.rom_roots = vec![
            empty_dir.to_str().unwrap().to_string(),
            non_empty_dir.to_str().unwrap().to_string(),
        ];
        crate::commands::settings::save_settings_inner(&conn, &settings).unwrap();

        // Simulate get_empty_roots logic.
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

    // ── resume: folder cleanup only for format_pair_cleanup reason ────────────

    #[test]
    fn test_resume_folder_cleanup_only_for_format_pairs() {
        let tmp = std::env::temp_dir().join(format!("romulus_test_{}", Uuid::new_v4()));
        let format_dir = tmp.join("format_pair_dir");
        let prune_dir = tmp.join("prune_dir");
        std::fs::create_dir_all(&format_dir).unwrap();
        std::fs::create_dir_all(&prune_dir).unwrap();

        // format_pair_dir → empty (simulates post-deletion state).
        // prune_dir → still has a file (regular prune should NOT touch the folder).
        std::fs::write(prune_dir.join("remaining.zip"), b"keep").unwrap();

        let conn = db::open_in_memory();
        let mut settings = crate::commands::settings::get_settings_inner(&conn).unwrap();
        settings.rom_roots = vec![
            format_dir.to_str().unwrap().to_string(),
            prune_dir.to_str().unwrap().to_string(),
        ];
        crate::commands::settings::save_settings_inner(&conn, &settings).unwrap();

        // Run cleanup on only the format_pair source dirs.
        let format_pair_dirs: HashSet<std::path::PathBuf> =
            [format_dir.clone()].into_iter().collect();
        let removed = cleanup_empty_source_dirs(&format_pair_dirs, &conn).unwrap();

        assert_eq!(removed.len(), 1, "only the empty format_pair dir should be removed");
        assert!(!format_dir.exists(), "empty format_pair dir should be gone");
        assert!(prune_dir.exists(), "non-empty prune dir should remain untouched");

        // Verify rom_roots was updated.
        let updated = crate::commands::settings::get_settings_inner(&conn).unwrap();
        assert!(!updated.rom_roots.contains(&format_dir.to_str().unwrap().to_string()));
        assert!(updated.rom_roots.contains(&prune_dir.to_str().unwrap().to_string()));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
