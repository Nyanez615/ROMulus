use std::path::Path;
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::commands::group::group_roms;
use crate::db::AppState;
use crate::deduper::{detect_format_pairs, mark_format_pairs};
use crate::models::FormatPair;
use tauri_plugin_notification::NotificationExt;
use crate::models::{ConsoleStats, RomFile, ScanProgress, ScanStatus};
use crate::parser;

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_scan_status(state: State<'_, AppState>) -> ScanStatus {
    state.scan_cache.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn get_consoles(state: State<'_, AppState>) -> Vec<ConsoleStats> {
    let cache = state.scan_cache.lock().unwrap();
    compute_console_stats(&cache.roms)
}

#[tauri::command]
pub async fn scan_roots(
    app: AppHandle,
    state: State<'_, AppState>,
    roots: Vec<String>,
) -> Result<ScanStatus, String> {
    // Mark as scanning
    {
        let mut cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
        cache.status.scanning = true;
        cache.status.scanned = 0;
        cache.status.cached = false;
    }

    let roms = scan_all_roots(&app, &roots, &state)?;
    let total = roms.len() as u32;

    // Load preferences from DB to score variants
    let prefs = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        load_preferences(&conn)?
    };

    // Group + score variants, detect format pairs
    let mut groups = group_roms(roms.clone(), &prefs);
    let format_pairs = detect_format_pairs(&roms);
    mark_format_pairs(&mut groups, &format_pairs);

    let mut cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
    cache.roms = roms;
    cache.groups = groups;
    cache.status = ScanStatus {
        scanning: false,
        scanned: total,
        total_estimate: total,
        current_console: None,
        cached: false,
    };

    let final_status = cache.status.clone();
    drop(cache); // release scan_cache lock before acquiring watcher lock

    // Store the watcher in AppState so the OS handle stays alive.
    // Replacing on each rescan stops the previous watcher automatically.
    match crate::watcher::start(app.clone(), &roots) {
        Ok(w) => {
            if let Ok(mut guard) = state.watcher.lock() {
                *guard = Some(w);
            }
        }
        Err(e) => eprintln!("[watcher] Failed to start: {e}"),
    }

    // OS notification: scan complete
    let console_count = {
        let cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
        cache.groups.iter().map(|g| &g.console).collect::<std::collections::HashSet<_>>().len()
    };
    let _ = app.notification().builder()
        .title("ROMulus")
        .body(format!("Scan complete — {total} ROMs across {console_count} consoles"))
        .show();

    Ok(final_status)
}

/// Return all detected format pairs from the current scan cache.
#[tauri::command]
pub fn get_format_pairs(state: State<'_, AppState>) -> Vec<FormatPair> {
    let cache = state.scan_cache.lock().unwrap();
    detect_format_pairs(&cache.roms)
}

// ── Preferences loader ────────────────────────────────────────────────────────

pub fn load_preferences(conn: &rusqlite::Connection) -> Result<crate::models::UserPreferences, String> {
    use crate::db::get_setting;
    let langs: Vec<String> = get_setting(conn, "preferred_languages")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    let regions: Vec<String> = get_setting(conn, "preferred_regions")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    Ok(crate::models::UserPreferences { preferred_languages: langs, preferred_regions: regions })
}

// ── Scanner implementation ────────────────────────────────────────────────────

fn scan_all_roots(
    app: &AppHandle,
    roots: &[String],
    state: &State<'_, AppState>,
) -> Result<Vec<RomFile>, String> {
    let mut all_roms: Vec<RomFile> = vec![];
    let mut seen_consoles: std::collections::HashSet<String> = std::collections::HashSet::new();

    for root in roots {
        let root_path = Path::new(root);
        if !root_path.exists() {
            continue;
        }

        // Recursive walk: console name = immediate parent dir of each file.
        // This handles any nesting depth below the root.
        for entry in WalkDir::new(root_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let path = entry.path();

            // Skip files sitting directly in the root — they're not in a console folder.
            let parent = match path.parent() {
                Some(p) => p,
                None => continue,
            };
            if parent == root_path {
                continue;
            }

            let console_name = match parent.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            // Skip zero-byte OneDrive placeholder files
            if meta.len() == 0 {
                continue;
            }

            // Emit progress the first time a console is encountered
            if seen_consoles.insert(console_name.clone()) {
                let _ = app.emit(
                    "scan:progress",
                    ScanProgress {
                        console: console_name.clone(),
                        scanned: all_roms.len() as u32,
                        total: 0,
                    },
                );
                if let Ok(mut cache) = state.scan_cache.lock() {
                    cache.status.current_console = Some(console_name.clone());
                }
            }

            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            if let Some(rom) = parser::parse_file(path, &console_name, meta.len(), mtime) {
                all_roms.push(rom);
            }
        }
    }

    Ok(all_roms)
}

// ── Stats computation ─────────────────────────────────────────────────────────

pub fn compute_console_stats(roms: &[RomFile]) -> Vec<ConsoleStats> {
    use std::collections::HashMap;

    let mut map: HashMap<&str, ConsoleStats> = HashMap::new();

    for rom in roms {
        let stats = map.entry(&rom.console).or_insert_with(|| ConsoleStats {
            name: rom.console.clone(),
            total_files: 0,
            preferred_count: 0,
            marked_for_deletion: 0,
            bytes_to_free: 0,
        });
        stats.total_files += 1;
        if rom.matches_preferred_language {
            stats.preferred_count += 1;
        }
    }

    let mut result: Vec<ConsoleStats> = map.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rom(console: &str, preferred: bool) -> RomFile {
        RomFile {
            path: format!("/roms/{console}/Game (USA).zip"),
            filename: "Game (USA).zip".into(),
            console: console.into(),
            title: "Game".into(),
            title_normalized: "game".into(),
            regions: vec!["USA".into()],
            languages: vec![],
            status_flags: vec![],
            extra_tags: vec![],
            bad_dump: false,
            revision: 0,
            disc_number: None,
            version: None,
            is_bios: false,
            file_format: crate::models::FileFormat::Zip,
            file_category: crate::models::FileCategory::Game,
            filesize: 1024,
            matches_preferred_language: preferred,
            matches_preferred_region: preferred,
            is_unofficial_preferred_fallback: false,
        }
    }

    #[test]
    fn console_stats_counts() {
        let roms = vec![
            make_rom("GBA", true),
            make_rom("GBA", true),
            make_rom("GBA", false),
            make_rom("SNES", true),
        ];
        let stats = compute_console_stats(&roms);
        let gba = stats.iter().find(|s| s.name == "GBA").unwrap();
        assert_eq!(gba.total_files, 3);
        assert_eq!(gba.preferred_count, 2);
        let snes = stats.iter().find(|s| s.name == "SNES").unwrap();
        assert_eq!(snes.total_files, 1);
    }
}
