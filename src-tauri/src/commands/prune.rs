use std::collections::HashMap;
use std::io::Write;
use tauri::State;

use crate::commands::group::group_matches_consoles;
use crate::db::AppState;
use crate::models::{
    ConsoleStats, DeletionItem, DeletionPlan, DeletionReason, FileCategory, RomFile, RomGroup,
};

// ── Filter application ────────────────────────────────────────────────────────

/// Apply language/region preferences to groups and return a deletion plan.
/// All file categories (Game, Unofficial, Demo, etc.) are handled identically:
/// keep the preferred variant, delete the rest.
pub(crate) fn apply_filters_inner(groups: Vec<RomGroup>) -> DeletionPlan {
    let mut to_delete: Vec<DeletionItem> = vec![];
    let mut to_keep: Vec<RomFile> = vec![];
    let mut no_preferred_count = 0u32;

    for group in &groups {
        // System files (BIOS, Video, e-Reader, Accessory) are always preserved in full —
        // language preference does not apply. If every variant in the group is a system
        // file, keep them all and skip preference logic entirely.
        let all_system = group.variants.iter().all(|r| {
            matches!(r.file_category, FileCategory::Bios | FileCategory::Video | FileCategory::EReader | FileCategory::Accessory)
        });
        if all_system {
            to_keep.extend(group.variants.clone());
            continue;
        }

        // No preferred version → delete all non-system variants.
        if !group.has_preferred_version {
            no_preferred_count += 1;
            for rom in &group.variants {
                let is_system = matches!(rom.file_category, FileCategory::Bios | FileCategory::Video | FileCategory::EReader | FileCategory::Accessory);
                if is_system {
                    to_keep.push(rom.clone());
                } else {
                    to_delete.push(DeletionItem { rom: rom.clone(), reason: DeletionReason::NoPreferredVersion });
                }
            }
            continue;
        }

        // Single-variant or multi-disc groups are always kept as-is.
        if group.variants.len() == 1 || group.disc_count > 1 {
            to_keep.extend(group.variants.clone());
            continue;
        }

        for (i, rom) in group.variants.iter().enumerate() {
            let is_system = matches!(rom.file_category, FileCategory::Bios | FileCategory::Video | FileCategory::EReader | FileCategory::Accessory);
            if is_system {
                to_keep.push(rom.clone());
            } else {
                match group.preferred_idx {
                    Some(pi) if i == pi => to_keep.push(rom.clone()),
                    _ => to_delete.push(DeletionItem {
                        rom: rom.clone(),
                        reason: DeletionReason::NonPreferred,
                    }),
                }
            }
        }
    }

    to_delete.sort_by(|a, b| {
        a.rom.console.cmp(&b.rom.console).then_with(|| a.rom.filename.cmp(&b.rom.filename))
    });

    let total_bytes = to_delete.iter().map(|item| item.rom.filesize).sum();

    let mut console_map: HashMap<String, ConsoleStats> = HashMap::new();
    for item in &to_delete {
        let e = console_map.entry(item.rom.console.clone()).or_insert(ConsoleStats {
            name: item.rom.console.clone(),
            total_files: 0,
            total_groups: 0,
            game_files: 0,
            game_groups: 0,
            preferred_groups: 0,
            all_groups: 0,
            unofficial_files: 0,
            preferred_count: 0,
            preferred_explicit_count: 0,
            preferred_inferred_count: 0,
            system_file_count: 0,
            marked_for_deletion: 0,
            bytes_to_free: 0,
            total_bytes: 0,
        });
        e.marked_for_deletion += 1;
        e.bytes_to_free += item.rom.filesize;
    }
    for rom in &to_keep {
        let e = console_map.entry(rom.console.clone()).or_insert(ConsoleStats {
            name: rom.console.clone(),
            total_files: 0,
            total_groups: 0,
            game_files: 0,
            game_groups: 0,
            preferred_groups: 0,
            all_groups: 0,
            unofficial_files: 0,
            preferred_count: 0,
            preferred_explicit_count: 0,
            preferred_inferred_count: 0,
            system_file_count: 0,
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

/// Produce a deletion plan for all groups (optionally scoped to a console list).
#[tauri::command]
pub fn apply_filters(
    state: State<'_, AppState>,
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

    Ok(apply_filters_inner(groups))
}

// ── CSV helper ────────────────────────────────────────────────────────────────

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn deletion_reason_str(r: &DeletionReason) -> &'static str {
    match r {
        DeletionReason::NonPreferred       => "non_preferred",
        DeletionReason::NoPreferredVersion => "no_preferred_version",
    }
}

fn file_category_label(cat: &FileCategory) -> &'static str {
    match cat {
        FileCategory::Game       => "game",
        FileCategory::Unofficial => "unofficial",
        FileCategory::Bios       => "bios",
        FileCategory::Utility    => "utility",
        FileCategory::Demo       => "demo",
        FileCategory::Video      => "video",
        FileCategory::EReader    => "e_reader",
        FileCategory::Accessory  => "accessory",
    }
}

/// Export a deletion plan (checked subset) to a CSV file at the given path.
#[tauri::command]
pub fn export_csv(to_delete: Vec<DeletionItem>, path: String) -> Result<(), String> {
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    writeln!(file, "path,filename,console,title,regions,languages,status_flags,file_category,filesize,reason")
        .map_err(|e| e.to_string())?;
    for item in &to_delete {
        let rom = &item.rom;
        writeln!(
            file,
            "{},{},{},{},{},{},{},{},{},{}",
            csv_escape(&rom.path),
            csv_escape(&rom.filename),
            csv_escape(&rom.console),
            csv_escape(&rom.title),
            csv_escape(&rom.regions.join("|")),
            csv_escape(&rom.languages.join("|")),
            csv_escape(&rom.status_flags.join("|")),
            file_category_label(&rom.file_category),
            rom.filesize,
            deletion_reason_str(&item.reason),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileCategory, RomFile, RomGroup};

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
            build_date: None,
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
    fn preferred_idx_keeps_exactly_one() {
        let mut preferred = make_rom("Game (USA)", FileCategory::Game);
        preferred.matches_preferred_language = true;
        let mut other_en = make_rom("Game (Europe)", FileCategory::Game);
        other_en.matches_preferred_language = true;
        let mut japan = make_rom("Game (Japan)", FileCategory::Game);
        japan.matches_preferred_language = false;

        let mut group = make_group(vec![preferred, other_en, japan]);
        group.preferred_idx = Some(0);
        group.has_preferred_version = true;

        let plan = apply_filters_inner(vec![group]);
        assert_eq!(plan.to_keep.len(), 1, "exactly one ROM should be kept");
        assert_eq!(plan.to_delete.len(), 2);
        assert!(plan.to_delete.iter().all(|d| matches!(d.reason, DeletionReason::NonPreferred)));
    }

    #[test]
    fn unofficial_variants_pruned_like_game_variants() {
        // Unofficial files now go through the same preferred_idx logic as Game files.
        // The preferred version is kept; the non-preferred is deleted as NonPreferred.
        let mut preferred = make_rom("Hack (En)", FileCategory::Unofficial);
        preferred.matches_preferred_language = true;
        let non_preferred = make_rom("Hack (Ja)", FileCategory::Unofficial);
        let mut group = make_group(vec![preferred, non_preferred]);
        group.preferred_idx = Some(0);
        group.has_preferred_version = true;

        let plan = apply_filters_inner(vec![group]);
        assert_eq!(plan.to_keep.len(), 1, "preferred unofficial must be kept");
        assert_eq!(plan.to_delete.len(), 1, "non-preferred unofficial must be deleted");
        assert!(matches!(plan.to_delete[0].reason, DeletionReason::NonPreferred));
    }

    #[test]
    fn unofficial_group_no_preferred_version_deletes_all() {
        // Unofficial groups with no language match behave identically to Game groups.
        let group = make_group(vec![make_rom("Hack (Ja)", FileCategory::Unofficial)]);
        let plan = apply_filters_inner(vec![group]);
        assert_eq!(plan.to_delete.len(), 1, "unofficial with no preferred version should be deleted");
        assert!(matches!(plan.to_delete[0].reason, DeletionReason::NoPreferredVersion));
    }

    #[test]
    fn prerelease_only_group_is_kept_as_preferred() {
        // When a pre-release is the only matching-language variant, scoring picks it as
        // preferred_idx — we keep it rather than deleting the only playable copy.
        let mut beta = make_rom("Game (USA) (Beta)", FileCategory::Game);
        beta.matches_preferred_language = true;
        beta.status_flags = vec!["Beta".into()];

        let mut group = make_group(vec![beta]);
        group.preferred_idx = Some(0);
        group.has_preferred_version = true;

        let plan = apply_filters_inner(vec![group]);
        assert_eq!(plan.to_keep.len(), 1, "pre-release kept when it is the only preferred variant");
        assert!(plan.to_delete.is_empty());
    }

    #[test]
    fn prerelease_deleted_when_release_exists() {
        // When a release and a beta both exist, scoring makes the release preferred_idx.
        // The beta is deleted as NonPreferred.
        let mut release = make_rom("Game (USA)", FileCategory::Game);
        release.matches_preferred_language = true;
        let mut beta = make_rom("Game (USA) (Beta)", FileCategory::Game);
        beta.matches_preferred_language = true;
        beta.status_flags = vec!["Beta".into()];

        let mut group = make_group(vec![release, beta]);
        group.preferred_idx = Some(0); // release wins in scoring
        group.has_preferred_version = true;

        let plan = apply_filters_inner(vec![group]);
        assert_eq!(plan.to_keep.len(), 1);
        assert_eq!(plan.to_delete.len(), 1);
        assert!(matches!(plan.to_delete[0].reason, DeletionReason::NonPreferred));
    }


}
