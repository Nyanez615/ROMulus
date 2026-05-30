use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::db::{self, AppState, LogEntry};
use crate::models::{DeleteMode, ExecutionResult, FailedFile, RomFile};

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
    if let Err(e) = write_backup_manifest(&app, &to_delete) {
        eprintln!("[backup] Could not write manifest: {e}");
    }

    let session_id = Uuid::new_v4().to_string();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut success_count = 0u32;
    let mut failed: Vec<FailedFile> = vec![];
    let mut skipped_count = 0u32;

    for rom in &to_delete {
        let path = Path::new(&rom.path);

        // Safety: skip if file disappeared (e.g., OneDrive removed it)
        if !path.exists() {
            skipped_count += 1;
            continue;
        }

        // Log as pending before touching the file (crash recovery)
        db::log_action(
            &conn,
            LogEntry {
                action: "pending",
                path: &rom.path,
                console: &rom.console,
                title: &rom.title,
                reason: "prune_execution",
                session_id: &session_id,
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

    // OS notification: deletion complete
    let _ = app.notification().builder()
        .title("ROMulus")
        .body(format!("Moved {success_count} files to Trash"))
        .show();

    Ok(ExecutionResult {
        success_count,
        failed,
        skipped_count,
    })
}

/// Writes a human-readable .txt manifest of all files about to be deleted
/// to the user's Desktop. Non-fatal — execution continues even if this fails.
fn write_backup_manifest(app: &AppHandle, to_delete: &[RomFile]) -> Result<(), Box<dyn std::error::Error>> {
    let desktop = app.path().desktop_dir()?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let manifest_path = desktop.join(format!("romulus-prune-{ts}.txt"));
    let mut file = std::fs::File::create(&manifest_path)?;
    writeln!(file, "# ROMulus pre-prune manifest — {ts}")?;
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
