use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, SET_COOKIE};
use serde::Deserialize;
use tauri::State;

use crate::commands::group::{group_roms, merge_format_pairs};
use crate::deduper::detect_format_pairs;
use crate::commands::settings::get_settings_inner;
use crate::db::{get_setting, set_setting, AppState};
use crate::models::{QbtApplyResult, QbtFileDecision, QbtFilterPreview, QbtGroupInfo, QbtSettings, QbtTorrent};
use crate::parser::parse_from_filename;

// ── Keyring ───────────────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "ROMulus";
const KEYRING_KEY: &str = "qbt_password";

// ── Settings keys (KV table) ──────────────────────────────────────────────────

const KEY_HOST: &str = "qbt_host";
const KEY_USER: &str = "qbt_user";
const KEY_NO_AUTH: &str = "qbt_no_auth";

// ── qBt API response shapes ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct QbtTorrentInfo {
    hash: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct QbtFileEntry {
    /// Added in Web API v2.1; absent in older builds — fall back to positional index.
    index: Option<u32>,
    name: String,
    /// Can be -1 ("mixed") at the folder level or for torrents not yet started.
    #[serde(default)]
    #[allow(dead_code)]
    priority: i32,
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/// Build a reqwest client and, when auth is required, log in to qBittorrent.
/// Returns `(client, cookie_header)` — the cookie header is empty for no-auth mode.
async fn qbt_connect(settings: &QbtSettingsInner) -> Result<(reqwest::Client, String), String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    if settings.no_auth {
        return Ok((client, String::new()));
    }

    let url = format!("http://{}/api/v2/auth/login", settings.host);
    let referer = format!("http://{}", settings.host);

    let resp = client
        .post(&url)
        .header(REFERER, HeaderValue::from_str(&referer).unwrap_or_else(|_| HeaderValue::from_static("")))
        .form(&[("username", settings.user.as_str()), ("password", settings.password.as_str())])
        .send()
        .await
        .map_err(|e| format!("qBittorrent connection failed: {e}"))?;

    // Extract SID cookie from Set-Cookie header
    let sid = resp
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .find_map(|v| {
            let s = v.to_str().ok()?;
            let pair = s.split(';').next()?;
            pair.strip_prefix("SID=").map(str::to_string)
        })
        .ok_or_else(|| "Login failed: no SID cookie in response".to_string())?;

    let body = resp.text().await.unwrap_or_default();
    if body.trim() == "Fails." {
        return Err("Login failed: wrong credentials".to_string());
    }

    Ok((client, format!("SID={sid}")))
}

// ── Internal settings struct ──────────────────────────────────────────────────

struct QbtSettingsInner {
    host: String,
    user: String,
    password: String,
    no_auth: bool,
}

fn load_qbt_settings(conn: &rusqlite::Connection) -> Result<QbtSettingsInner, String> {
    let host = get_setting(conn, KEY_HOST)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "localhost:8080".to_string());
    let user = get_setting(conn, KEY_USER)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "admin".to_string());
    let no_auth = get_setting(conn, KEY_NO_AUTH)
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);
    let password = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY)
        .and_then(|e| e.get_password())
        .unwrap_or_default();

    Ok(QbtSettingsInner { host, user, password, no_auth })
}

// ── Request helper ────────────────────────────────────────────────────────────

fn with_auth(mut headers: HeaderMap, cookie: &str) -> HeaderMap {
    if !cookie.is_empty() {
        if let Ok(v) = HeaderValue::from_str(cookie) {
            headers.insert(COOKIE, v);
        }
    }
    headers
}

// ── Console detection ─────────────────────────────────────────────────────────

/// Returns the immediate parent folder of a torrent file path.
///
/// No-Intro torrents use a structure like:
///   `Minerva_Myrient/No-Intro/Nintendo - amiibo/282 - Isabelle (World).zip`
///
/// The console folder is the segment directly above the filename, not the
/// torrent root. Using `rsplit` twice gives us that segment regardless of
/// how many levels deep the path is.
fn file_parent_folder(path: &str) -> &str {
    // rsplit gives [filename, "rest/of/path"], or just [filename] for no slash
    let mut iter = path.rsplitn(2, '/');
    iter.next(); // discard filename
    // from the remaining "rest/of/path", take the last segment
    iter.next()
        .and_then(|parent_path| parent_path.rsplit('/').next())
        .unwrap_or("")
}

/// Detects the console folder from the first file in the torrent.
/// Shows "Nintendo - amiibo", not "Minerva_Myrient".
fn detect_console(files: &[QbtFileEntry]) -> Option<String> {
    let first_path = files.first().map(|f| f.name.as_str())?;
    let folder = file_parent_folder(first_path);
    if folder.is_empty() {
        None
    } else {
        Some(folder.to_string())
    }
}

// ── Shared filter logic ───────────────────────────────────────────────────────

struct FilterResult {
    console_name: Option<String>,
    /// (file_index, filename, is_preferred)
    decisions: Vec<(u32, String, bool)>,
    /// Groups produced by group_roms — used to build QbtGroupInfo without
    /// re-collapsing catalog-number-split groups back to the same key.
    groups: Vec<crate::models::RomGroup>,
}

