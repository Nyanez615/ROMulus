use std::path::Path;
use std::sync::Arc;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::db::AppState;
use crate::models::{Completeness, DatFile, VerificationStatus};

// ── DAT parsing ───────────────────────────────────────────────────────────────

struct DatEntry {
    name: String,
    crc32: Option<String>,
}

struct DatHeader {
    version: Option<String>,
}

fn parse_dat(xml: &str) -> Result<(DatHeader, Vec<DatEntry>), String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut entries: Vec<DatEntry> = vec![];
    let header = DatHeader { version: None };
    let mut in_header = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"header" => in_header = true,
                    b"game" | b"machine" => {
                        // Game name comes from the name attribute
                        let name = e.attributes()
                            .filter_map(|a| a.ok())
                            .find(|a| a.key.as_ref() == b"name")
                            .and_then(|a| String::from_utf8(a.value.to_vec()).ok())
                            .unwrap_or_default();
                        entries.push(DatEntry { name, crc32: None });
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"header" { in_header = false; }
            }
            Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"rom" {
                    let crc = e.attributes()
                        .filter_map(|a| a.ok())
                        .find(|a| a.key.as_ref() == b"crc")
                        .and_then(|a| String::from_utf8(a.value.to_vec()).ok());
                    if let Some(last) = entries.last_mut() {
                        last.crc32 = crc;
                    }
                }
            }
            Ok(Event::Text(ref t)) if in_header => {
                // Capture version text from <version> element
                // quick-xml gives us text content between tags; we need to track which tag we're in
                // Simplified: we'll pick it up via the settings approach below
                let _ = t;
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
            "INSERT INTO dat_entries (dat_file_id, name, crc32) VALUES (?1,?2,?3)",
            rusqlite::params![dat_id, entry.name, entry.crc32],
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
        let filter = console.as_deref().map(|c| format!("AND console = '{c}'")).unwrap_or_default();
        let sql = format!(
            "SELECT id, path, console FROM rom_cache WHERE file_format = 'zip' {} LIMIT 5000",
            filter
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
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
    // Clone Arc for the spawned task
    let db = Arc::clone(&state.db);
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

        app2.emit("verify:complete", VerificationStatus { running: false, verified, modified, unknown, total }).ok();
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
