use rusqlite::Connection;
use tauri::{Emitter, State};

use crate::commands::group::{group_roms, matches_preferred, merge_format_pairs, region_score};
use crate::db::{self, AppState};
use crate::deduper::detect_format_pairs;
use crate::models::{AppSettings, OnboardingState, UserPreferences};

// ── Testable inner functions ──────────────────────────────────────────────────

pub(crate) fn get_settings_inner(conn: &Connection) -> Result<AppSettings, String> {
    let theme = db::get_setting(conn, "theme")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "dark".into());

    let onedrive_acknowledged = db::get_setting(conn, "onedrive_acknowledged")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let crash_reporting_enabled = db::get_setting(conn, "crash_reporting_enabled")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let allow_permanent_delete = db::get_setting(conn, "allow_permanent_delete")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let preferred_languages: Vec<String> = db::get_setting(conn, "preferred_languages")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();

    let preferred_regions: Vec<String> = db::get_setting(conn, "preferred_regions")
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();

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

    let short_console_names = db::get_setting(conn, "short_console_names")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let format_preferences: std::collections::HashMap<String, String> = {
        let mut stmt = conn
            .prepare("SELECT console_group, preferred_folder FROM format_preferences")
            .map_err(|e| e.to_string())?;
        let mut prefs = std::collections::HashMap::new();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let group: String = row.get(0).map_err(|e| e.to_string())?;
            let folder: String = row.get(1).map_err(|e| e.to_string())?;
            prefs.insert(group, folder);
        }
        prefs
    };

    Ok(AppSettings {
        rom_roots,
        format_preferences,
        preferences: UserPreferences {
            preferred_languages,
            preferred_regions,
            short_console_names,
        },
        onedrive_acknowledged,
        terms_accepted: true,
        crash_reporting_enabled,
        allow_permanent_delete,
        theme,
    })
}

pub(crate) fn save_settings_inner(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    db::set_setting(conn, "theme", &settings.theme).map_err(|e| e.to_string())?;
    db::set_setting(
        conn,
        "onedrive_acknowledged",
        if settings.onedrive_acknowledged { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;
    db::set_setting(
        conn,
        "crash_reporting_enabled",
        if settings.crash_reporting_enabled { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;
    db::set_setting(
        conn,
        "allow_permanent_delete",
        if settings.allow_permanent_delete { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;

    let langs = serde_json::to_string(&settings.preferences.preferred_languages)
        .map_err(|e| e.to_string())?;
    db::set_setting(conn, "preferred_languages", &langs).map_err(|e| e.to_string())?;

    let regions = serde_json::to_string(&settings.preferences.preferred_regions)
        .map_err(|e| e.to_string())?;
    db::set_setting(conn, "preferred_regions", &regions).map_err(|e| e.to_string())?;

    db::set_setting(
        conn,
        "short_console_names",
        if settings.preferences.short_console_names { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;

    // Sync rom_roots: full replace so removes are reflected immediately.
    conn.execute("DELETE FROM rom_roots", [])
        .map_err(|e| e.to_string())?;
    for path in &settings.rom_roots {
        conn.execute(
            "INSERT INTO rom_roots (path) VALUES (?1)",
            rusqlite::params![path],
        )
        .map_err(|e| e.to_string())?;
    }

    // Sync format_preferences: full replace.
    conn.execute("DELETE FROM format_preferences", [])
        .map_err(|e| e.to_string())?;
    for (console_group, preferred_folder) in &settings.format_preferences {
        conn.execute(
            "INSERT INTO format_preferences (console_group, preferred_folder) VALUES (?1, ?2)",
            rusqlite::params![console_group, preferred_folder],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    get_settings_inner(&conn)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_settings_inner(&conn, &settings)
}

#[tauri::command]
pub fn reapply_preferences(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let settings = get_settings_inner(&conn)?;
    drop(conn);

    let mut cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
    if cache.roms.is_empty() {
        return Ok(());
    }

    for rom in &mut cache.roms {
        rom.matches_preferred_language = matches_preferred(rom, &settings.preferences);
        rom.matches_preferred_region = region_score(&rom.regions, &settings.preferences) > 5;
    }

    let format_pairs = detect_format_pairs(&cache.roms);
    let new_groups = group_roms(cache.roms.clone(), &settings.preferences);
    cache.groups = merge_format_pairs(new_groups, &format_pairs, &settings.preferences);
    drop(cache);

    app_handle.emit("preferences:regrouped", ()).ok();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn default_settings() -> AppSettings {
        AppSettings {
            rom_roots: vec![],
            format_preferences: std::collections::HashMap::new(),
            preferences: UserPreferences {
                preferred_languages: vec!["En".into()],
                preferred_regions: vec!["USA".into()],
                short_console_names: false,
            },
            onedrive_acknowledged: false,
            terms_accepted: true,
            crash_reporting_enabled: false,
            allow_permanent_delete: false,
            theme: "dark".into(),
        }
    }

    #[test]
    fn test_save_load_rom_roots() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.rom_roots = vec!["/path/to/roms".into(), "/other/path".into()];
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.rom_roots, s.rom_roots);
    }

    #[test]
    fn test_rom_roots_replace_on_save() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.rom_roots = vec!["/path/a".into(), "/path/b".into()];
        save_settings_inner(&conn, &s).unwrap();
        s.rom_roots = vec!["/path/c".into()];
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.rom_roots, vec!["/path/c".to_string()]);
    }

    #[test]
    fn test_save_load_preferences() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.preferences.preferred_languages = vec!["En".into(), "Ja".into()];
        s.preferences.preferred_regions = vec!["USA".into(), "Japan".into()];
        s.crash_reporting_enabled = true;
        s.theme = "light".into();
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.preferences.preferred_languages, s.preferences.preferred_languages);
        assert_eq!(loaded.preferences.preferred_regions, s.preferences.preferred_regions);
        assert!(loaded.crash_reporting_enabled);
        assert_eq!(loaded.theme, "light");
    }

    #[test]
    fn test_save_load_permanent_delete() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.allow_permanent_delete = true;
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert!(loaded.allow_permanent_delete);
    }

    #[test]
    fn test_default_permanent_delete_is_false() {
        let conn = db::open_in_memory();
        let loaded = get_settings_inner(&conn).unwrap();
        assert!(!loaded.allow_permanent_delete);
    }

    #[test]
    fn test_save_load_format_preferences() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.format_preferences.insert(
            "Nintendo - Family Computer Disk System".into(),
            "Nintendo - Family Computer Disk System".into(),
        );
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.format_preferences, s.format_preferences);
    }

    #[test]
    fn test_format_preferences_replace_on_save() {
        let conn = db::open_in_memory();
        let mut s = default_settings();
        s.format_preferences.insert("GroupA".into(), "FolderA".into());
        save_settings_inner(&conn, &s).unwrap();
        s.format_preferences.clear();
        s.format_preferences.insert("GroupB".into(), "FolderB".into());
        save_settings_inner(&conn, &s).unwrap();
        let loaded = get_settings_inner(&conn).unwrap();
        assert!(!loaded.format_preferences.contains_key("GroupA"));
        assert_eq!(loaded.format_preferences["GroupB"], "FolderB");
    }
}
