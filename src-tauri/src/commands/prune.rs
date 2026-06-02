use std::io::Write;
use tauri::State;

use crate::commands::group::group_matches_consoles;
use crate::db::AppState;
use crate::models::{
    ConsoleStats, DeletionPlan, FileCategory, FilterSettings, RomFile,
};

// ── Filter application ────────────────────────────────────────────────────────

pub(crate) fn apply_filters_inner(groups: Vec<crate::models::RomGroup>, settings: &FilterSettings) -> DeletionPlan {
    let mut to_delete: Vec<RomFile> = vec![];
    let mut to_keep: Vec<RomFile> = vec![];
    let mut no_preferred_count = 0u32;

    for group in &groups {
        let all_unofficial = group.variants.iter().all(|v| matches!(v.file_category, FileCategory::Unofficial));

        // No preferred version → delete all if flag set (official groups only; unofficial have
        // no meaningful "preferred version" concept so don't nuke them on this criterion).
        if !all_unofficial && !group.has_preferred_version && settings.remove_if_no_preferred_version {
            no_preferred_count += 1;
            to_delete.extend(group.variants.clone());
            continue;
        }

        // Single-variant group is always kept
        if group.variants.len() == 1 || group.disc_count > 1 {
            to_keep.extend(group.variants.clone());
            continue;
        }

        let max_revision = group.variants.iter().map(|v| v.revision).max().unwrap_or(0);

        for (i, rom) in group.variants.iter().enumerate() {
            // BIOS always kept
            if rom.is_bios {
                to_keep.push(rom.clone());
                continue;
            }
            // Unofficial variants — respect remove_unofficial toggle
            if matches!(rom.file_category, FileCategory::Unofficial) {
                if settings.remove_unofficial {
                    if rom.is_unofficial_preferred_fallback && settings.keep_unofficial_as_fallback {
                        to_keep.push(rom.clone());
                    } else {
                        to_delete.push(rom.clone());
                    }
                } else {
                    to_keep.push(rom.clone());
                }
                continue;
            }
            // Remove pre-release
            if settings.remove_prerelease
                && rom.status_flags.iter().any(|f| {
                    matches!(f.as_str(), "Beta" | "Proto" | "Demo" | "Sample" | "Promo" | "Kiosk")
                })
            {
                to_delete.push(rom.clone());
                continue;
            }
            // Remove older revisions
            if settings.remove_older_revisions && rom.revision < max_revision {
                to_delete.push(rom.clone());
                continue;
            }
            // Non-preferred variant
            if settings.keep_preferred_only {
                let is_preferred = group.preferred_idx == Some(i);
                if is_preferred || !rom.matches_preferred_language {
                    if is_preferred {
                        to_keep.push(rom.clone());
                    } else {
                        to_delete.push(rom.clone());
                    }
                } else {
                    to_keep.push(rom.clone());
                }
            } else {
                to_keep.push(rom.clone());
            }
        }
    }

    to_delete.sort_by(|a, b| a.console.cmp(&b.console).then_with(|| a.filename.cmp(&b.filename)));

    let total_bytes = to_delete.iter().map(|r| r.filesize).sum();

    let mut console_map: std::collections::HashMap<String, ConsoleStats> =
        std::collections::HashMap::new();
    for rom in &to_delete {
        let e = console_map.entry(rom.console.clone()).or_insert(ConsoleStats {
            name: rom.console.clone(),
            total_files: 0,
            preferred_count: 0,
            marked_for_deletion: 0,
            bytes_to_free: 0,
            total_bytes: 0,
        });
        e.marked_for_deletion += 1;
        e.bytes_to_free += rom.filesize;
    }
    for rom in &to_keep {
        let e = console_map.entry(rom.console.clone()).or_insert(ConsoleStats {
            name: rom.console.clone(),
            total_files: 0,
            preferred_count: 0,
            marked_for_deletion: 0,
            bytes_to_free: 0,
            total_bytes: 0,
        });
        e.total_files += 1;
    }

    let mut console_summary: Vec<ConsoleStats> = console_map.into_values().collect();
    console_summary.sort_by(|a, b| a.name.cmp(&b.name));

    DeletionPlan {
        to_delete,
        to_keep,
        no_preferred_version_count: no_preferred_count,
        total_bytes_freed: total_bytes,
        console_summary,
    }
}

