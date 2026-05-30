use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use std::collections::HashMap;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::models::NewRomEvent;
use crate::parser;

const DEBOUNCE_MS: u64 = 200;

/// Start watching all configured ROM root directories.
/// Returns the watcher (must be kept alive — drop to stop watching).
pub fn start(app: AppHandle, roots: &[String]) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;

    for root in roots {
        let path = Path::new(root);
        if path.exists() {
            watcher.watch(path, RecursiveMode::Recursive)?;
        }
    }

    // Spawn a thread to process events with debouncing
    std::thread::spawn(move || {
        process_events(rx, app);
    });

    Ok(watcher)
}

fn process_events(rx: mpsc::Receiver<notify::Result<Event>>, app: AppHandle) {
    // Debounce: track last seen event time per path
    let mut pending: HashMap<String, Instant> = HashMap::new();

    loop {
        // Collect events with a short timeout
        match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Create(_)) {
                    for path in &event.paths {
                        if let Some(p) = path.to_str() {
                            pending.insert(p.to_string(), Instant::now());
                        }
                    }
                }
            }
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Flush debounced events older than DEBOUNCE_MS
                let now = Instant::now();
                let ready: Vec<String> = pending
                    .iter()
                    .filter(|(_, t)| now.duration_since(**t).as_millis() >= DEBOUNCE_MS as u128)
                    .map(|(p, _)| p.clone())
                    .collect();

                for path_str in ready {
                    pending.remove(&path_str);
                    let path = std::path::Path::new(&path_str);

                    // Derive console name from parent directory
                    let console = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();

                    // Only emit if it parses as a valid ROM
                    if let Ok(meta) = std::fs::metadata(path) {
                        if meta.len() > 0
                            && parser::parse_file(path, &console, meta.len(), 0).is_some()
                        {
                            let _ = app.emit(
                                "watcher:new_rom",
                                NewRomEvent {
                                    path: path_str,
                                    console,
                                },
                            );
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}
