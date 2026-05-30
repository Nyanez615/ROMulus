use tauri::State;

use crate::db::{self, AppState};
use crate::models::{AppSettings, OnboardingState, UserPreferences};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let theme = db::get_setting(&conn, "theme")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "dark".into());

    let onedrive_acknowledged = db::get_setting(&conn, "onedrive_acknowledged")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let crash_reporting_enabled = db::get_setting(&conn, "crash_reporting_enabled")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    // Load preferred languages and regions
    let preferred_languages: Vec<String> = db::get_setting(&conn, "preferred_languages")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();

    let preferred_regions: Vec<String> = db::get_setting(&conn, "preferred_regions")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();

    // Load ROM roots
    let rom_roots: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT path FROM rom_roots ORDER BY id")
            .map_err(|e| e.to_string())?;
        let mut roots: Vec<String> = vec![];
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            roots.push(row.get(0).map_err(|e| e.to_string())?);
        }
        roots
    };

    Ok(AppSettings {
        rom_roots,
        format_preferences: std::collections::HashMap::new(),
        preferences: UserPreferences {
            preferred_languages,
            preferred_regions,
        },
        onedrive_acknowledged,
        terms_accepted: true,
        crash_reporting_enabled,
        theme,
    })
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    db::set_setting(&conn, "theme", &settings.theme).map_err(|e| e.to_string())?;
    db::set_setting(
        &conn,
        "onedrive_acknowledged",
        if settings.onedrive_acknowledged { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;
    db::set_setting(
        &conn,
        "crash_reporting_enabled",
        if settings.crash_reporting_enabled { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;

    let langs = serde_json::to_string(&settings.preferences.preferred_languages)
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "preferred_languages", &langs).map_err(|e| e.to_string())?;

    let regions = serde_json::to_string(&settings.preferences.preferred_regions)
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "preferred_regions", &regions).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_onboarding_state(state: State<'_, AppState>) -> Result<OnboardingState, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT terms_accepted, crash_reporting_opted_in, preferences_configured,
                roots_added, first_scan_complete
         FROM onboarding WHERE id = 1",
        [],
        |row| {
            let terms: bool = row.get::<_, i32>(0)? != 0;
            let crash: bool = row.get::<_, i32>(1)? != 0;
            let prefs: bool = row.get::<_, i32>(2)? != 0;
            let roots: bool = row.get::<_, i32>(3)? != 0;
            let scan: bool = row.get::<_, i32>(4)? != 0;
            Ok(OnboardingState {
                terms_accepted: terms,
                crash_reporting_opted_in: crash,
                preferences_configured: prefs,
                roots_added: roots,
                first_scan_complete: scan,
                is_complete: terms && prefs && roots && scan,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn complete_onboarding_step(
    state: State<'_, AppState>,
    step: u32,
) -> Result<OnboardingState, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let col = match step {
        1 => "terms_accepted",
        2 => "preferences_configured",
        3 => "roots_added",
        4 => "first_scan_complete",
        _ => return Err(format!("Unknown onboarding step: {step}")),
    };

    conn.execute(
        &format!("UPDATE onboarding SET {col} = 1 WHERE id = 1"),
        [],
    )
    .map_err(|e| e.to_string())?;

    drop(conn);
    get_onboarding_state(state)
}
