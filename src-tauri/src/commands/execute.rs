use std::collections::HashSet;
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
use crate::models::{DeleteMode, ExecutionResult, FailedFile, RomFile};

// ── Shared deletion helper ────────────────────────────────────────────────────

/// Delete a list of files and record each action in the log.
/// Returns (success_count, failed_files, skipped_count).
fn delete_files_inner(
    files: &[RomFile],
    mode: &DeleteMode,
    session_id: &str,
    reason: &str,
    db_conn: &Arc<Mutex<Connection>>,
) -> Result<(u32, Vec<FailedFile>, u32), String> {
    let conn = db_conn.lock().map_err(|e| e.to_string())?;
    let mut success_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];
    let mut skipped_count = 0u32;

    for rom in files {
        let path = Path::new(&rom.path);

        if !path.exists() {
            skipped_count += 1;
            continue;
        }

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

        let result = match mode {
            DeleteMode::Trash => trash::delete(path).map_err(|e| e.to_string()),
            DeleteMode::Permanent => std::fs::remove_file(path).map_err(|e| e.to_string()),
        };

        match result {
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
                    error: e,
                });
            }
        }
    }

    Ok((success_count, failed, skipped_count))
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
    // Check OneDrive acknowledgment for cloud-synced paths
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

    // Write a pre-prune backup manifest to the Desktop before touching any file
    if let Err(e) = write_backup_manifest(&app, "romulus-prune", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let (success_count, failed, skipped_count) =
        delete_files_inner(&to_delete, &mode, &session_id, "prune_execution", &state.db)?;

    // OS notification: deletion complete
    let _ = app.notification().builder()
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

/// Execute format-pair cleanup: delete all files in the non-preferred format folder,
/// then remove any source directories that are now empty and clean them from rom_roots.
#[tauri::command]
pub fn execute_format_pairs(
    app: AppHandle,
    state: State<'_, AppState>,
    to_delete: Vec<RomFile>,
    mode: DeleteMode,
) -> Result<ExecutionResult, String> {
    // Collect the unique parent directories of files being deleted — we'll check
    // them for emptiness after deletion.
    let source_dirs: HashSet<std::path::PathBuf> = to_delete
        .iter()
        .filter_map(|r| Path::new(&r.path).parent().map(|p| p.to_path_buf()))
        .collect();

    // Write backup manifest before touching anything
    if let Err(e) = write_backup_manifest(&app, "romulus-format-pair", &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let (success_count, failed, skipped_count) =
        delete_files_inner(&to_delete, &mode, &session_id, "format_pair_cleanup", &state.db)?;

    // ── Empty folder cleanup ──────────────────────────────────────────────────
    let mut folders_removed: Vec<String> = vec![];

    for dir in &source_dirs {
        // Count visible (non-hidden) files remaining in the directory.
        let visible_count = std::fs::read_dir(dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .count()
            })
            .unwrap_or(1); // if we can't read, assume non-empty

        if visible_count == 0 {
            // Directory is empty (or contains only hidden files like .DS_Store).
            if let Err(e) = std::fs::remove_dir_all(dir) {
                eprintln!("[cleanup] Could not remove dir {:?}: {e}", dir);
            } else {
                folders_removed.push(dir.to_string_lossy().to_string());
            }
        }
    }

    // ── Remove deleted folders from rom_roots ─────────────────────────────────
    if !folders_removed.is_empty() {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut settings = get_settings_inner(&conn)?;
        settings.rom_roots.retain(|r| !folders_removed.contains(r));
        save_settings_inner(&conn, &settings)?;
    }

    // OS notification
    let _ = app.notification().builder()
        .title("ROMulus")
        .body(format!(
            "Format pair cleanup: removed {success_count} files{}",
            if folders_removed.is_empty() {
                String::new()
            } else {
                format!(", {} folder{} deleted", folders_removed.len(),
                    if folders_removed.len() == 1 { "" } else { "s" })
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

/// Writes a human-readable .txt manifest of all files about to be deleted
/// to the user's Desktop. Non-fatal — execution continues even if this fails.
fn write_backup_manifest(app: &AppHandle, prefix: &str, to_delete: &[RomFile]) -> Result<(), Box<dyn std::error::Error>> {
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

/// Returns true if the previous session was interrupted mid-execution.
#[tauri::command]
pub fn get_interrupted_session(state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::has_pending_actions(&conn).map_err(|e| e.to_string())
}
