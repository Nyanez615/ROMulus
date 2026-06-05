use std::collections::HashMap;
use std::io::Write;
use tauri::State;

use crate::commands::group::group_matches_consoles;
use crate::commands::settings::load_format_preferences;
use crate::db::AppState;
use crate::deduper::detect_format_pairs;
use crate::models::{
    ConsoleStats, DeletionItem, DeletionPlan, DeletionReason, FileCategory, FilterSettings,
    FormatPair, RomFile, RomGroup,
};

// ── Format-pair deletion helpers ──────────────────────────────────────────────

/// Returns a map of file path → DeletionReason for all files to delete due to format-pair
/// preferences. For each is_format_pair group where a preference is configured, ALL variants
/// from the non-preferred folder are included (including BIOS — the entire folder is removed).
///
/// Reason assignment:
/// - `FormatPairNonPreferred`   — title also exists in the preferred folder (safe to delete)
/// - `FormatPairNoCounterpart`  — title exists ONLY in the non-preferred folder (no counterpart)
pub(crate) fn build_format_delete_map(
    groups: &[RomGroup],
    format_prefs: &HashMap<String, String>,
    format_pairs: &[FormatPair],
) -> HashMap<String, DeletionReason> {
    let mut map = HashMap::new();
    if format_prefs.is_empty() || format_pairs.is_empty() {
        return map;
    }
    for group in groups {
        if !group.is_format_pair {
            continue;
        }
        // Find the FormatPair whose folder_a or folder_b appears in this group's variants.
        let pair = format_pairs.iter().find(|fp| {
            group.variants.iter().any(|v| v.console == fp.folder_a || v.console == fp.folder_b)
        });
        let Some(pair) = pair else { continue };
        let Some(preferred_folder) = format_prefs.get(&pair.console_group) else { continue };
        // Does this group have any variant in the preferred folder?
        let has_counterpart = group.variants.iter().any(|v| v.console == *preferred_folder);
        let reason = if has_counterpart {
            DeletionReason::FormatPairNonPreferred
        } else {
            DeletionReason::FormatPairNoCounterpart
        };
        // All non-preferred-folder variants go in the map — BIOS included.
        for rom in &group.variants {
            if rom.console != *preferred_folder {
                map.insert(rom.path.clone(), reason.clone());
            }
        }
    }
    map
}

// ── Filter application ────────────────────────────────────────────────────────