async fn run_filter(
    state: &AppState,
    hash: &str,
) -> Result<FilterResult, String> {
    let (settings, prefs, format_prefs) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let s = load_qbt_settings(&conn)?;
        let app_settings = get_settings_inner(&conn)?;
        let fp = crate::commands::settings::load_format_preferences(&conn)
            .map_err(|e| e.to_string())?;
        (s, app_settings.preferences, fp)
    };

    let (client, cookie) = qbt_connect(&settings).await?;
    let url = format!("http://{}/api/v2/torrents/files?hash={}", settings.host, hash);

    let mut req_headers = HeaderMap::new();
    req_headers = with_auth(req_headers, &cookie);

    let files: Vec<QbtFileEntry> = client
        .get(&url)
        .headers(req_headers)
        .send()
        .await
        .map_err(|e| format!("Failed to get torrent files: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse torrent files: {e}"))?;

    let console_name = detect_console(&files);

    // Parse each file using its own parent folder as the console name.
    // This correctly handles multi-console torrents and gives the parser
    // the "Nintendo - amiibo" context it needs for BIOS/figurine detection.
    // Use the enumeration position as a fallback file index when the API
    // omits the `index` field (Web API < v2.1) or returns it as null.
    let roms: Vec<_> = files
        .iter()
        .enumerate()
        .filter_map(|(pos, f)| {
            let idx = f.index.unwrap_or(pos as u32);
            let basename = f.name.split('/').next_back().unwrap_or(&f.name);
            let console = file_parent_folder(&f.name);
            parse_from_filename(basename, console).map(|rom| (idx, rom))
        })
        .collect();

    // Group with identical logic used by post-download prune, then apply
    // format variant preferences (e.g. "prefer GBA over GBA (Aftermarket)").
    let rom_vec: Vec<_> = roms.iter().map(|(_, r)| r.clone()).collect();
    let format_pairs = detect_format_pairs(&rom_vec);
    let groups = group_roms(rom_vec, &prefs);
    let groups = merge_format_pairs(groups, &format_pairs, &prefs, &format_prefs);

    // For each group, mark preferred index as priority 1, rest as 0
    let mut decisions: Vec<(u32, String, bool)> = Vec::new();

    for group in &groups {
        for (variant_pos, rom) in group.variants.iter().enumerate() {
            let file_index = roms
                .iter()
                .find(|(_, r)| r.filename == rom.filename)
                .map(|(idx, _)| *idx)
                .unwrap_or(0);

            let is_preferred = !rom.file_category.is_non_playable()
                && group.preferred_idx == Some(variant_pos);
            decisions.push((file_index, rom.filename.clone(), is_preferred));
        }
    }

    // Files that failed to parse are kept (priority 1)
    for (pos, f) in files.iter().enumerate() {
        let idx = f.index.unwrap_or(pos as u32);
        let basename = f.name.split('/').next_back().unwrap_or(&f.name);
        if !decisions.iter().any(|(_, name, _)| name == basename) {
            decisions.push((idx, basename.to_string(), true));
        }
    }

    Ok(FilterResult { console_name, decisions, groups })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_qbt_settings(
    state: State<'_, AppState>,
    host: String,
    user: String,
    password: Option<String>,
    no_auth: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    set_setting(&conn, KEY_HOST, &host).map_err(|e| e.to_string())?;
    set_setting(&conn, KEY_USER, &user).map_err(|e| e.to_string())?;
    set_setting(&conn, KEY_NO_AUTH, if no_auth { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    if let Some(pw) = password {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY)
            .and_then(|e| e.set_password(&pw))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_qbt_settings(state: State<'_, AppState>) -> Result<QbtSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let host = get_setting(&conn, KEY_HOST)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "localhost:8080".to_string());
    let user = get_setting(&conn, KEY_USER)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "admin".to_string());
    let no_auth = get_setting(&conn, KEY_NO_AUTH)
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);
    let has_password = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY)
        .and_then(|e| e.get_password())
        .map(|p| !p.is_empty())
        .unwrap_or(false);
    Ok(QbtSettings { host, user, has_password, no_auth })
}

#[tauri::command]
pub async fn test_qbt_connection(state: State<'_, AppState>) -> Result<bool, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        load_qbt_settings(&conn)?
    };
    qbt_connect(&settings).await.map(|_| true)
}

#[tauri::command]
pub async fn list_qbt_torrents(state: State<'_, AppState>) -> Result<Vec<QbtTorrent>, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        load_qbt_settings(&conn)?
    };

    let (client, cookie) = qbt_connect(&settings).await?;
    let url = format!("http://{}/api/v2/torrents/info", settings.host);

    let mut headers = HeaderMap::new();
    headers = with_auth(headers, &cookie);

    let infos: Vec<QbtTorrentInfo> = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Failed to list torrents: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse torrent list: {e}"))?;

    // For each torrent, get file count with a separate call
    let mut results = Vec::with_capacity(infos.len());
    for info in infos {
        let files_url = format!(
            "http://{}/api/v2/torrents/files?hash={}",
            settings.host, info.hash
        );
        let mut fh = HeaderMap::new();
        fh = with_auth(fh, &cookie);
        let (count, console_folder) = match client.get(&files_url).headers(fh).send().await {
            Ok(resp) => match resp.json::<Vec<QbtFileEntry>>().await {
                Ok(files) => (files.len() as u32, detect_console(&files)),
                Err(_) => (0, None),
            },
            Err(_) => (0, None),
        };
        results.push(QbtTorrent {
            hash: info.hash,
            name: info.name,
            num_files: count,
            console_folder,
        });
    }
    Ok(results)
}

