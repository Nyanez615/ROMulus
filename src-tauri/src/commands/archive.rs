use std::collections::HashSet;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::db::{self, AppState, LogEntry};
use crate::models::{
    ArchiveCollision, CompressCandidate, CompressPreview, CompressProgress, CompressionResult,
    DirSpace, ExtractCandidate, ExtractPreview, ExtractProgress, ExtractionResult, FailedFile,
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Derive a display console name (parent directory name) and title (filename
/// stem) for a path — used only for History/action_log rows, which don't need
/// the full RomFile parsing pipeline.
fn console_and_title(path: &Path) -> (String, String) {
    let console = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    (console, title)
}

/// Reports free space for each of `dirs`. Carries no "needed" comparison —
/// that depends on which candidates are actually selected, which only the
/// frontend knows and which changes live as checkboxes are toggled.
fn available_space_by_dir(dirs: &HashSet<PathBuf>) -> Vec<DirSpace> {
    let mut result = vec![];
    for dir in dirs {
        if let Ok(available) = fs4::available_space(dir) {
            result.push(DirSpace { parent_dir: dir.to_string_lossy().to_string(), available_bytes: available });
        }
    }
    result.sort_by(|a, b| a.parent_dir.cmp(&b.parent_dir));
    result
}

enum CollisionCheck {
    Proceed,
    AlreadyDone,
    Conflict,
}

/// Checks whether `target` already exists and, if so, whether it matches
/// `expected_size` — same size is treated as "already converted" (safe to
/// skip), different size is a genuine conflict (never overwritten).
fn check_collision(target: &Path, expected_size: u64) -> CollisionCheck {
    match std::fs::metadata(target) {
        Err(_) => CollisionCheck::Proceed,
        Ok(meta) if meta.len() == expected_size => CollisionCheck::AlreadyDone,
        Ok(_) => CollisionCheck::Conflict,
    }
}

enum ArchiveOutcome {
    Success,
    /// A same-name target already exists with a different size.
    Collision(String),
}

/// Like `check_collision`, but for a target that is itself a zip container
/// (the compress direction): compares `expected_size` against the *existing
/// zip's single entry's uncompressed size*, not the zip file's on-disk size
/// — a zip's own container overhead means those two never match even for
/// identical content, so comparing raw byte sizes here would be wrong.
fn check_zip_collision(target: &Path, expected_size: u64) -> CollisionCheck {
    let Ok(file) = File::open(target) else {
        return CollisionCheck::Proceed;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return CollisionCheck::Conflict;
    };
    if archive.len() != 1 {
        return CollisionCheck::Conflict;
    }
    let entry_size = archive.by_index(0).ok().map(|e| e.size());
    match entry_size {
        Some(size) if size == expected_size => CollisionCheck::AlreadyDone,
        _ => CollisionCheck::Conflict,
    }
}

/// Deletes `path`, retrying once after clearing the read-only attribute if the
/// first attempt fails. Downloaded/extracted files on Windows often carry the
/// read-only bit, which blocks a plain `remove_file` with a permission-denied
/// error that looks identical to a real lock/permission issue. This retry is
/// Windows-only: on Unix, deletability is governed by the containing
/// directory's write permission, not the file's own read-only bit, so
/// clearing it wouldn't help there — and `set_readonly(false)` would
/// incorrectly make the file world-writable on that platform.
fn remove_file_robust(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) => {
            #[cfg(windows)]
            {
                if let Ok(metadata) = std::fs::metadata(path) {
                    let mut perms = metadata.permissions();
                    if perms.readonly() {
                        // Safe here: this branch only compiles on Windows, where
                        // set_readonly(false) clears the DOS read-only attribute —
                        // it does not have the Unix world-writable side effect.
                        #[allow(clippy::permissions_set_readonly_false)]
                        perms.set_readonly(false);
                        if std::fs::set_permissions(path, perms).is_ok() {
                            return std::fs::remove_file(path);
                        }
                    }
                }
            }
            Err(e)
        }
    }
}

fn write_manifest(
    app: &AppHandle,
    prefix: &str,
    deleted_paths: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    let manifests_dir = app.path().app_data_dir()?.join("manifests");
    std::fs::create_dir_all(&manifests_dir)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let manifest_path = manifests_dir.join(format!("{prefix}-{ts}.txt"));
    let mut file = std::fs::File::create(&manifest_path)?;
    writeln!(file, "# ROMulus source-file manifest — {ts}")?;
    writeln!(file, "# Original files deleted after successful conversion:")?;
    for path in deleted_paths {
        writeln!(file, "{path}")?;
    }
    Ok(())
}