/// Apply filter settings to all groups (optionally scoped to a console list) and produce a deletion plan.
#[tauri::command]
pub fn apply_filters(
    state: State<'_, AppState>,
    settings: FilterSettings,
    consoles: Option<Vec<String>>,
) -> Result<DeletionPlan, String> {
    let groups = {
        let cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
        let all = cache.groups.clone();
        if consoles.is_some() {
            all.into_iter().filter(|g| group_matches_consoles(g, &consoles)).collect()
        } else {
            all
        }
    };
    Ok(apply_filters_inner(groups, &settings))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileCategory, FilterSettings, RomFile, RomGroup};

    fn default_filters() -> FilterSettings {
        FilterSettings {
            keep_preferred_only: true,
            remove_if_no_preferred_version: true,
            remove_prerelease: true,
            remove_unofficial: false,
            remove_older_revisions: true,
            keep_unofficial_as_fallback: true,
        }
    }

    fn make_rom(title: &str, category: FileCategory) -> RomFile {
        RomFile {
            path: format!("/roms/{title}.zip"),
            filename: format!("{title}.zip"),
            title: title.into(),
            title_normalized: title.to_lowercase(),
            console: "Test Console".into(),
            languages: vec![],
            regions: vec![],
            revision: 0,
            disc_number: None,
            version: None,
            status_flags: vec![],
            extra_tags: vec![],
            file_category: category,
            file_format: crate::models::FileFormat::Zip,
            filesize: 1024,
            is_bios: false,
            bad_dump: false,
            matches_preferred_language: false,
            matches_preferred_region: false,
            is_unofficial_preferred_fallback: false,
        }
    }

    fn make_group(variants: Vec<RomFile>) -> RomGroup {
        RomGroup {
            title_normalized: variants[0].title.to_lowercase(),
            console: variants[0].console.clone(),
            variants,
            preferred_idx: None,
            has_preferred_version: false,
            is_format_pair: false,
            disc_count: 0,
        }
    }

    #[test]
    fn unofficial_group_deleted_when_remove_unofficial_on() {
        let group = make_group(vec![
            make_rom("Hack (En)", FileCategory::Unofficial),
            make_rom("Hack (Ja)", FileCategory::Unofficial),
        ]);
        let mut filters = default_filters();
        filters.remove_unofficial = true;
        let plan = apply_filters_inner(vec![group], &filters);
        assert_eq!(plan.to_delete.len(), 2, "all unofficial variants should be deleted");
        assert!(plan.to_keep.is_empty());
    }

    #[test]
    fn unofficial_group_kept_when_remove_unofficial_off() {
        let group = make_group(vec![
            make_rom("Hack (En)", FileCategory::Unofficial),
            make_rom("Hack (Ja)", FileCategory::Unofficial),
        ]);
        let mut filters = default_filters();
        filters.remove_unofficial = false;
        let plan = apply_filters_inner(vec![group], &filters);
        assert!(plan.to_delete.is_empty(), "unofficial variants should be kept");
        assert_eq!(plan.to_keep.len(), 2);
    }

    #[test]
    fn unofficial_group_not_deleted_by_no_preferred_version_flag() {
        // A pure hack group has no preferred language version — it should NOT be mass-deleted
        // by remove_if_no_preferred_version (that flag is for official games only).
        let group = make_group(vec![make_rom("Hack (Ja)", FileCategory::Unofficial)]);
        let mut filters = default_filters();
        filters.remove_unofficial = false;
        filters.remove_if_no_preferred_version = true;
        let plan = apply_filters_inner(vec![group], &filters);
        assert!(plan.to_delete.is_empty(), "unofficial group must not be nuked by remove_if_no_preferred_version");
    }
}

/// Export current deletion plan to a CSV file at the given path.
#[tauri::command]
pub fn export_csv(to_delete: Vec<RomFile>, path: String) -> Result<(), String> {
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    writeln!(file, "path,console,title,filesize,reason").map_err(|e| e.to_string())?;
    for rom in &to_delete {
        writeln!(
            file,
            "{},{},{},{},pruned",
            rom.path, rom.console, rom.title, rom.filesize
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