/// Apply filter settings to groups and return a deletion plan.
/// Format-pair removal is handled separately by `apply_format_pairs` — this
/// function deals exclusively with variant selection (language / region / revision).
pub(crate) fn apply_filters_inner(
    groups: Vec<RomGroup>,
    settings: &FilterSettings,
) -> DeletionPlan {
    let mut to_delete: Vec<DeletionItem> = vec![];
    let mut to_keep: Vec<RomFile> = vec![];
    let mut no_preferred_count = 0u32;

    for group in &groups {
        // No preferred version → delete all variants (game or unofficial) if flag set.
        if !group.has_preferred_version && settings.remove_if_no_preferred_version {
            no_preferred_count += 1;
            for rom in &group.variants {
                to_delete.push(DeletionItem { rom: rom.clone(), reason: DeletionReason::NoPreferredVersion });
            }
            continue;
        }

        // Single-variant or multi-disc groups are always kept as-is.
        if group.variants.len() == 1 || group.disc_count > 1 {
            to_keep.extend(group.variants.clone());
            continue;
        }

        let max_revision = group.variants.iter().map(|v| v.revision).max().unwrap_or(0);

        for (i, rom) in group.variants.iter().enumerate() {
            // BIOS always kept.
            if rom.is_bios {
                to_keep.push(rom.clone());
                continue;
            }
            // Unofficial variants — respect remove_unofficial toggle.
            if matches!(rom.file_category, FileCategory::Unofficial) {
                if settings.remove_unofficial {
                    if rom.is_unofficial_preferred_fallback && settings.keep_unofficial_as_fallback {
                        to_keep.push(rom.clone());
                    } else {
                        to_delete.push(DeletionItem { rom: rom.clone(), reason: DeletionReason::Unofficial });
                    }
                } else {
                    to_keep.push(rom.clone());
                }
                continue;
            }
            // Remove pre-release.
            if settings.remove_prerelease
                && rom.status_flags.iter().any(|f| {
                    matches!(
                        f.as_str(),
                        "Beta" | "Proto" | "Demo" | "Sample" | "Promo" | "Kiosk"
                        | "Preview" | "GameCube Preview"
                    )
                })
            {
                to_delete.push(DeletionItem { rom: rom.clone(), reason: DeletionReason::Prerelease });
                continue;
            }
            // Remove older revisions.
            if settings.remove_older_revisions && rom.revision < max_revision {
                to_delete.push(DeletionItem { rom: rom.clone(), reason: DeletionReason::OlderRevision });
                continue;
            }
            // Keep exactly one copy — the preferred variant; delete all others.
            if settings.keep_preferred_only {
                match group.preferred_idx {
                    Some(pi) => {
                        if i == pi {
                            to_keep.push(rom.clone());
                        } else {
                            to_delete.push(DeletionItem {
                                rom: rom.clone(),
                                reason: DeletionReason::NonPreferredLanguage,
                            });
                        }
                    }
                    // No preferred version exists — can't apply keep_preferred_only here;
                    // let remove_if_no_preferred_version handle it separately.
                    None => to_keep.push(rom.clone()),
                }
            } else {
                to_keep.push(rom.clone());
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
/// Format-pair cleanup is a separate operation — see `apply_format_pairs`.
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

/// Build a deletion plan for format-pair cleanup: remove all variants from the
/// non-preferred folder for each pair where the user has set a preference.
/// This is intentionally separate from `apply_filters` — format-pair removal is a
/// structural, one-time operation; variant pruning is preference-driven and recurring.
#[tauri::command]
pub fn apply_format_pairs(state: State<'_, AppState>) -> Result<DeletionPlan, String> {
    // Load format preferences before acquiring the scan cache lock.
    let format_prefs = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        load_format_preferences(&conn)?
    };

    if format_prefs.is_empty() {
        return Ok(DeletionPlan {
            to_delete: vec![],
            to_keep: vec![],
            no_preferred_version_count: 0,
            total_bytes_freed: 0,
            console_summary: vec![],
        });
    }

    let (groups, format_pairs) = {
        let cache = state.scan_cache.lock().map_err(|e| e.to_string())?;
        let pairs = detect_format_pairs(&cache.roms);
        (cache.groups.clone(), pairs)
    };

    let delete_map = build_format_delete_map(&groups, &format_prefs, &format_pairs);

    let mut to_delete: Vec<DeletionItem> = vec![];
    let mut to_keep: Vec<RomFile> = vec![];

    for group in &groups {
        for rom in &group.variants {
            if let Some(reason) = delete_map.get(&rom.path) {
                to_delete.push(DeletionItem {
                    rom: rom.clone(),
                    reason: reason.clone(),
                });
            } else {
                to_keep.push(rom.clone());
            }
        }
    }

    to_delete.sort_by(|a, b| {
        a.rom.console.cmp(&b.rom.console).then_with(|| a.rom.filename.cmp(&b.rom.filename))
    });

    let total_bytes_freed = to_delete.iter().map(|d| d.rom.filesize).sum();

    Ok(DeletionPlan {
        to_delete,
        to_keep,
        no_preferred_version_count: 0,
        total_bytes_freed,
        console_summary: vec![],
    })
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
        DeletionReason::NonPreferredLanguage     => "non_preferred_language",
        DeletionReason::Prerelease               => "prerelease",
        DeletionReason::OlderRevision            => "older_revision",
        DeletionReason::Unofficial               => "unofficial",
        DeletionReason::FormatPairNonPreferred   => "format_pair_non_preferred",
        DeletionReason::FormatPairNoCounterpart  => "format_pair_no_counterpart",
        DeletionReason::NoPreferredVersion       => "no_preferred_version",
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
    use crate::models::{FileCategory, FilterSettings, FormatPair, RomFile, RomGroup};

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
        // When the group has a preferred version, remove_unofficial=false must keep it
        // regardless of any other toggle.
        let mut preferred = make_rom("Hack (En)", FileCategory::Unofficial);
        preferred.matches_preferred_language = true;
        let mut group = make_group(vec![preferred, make_rom("Hack (Ja)", FileCategory::Unofficial)]);
        group.has_preferred_version = true;
        let mut filters = default_filters();
        filters.remove_unofficial = false;
        let plan = apply_filters_inner(vec![group], &filters);
        assert!(plan.to_delete.is_empty(), "unofficial variants should be kept when remove_unofficial is off");
        assert_eq!(plan.to_keep.len(), 2);
    }

    #[test]
    fn unofficial_group_deleted_by_no_preferred_version_flag() {
        // Unified ROMs+unofficial: the no_preferred_version rule applies to unofficial groups too.
        let group = make_group(vec![make_rom("Hack (Ja)", FileCategory::Unofficial)]);
        let mut filters = default_filters();
        filters.remove_unofficial = false;
        filters.remove_if_no_preferred_version = true;
        let plan = apply_filters_inner(vec![group], &filters);
        assert_eq!(plan.to_delete.len(), 1, "unofficial group with no preferred version should be deleted");
    }

    #[test]
    fn keep_preferred_only_keeps_exactly_one() {
        let mut preferred = make_rom("Game (USA)", FileCategory::Game);
        preferred.matches_preferred_language = true;
        let mut other_en = make_rom("Game (Europe)", FileCategory::Game);
        other_en.matches_preferred_language = true;
        let mut japan = make_rom("Game (Japan)", FileCategory::Game);
        japan.matches_preferred_language = false;

        let mut group = make_group(vec![preferred, other_en, japan]);
        group.preferred_idx = Some(0);
        group.has_preferred_version = true;

        let mut filters = default_filters();
        filters.keep_preferred_only = true;
        filters.remove_prerelease = false;
        filters.remove_older_revisions = false;
        let plan = apply_filters_inner(vec![group], &filters);
        assert_eq!(plan.to_keep.len(), 1, "exactly one ROM should be kept");
        assert_eq!(plan.to_delete.len(), 2);
    }

    #[test]
    fn build_format_delete_map_marks_non_preferred_folder() {
        let fds = "Nintendo - Family Computer Disk System (FDS)";
        let qd  = "Nintendo - Family Computer Disk System (QD)";
        let group_name = "Nintendo - Family Computer Disk System";

        let mut fds_rom = make_rom("Game", FileCategory::Game);
        fds_rom.path = "/roms/fds/Game.zip".into();
        fds_rom.console = fds.into();
        let mut qd_rom = make_rom("Game", FileCategory::Game);
        qd_rom.path = "/roms/qd/Game.zip".into();
        qd_rom.console = qd.into();

        let mut group = make_group(vec![fds_rom, qd_rom]);
        group.is_format_pair = true;

        let mut format_prefs = HashMap::new();
        format_prefs.insert(group_name.to_string(), fds.to_string());

        let pairs = vec![FormatPair {
            console_group: group_name.into(),
            folder_a: fds.into(),
            folder_b: qd.into(),
            overlap_percent: 1.0,
            folder_a_count: 0,
            folder_b_count: 0,
        }];

        let delete_map = build_format_delete_map(&[group], &format_prefs, &pairs);
        assert_eq!(delete_map.len(), 1, "only the non-preferred (QD) path should be in the map");
        assert!(delete_map.contains_key("/roms/qd/Game.zip"));
        assert!(!delete_map.contains_key("/roms/fds/Game.zip"));
        assert!(matches!(delete_map["/roms/qd/Game.zip"], DeletionReason::FormatPairNonPreferred));
    }

    #[test]
    fn build_format_delete_map_includes_bios_in_non_preferred_folder() {
        // BIOS in the non-preferred folder IS included — the whole folder is being removed.
        let fds = "Nintendo - Family Computer Disk System (FDS)";
        let qd  = "Nintendo - Family Computer Disk System (QD)";
        let group_name = "Nintendo - Family Computer Disk System";

        let mut bios = make_rom("[BIOS] Disk System BIOS", FileCategory::Game);
        bios.path = "/roms/qd/bios.zip".into();
        bios.console = qd.into();
        bios.is_bios = true;
        let mut fds_bios = make_rom("[BIOS] Disk System BIOS", FileCategory::Game);
        fds_bios.path = "/roms/fds/bios.zip".into();
        fds_bios.console = fds.into();
        fds_bios.is_bios = true;

        let mut group = make_group(vec![fds_bios, bios]);
        group.is_format_pair = true;

        let mut format_prefs = HashMap::new();
        format_prefs.insert(group_name.to_string(), fds.to_string());
        let pairs = vec![FormatPair {
            console_group: group_name.into(),
            folder_a: fds.into(),
            folder_b: qd.into(),
            overlap_percent: 1.0,
            folder_a_count: 0,
            folder_b_count: 0,
        }];

        let delete_map = build_format_delete_map(&[group], &format_prefs, &pairs);
        assert!(delete_map.contains_key("/roms/qd/bios.zip"), "BIOS in non-preferred folder must be included");
        assert!(!delete_map.contains_key("/roms/fds/bios.zip"), "BIOS in preferred folder must be kept");
    }

    #[test]
    fn build_format_delete_map_no_counterpart_reason() {
        // Title exists ONLY in the non-preferred folder → FormatPairNoCounterpart reason.
        let fds = "Nintendo - Family Computer Disk System (FDS)";
        let qd  = "Nintendo - Family Computer Disk System (QD)";
        let group_name = "Nintendo - Family Computer Disk System";

        // QD-only ROM (no FDS counterpart)
        let mut qd_only = make_rom("QD Exclusive Title", FileCategory::Game);
        qd_only.path = "/roms/qd/exclusive.zip".into();
        qd_only.console = qd.into();

        let mut group = make_group(vec![qd_only]);
        group.is_format_pair = true;

        let mut format_prefs = HashMap::new();
        format_prefs.insert(group_name.to_string(), fds.to_string());
        let pairs = vec![FormatPair {
            console_group: group_name.into(),
            folder_a: fds.into(),
            folder_b: qd.into(),
            overlap_percent: 0.95,
            folder_a_count: 0,
            folder_b_count: 0,
        }];

        let delete_map = build_format_delete_map(&[group], &format_prefs, &pairs);
        assert_eq!(delete_map.len(), 1);
        assert!(matches!(
            delete_map["/roms/qd/exclusive.zip"],
            DeletionReason::FormatPairNoCounterpart
        ), "title with no preferred-folder counterpart must use FormatPairNoCounterpart");
    }

    #[test]
    fn build_format_delete_map_with_counterpart_reason() {
        // Title exists in BOTH folders → FormatPairNonPreferred reason for non-preferred copy.
        let fds = "Nintendo - Family Computer Disk System (FDS)";
        let qd  = "Nintendo - Family Computer Disk System (QD)";
        let group_name = "Nintendo - Family Computer Disk System";

        let mut fds_rom = make_rom("Shared Title", FileCategory::Game);
        fds_rom.path = "/roms/fds/shared.zip".into();
        fds_rom.console = fds.into();
        let mut qd_rom = make_rom("Shared Title", FileCategory::Game);
        qd_rom.path = "/roms/qd/shared.zip".into();
        qd_rom.console = qd.into();

        let mut group = make_group(vec![fds_rom, qd_rom]);
        group.is_format_pair = true;

        let mut format_prefs = HashMap::new();
        format_prefs.insert(group_name.to_string(), fds.to_string());
        let pairs = vec![FormatPair {
            console_group: group_name.into(),
            folder_a: fds.into(),
            folder_b: qd.into(),
            overlap_percent: 1.0,
            folder_a_count: 0,
            folder_b_count: 0,
        }];

        let delete_map = build_format_delete_map(&[group], &format_prefs, &pairs);
        assert!(matches!(
            delete_map["/roms/qd/shared.zip"],
            DeletionReason::FormatPairNonPreferred
        ), "title with a counterpart must use FormatPairNonPreferred");
    }

    #[test]
    fn deletion_reasons_are_set_correctly() {
        // Group with a prerelease + a release variant; prerelease should be deleted with correct reason.
        let mut release = make_rom("Game (USA)", FileCategory::Game);
        release.matches_preferred_language = true;
        let mut prerelease = make_rom("Game (USA) (Beta)", FileCategory::Game);
        prerelease.status_flags = vec!["Beta".into()];
        prerelease.matches_preferred_language = true;

        let mut group = make_group(vec![release, prerelease]);
        group.has_preferred_version = true;
        group.preferred_idx = Some(0);

        let mut filters = default_filters();
        filters.keep_preferred_only = false;
        filters.remove_prerelease = true;
        filters.remove_older_revisions = false;
        let plan = apply_filters_inner(vec![group], &filters);
        assert_eq!(plan.to_delete.len(), 1);
        assert!(matches!(plan.to_delete[0].reason, DeletionReason::Prerelease));
    }

    #[test]
    fn preview_tag_deleted_as_prerelease() {
        let mut release = make_rom("Pokemon Puzzle Collection (USA, Europe)", FileCategory::Game);
        release.matches_preferred_language = true;
        let mut preview = make_rom("Pokemon Puzzle Collection (USA) (GameCube Preview)", FileCategory::Game);
        preview.status_flags = vec!["GameCube Preview".into()];
        preview.matches_preferred_language = true;

        let mut group = make_group(vec![release, preview]);
        group.has_preferred_version = true;
        group.preferred_idx = Some(0);

        let mut filters = default_filters();
        filters.keep_preferred_only = false;
        filters.remove_prerelease = true;
        filters.remove_older_revisions = false;
        let plan = apply_filters_inner(vec![group], &filters);
        assert_eq!(plan.to_delete.len(), 1);
        assert!(matches!(plan.to_delete[0].reason, DeletionReason::Prerelease));
        assert!(plan.to_delete[0].rom.filename.contains("GameCube Preview"));
    }
}
