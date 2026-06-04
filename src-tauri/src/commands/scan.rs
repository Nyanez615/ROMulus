use std::path::Path;
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::commands::group::{group_roms, merge_format_pairs};
use crate::db::AppState;
use crate::deduper::detect_format_pairs;
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
    use crate::models::FileCategory;
    use std::collections::{HashMap, HashSet};

    let cache = state.scan_cache.lock().unwrap();
    let mut stats = compute_console_stats(&cache.roms);

    // Recompute game_groups from cache.groups (authoritative post-merge_format_pairs
    // data) so the counts exactly match what get_roms() returns.  The raw-file
    // computation in compute_console_stats can be slightly off when merged format-pair
    // groups span two sub-folders that have different sets of game titles.
    //
    // Strategy: for every game group, attribute its title_normalized to the canonical
    // base-name of its primary console (strip_format_suffix).  All sub-folders that
    // share the same base-name get the same canonical count.
    let mut canonical_game: HashMap<String, HashSet<&str>> = HashMap::new();
    for group in &cache.groups {
        if group
            .variants
            .iter()
            .any(|v| matches!(v.file_category, FileCategory::Game))
        {
            let base = strip_format_suffix(&group.console).to_owned();
            canonical_game
                .entry(base)
                .or_default()
                .insert(&group.title_normalized);
        }
    }

    for s in &mut stats {
        let base = strip_format_suffix(&s.name);
        s.game_groups = canonical_game
            .get(base)
            .map(|t| t.len() as u32)
            .unwrap_or(0);
    }

    stats
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

    // Upsert all tag values discovered in this scan
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        upsert_known_tags(&conn, &roms).map_err(|e| e.to_string())?;
    }

    // Group + score variants, detect format pairs, merge cross-console groups
    let groups = group_roms(roms.clone(), &prefs);
    let format_pairs = detect_format_pairs(&roms);
    let groups = merge_format_pairs(groups, &format_pairs, &prefs);

    // Rebuild flat roms list from group variants so matches_preferred_language flags are set.
    // group_roms() received a clone of roms and tagged the clone; the original had all-false.
    let updated_roms: Vec<RomFile> = groups.iter().flat_map(|g| g.variants.clone()).collect();

    let mut cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
    cache.roms = updated_roms;
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

    app.emit("scan:complete", &final_status).ok();

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
    Ok(crate::models::UserPreferences { preferred_languages: langs, preferred_regions: regions, short_console_names: false })
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

// ── Known tags ────────────────────────────────────────────────────────────────

const CATEGORY_FLAGS: &[&str] = &["Pirate", "Unl", "Aftermarket", "Hack"];

fn upsert_known_tags(conn: &rusqlite::Connection, roms: &[RomFile]) -> rusqlite::Result<()> {
    use std::collections::HashSet;

    let mut tags: HashSet<(&str, String)> = HashSet::new();
    for rom in roms {
        for r in &rom.regions       { tags.insert(("region",        r.clone())); }
        for l in &rom.languages     { tags.insert(("language",      l.clone())); }
        for f in &rom.status_flags  {
            if CATEGORY_FLAGS.contains(&f.as_str()) {
                tags.insert(("category", f.clone()));
            } else {
                tags.insert(("status",   f.clone()));
            }
        }
        let fc = file_category_str(rom);
        if !fc.is_empty() {
            tags.insert(("file_category", fc.to_string()));
        }
    }

    let tx = conn.unchecked_transaction()?;
    for (tag_type, value) in &tags {
        tx.execute(
            "INSERT OR IGNORE INTO known_tags (tag_type, value) VALUES (?1, ?2)",
            rusqlite::params![tag_type, value],
        )?;
    }
    tx.commit()
}

fn file_category_str(rom: &RomFile) -> &'static str {
    use crate::models::FileCategory;
    match rom.file_category {
        FileCategory::Bios     => "bios",
        FileCategory::Utility  => "utility",
        FileCategory::Demo     => "demo",
        FileCategory::Video    => "video",
        FileCategory::EReader  => "e_reader",
        FileCategory::Game | FileCategory::Unofficial => "",
    }
}

/// Returns all known tag values for a given tag type, or all values if tag_type is None.
#[tauri::command]
pub fn get_known_tags(
    state: State<'_, AppState>,
    tag_type: Option<String>,
) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let values: Vec<String> = if let Some(ref tt) = tag_type {
        let mut stmt = conn
            .prepare("SELECT value FROM known_tags WHERE tag_type = ?1 ORDER BY value")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([tt]).map_err(|e| e.to_string())?;
        let mut out = vec![];
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push(row.get(0).map_err(|e| e.to_string())?);
        }
        out
    } else {
        let mut stmt = conn
            .prepare("SELECT value FROM known_tags ORDER BY tag_type, value")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut out = vec![];
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push(row.get(0).map_err(|e| e.to_string())?);
        }
        out
    };
    Ok(values)
}

