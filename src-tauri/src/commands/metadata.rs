use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::db::{self, AppState};
use crate::models::{EnrichmentStatus, FileCategory, GameMetadata};

// ── IGDB platform IDs ─────────────────────────────────────────────────────────

fn console_to_igdb_platform(console: &str) -> Option<u32> {
    if console.contains("Game Boy Advance") { return Some(24); }
    if console.contains("Game Boy Color")   { return Some(22); }
    if console.contains("Game Boy")         { return Some(33); }
    if console.contains("Super Nintendo")   { return Some(58); }
    if console.contains("Nintendo Entertainment System") { return Some(37); }
    if console.contains("Nintendo 64")      { return Some(18); }
    if console.contains("Family Computer")  { return Some(37); }
    if console.contains("Virtual Boy")      { return Some(87); }
    None
}

fn year_from_timestamp(ts: i64) -> i32 {
    (1970.0 + ts as f64 / (365.25 * 86400.0)) as i32
}

// ── Credentials ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_igdb_credentials(client_id: String, secret: String) -> Result<(), String> {
    keyring::Entry::new("ROMulus", "igdb_client_id")
        .map_err(|e| e.to_string())?.set_password(&client_id).map_err(|e| e.to_string())?;
    keyring::Entry::new("ROMulus", "igdb_client_secret")
        .map_err(|e| e.to_string())?.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_igdb_credentials() -> bool {
    keyring::Entry::new("ROMulus", "igdb_client_id")
        .and_then(|e| e.get_password()).is_ok()
}

#[tauri::command]
pub fn clear_igdb_credentials() -> Result<(), String> {
    let _ = keyring::Entry::new("ROMulus", "igdb_client_id").and_then(|e| e.delete_credential());
    let _ = keyring::Entry::new("ROMulus", "igdb_client_secret").and_then(|e| e.delete_credential());
    Ok(())
}

// ── IGDB OAuth token ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TwitchTokenResponse { access_token: String, expires_in: u64 }

async fn get_igdb_token(db: &Arc<std::sync::Mutex<rusqlite::Connection>>) -> Result<(String, String), String> {
    let client_id = keyring::Entry::new("ROMulus", "igdb_client_id")
        .map_err(|e| e.to_string())?.get_password().map_err(|_| "IGDB credentials not configured".to_string())?;
    let secret = keyring::Entry::new("ROMulus", "igdb_client_secret")
        .map_err(|e| e.to_string())?.get_password().map_err(|_| "IGDB credentials not configured".to_string())?;

    // Check cached token
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Ok(Some(token)) = db::get_setting(&conn, "igdb_token") {
            if let Ok(Some(exp_str)) = db::get_setting(&conn, "igdb_token_expiry") {
                let exp: u64 = exp_str.parse().unwrap_or(0);
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                if now < exp.saturating_sub(60) { return Ok((client_id, token)); }
            }
        }
    }

    let resp = reqwest::Client::new()
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[("client_id", client_id.as_str()), ("client_secret", secret.as_str()), ("grant_type", "client_credentials")])
        .send().await.map_err(|e| format!("Token request: {e}"))?
        .json::<TwitchTokenResponse>().await.map_err(|e| format!("Token parse: {e}"))?;

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "igdb_token", &resp.access_token).ok();
    db::set_setting(&conn, "igdb_token_expiry", &(now + resp.expires_in).to_string()).ok();
    Ok((client_id, resp.access_token))
}

// ── IGDB game lookup ──────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct IgdbGame {
    id: i64,
    name: Option<String>,
    first_release_date: Option<i64>,
    #[serde(default)] genres: Vec<IgdbGenre>,
    summary: Option<String>,
    rating: Option<f64>,
    cover: Option<IgdbCover>,
}
#[derive(Deserialize, Debug)] struct IgdbGenre { name: String }
#[derive(Deserialize, Debug)] struct IgdbCover { url: String }

