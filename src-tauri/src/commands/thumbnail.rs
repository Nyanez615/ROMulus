use std::path::PathBuf;
use serde::Deserialize;
use tauri::{AppHandle, Manager};


// ── SteamGridDB API key (keyring) ─────────────────────────────────────────────

#[tauri::command]
pub fn set_steamgriddb_key(key: String) -> Result<(), String> {
    keyring::Entry::new("ROMulus", "steamgriddb_key")
        .map_err(|e| e.to_string())?
        .set_password(&key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_steamgriddb_key() -> bool {
    keyring::Entry::new("ROMulus", "steamgriddb_key")
        .and_then(|e| e.get_password())
        .is_ok()
}

#[tauri::command]
pub fn clear_steamgriddb_key() -> Result<(), String> {
    let _ = keyring::Entry::new("ROMulus", "steamgriddb_key")
        .and_then(|e| e.delete_credential());
    Ok(())
}

// ── SteamGridDB response types ────────────────────────────────────────────────

#[derive(Deserialize)]
struct SearchResponse {
    success: bool,
    data: Vec<SearchResult>,
}

#[derive(Deserialize)]
struct SearchResult {
    id: u64,
}

#[derive(Deserialize)]
struct GridResponse {
    success: bool,
    data: Vec<GridResult>,
}

#[derive(Deserialize)]
struct GridResult {
    url: String,
}

// ── Cache path ────────────────────────────────────────────────────────────────

fn thumbnail_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("thumbnails");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cache_key(title_normalized: &str, console: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    title_normalized.hash(&mut h);
    console.hash(&mut h);
    format!("{:016x}", h.finish())
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Returns the local cached file path for a game's cover art.
/// Fetches from SteamGridDB and caches if not already cached.
/// Returns None if no key configured or fetch fails.
#[tauri::command]
pub async fn get_thumbnail(
    app: AppHandle,
    title: String,
    console: String,
) -> Option<String> {
    let key = cache_key(&crate::parser::normalize_title(&title), &console);
    let cache_dir = thumbnail_cache_dir(&app).ok()?;
    let cache_path = cache_dir.join(format!("{key}.jpg"));

    // Return cached version if it exists
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().into_owned());
    }

    // Need API key to fetch
    let api_key = keyring::Entry::new("ROMulus", "steamgriddb_key")
        .ok()?
        .get_password()
        .ok()?;

    let client = reqwest::Client::new();

    // Step 1: search for the game
    let search_url = format!(
        "https://www.steamgriddb.com/api/v2/search/autocomplete/{}",
        urlencoding::encode(&title)
    );
    let search: SearchResponse = client
        .get(&search_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send().await.ok()?
        .json().await.ok()?;

    if !search.success || search.data.is_empty() {
        return None;
    }

    let game_id = search.data[0].id;

    // Step 2: get grid art for that game
    let grid_url = format!(
        "https://www.steamgriddb.com/api/v2/grids/game/{game_id}?dimensions=600x900&limit=1&mime=jpeg"
    );
    let grids: GridResponse = client
        .get(&grid_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send().await.ok()?
        .json().await.ok()?;

    if !grids.success || grids.data.is_empty() {
        return None;
    }

    // Step 3: download and cache
    let img_bytes = client
        .get(&grids.data[0].url)
        .send().await.ok()?
        .bytes().await.ok()?;

    std::fs::write(&cache_path, &img_bytes).ok()?;
    Some(cache_path.to_string_lossy().into_owned())
}
