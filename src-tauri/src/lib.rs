// All dead code is wired — no suppressor needed.

use std::sync::Mutex;
use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::Manager;

mod commands;
mod db;
mod deduper;
mod models;
mod parser;
mod watcher;

use commands::{dat, execute, group, history, metadata, prune, scan, settings, thumbnail};
use db::AppState;

fn build_menu(app: &tauri::App) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About ROMulus"),
        Some(AboutMetadata {
            name: Some("ROMulus".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            authors: Some(vec!["Nicolas Yanez".to_string()]),
            comments: Some(
                "A cross-platform ROM collection management hub.\n\
                 Organize, prune, and verify your game library."
                    .to_string(),
            ),
            copyright: Some(format!(
                "© {} Nicolas Yanez. All rights reserved.",
                chrono_year()
            )),
            license: Some("Business Source License 1.1".to_string()),
            website: Some("https://github.com/Nyanez615/ROMulus".to_string()),
            website_label: Some("GitHub Repository".to_string()),
            icon: Some(tauri::include_image!("icons/128x128@2x.png")),
            short_version: Some(String::new()), // suppress duplicate "(0.1.0)" in About panel
            ..Default::default()
        }),
    )?;

    let app_menu = Submenu::with_items(
        app,
        "ROMulus",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide ROMulus"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit ROMulus"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu])
}

fn chrono_year() -> u32 {
    // Safe constant — update when the year rolls over
    2026
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let conn = db::open(app.handle())?;
            app.manage(AppState {
                db: std::sync::Arc::new(Mutex::new(conn)),
                scan_cache: std::sync::Arc::new(Mutex::new(db::ScanCache::default())),
                watcher: Mutex::new(None),
            });
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            // Set dock icon programmatically so dev builds show the correct icon
            // (bundled release builds pick it up from the .icns automatically).
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_icon(tauri::include_image!("icons/128x128@2x.png"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Scan
            scan::get_scan_status,
            scan::get_consoles,
            scan::scan_roots,
            scan::get_format_pairs,
            scan::get_known_tags,

            // Browse — official ROMs
            group::get_roms,
            // Browse — filtered
            group::get_unofficial,
            group::get_system_files,
            group::get_duplicates,
            // Prune
            prune::apply_filters,
            prune::apply_format_pairs,
            prune::export_csv,
            // Execute
            execute::execute_prune,
            execute::execute_format_pairs,
            execute::resume_session,
            execute::get_interrupted_session,
            execute::get_empty_roots,
            execute::cleanup_empty_roots,
            // History
            history::get_history,
            history::clear_history,
            // Settings & onboarding
            settings::get_settings,
            settings::save_settings,
            settings::reapply_preferences,
            settings::get_filter_settings,
            settings::save_filter_settings,
            settings::get_onboarding_state,
            settings::complete_onboarding_step,
            // Metadata (IGDB)
            metadata::set_igdb_credentials,
            metadata::has_igdb_credentials,
            metadata::clear_igdb_credentials,
            metadata::get_game_metadata,
            metadata::get_enrichment_status,
            metadata::enrich_all_games,
            // Thumbnails (SteamGridDB)
            thumbnail::set_steamgriddb_key,
            thumbnail::has_steamgriddb_key,
            thumbnail::clear_steamgriddb_key,
            thumbnail::get_thumbnail,
            // DAT files
            dat::import_dat,
            dat::get_dat_files,
            dat::remove_dat,
            dat::verify_roms,
            dat::get_verification_status,
            dat::get_completeness,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