async fn fetch_igdb_metadata(title: &str, console: &str, client_id: &str, token: &str) -> Result<Option<GameMetadata>, String> {
    let platform_filter = console_to_igdb_platform(console)
        .map(|p| format!(" & platforms = ({p})")).unwrap_or_default();
    let safe_title = title.replace('"', "\\\"");
    let query = format!("fields name,first_release_date,genres.name,summary,rating,cover.url; where name ~ \"{safe_title}\"{platform_filter}; limit 3;");

    let resp = reqwest::Client::new()
        .post("https://api.igdb.com/v4/games")
        .header("Authorization", format!("Bearer {token}"))
        .header("Client-ID", client_id)
        .body(query)
        .send().await.map_err(|e| format!("IGDB request: {e}"))?;

    if !resp.status().is_success() { return Err(format!("IGDB returned {}", resp.status())); }

    let games: Vec<IgdbGame> = resp.json().await.map_err(|e| e.to_string())?;
    let game = match games.into_iter().next() { Some(g) => g, None => return Ok(None) };

    let cover_url = game.cover.map(|c| c.url.replace("t_thumb", "t_cover_big").replace("//", "https://"));

    Ok(Some(GameMetadata {
        title_normalized: crate::parser::normalize_title(title),
        console: console.to_string(),
        igdb_id: Some(game.id),
        name: game.name,
        release_year: game.first_release_date.map(year_from_timestamp),
        genres: game.genres.into_iter().map(|g| g.name).collect(),
        summary: game.summary,
        rating: game.rating,
        cover_url,
    }))
}

// ── SQLite helpers ────────────────────────────────────────────────────────────

pub fn load_cached_metadata(conn: &rusqlite::Connection, title_normalized: &str, console: &str) -> Result<Option<GameMetadata>, String> {
    let r = conn.query_row(
        "SELECT igdb_id,name,release_year,genres,summary,rating,cover_url FROM game_metadata WHERE title_normalized=?1 AND console=?2",
        rusqlite::params![title_normalized, console],
        |row| Ok(GameMetadata {
            title_normalized: title_normalized.to_string(), console: console.to_string(),
            igdb_id: row.get(0)?, name: row.get(1)?, release_year: row.get(2)?,
            genres: row.get::<_,Option<String>>(3)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
            summary: row.get(4)?, rating: row.get(5)?, cover_url: row.get(6)?,
        }),
    );
    match r {
        Ok(m) => Ok(Some(m)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_metadata(conn: &rusqlite::Connection, meta: &GameMetadata) -> Result<(), String> {
    let genres = serde_json::to_string(&meta.genres).unwrap_or_default();
    conn.execute(
        "INSERT INTO game_metadata (title_normalized,console,igdb_id,name,release_year,genres,summary,rating,cover_url)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(title_normalized,console) DO UPDATE SET
           igdb_id=excluded.igdb_id,name=excluded.name,release_year=excluded.release_year,
           genres=excluded.genres,summary=excluded.summary,rating=excluded.rating,
           cover_url=excluded.cover_url,fetched_at=datetime('now')",
        rusqlite::params![meta.title_normalized,meta.console,meta.igdb_id,meta.name,meta.release_year,genres,meta.summary,meta.rating,meta.cover_url],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_game_metadata(state: State<'_, AppState>, title: String, console: String) -> Result<Option<GameMetadata>, String> {
    let title_normalized = crate::parser::normalize_title(&title);
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(m) = load_cached_metadata(&conn, &title_normalized, &console)? { return Ok(Some(m)); }
    }
    let (client_id, token) = get_igdb_token(&state.db).await?;
    if let Some(meta) = fetch_igdb_metadata(&title, &console, &client_id, &token).await? {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        save_metadata(&conn, &meta)?;
        return Ok(Some(meta));
    }
    Ok(None)
}

#[tauri::command]
pub fn get_enrichment_status(state: State<'_, AppState>) -> EnrichmentStatus {
    state.scan_cache.lock().map(|c| c.enrichment.clone()).unwrap_or_default()
}

#[tauri::command]
pub async fn enrich_all_games(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let roms = {
        let cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
        let mut seen = std::collections::HashSet::new();
        cache.roms.iter()
            .filter(|r| matches!(r.file_category, FileCategory::Game))
            .filter_map(|r| {
                let key = (r.title_normalized.clone(), r.console.clone());
                if seen.insert(key) { Some((r.title.clone(), r.console.clone())) } else { None }
            })
            .collect::<Vec<_>>()
    };
    let total = roms.len() as u32;
    let (client_id, token) = get_igdb_token(&state.db).await?;

    // Clone Arc for the spawned task
    let db = Arc::clone(&state.db);
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        for (i, (title, console)) in roms.iter().enumerate() {
            app2.emit("enrich:progress", EnrichmentStatus {
                running: true, enriched: i as u32, total, current_title: Some(title.clone()),
            }).ok();

            if let Ok(Some(meta)) = fetch_igdb_metadata(title, console, &client_id, &token).await {
                if let Ok(conn) = db.lock() { let _ = save_metadata(&conn, &meta); }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }
        app2.emit("enrich:complete", EnrichmentStatus { running: false, enriched: total, total, current_title: None }).ok();
        let _ = app2.notification().builder().title("ROMulus").body(format!("Metadata enrichment complete — {total} games updated")).show();
    });
    Ok(())
}