#[tauri::command]
pub async fn preview_qbt_filter(
    state: State<'_, AppState>,
    hash: String,
) -> Result<QbtFilterPreview, String> {
    let result = run_filter(&state, &hash).await?;

    let total = result.decisions.len() as u32;
    let to_download = result.decisions.iter().filter(|(_, _, p)| *p).count() as u32;
    let to_skip = total - to_download;

    // Full per-file decision list (all files, ordered as received from qBt)
    let mut files: Vec<QbtFileDecision> = result.decisions.iter()
        .map(|(_, filename, is_preferred)| QbtFileDecision {
            filename: filename.clone(),
            download: *is_preferred,
        })
        .collect();
    files.sort_by(|a, b| a.filename.cmp(&b.filename));

    // Build title groups directly from the groups produced by group_roms.
    // Re-grouping from decisions by picker::group_key would collapse catalog-number-split
    // groups (e.g. 9 × "4 in 1 (4B-00N, Sachen)") back to a single key, making 8 of
    // the 9 downloads invisible in the Titles view.
    let mut multi_variant_groups: Vec<QbtGroupInfo> = result.groups
        .iter()
        .filter_map(|g| {
            let preferred_idx = g.preferred_idx?; // skip no-preferred-version groups
            // Skip groups where the preferred variant is non-playable (BIOS, Utility, etc.)
            if g.variants[preferred_idx].file_category.is_non_playable() {
                return None;
            }
            let chosen_name = g.variants[preferred_idx].filename.clone();

            let mut skipped: Vec<String> = g.variants.iter().enumerate()
                .filter(|(i, r)| *i != preferred_idx && !r.file_category.is_non_playable())
                .map(|(_, r)| r.filename.clone())
                .collect();
            skipped.sort();

            // Append catalog number to both key (for React stability) and display title
            // (so the user can distinguish "4 in 1 · 4B-001" from "4 in 1 · 4B-002").
            let base_key = crate::picker::group_key(&chosen_name);
            let key = if let Some(ref cat) = g.catalog_number {
                format!("{} ({})", base_key, cat.to_lowercase())
            } else {
                base_key
            };
            let display_title = if let Some(ref cat) = g.catalog_number {
                format!("{} · {}", crate::picker::display_title(&chosen_name), cat)
            } else {
                crate::picker::display_title(&chosen_name)
            };

            Some(QbtGroupInfo { key, display_title, chosen: chosen_name, skipped })
        })
        .collect();
    multi_variant_groups.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(QbtFilterPreview {
        console_name: result.console_name,
        total,
        to_download,
        to_skip,
        files,
        multi_variant_groups,
    })
}

#[tauri::command]
pub async fn apply_qbt_filter(
    state: State<'_, AppState>,
    hash: String,
) -> Result<QbtApplyResult, String> {
    let result = run_filter(&state, &hash).await?;

    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        load_qbt_settings(&conn)?
    };
    let (client, cookie) = qbt_connect(&settings).await?;

    // Build priority 1 (download) and 0 (skip) index lists
    let download_ids: Vec<u32> = result.decisions.iter().filter(|(_, _, p)| *p).map(|(i, _, _)| *i).collect();
    let skip_ids: Vec<u32> = result.decisions.iter().filter(|(_, _, p)| !p).map(|(i, _, _)| *i).collect();

    let to_download = download_ids.len() as u32;
    let to_skip = skip_ids.len() as u32;

    let base_url = format!("http://{}/api/v2/torrents/filePrio", settings.host);

    // Set download priorities
    if !download_ids.is_empty() {
        let ids_str = download_ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join("|");
        let mut h = HeaderMap::new();
        h = with_auth(h, &cookie);
        client
            .post(&base_url)
            .headers(h)
            .form(&[("hash", hash.as_str()), ("id", ids_str.as_str()), ("priority", "1")])
            .send()
            .await
            .map_err(|e| format!("Failed to set download priorities: {e}"))?;
    }

    // Set skip priorities
    if !skip_ids.is_empty() {
        let ids_str = skip_ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join("|");
        let mut h = HeaderMap::new();
        h = with_auth(h, &cookie);
        client
            .post(&base_url)
            .headers(h)
            .form(&[("hash", hash.as_str()), ("id", ids_str.as_str()), ("priority", "0")])
            .send()
            .await
            .map_err(|e| format!("Failed to set skip priorities: {e}"))?;
    }

    Ok(QbtApplyResult { to_download, to_skip })
}
