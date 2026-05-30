#![allow(dead_code)] // Phase 1: many functions not yet called from all commands — remove when wired up

use std::sync::Mutex;

use tauri::Manager;

mod commands;
mod db;
mod deduper;
mod models;
mod parser;
mod watcher;

use commands::{execute, group, scan, settings};
use db::AppState;

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
                db: Mutex::new(conn),
                scan_cache: Mutex::new(db::ScanCache::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Scan
            scan::get_scan_status,
            scan::get_consoles,
            scan::scan_roots,
            // Games / groups
            group::get_games,
            // Execute
            execute::execute_prune,
            execute::get_interrupted_session,
            // Settings & onboarding
            settings::get_settings,
            settings::save_settings,
            settings::get_onboarding_state,
            settings::complete_onboarding_step,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