// ── Extract (zip → files) ────────────────────────────────────────────────────

#[tauri::command]
pub fn preview_extract(paths: Vec<String>) -> Result<ExtractPreview, String> {
    let mut candidates = vec![];
    let mut invalid = vec![];
    let mut total_compressed = 0u64;
    let mut total_uncompressed = 0u64;
    let mut dirs: HashSet<PathBuf> = HashSet::new();

    for path_str in &paths {
        let path = Path::new(path_str);
        let compressed_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) => {
                invalid.push(FailedFile { path: path_str.clone(), error: e.to_string() });
                continue;
            }
        };
        let mut archive = match zip::ZipArchive::new(file) {
            Ok(a) => a,
            Err(e) => {
                invalid.push(FailedFile { path: path_str.clone(), error: e.to_string() });
                continue;
            }
        };

        let entry_count = archive.len() as u32;
        let mut uncompressed_size = 0u64;
        let parent_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let mut already_extracted = entry_count > 0;
        for i in 0..archive.len() {
            match archive.by_index(i) {
                Ok(entry) => {
                    uncompressed_size += entry.size();
                    let entry_present = match entry.enclosed_name() {
                        Some(enclosed) => matches!(
                            check_collision(&parent_dir.join(enclosed), entry.size()),
                            CollisionCheck::AlreadyDone
                        ),
                        None => false,
                    };
                    if !entry_present {
                        already_extracted = false;
                    }
                }
                Err(_) => already_extracted = false,
            }
        }

        let filename = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let console = path.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let parent_dir_str = parent_dir.to_string_lossy().to_string();

        total_compressed += compressed_size;
        total_uncompressed += uncompressed_size;
        dirs.insert(parent_dir);

        candidates.push(ExtractCandidate {
            path: path_str.clone(),
            filename,
            console,
            parent_dir: parent_dir_str,
            compressed_size,
            uncompressed_size,
            entry_count,
            already_extracted,
        });
    }

    Ok(ExtractPreview {
        candidates,
        invalid,
        total_compressed_bytes: total_compressed,
        total_uncompressed_bytes: total_uncompressed,
        available_space: available_space_by_dir(&dirs),
    })
}

/// Extracts every entry of `zip_path` flat into its own parent directory
/// (never a new `<zipname>/` subfolder). Two-pass: first checks every entry
/// for a conflicting same-name/different-size target so a mid-zip failure
/// never leaves a multi-entry zip partially extracted, then writes.
fn extract_one(zip_path: &Path) -> Result<ArchiveOutcome, String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let parent = zip_path.parent().unwrap_or_else(|| Path::new("."));

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else { continue };
        let target = parent.join(enclosed);
        if let CollisionCheck::Conflict = check_collision(&target, entry.size()) {
            return Ok(ArchiveOutcome::Collision(target.to_string_lossy().to_string()));
        }
    }

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else { continue };
        let target = parent.join(enclosed);

        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let CollisionCheck::AlreadyDone = check_collision(&target, entry.size()) {
            continue;
        }
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&target).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }

    Ok(ArchiveOutcome::Success)
}

#[tauri::command]
pub async fn extract_zips(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    delete_after: bool,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let total = paths.len() as u32;

    tauri::async_runtime::spawn(async move {
        let mut success_count = 0u32;
        let mut failed: Vec<FailedFile> = vec![];
        let mut collisions: Vec<ArchiveCollision> = vec![];
        let mut deleted_count = 0u32;
        let mut deleted_paths: Vec<String> = vec![];

        for (i, path_str) in paths.iter().enumerate() {
            let path = Path::new(path_str);
            let mut ok = false;

            match extract_one(path) {
                Ok(ArchiveOutcome::Success) => {
                    ok = true;
                    if delete_after {
                        match remove_file_robust(path) {
                            Ok(()) => {
                                success_count += 1;
                                deleted_count += 1;
                                deleted_paths.push(path_str.clone());
                                if let Ok(conn) = db.lock() {
                                    let (console, title) = console_and_title(path);
                                    let _ = db::log_action(
                                        &conn,
                                        LogEntry {
                                            action: "deleted",
                                            path: path_str,
                                            console: &console,
                                            title: &title,
                                            reason: "extract_delete_source",
                                            session_id: &Uuid::new_v4().to_string(),
                                        },
                                    );
                                }
                            }
                            Err(e) => {
                                failed.push(FailedFile {
                                    path: path_str.clone(),
                                    error: format!("extracted, but couldn't delete the original zip: {e}"),
                                });
                            }
                        }
                    } else {
                        success_count += 1;
                    }
                }
                Ok(ArchiveOutcome::Collision(target_path)) => {
                    collisions.push(ArchiveCollision {
                        source_path: path_str.clone(),
                        target_path,
                        reason: "exists_different_size".to_string(),
                    });
                }
                Err(e) => {
                    failed.push(FailedFile { path: path_str.clone(), error: e });
                }
            }

            let _ = app.emit(
                "extract:progress",
                ExtractProgress { current_file: path_str.clone(), done: (i + 1) as u32, total, success: ok },
            );
        }

        if !deleted_paths.is_empty() {
            if let Err(e) = write_manifest(&app, "romulus-extract", &deleted_paths) {
                eprintln!("[archive] Could not write extract manifest: {e}");
            }
        }

        let result = ExtractionResult { success_count, failed, collisions, deleted_count, total };
        app.emit("extract:complete", &result).ok();
        let _ = app
            .notification()
            .builder()
            .title("ROMulus")
            .body(format!("Extraction complete — {success_count} of {total} files"))
            .show();
    });

    Ok(())
}

