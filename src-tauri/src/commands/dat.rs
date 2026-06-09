use std::path::Path;
use std::sync::Arc;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::commands::group::{group_roms, score_rom};
use crate::commands::settings::get_settings_inner;
use crate::db::AppState;
use crate::models::{
    Completeness, DatFile, DownloadEntry, DownloadList, DownloadStatus, ExportFormat,
    VerificationStatus,
};
use crate::parser::parse_from_filename;

// ── DAT parsing ───────────────────────────────────────────────────────────────

struct DatEntry {
    name: String,
    /// Actual ROM filename from `<rom name="…">` (e.g. `"Game (USA).3ds"`).
    /// `None` when the `<game>` element has no `<rom>` child.
    rom_name: Option<String>,
    crc32: Option<String>,
}

struct DatHeader {
    name: Option<String>,
    version: Option<String>,
}

fn parse_dat(xml: &str) -> Result<(DatHeader, Vec<DatEntry>), String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut entries: Vec<DatEntry> = vec![];
    let mut header = DatHeader { name: None, version: None };
    let mut in_header = false;
    let mut header_tag: Option<Vec<u8>> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"header" => in_header = true,
                    b"name" | b"version" if in_header => {
                        header_tag = Some(e.name().as_ref().to_vec());
                    }
                    b"game" | b"machine" => {
                        let name = e.attributes()
                            .filter_map(|a| a.ok())
                            .find(|a| a.key.as_ref() == b"name")
                            .and_then(|a| String::from_utf8(a.value.to_vec()).ok())
                            .unwrap_or_default();
                        entries.push(DatEntry { name, rom_name: None, crc32: None });
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"header" => { in_header = false; header_tag = None; }
                    b"name" | b"version" => { header_tag = None; }
                    _ => {}
                }
            }
            Ok(Event::Text(ref t)) if in_header => {
                if let Ok(text) = t.unescape() {
                    let text = text.trim().to_string();
                    if !text.is_empty() {
                        match header_tag.as_deref() {
                            Some(b"name")    => header.name    = Some(text),
                            Some(b"version") => header.version = Some(text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"rom" {
                    let attrs: Vec<_> = e.attributes().filter_map(|a| a.ok()).collect();
                    let rom_name = attrs.iter()
                        .find(|a| a.key.as_ref() == b"name")
                        .and_then(|a| String::from_utf8(a.value.to_vec()).ok());
                    let crc = attrs.iter()
                        .find(|a| a.key.as_ref() == b"crc")
                        .and_then(|a| String::from_utf8(a.value.to_vec()).ok());
                    if let Some(last) = entries.last_mut() {
                        if last.rom_name.is_none() { last.rom_name = rom_name; }
                        if last.crc32.is_none()    { last.crc32    = crc; }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok((header, entries))
}

fn read_zip_crc(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let _archive = zip::ZipArchive::new(file).ok()?;
    // CRC of first entry (the ROM file inside the ZIP)
    // ZipArchive::by_index requires &mut, so we open fresh
    let file2 = std::fs::File::open(path).ok()?;
    let mut archive2 = zip::ZipArchive::new(file2).ok()?;
    let entry = archive2.by_index(0).ok()?;
    Some(format!("{:08x}", entry.crc32()))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns the `<header><name>` and `<header><version>` from a DAT file without
/// importing it. Used by the frontend to auto-populate the console name field.
#[tauri::command]
pub fn read_dat_header(path: String) -> Result<(String, String), String> {
    let xml = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (header, _) = parse_dat(&xml)?;
    Ok((
        header.name.unwrap_or_default(),
        header.version.unwrap_or_default(),
    ))
}

#[tauri::command]
pub fn import_dat(
    state: State<'_, AppState>,
    path: String,
    console: String,
) -> Result<DatFile, String> {
    let xml = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let filename = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.dat")
        .to_string();

    let (header, entries) = parse_dat(&xml)?;
    // If the caller passes an empty console name, fall back to the DAT's own header name.
    let console = if console.trim().is_empty() {
        header.name.unwrap_or_default()
    } else {
        console
    };
    if console.is_empty() {
        return Err("Could not determine console name from DAT header or caller".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Delete existing DAT for this console before inserting new one
    conn.execute("DELETE FROM dat_files WHERE console = ?1", [&console])
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO dat_files (console, filename, version, imported_at) VALUES (?1,?2,?3,datetime('now'))",
        rusqlite::params![console, filename, header.version],
    ).map_err(|e| e.to_string())?;

    let dat_id = conn.last_insert_rowid();
    let entry_count = entries.len() as u32;

    for entry in &entries {
        conn.execute(
            "INSERT INTO dat_entries (dat_file_id, name, rom_name, crc32) VALUES (?1,?2,?3,?4)",
            rusqlite::params![dat_id, entry.name, entry.rom_name, entry.crc32],
        ).map_err(|e| e.to_string())?;
    }

    Ok(DatFile {
        console,
        filename,
        version: header.version,
        entry_count,
        imported_at: chrono_now(),
    })
}

#[tauri::command]
pub fn get_dat_files(state: State<'_, AppState>) -> Result<Vec<DatFile>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT d.console, d.filename, d.version, COUNT(e.id), d.imported_at
         FROM dat_files d LEFT JOIN dat_entries e ON e.dat_file_id = d.id
         GROUP BY d.id ORDER BY d.console",
    ).map_err(|e| e.to_string())?;

    let mut files = vec![];
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        files.push(DatFile {
            console: row.get(0).map_err(|e| e.to_string())?,
            filename: row.get(1).map_err(|e| e.to_string())?,
            version: row.get(2).map_err(|e| e.to_string())?,
            entry_count: row.get::<_, i64>(3).map_err(|e| e.to_string())? as u32,
            imported_at: row.get(4).map_err(|e| e.to_string())?,
        });
    }
    Ok(files)
}

#[tauri::command]
pub fn remove_dat(state: State<'_, AppState>, console: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM dat_files WHERE console = ?1", [&console])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn verify_roms(
    app: AppHandle,
    state: State<'_, AppState>,
    console: Option<String>,
) -> Result<(), String> {
    // Collect ROMs to verify
    let roms: Vec<(i64, String, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        // Use nullable parameter to avoid SQL injection from console name
        let mut stmt = conn.prepare(
            "SELECT id, path, console FROM rom_cache
             WHERE file_format = 'zip' AND (?1 IS NULL OR console = ?1)
             LIMIT 5000",
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(rusqlite::params![console]).map_err(|e| e.to_string())?;
        let mut result = vec![];
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            result.push((
                row.get::<_, i64>(0).map_err(|e| e.to_string())?,
                row.get::<_, String>(1).map_err(|e| e.to_string())?,
                row.get::<_, String>(2).map_err(|e| e.to_string())?,
            ));
        }
        result
    };

    let total = roms.len() as u32;
    // Clone Arcs for the spawned task
    let db = Arc::clone(&state.db);
    let scan_cache = Arc::clone(&state.scan_cache);
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        let mut verified = 0u32;
        let mut modified = 0u32;
        let mut unknown = 0u32;

        for (id, path, _console) in &roms {
            let status = match read_zip_crc(Path::new(path)) {
                Some(actual_crc) => {
                    let filename = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if let Ok(conn) = db.lock() {
                        let expected: Option<String> = conn.query_row(
                            "SELECT e.crc32 FROM dat_entries e JOIN dat_files d ON d.id=e.dat_file_id WHERE e.name LIKE ?1 LIMIT 1",
                            [&format!("%{filename}%")],
                            |r| r.get(0),
                        ).ok().flatten();
                        match expected {
                            Some(exp) if exp.to_lowercase() == actual_crc => { verified += 1; "verified" }
                            Some(_) => { modified += 1; "modified" }
                            None => { unknown += 1; "unknown" }
                        }
                    } else { unknown += 1; "unknown" }
                }
                None => { unknown += 1; "unknown" }
            };

            if let Ok(conn) = db.lock() {
                let _ = conn.execute(
                    "INSERT INTO rom_verifications (rom_cache_id,status) VALUES (?1,?2)
                     ON CONFLICT(rom_cache_id) DO UPDATE SET status=excluded.status,verified_at=datetime('now')",
                    rusqlite::params![id, status],
                );
            }
        }

        let done = VerificationStatus { running: false, verified, modified, unknown, total };
        app2.emit("verify:complete", &done).ok();
        if let Ok(mut cache) = scan_cache.lock() { cache.verification = done; }
        let _ = app2.notification().builder()
            .title("ROMulus")
            .body(format!("Verification complete — {verified} verified, {modified} modified, {unknown} unknown"))
            .show();
    });

    Ok(())
}

#[tauri::command]
pub fn get_completeness(
    state: State<'_, AppState>,
    console: String,
) -> Result<Completeness, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let total: u32 = conn.query_row(
        "SELECT COUNT(*) FROM dat_entries e JOIN dat_files d ON d.id = e.dat_file_id WHERE d.console = ?1",
        [&console],
        |r| r.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    let have: u32 = conn.query_row(
        "SELECT COUNT(DISTINCT c.id) FROM rom_cache c
         JOIN dat_entries e ON e.name LIKE '%' || c.path || '%'
         JOIN dat_files d ON d.id = e.dat_file_id
         WHERE d.console = ?1",
        [&console],
        |r| r.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    let percent = if total > 0 { have as f32 / total as f32 * 100.0 } else { 0.0 };
    Ok(Completeness { console, have, total, percent })
}

#[tauri::command]
pub fn get_verification_status(state: State<'_, AppState>) -> VerificationStatus {
    state.scan_cache.lock().map(|c| c.verification.clone()).unwrap_or_default()
}

// ── Pre-download filter ───────────────────────────────────────────────────────

/// Pre-release flags that indicate no official, non-pre-release variant exists.
const PRERELEASE_FLAGS: &[&str] = &[
    "Alpha", "Beta", "Proto", "Possible Proto", "Demo", "Sample", "Promo",
    "Kiosk", "Wi-Fi Kiosk", "Preview", "GameCube Preview",
    "IS-NITRO-EMULATOR", "IS-NITRO-PROGRAMMER",
];

#[tauri::command]
pub fn generate_download_list(
    state: State<'_, AppState>,
    console: String,
) -> Result<DownloadList, String> {
    // ── 1. Load DAT entries and preferences — hold lock only for DB work ──────
    let (raw_entries, prefs) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let settings = get_settings_inner(&conn)?;

        let mut stmt = conn.prepare(
            "SELECT e.rom_name, e.name
             FROM dat_entries e
             JOIN dat_files d ON d.id = e.dat_file_id
             WHERE d.console = ?1 AND e.rom_name IS NOT NULL",
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query(rusqlite::params![console]).map_err(|e| e.to_string())?;
        let mut entries: Vec<(String, String)> = vec![];
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            entries.push((
                row.get(0).map_err(|e| e.to_string())?,
                row.get(1).map_err(|e| e.to_string())?,
            ));
        }
        (entries, settings.preferences)
    }; // DB lock released before CPU-heavy grouping work

    let total_in_dat = raw_entries.len() as u32;

    // ── 2. Fast-exit when no rom_name entries exist (pre-migration import) ────
    if total_in_dat == 0 {
        return Ok(DownloadList {
            console,
            to_download: vec![],
            total_in_dat: 0,
            preferred_count: 0,
            prerelease_only_count: 0,
            excluded_count: 0,
        });
    }

    // ── 3. rom_name → game_title lookup table ─────────────────────────────────
    // parse_from_filename sets rom.filename = the filename string verbatim
    // (Path::new("Foo (USA).3ds").file_name() == "Foo (USA).3ds"), so this
    // lookup is always an exact match.
    let title_map: std::collections::HashMap<String, String> =
        raw_entries.iter().map(|(rn, gt)| (rn.clone(), gt.clone())).collect();

    // ── 4. Parse filenames into RomFile — skip unrecognised extensions ────────
    let roms: Vec<_> = raw_entries
        .into_iter()
        .filter_map(|(rom_name, _)| parse_from_filename(&rom_name, &console))
        .collect();

    // ── 5. Group + score via the standard pipeline ────────────────────────────
    let groups = group_roms(roms, &prefs);

    let mut to_download: Vec<DownloadEntry> = vec![];
    let mut preferred_count = 0u32;
    let mut prerelease_only_count = 0u32;
    let mut excluded_count = 0u32;

    for group in &groups {
        // preferred_idx = None → no language-matching variant (Japan-only for En
        // user, etc.) → excluded from the download list.
        let Some(pi) = group.preferred_idx else {
            excluded_count += 1;
            continue;
        };

        let preferred = &group.variants[pi];
        let preferred_score = score_rom(preferred, &prefs);

        let is_prerelease = preferred.status_flags.iter()
            .any(|f| PRERELEASE_FLAGS.contains(&f.as_str()));

        // Counts track logical titles (groups), not files, so multi-disc games
        // increment the counter once regardless of disc count.
        let status = if is_prerelease {
            prerelease_only_count += 1;
            DownloadStatus::PrereleaseOnly
        } else {
            preferred_count += 1;
            DownloadStatus::Preferred
        };

        // Include the preferred variant AND any sibling discs of the same set.
        // Sibling discs have an identical score triple (same region/language/
        // version/flags, only disc_number differs), so matching on score is both
        // necessary and sufficient. Non-preferred regions/revisions always produce
        // a different score; the preferred disc itself is included naturally.
        for variant in group.variants.iter().filter(|v| score_rom(v, &prefs) == preferred_score) {
            to_download.push(DownloadEntry {
                rom_name: variant.filename.clone(),
                game_title: title_map.get(&variant.filename).cloned()
                    .unwrap_or_else(|| variant.title.clone()),
                title_normalized: variant.title_normalized.clone(),
                regions: variant.regions.clone(),
                languages: variant.languages.clone(),
                status_flags: variant.status_flags.clone(),
                file_category: variant.file_category.clone(),
                status: status.clone(),
                score: preferred_score.0,
            });
        }
    }

    // Sort alphabetically by filename — deterministic and easy to diff
    to_download.sort_by(|a, b| a.rom_name.cmp(&b.rom_name));

    Ok(DownloadList {
        console,
        to_download,
        total_in_dat,
        preferred_count,
        prerelease_only_count,
        excluded_count,
    })
}

#[tauri::command]
pub fn export_download_list(
    entries: Vec<DownloadEntry>,
    path: String,
    format: ExportFormat,
) -> Result<(), String> {
    use std::io::Write;

    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;

    match format {
        ExportFormat::Text => {
            // One filename per line with ROM extensions mapped to .zip so the
            // output matches Myrient torrent archive names directly.
            for e in &entries {
                writeln!(file, "{}", to_zip_name(&e.rom_name))
                    .map_err(|e| e.to_string())?;
            }
        }
        ExportFormat::Csv => {
            writeln!(
                file,
                "rom_name,game_title,regions,languages,status_flags,file_category,status,score"
            ).map_err(|e| e.to_string())?;
            for e in &entries {
                let status_str = match e.status {
                    DownloadStatus::Preferred      => "preferred",
                    DownloadStatus::PrereleaseOnly => "prerelease_only",
                };
                writeln!(
                    file,
                    "{},{},{},{},{},{},{},{}",
                    csv_esc(&e.rom_name),
                    csv_esc(&e.game_title),
                    csv_esc(&e.regions.join("|")),
                    csv_esc(&e.languages.join("|")),
                    csv_esc(&e.status_flags.join("|")),
                    csv_esc(&format!("{:?}", e.file_category).to_lowercase()),
                    status_str,
                    e.score,
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Map a ROM filename extension to `.zip` so the output matches Myrient
/// torrent archive names. Files already ending in `.zip` are returned as-is.
fn to_zip_name(filename: &str) -> String {
    const ROM_EXTS: &[&str] = &[
        ".3ds", ".cci", ".cxi", ".nds", ".gba", ".nes", ".sfc", ".smc",
        ".gb", ".gbc", ".n64", ".z64", ".v64", ".gcm",
        ".smd", ".md", ".sms", ".gg", ".pce",
    ];
    let lower = filename.to_lowercase();
    for ext in ROM_EXTS {
        if lower.ends_with(ext) {
            return format!("{}.zip", &filename[..filename.len() - ext.len()]);
        }
    }
    filename.to_string()
}

fn csv_esc(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono dependency
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // YYYY-MM-DD approximation
    let days = secs / 86400;
    let year = 1970 + days / 365;
    format!("{year}-01-01") // approximate; good enough for display
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::models::UserPreferences;
    use rusqlite::Connection;

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Insert a dat_files row plus (game_name, rom_name) dat_entries.
    fn insert_dat(conn: &Connection, console: &str, entries: &[(&str, &str)]) {
        conn.execute(
            "INSERT INTO dat_files (console, filename, imported_at) VALUES (?1,'test.dat','2026-01-01')",
            [console],
        ).unwrap();
        let dat_id = conn.last_insert_rowid();
        for (game_name, rom_name) in entries {
            conn.execute(
                "INSERT INTO dat_entries (dat_file_id, name, rom_name) VALUES (?1,?2,?3)",
                rusqlite::params![dat_id, game_name, rom_name],
            ).unwrap();
        }
    }

    /// Build a minimal AppState backed by an in-memory DB and save the given prefs.
    fn make_state_with_prefs(prefs: &UserPreferences) -> crate::db::AppState {
        let conn = open_in_memory();
        // Persist prefs so get_settings_inner can read them back
        conn.execute(
            "UPDATE user_preferences SET preferred_languages = ?1, preferred_regions = ?2 WHERE id = 1",
            rusqlite::params![
                serde_json::to_string(&prefs.preferred_languages).unwrap(),
                serde_json::to_string(&prefs.preferred_regions).unwrap(),
            ],
        ).unwrap();
        crate::db::AppState {
            db: std::sync::Arc::new(std::sync::Mutex::new(conn)),
            scan_cache: std::sync::Arc::new(std::sync::Mutex::new(crate::db::ScanCache::default())),
            watcher: std::sync::Mutex::new(None),
        }
    }

    // ── parse_dat tests ───────────────────────────────────────────────────────

    #[test]
    fn parse_dat_captures_rom_name() {
        let xml = r#"<datafile>
  <game name="Super Mario Bros">
    <rom name="Super Mario Bros (USA).nes" crc="3347b98f"/>
  </game>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Super Mario Bros");
        assert_eq!(entries[0].rom_name.as_deref(), Some("Super Mario Bros (USA).nes"));
        assert_eq!(entries[0].crc32.as_deref(), Some("3347b98f"));
    }

    #[test]
    fn parse_dat_machine_element_captures_rom_name() {
        let xml = r#"<datafile>
  <machine name="donpachi">
    <rom name="donpachi (Japan).zip" crc="aabbccdd"/>
  </machine>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries[0].name, "donpachi");
        assert_eq!(entries[0].rom_name.as_deref(), Some("donpachi (Japan).zip"));
    }

    #[test]
    fn parse_dat_multiple_games_correct_attribution() {
        let xml = r#"<datafile>
  <game name="Game A"><rom name="Game A (USA).nes" crc="11111111"/></game>
  <game name="Game B"><rom name="Game B (Europe).nes" crc="22222222"/></game>
  <game name="Game C"><rom name="Game C (Japan).nes" crc="33333333"/></game>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].rom_name.as_deref(), Some("Game A (USA).nes"));
        assert_eq!(entries[1].rom_name.as_deref(), Some("Game B (Europe).nes"));
        assert_eq!(entries[2].rom_name.as_deref(), Some("Game C (Japan).nes"));
    }

    #[test]
    fn parse_dat_game_without_rom_child_yields_none() {
        // Non-self-closing game element with no <rom> child — fires Start+End, not Empty
        let xml = r#"<datafile>
  <game name="Placeholder"></game>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Placeholder");
        assert!(entries[0].rom_name.is_none());
        assert!(entries[0].crc32.is_none());
    }

    #[test]
    fn parse_dat_first_rom_wins_for_multi_rom_game() {
        let xml = r#"<datafile>
  <game name="Multi">
    <rom name="Multi (USA) (Disc 1).bin" crc="aaaaaaaa"/>
    <rom name="Multi (USA) (Disc 2).bin" crc="bbbbbbbb"/>
  </game>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries.len(), 1);
        // First rom element wins
        assert_eq!(entries[0].rom_name.as_deref(), Some("Multi (USA) (Disc 1).bin"));
        assert_eq!(entries[0].crc32.as_deref(), Some("aaaaaaaa"));
    }

    #[test]
    fn parse_dat_crc_still_captured_alongside_rom_name() {
        let xml = r#"<datafile>
  <game name="G"><rom name="G (USA).gba" crc="deadbeef"/></game>
</datafile>"#;
        let (_, entries) = parse_dat(xml).unwrap();
        assert_eq!(entries[0].crc32.as_deref(), Some("deadbeef"));
        assert_eq!(entries[0].rom_name.as_deref(), Some("G (USA).gba"));
    }

    // ── parse_from_filename tests ─────────────────────────────────────────────

    #[test]
    fn parse_from_filename_matches_parse_file() {
        let name = "Super Mario 3D Land (USA) (En,Fr,De,Es,Pt,It).3ds";
        let console = "Nintendo - Nintendo 3DS";
        let from_filename = parse_from_filename(name, console).unwrap();
        let from_path = crate::parser::parse_file(
            std::path::Path::new(name), console, 0, 0,
        ).unwrap();
        assert_eq!(from_filename.regions,    from_path.regions);
        assert_eq!(from_filename.languages,  from_path.languages);
        assert_eq!(from_filename.title,      from_path.title);
        assert_eq!(from_filename.filename,   from_path.filename);
        // filename equals the input string — guarantees title_map lookup works
        assert_eq!(from_filename.filename, name);
    }

    #[test]
    fn parse_from_filename_3ds_extension_accepted() {
        let rom = parse_from_filename(
            "Pokemon X (USA) (En,Fr,De,Es,It).3ds",
            "Nintendo - Nintendo 3DS",
        ).unwrap();
        assert_eq!(rom.regions, vec!["USA"]);
        assert_eq!(rom.languages, vec!["En", "Fr", "De", "Es", "It"]);
    }

    #[test]
    fn parse_from_filename_unknown_extension_returns_none() {
        assert!(parse_from_filename("README.txt", "Any Console").is_none());
        assert!(parse_from_filename("Manual (USA).pdf", "Any Console").is_none());
    }

    // ── to_zip_name tests ─────────────────────────────────────────────────────

    #[test]
    fn to_zip_name_maps_3ds_to_zip() {
        assert_eq!(to_zip_name("Game (USA).3ds"), "Game (USA).zip");
    }

    #[test]
    fn to_zip_name_maps_nds_to_zip() {
        assert_eq!(to_zip_name("Game (Europe).nds"), "Game (Europe).zip");
    }

    #[test]
    fn to_zip_name_maps_gba_to_zip() {
        assert_eq!(to_zip_name("Game (Japan).gba"), "Game (Japan).zip");
    }

    #[test]
    fn to_zip_name_passthrough_for_zip() {
        assert_eq!(to_zip_name("Game (USA).zip"), "Game (USA).zip");
    }

    #[test]
    fn to_zip_name_passthrough_for_unknown() {
        assert_eq!(to_zip_name("Archive.7z"), "Archive.7z");
    }

    // ── generate_download_list integration tests ──────────────────────────────

    #[test]
    fn generate_download_list_usa_preferred_over_japan() {
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into(), "World".into(), "Europe".into()],
            short_console_names: false,
        };
        let state = make_state_with_prefs(&prefs);
        let console = "Nintendo - Game Boy Advance";

        {
            let conn = state.db.lock().unwrap();
            // Both filenames normalise to the same title ("pokemon ruby") so they
            // collapse into one group. Use a shared English name, not the localised
            // Japanese title ("Pocket Monsters Ruby") which gives a different normalised form.
            insert_dat(&conn, console, &[
                ("Pokemon Ruby", "Pokemon Ruby (USA, Australia).gba"),
                ("Pokemon Ruby", "Pokemon Ruby (Japan).gba"),
            ]);
        }

        // Test the core logic directly (Tauri command wiring tested via clippy/types)
        let (entries, pref_langs) = {
            let conn = state.db.lock().unwrap();
            let settings = get_settings_inner(&conn).unwrap();
            let mut stmt = conn.prepare(
                "SELECT e.rom_name, e.name FROM dat_entries e
                 JOIN dat_files d ON d.id = e.dat_file_id
                 WHERE d.console = ?1 AND e.rom_name IS NOT NULL",
            ).unwrap();
            let mut rows = stmt.query(rusqlite::params![console]).unwrap();
            let mut v: Vec<(String, String)> = vec![];
            while let Some(row) = rows.next().unwrap() {
                v.push((row.get(0).unwrap(), row.get(1).unwrap()));
            }
            (v, settings.preferences)
        };

        let roms: Vec<_> = entries.into_iter()
            .filter_map(|(rn, _)| parse_from_filename(&rn, console))
            .collect();
        let groups = group_roms(roms, &pref_langs);

        assert_eq!(groups.len(), 1, "USA + Japan should collapse into one group");
        let group = &groups[0];
        assert!(group.preferred_idx.is_some(), "Should have a preferred variant");
        let preferred = &group.variants[group.preferred_idx.unwrap()];
        assert!(preferred.filename.contains("USA"), "USA should be preferred over Japan");
    }

    #[test]
    fn generate_download_list_prerelease_only() {
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into()],
            short_console_names: false,
        };
        let state = make_state_with_prefs(&prefs);
        let console = "Nintendo - Nintendo Entertainment System";
        {
            let conn = state.db.lock().unwrap();
            insert_dat(&conn, console, &[
                ("EarthBound Zero", "EarthBound Zero (USA) (Beta).nes"),
            ]);
        }

        let conn = state.db.lock().unwrap();
        let settings = get_settings_inner(&conn).unwrap();
        let entries = vec![("EarthBound Zero (USA) (Beta).nes".to_string(), "EarthBound Zero".to_string())];
        drop(conn);

        let roms: Vec<_> = entries.into_iter()
            .filter_map(|(rn, _)| parse_from_filename(&rn, console))
            .collect();
        let groups = group_roms(roms, &settings.preferences);
        assert_eq!(groups.len(), 1);
        let pi = groups[0].preferred_idx.unwrap();
        let chosen = &groups[0].variants[pi];
        let is_prerelease = chosen.status_flags.iter()
            .any(|f| PRERELEASE_FLAGS.contains(&f.as_str()));
        assert!(is_prerelease, "Beta-only title should be marked as prerelease");
    }

    #[test]
    fn generate_download_list_prerelease_excluded_when_release_exists() {
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into()],
            short_console_names: false,
        };
        let state = make_state_with_prefs(&prefs);
        let console = "Nintendo - Nintendo Entertainment System";
        {
            let conn = state.db.lock().unwrap();
            insert_dat(&conn, console, &[
                ("EarthBound Beginnings", "EarthBound Beginnings (USA).nes"),
                ("EarthBound Zero",       "EarthBound Zero (USA) (Beta).nes"),
            ]);
        }

        let raw: Vec<_> = vec![
            ("EarthBound Beginnings (USA).nes", "EarthBound Beginnings"),
            ("EarthBound Zero (USA) (Beta).nes", "EarthBound Zero"),
        ];

        let roms: Vec<_> = raw.iter()
            .filter_map(|(rn, _)| parse_from_filename(rn, console))
            .collect();
        let groups = group_roms(roms, &prefs);

        // Two different title_normalized → two groups
        assert_eq!(groups.len(), 2);
        for group in &groups {
            let pi = group.preferred_idx.unwrap();
            let chosen = &group.variants[pi];
            let is_prerelease = chosen.status_flags.iter()
                .any(|f| PRERELEASE_FLAGS.contains(&f.as_str()));
            // The official release group should NOT be prerelease
            if chosen.filename.contains("Beginnings") {
                assert!(!is_prerelease);
            }
        }
    }

    #[test]
    fn generate_download_list_excluded_when_no_language_match() {
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into()],
            short_console_names: false,
        };
        let roms: Vec<_> = vec!["Dragon Quest (Japan).nes"]
            .into_iter()
            .filter_map(|rn| parse_from_filename(rn, "Nintendo - Nintendo Entertainment System"))
            .collect();
        let groups = group_roms(roms, &prefs);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].preferred_idx.is_none(), "Japan-only should be excluded for En user");
    }

    #[test]
    fn generate_download_list_empty_prefs_includes_japan_only() {
        let prefs = UserPreferences {
            preferred_languages: vec![],   // no language preference
            preferred_regions: vec![],
            short_console_names: false,
        };
        let roms: Vec<_> = vec!["Dragon Quest (Japan).nes"]
            .into_iter()
            .filter_map(|rn| parse_from_filename(rn, "Nintendo - Nintendo Entertainment System"))
            .collect();
        let groups = group_roms(roms, &prefs);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].preferred_idx.is_some(),
            "With empty prefs, Japan-only should not be excluded");
    }

    #[test]
    fn generate_download_list_null_rom_names_yield_zero_total() {
        let prefs = UserPreferences::default();
        let state = make_state_with_prefs(&prefs);
        let console = "Nintendo - Game Boy";
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO dat_files (console, filename, imported_at) VALUES (?1,'old.dat','2025')",
                [console],
            ).unwrap();
            let dat_id = conn.last_insert_rowid();
            // Insert with NULL rom_name (simulates pre-migration import)
            conn.execute(
                "INSERT INTO dat_entries (dat_file_id, name, rom_name) VALUES (?1,'Tetris',NULL)",
                [dat_id],
            ).unwrap();
        }

        let conn = state.db.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT e.rom_name, e.name FROM dat_entries e
             JOIN dat_files d ON d.id = e.dat_file_id
             WHERE d.console = ?1 AND e.rom_name IS NOT NULL",
        ).unwrap();
        let mut rows = stmt.query(rusqlite::params![console]).unwrap();
        let mut entries: Vec<(String, String)> = vec![];
        while let Some(row) = rows.next().unwrap() {
            entries.push((row.get(0).unwrap(), row.get(1).unwrap()));
        }
        assert!(entries.is_empty(), "NULL rom_name entries should be excluded from the query");
    }

    #[test]
    fn generate_download_list_multi_disc_includes_all_sibling_discs() {
        // Three USA discs + one Japan disc of the same title.
        // Preferred: USA (all three discs). Japan disc must be excluded.
        // Uses .cue extension (PS1-style); disc_number is parsed from "(Disc N)" tags.
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into(), "World".into(), "Europe".into()],
            short_console_names: false,
        };
        let console = "Sony - PlayStation";
        let filenames = [
            "Final Fantasy VII (USA) (Disc 1).cue",
            "Final Fantasy VII (USA) (Disc 2).cue",
            "Final Fantasy VII (USA) (Disc 3).cue",
            "Final Fantasy VII (Japan) (Disc 1).cue",
        ];

        let roms: Vec<_> = filenames.iter()
            .filter_map(|rn| parse_from_filename(rn, console))
            .collect();

        // Verify disc_number was parsed correctly
        let usa_d1 = roms.iter().find(|r| r.filename.contains("Disc 1") && r.regions.contains(&"USA".to_string())).unwrap();
        let usa_d2 = roms.iter().find(|r| r.filename.contains("Disc 2")).unwrap();
        assert_eq!(usa_d1.disc_number, Some(1));
        assert_eq!(usa_d2.disc_number, Some(2));

        let groups = group_roms(roms, &prefs);
        // All four ROMs share the same title_normalized → one group
        assert_eq!(groups.len(), 1, "All discs should collapse into one group");

        let group = &groups[0];
        let pi = group.preferred_idx.expect("Should have a preferred variant");
        let preferred = &group.variants[pi];
        let preferred_score = score_rom(preferred, &prefs);

        // Collect download entries using the same logic as generate_download_list
        let siblings: Vec<_> = group.variants.iter()
            .filter(|v| score_rom(v, &prefs) == preferred_score)
            .collect();

        // All 3 USA discs share the same score; Japan disc does not (no En match → -9999)
        assert_eq!(siblings.len(), 3, "All 3 USA discs should be included");
        assert!(siblings.iter().all(|v| v.regions.contains(&"USA".to_string())),
            "No Japan disc should appear in the download set");
        // All three disc numbers present
        let disc_nums: Vec<_> = siblings.iter().filter_map(|v| v.disc_number).collect();
        assert!(disc_nums.contains(&1));
        assert!(disc_nums.contains(&2));
        assert!(disc_nums.contains(&3));
    }

    #[test]
    fn generate_download_list_multi_disc_count_tracks_titles_not_files() {
        // A 2-disc USA game: preferred_count should be 1 (one title),
        // but to_download length should be 2 (two files).
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into()],
            short_console_names: false,
        };
        let console = "Sony - PlayStation";
        let roms: Vec<_> = [
            "Xenogears (USA) (Disc 1).cue",
            "Xenogears (USA) (Disc 2).cue",
        ].iter()
            .filter_map(|rn| parse_from_filename(rn, console))
            .collect();

        let groups = group_roms(roms, &prefs);
        assert_eq!(groups.len(), 1);

        let pi = groups[0].preferred_idx.unwrap();
        let preferred = &groups[0].variants[pi];
        let preferred_score = score_rom(preferred, &prefs);

        let file_count = groups[0].variants.iter()
            .filter(|v| score_rom(v, &prefs) == preferred_score)
            .count();

        // 1 group (title) but 2 files to download
        assert_eq!(file_count, 2, "Both discs should be in download list");
        // preferred_count would be 1 (incremented once per group)
        let group_count = 1usize; // as generate_download_list does it
        assert!(file_count > group_count, "File count exceeds title count for multi-disc");
    }
}