// ── Stats computation ─────────────────────────────────────────────────────────

/// Strip the last parenthetical suffix from a console folder name, matching the
/// same heuristic used by `detect_format_pairs` to identify format-variant
/// sub-folders (e.g. "NES (Headered)" and "NES (Headerless)" → "NES").
fn strip_format_suffix(s: &str) -> &str {
    if let Some(idx) = s.rfind('(') {
        s[..idx].trim()
    } else {
        s
    }
}

pub fn compute_console_stats(roms: &[RomFile]) -> Vec<ConsoleStats> {
    use crate::models::FileCategory;
    use std::collections::{HashMap, HashSet};

    let mut map: HashMap<&str, ConsoleStats> = HashMap::new();
    // canonical base-name → union of title_normalized values (all categories)
    let mut canonical_titles: HashMap<String, HashSet<String>> = HashMap::new();
    // canonical base-name → union of title_normalized values (game category only)
    let mut canonical_game_titles: HashMap<String, HashSet<String>> = HashMap::new();

    for rom in roms {
        let stats = map.entry(&rom.console).or_insert_with(|| ConsoleStats {
            name: rom.console.clone(),
            total_files: 0,
            total_groups: 0,
            game_files: 0,
            game_groups: 0,
            preferred_count: 0,
            preferred_explicit_count: 0,
            preferred_inferred_count: 0,
            marked_for_deletion: 0,
            bytes_to_free: 0,
            total_bytes: 0,
        });
        stats.total_files += 1;
        stats.total_bytes += rom.filesize;
        if rom.matches_preferred_language {
            stats.preferred_count += 1;
            if rom.languages.is_empty() {
                stats.preferred_inferred_count += 1;
            } else {
                stats.preferred_explicit_count += 1;
            }
        }
        let base = strip_format_suffix(&rom.console).to_owned();
        canonical_titles
            .entry(base.clone())
            .or_default()
            .insert(rom.title_normalized.clone());
        if rom.file_category == FileCategory::Game {
            stats.game_files += 1;
            canonical_game_titles
                .entry(base)
                .or_default()
                .insert(rom.title_normalized.clone());
        }
    }

    // Assign canonical-level title counts to every sub-folder in the group.
    // "NES (Headered)" and "NES (Headerless)" both report the same deduplicated
    // count so the frontend can use variants[0].x_groups without summing.
    for stats in map.values_mut() {
        let base = strip_format_suffix(&stats.name);
        stats.total_groups = canonical_titles
            .get(base)
            .map(|t| t.len() as u32)
            .unwrap_or(0);
        stats.game_groups = canonical_game_titles
            .get(base)
            .map(|t| t.len() as u32)
            .unwrap_or(0);
    }

    let mut result: Vec<ConsoleStats> = map.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

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

    fn make_rich_rom(regions: &[&str], langs: &[&str], flags: &[&str], cat: crate::models::FileCategory) -> RomFile {
        RomFile {
            path: "/roms/test/game.zip".into(),
            filename: "game.zip".into(),
            console: "Test".into(),
            title: "Game".into(),
            title_normalized: "game".into(),
            regions: regions.iter().map(|s| s.to_string()).collect(),
            languages: langs.iter().map(|s| s.to_string()).collect(),
            status_flags: flags.iter().map(|s| s.to_string()).collect(),
            extra_tags: vec![],
            bad_dump: false,
            revision: 0,
            disc_number: None,
            version: None,
            is_bios: cat == crate::models::FileCategory::Bios,
            file_format: crate::models::FileFormat::Zip,
            file_category: cat,
            filesize: 1024,
            matches_preferred_language: true,
            matches_preferred_region: true,
            is_unofficial_preferred_fallback: false,
        }
    }

    #[test]
    fn total_bytes_equals_sum_of_rom_filesizes() {
        let roms = vec![
            {
                let mut r = make_rom("GBA", true);
                r.filesize = 1024;
                r
            },
            {
                let mut r = make_rom("GBA", false);
                r.filesize = 2048;
                r
            },
            {
                let mut r = make_rom("SNES", true);
                r.filesize = 512;
                r
            },
        ];
        let stats = compute_console_stats(&roms);
        let gba = stats.iter().find(|s| s.name == "GBA").unwrap();
        assert_eq!(gba.total_bytes, 1024 + 2048);
        let snes = stats.iter().find(|s| s.name == "SNES").unwrap();
        assert_eq!(snes.total_bytes, 512);
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
        assert_eq!(gba.total_groups, 1); // all share title_normalized "game"
        assert_eq!(gba.preferred_count, 2);
        let snes = stats.iter().find(|s| s.name == "SNES").unwrap();
        assert_eq!(snes.total_files, 1);
        assert_eq!(snes.total_groups, 1);
    }

    #[test]
    fn total_groups_counts_distinct_titles() {
        let mut rom_a = make_rom("NES", true);
        rom_a.title_normalized = "mario".into();
        let mut rom_b = make_rom("NES", false);
        rom_b.title_normalized = "mario".into(); // same title, different variant
        let mut rom_c = make_rom("NES", true);
        rom_c.title_normalized = "zelda".into();
        let mut rom_d = make_rom("SNES", true);
        rom_d.title_normalized = "mario".into();

        let stats = compute_console_stats(&[rom_a, rom_b, rom_c, rom_d]);
        let nes = stats.iter().find(|s| s.name == "NES").unwrap();
        assert_eq!(nes.total_files, 3);
        assert_eq!(nes.total_groups, 2); // mario + zelda
        let snes = stats.iter().find(|s| s.name == "SNES").unwrap();
        assert_eq!(snes.total_groups, 1);
    }

    #[test]
    fn total_groups_deduplicates_format_variant_sub_folders() {
        // NES (Headered) and NES (Headerless) both strip to canonical "NES".
        // A title present in both sub-folders should be counted once.
        let headered = "NES (Headered)";
        let headerless = "NES (Headerless)";

        let mut mario_h = make_rom(headered, true);
        mario_h.title_normalized = "mario".into();
        let mut mario_hl = make_rom(headerless, true);
        mario_hl.title_normalized = "mario".into(); // same game, different format
        let mut zelda_h = make_rom(headered, true);
        zelda_h.title_normalized = "zelda".into(); // only in Headered

        let stats = compute_console_stats(&[mario_h, mario_hl, zelda_h]);
        let h = stats.iter().find(|s| s.name == headered).unwrap();
        let hl = stats.iter().find(|s| s.name == headerless).unwrap();

        // Canonical union = {mario, zelda} = 2; both sub-folders report that count
        assert_eq!(h.total_groups, 2);
        assert_eq!(hl.total_groups, 2);
        // But file counts are per-folder, not merged
        assert_eq!(h.total_files, 2);
        assert_eq!(hl.total_files, 1);
    }

    #[test]
    fn preferred_explicit_vs_inferred_counts() {
        // ROM with explicit language tag → explicit count
        let mut with_tag = make_rom("GBA", true);
        with_tag.languages = vec!["En".into()];
        // ROM matched by region inference (no language tag) → inferred count
        let no_tag = make_rom("GBA", true); // make_rom leaves languages empty
        // ROM not preferred → neither count
        let not_preferred = make_rom("GBA", false);

        let stats = compute_console_stats(&[with_tag, no_tag, not_preferred]);
        let gba = stats.iter().find(|s| s.name == "GBA").unwrap();
        assert_eq!(gba.preferred_count, 2);
        assert_eq!(gba.preferred_explicit_count, 1);
        assert_eq!(gba.preferred_inferred_count, 1);
    }

    #[test]
    fn upsert_known_tags_inserts_regions_and_langs() {
        let conn = db::open_in_memory();
        let roms = vec![
            make_rich_rom(&["USA", "Europe"], &["En", "Fr"], &["Beta"], crate::models::FileCategory::Game),
        ];
        upsert_known_tags(&conn, &roms).unwrap();

        let regions: Vec<String> = conn
            .prepare("SELECT value FROM known_tags WHERE tag_type='region' ORDER BY value")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(regions, vec!["Europe", "USA"]);

        let langs: Vec<String> = conn
            .prepare("SELECT value FROM known_tags WHERE tag_type='language' ORDER BY value")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(langs, vec!["En", "Fr"]);
    }

    #[test]
    fn upsert_known_tags_categorizes_flags_correctly() {
        let conn = db::open_in_memory();
        let roms = vec![
            make_rich_rom(&[], &[], &["Pirate", "Beta"], crate::models::FileCategory::Unofficial),
        ];
        upsert_known_tags(&conn, &roms).unwrap();

        let cats: Vec<String> = conn
            .prepare("SELECT value FROM known_tags WHERE tag_type='category'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(cats.contains(&"Pirate".to_string()));

        let statuses: Vec<String> = conn
            .prepare("SELECT value FROM known_tags WHERE tag_type='status'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(statuses.contains(&"Beta".to_string()));
    }

    #[test]
    fn upsert_known_tags_is_idempotent() {
        let conn = db::open_in_memory();
        let roms = vec![make_rich_rom(&["USA"], &[], &[], crate::models::FileCategory::Game)];
        upsert_known_tags(&conn, &roms).unwrap();
        upsert_known_tags(&conn, &roms).unwrap(); // second scan — no duplicate
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM known_tags WHERE tag_type='region' AND value='USA'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_known_tags_inserts_file_category() {
        let conn = db::open_in_memory();
        let roms = vec![make_rich_rom(&[], &[], &[], crate::models::FileCategory::Bios)];
        upsert_known_tags(&conn, &roms).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM known_tags WHERE tag_type='file_category' AND value='bios'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