// ── Compress (file → zip) ─────────────────────────────────────────────────────

#[tauri::command]
pub fn preview_compress(paths: Vec<String>) -> Result<CompressPreview, String> {
    let mut candidates = vec![];
    let mut total_source = 0u64;
    let mut dirs: HashSet<PathBuf> = HashSet::new();

    for path_str in &paths {
        let path = Path::new(path_str);
        let source_size = match std::fs::metadata(path) {
            Ok(m) => m.len(),
            Err(_) => continue,
        };
        let filename = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let parent_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let console = parent_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let target = path.with_extension("zip");
        let already_compressed = matches!(check_zip_collision(&target, source_size), CollisionCheck::AlreadyDone);

        total_source += source_size;
        dirs.insert(parent_dir.clone());

        candidates.push(CompressCandidate {
            path: path_str.clone(),
            filename,
            console,
            parent_dir: parent_dir.to_string_lossy().to_string(),
            source_size,
            already_compressed,
        });
    }

    Ok(CompressPreview {
        candidates,
        total_source_bytes: total_source,
        available_space: available_space_by_dir(&dirs),
    })
}

/// Compresses `source_path` into a sibling `.zip` (same directory, same stem)
/// — the exact inverse of `extract_one`'s destination.
fn compress_one(source_path: &Path) -> Result<ArchiveOutcome, String> {
    let target = source_path.with_extension("zip");
    let source_size = std::fs::metadata(source_path).map_err(|e| e.to_string())?.len();

    match check_zip_collision(&target, source_size) {
        CollisionCheck::AlreadyDone => return Ok(ArchiveOutcome::Success),
        CollisionCheck::Conflict => {
            return Ok(ArchiveOutcome::Collision(target.to_string_lossy().to_string()));
        }
        CollisionCheck::Proceed => {}
    }

    let filename = source_path
        .file_name()
        .ok_or_else(|| "invalid source filename".to_string())?
        .to_string_lossy()
        .to_string();

    let mut src = File::open(source_path).map_err(|e| e.to_string())?;
    let out = File::create(&target).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(out);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file(filename, options).map_err(|e| e.to_string())?;
    io::copy(&mut src, &mut writer).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;

    Ok(ArchiveOutcome::Success)
}

#[tauri::command]
pub async fn compress_files(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    delete_after: bool,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let total = paths.len() as u32;

    tauri::async_runtime::spawn(async move {
        let mut success_count = 0u32;
        let mut failed: Vec<FailedFile> = vec![];
        let mut collisions: Vec<ArchiveCollision> = vec![];
        let mut deleted_count = 0u32;
        let mut deleted_paths: Vec<String> = vec![];

        for (i, path_str) in paths.iter().enumerate() {
            let path = Path::new(path_str);
            let mut ok = false;

            match compress_one(path) {
                Ok(ArchiveOutcome::Success) => {
                    ok = true;
                    if delete_after {
                        match remove_file_robust(path) {
                            Ok(()) => {
                                success_count += 1;
                                deleted_count += 1;
                                deleted_paths.push(path_str.clone());
                                if let Ok(conn) = db.lock() {
                                    let (console, title) = console_and_title(path);
                                    let _ = db::log_action(
                                        &conn,
                                        LogEntry {
                                            action: "deleted",
                                            path: path_str,
                                            console: &console,
                                            title: &title,
                                            reason: "compress_delete_source",
                                            session_id: &Uuid::new_v4().to_string(),
                                        },
                                    );
                                }
                            }
                            Err(e) => {
                                failed.push(FailedFile {
                                    path: path_str.clone(),
                                    error: format!("compressed, but couldn't delete the original file: {e}"),
                                });
                            }
                        }
                    } else {
                        success_count += 1;
                    }
                }
                Ok(ArchiveOutcome::Collision(target_path)) => {
                    collisions.push(ArchiveCollision {
                        source_path: path_str.clone(),
                        target_path,
                        reason: "exists_different_size".to_string(),
                    });
                }
                Err(e) => {
                    failed.push(FailedFile { path: path_str.clone(), error: e });
                }
            }

            let _ = app.emit(
                "compress:progress",
                CompressProgress { current_file: path_str.clone(), done: (i + 1) as u32, total, success: ok },
            );
        }

        if !deleted_paths.is_empty() {
            if let Err(e) = write_manifest(&app, "romulus-compress", &deleted_paths) {
                eprintln!("[archive] Could not write compress manifest: {e}");
            }
        }

        let result = CompressionResult { success_count, failed, collisions, deleted_count, total };
        app.emit("compress:complete", &result).ok();
        let _ = app
            .notification()
            .builder()
            .title("ROMulus")
            .body(format!("Compression complete — {success_count} of {total} files"))
            .show();
    });

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("romulus_archive_test_{name}_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_zip(path: &Path, entry_name: &str, contents: &[u8]) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer.start_file(entry_name, options).unwrap();
        io::Write::write_all(&mut writer, contents).unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn extract_one_places_file_flat_no_subfolder() {
        let dir = temp_dir("flat");
        let zip_path = dir.join("Game (USA).zip");
        write_zip(&zip_path, "Game (USA).3ds", b"rom-bytes");

        let outcome = extract_one(&zip_path).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Success));

        let expected = dir.join("Game (USA).3ds");
        assert!(expected.exists(), "extracted file should be a sibling of the zip");
        assert_eq!(std::fs::read(&expected).unwrap(), b"rom-bytes");

        // No subfolder named after the zip should have been created.
        assert!(!dir.join("Game (USA)").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_one_same_size_collision_is_idempotent_success() {
        let dir = temp_dir("collision_same");
        let zip_path = dir.join("Game.zip");
        write_zip(&zip_path, "Game.bin", b"12345678");
        std::fs::write(dir.join("Game.bin"), b"12345678").unwrap();

        let outcome = extract_one(&zip_path).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Success));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_one_different_size_collision_is_conflict_and_does_not_overwrite() {
        let dir = temp_dir("collision_diff");
        let zip_path = dir.join("Game.zip");
        write_zip(&zip_path, "Game.bin", b"12345678");
        std::fs::write(dir.join("Game.bin"), b"different-contents-here").unwrap();

        let outcome = extract_one(&zip_path).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Collision(_)));
        // Existing file must be untouched.
        assert_eq!(std::fs::read(dir.join("Game.bin")).unwrap(), b"different-contents-here");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compress_one_places_zip_flat_as_sibling() {
        let dir = temp_dir("compress_flat");
        let source = dir.join("Game.bin");
        std::fs::write(&source, b"rom-bytes").unwrap();

        let outcome = compress_one(&source).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Success));

        let target = dir.join("Game.zip");
        assert!(target.exists(), "compressed zip should be a sibling of the source");

        let file = File::open(&target).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 1);
        let mut entry = archive.by_index(0).unwrap();
        let mut contents = Vec::new();
        io::Read::read_to_end(&mut entry, &mut contents).unwrap();
        assert_eq!(contents, b"rom-bytes");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compress_one_same_size_existing_zip_is_idempotent_success() {
        let dir = temp_dir("compress_idempotent");
        let source = dir.join("Game.bin");
        std::fs::write(&source, b"12345678").unwrap();
        write_zip(&dir.join("Game.zip"), "Game.bin", b"12345678");

        let outcome = compress_one(&source).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Success));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn compress_one_different_size_existing_zip_is_conflict() {
        let dir = temp_dir("compress_conflict");
        let source = dir.join("Game.bin");
        std::fs::write(&source, b"12345678").unwrap();
        write_zip(&dir.join("Game.zip"), "Other.bin", b"totally-different-size-here");

        let outcome = compress_one(&source).unwrap();
        assert!(matches!(outcome, ArchiveOutcome::Collision(_)));

        std::fs::remove_dir_all(&dir).ok();
    }
}
