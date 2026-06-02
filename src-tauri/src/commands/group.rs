use std::collections::HashMap;

use tauri::State;

use crate::db::AppState;
use crate::models::{FileCategory, FormatPair, PagedGroups, RomFile, RomGroup, UserPreferences};
use crate::parser::region_default_languages;

// ── Preference matching ───────────────────────────────────────────────────────

pub fn matches_preferred(rom: &RomFile, prefs: &UserPreferences) -> bool {
    if prefs.preferred_languages.is_empty() {
        return true; // No preference set yet → treat everything as matching
    }
    if !rom.languages.is_empty() {
        return rom.languages.iter().any(|l| prefs.preferred_languages.contains(l));
    }
    // No explicit language tag — infer from region
    let primary = rom.regions.first().map(|s| s.as_str()).unwrap_or("");
    let inferred = region_default_languages(primary);
    inferred.iter().any(|l| prefs.preferred_languages.contains(&l.to_string()))
}

// ── Scoring ───────────────────────────────────────────────────────────────────

const COLLECTION_TAGS: &[&str] = &[
    "Virtual Console", "Wii Virtual Console", "Switch Online", "Switch",
    "Classic Mini", "Evercade", "NP", "GameCube", "LodgeNet",
    "Limited Run Games", "Retro-Bit Generations",
];

/// Higher score = more preferred variant. Returns (score, revision) tuple.
pub fn score_rom(rom: &RomFile, prefs: &UserPreferences) -> (i32, u32) {
    // Non-matching language → lowest priority
    if !matches_preferred(rom, prefs) {
        return (-9999, rom.revision);
    }

    // Pre-release → never keep unless sole copy
    if rom.status_flags.iter().any(|f| {
        matches!(f.as_str(), "Beta" | "Proto" | "Demo" | "Sample" | "Promo" | "Kiosk")
    }) {
        return (-100, rom.revision);
    }

    // Bad dump → very low
    if rom.bad_dump {
        return (-80, rom.revision);
    }

    // Unofficial (Pirate/Unl/Aftermarket) → low but above prerelease
    if matches!(rom.file_category, FileCategory::Unofficial) {
        return (-30, rom.revision);
    }

    // Region score from user's preferred_regions list
    let region_score = region_score(&rom.regions, prefs);

    // Collection tag penalty
    let collection_penalty: i32 = if rom.extra_tags.iter().any(|t| COLLECTION_TAGS.contains(&t.as_str())) {
        -10
    } else {
        0
    };

    let alt_penalty: i32 = if rom.extra_tags.iter().any(|t| t == "Alt") { -5 } else { 0 };

    (region_score + collection_penalty + alt_penalty, rom.revision)
}

fn region_score(regions: &[String], prefs: &UserPreferences) -> i32 {
    if prefs.preferred_regions.is_empty() {
        // Fallback scoring when no preference set
        let best = regions.iter().map(|r| default_region_score(r.as_str())).max();
        return best.unwrap_or(5);
    }

    let max_priority = prefs.preferred_regions.len() as i32;
    regions
        .iter()
        .filter_map(|r| {
            prefs.preferred_regions.iter().position(|p| p == r)
                .map(|idx| (max_priority - idx as i32) * 20)
        })
        .max()
        .unwrap_or(5)
}

fn default_region_score(region: &str) -> i32 {
    match region {
        "USA" => 100,
        "World" => 80,
        "Australia" | "United Kingdom" => 60,
        "Europe" => 50,
        _ => 5,
    }
}

// ── Grouping ──────────────────────────────────────────────────────────────────

pub fn group_roms(roms: Vec<RomFile>, prefs: &UserPreferences) -> Vec<RomGroup> {
    // Tag each ROM with preference match
    let mut roms: Vec<RomFile> = roms
        .into_iter()
        .map(|mut rom| {
            rom.matches_preferred_language = matches_preferred(&rom, prefs);
            rom.matches_preferred_region = region_score(&rom.regions, prefs) > 5;
            rom
        })
        .collect();

    // Group by (console, title_normalized) — but also handle multi-disc coalescing
    // Key: (console, title_normalized_without_disc)
    let mut groups: HashMap<(String, String), Vec<RomFile>> = HashMap::new();

    for rom in roms.drain(..) {
        let key = (rom.console.clone(), rom.title_normalized.clone());
        groups.entry(key).or_default().push(rom);
    }

    groups
        .into_values()
        .map(|variants| build_group(variants, prefs))
        .collect()
}

fn build_group(mut variants: Vec<RomFile>, prefs: &UserPreferences) -> RomGroup {
    let console = variants[0].console.clone();
    let title_normalized = variants[0].title_normalized.clone();

    // Detect multi-disc
    let max_disc = variants.iter().filter_map(|r| r.disc_number).max().unwrap_or(0);
    let disc_count = if max_disc > 0 { max_disc } else { 1 };

    // Sort variants by score descending, then revision descending as tiebreaker
    variants.sort_by(|a, b| {
        let sa = score_rom(a, prefs);
        let sb = score_rom(b, prefs);
        sb.cmp(&sa)
    });

    // Determine preferred index — None if no variant matches preferences
    let has_preferred = variants.iter().any(|r| r.matches_preferred_language);

    let preferred_idx = if has_preferred {
        // Prefer the highest-scored variant, but never choose a BIOS file as "preferred game"
        variants
            .iter()
            .position(|r| r.matches_preferred_language && !r.is_bios)
    } else {
        None
    };

    // Mark unofficial fallback candidates
    let has_official_preferred = variants.iter().any(|r| {
        r.matches_preferred_language && !matches!(r.file_category, FileCategory::Unofficial)
    });

    let mut variants = variants;
    for rom in &mut variants {
        rom.is_unofficial_preferred_fallback = !has_official_preferred
            && rom.matches_preferred_language
            && matches!(rom.file_category, FileCategory::Unofficial);
    }

    RomGroup {
        title_normalized,
        console,
        variants,
        preferred_idx,
        has_preferred_version: has_preferred,
        is_format_pair: false,
        disc_count,
    }
}

// ── Console filter helpers ────────────────────────────────────────────────────

/// Returns true when ANY variant in the group belongs to the selected console list.
/// This handles cross-console merged groups (is_format_pair) correctly — the
/// primary `g.console` may differ from what the user selected.
pub(crate) fn group_matches_consoles(g: &RomGroup, filter: &Option<Vec<String>>) -> bool {
    match filter {
        None => true,
        Some(cs) => g.variants.iter().any(|v| cs.contains(&v.console)),
    }
}

// ── Format-pair merging ───────────────────────────────────────────────────────

/// Merge groups that share the same `title_normalized` across format-paired
/// console folders (e.g. FDS + QD, Headered + Headerless).
///
/// Groups whose title exists in both paired consoles are collapsed into a single
/// `RomGroup` whose `variants` span both folders. `is_format_pair = true` is set
/// on every group that lives in a paired-console folder, merged or not.
///
pub fn merge_format_pairs(
    groups: Vec<RomGroup>,
    pairs: &[FormatPair],
    prefs: &UserPreferences,
) -> Vec<RomGroup> {
    if pairs.is_empty() {
        return groups;
    }

    // Map every paired console → the pair's stable key (folder_a).
    // Both folder_a and folder_b map to folder_a so they share a bucket key.
    let mut console_to_key: HashMap<&str, &str> = HashMap::new();
    for p in pairs {
        console_to_key
            .entry(p.folder_a.as_str())
            .or_insert(p.folder_a.as_str());
        console_to_key
            .entry(p.folder_b.as_str())
            .or_insert(p.folder_a.as_str());
    }

    let (paired, mut result): (Vec<RomGroup>, Vec<RomGroup>) = groups
        .into_iter()
        .partition(|g| console_to_key.contains_key(g.console.as_str()));

    // Bucket: (pair_key, title_normalized) → groups sharing that title across formats
    let mut by_title: HashMap<(String, String), Vec<RomGroup>> = HashMap::new();
    for g in paired {
        let key = console_to_key[g.console.as_str()].to_string();
        by_title
            .entry((key, g.title_normalized.clone()))
            .or_default()
            .push(g);
    }

    for (_, mut title_groups) in by_title {
        if title_groups.len() == 1 {
            let mut g = title_groups.remove(0);
            g.is_format_pair = true;
            result.push(g);
        } else {
            // Sort so folder_a always wins as the primary console (stable key)
            title_groups.sort_by(|a, b| a.console.cmp(&b.console));
            let title_normalized = title_groups[0].title_normalized.clone();
            let primary_console = title_groups[0].console.clone();
            let all_variants: Vec<RomFile> = title_groups
                .into_iter()
                .flat_map(|g| g.variants)
                .collect();
            let mut merged = build_group(all_variants, prefs);
            merged.title_normalized = title_normalized;
            merged.console = primary_console;
            merged.is_format_pair = true;
            result.push(merged);
        }
    }

    result
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns official ROM groups (FileCategory::Game variants only).
#[tauri::command]
pub fn get_roms(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
    search: Option<String>,
    page: u32,
    per_page: u32,
) -> PagedGroups {
    let cache = state.scan_cache.lock().unwrap();
    let search_lower = search.as_deref().map(|s| s.to_lowercase());

    let mut filtered: Vec<&RomGroup> = cache
        .groups
        .iter()
        .filter(|g| {
            if !g.variants.iter().any(|v| matches!(v.file_category, FileCategory::Game)) {
                return false;
            }
            if !group_matches_consoles(g, &consoles) { return false; }
            if let Some(ref q) = search_lower {
                if !g.title_normalized.contains(q.as_str()) { return false; }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| a.title_normalized.cmp(&b.title_normalized));
    paginate(filtered, page, per_page)
}

/// Returns unofficial ROM groups (Pirate/Unl/Aftermarket/Hack).
#[tauri::command]
pub fn get_unofficial(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
    search: Option<String>,
    page: u32,
    per_page: u32,
) -> PagedGroups {
    let cache = state.scan_cache.lock().unwrap();
    let search_lower = search.as_deref().map(|s| s.to_lowercase());

    let mut filtered: Vec<&RomGroup> = cache
        .groups
        .iter()
        .filter(|g| {
            if !g.variants.iter().any(|v| matches!(v.file_category, FileCategory::Unofficial)) {
                return false;
            }
            if !group_matches_consoles(g, &consoles) { return false; }
            if let Some(ref q) = search_lower {
                if !g.title_normalized.contains(q.as_str()) { return false; }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| a.title_normalized.cmp(&b.title_normalized));
    paginate(filtered, page, per_page)
}

/// Returns system file groups (BIOS, Utility, Demo, Video, EReader).
#[tauri::command]
pub fn get_system_files(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
    search: Option<String>,
    page: u32,
    per_page: u32,
) -> PagedGroups {
    let cache = state.scan_cache.lock().unwrap();
    let search_lower = search.as_deref().map(|s| s.to_lowercase());

    let mut filtered: Vec<&RomGroup> = cache
        .groups
        .iter()
        .filter(|g| {
            if !g.variants.iter().any(|v| {
                matches!(
                    v.file_category,
                    FileCategory::Bios | FileCategory::Utility | FileCategory::Demo
                    | FileCategory::Video | FileCategory::EReader
                )
            }) {
                return false;
            }
            if !group_matches_consoles(g, &consoles) { return false; }
            if let Some(ref q) = search_lower {
                if !g.title_normalized.contains(q.as_str()) { return false; }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| a.title_normalized.cmp(&b.title_normalized));
    paginate(filtered, page, per_page)
}

/// Returns groups with multiple keep-eligible variants (duplicates for manual resolution).
#[tauri::command]
pub fn get_duplicates(
    state: State<'_, AppState>,
    consoles: Option<Vec<String>>,
) -> Vec<RomGroup> {
    let cache = state.scan_cache.lock().unwrap();

    let mut groups: Vec<RomGroup> = cache
        .groups
        .iter()
        .filter(|g| {
            // Format pairs are not true duplicates — they represent different
            // formats of the same game (e.g. FDS/QD, Headered/Headerless).
            // Those are handled by Prune; the Duplicates tab shows only cases
            // where the same game exists as 2+ copies in the same format.
            if g.is_format_pair { return false; }
            let eligible_count = g.variants.iter()
                .filter(|v| v.matches_preferred_language && !v.bad_dump
                    && !v.status_flags.iter().any(|f| {
                        matches!(f.as_str(), "Beta"|"Proto"|"Demo"|"Sample"|"Promo"|"Kiosk")
                    }))
                .count();
            eligible_count > 1
        })
        .filter(|g| group_matches_consoles(g, &consoles))
        .cloned()
        .collect();

    groups.sort_by(|a, b| a.title_normalized.cmp(&b.title_normalized));
    groups
}

fn paginate(filtered: Vec<&RomGroup>, page: u32, per_page: u32) -> PagedGroups {
    let total = filtered.len() as u32;
    let start = (page.saturating_sub(1) * per_page) as usize;
    let end = (start + per_page as usize).min(filtered.len());
    let groups = if start < filtered.len() {
        filtered[start..end].iter().map(|g| (*g).clone()).collect()
    } else {
        vec![]
    };
    PagedGroups { total_groups: total, page, per_page, groups }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileFormat, RomFile};

    fn rom(title: &str, regions: &[&str], langs: &[&str], status: &[&str]) -> RomFile {
        RomFile {
            path: format!("/roms/{title}.zip"),
            filename: format!("{title}.zip"),
            console: "Test".into(),
            title: title.into(),
            title_normalized: crate::parser::normalize_title(title),
            regions: regions.iter().map(|s| s.to_string()).collect(),
            languages: langs.iter().map(|s| s.to_string()).collect(),
            status_flags: status.iter().map(|s| s.to_string()).collect(),
            extra_tags: vec![],
            bad_dump: false,
            revision: 0,
            disc_number: None,
            version: None,
            is_bios: false,
            file_format: FileFormat::Zip,
            file_category: FileCategory::Game,
            filesize: 1024,
            matches_preferred_language: false,
            matches_preferred_region: false,
            is_unofficial_preferred_fallback: false,
        }
    }

    fn en_prefs() -> UserPreferences {
        UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into(), "World".into(), "Europe".into()],
            short_console_names: false,
        }
    }

    #[test]
    fn usa_matches_english_preference() {
        let r = rom("Game (USA)", &["USA"], &[], &[]);
        assert!(matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn japan_only_does_not_match_english() {
        let r = rom("Game (Japan)", &["Japan"], &[], &[]);
        assert!(!matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn japan_with_en_tag_matches() {
        let r = rom("Game (Japan) (En)", &["Japan"], &["En"], &[]);
        assert!(matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn usa_rom_scores_higher_than_europe() {
        let usa = rom("Game", &["USA"], &[], &[]);
        let eu = rom("Game", &["Europe"], &[], &[]);
        let prefs = en_prefs();
        assert!(score_rom(&usa, &prefs) > score_rom(&eu, &prefs));
    }

    #[test]
    fn beta_scores_lower_than_release() {
        let release = rom("Game", &["USA"], &[], &[]);
        let beta = rom("Game", &["USA"], &[], &["Beta"]);
        let prefs = en_prefs();
        assert!(score_rom(&release, &prefs) > score_rom(&beta, &prefs));
    }

    #[test]
    fn non_english_gets_min_score() {
        let jp = rom("Game", &["Japan"], &[], &[]);
        let prefs = en_prefs();
        let (score, _) = score_rom(&jp, &prefs);
        assert_eq!(score, -9999);
    }

    #[test]
    fn grouper_picks_usa_as_preferred() {
        let roms = vec![
            rom("Castlevania", &["USA"], &[], &[]),
            rom("Castlevania", &["Japan"], &[], &[]),
            rom("Castlevania", &["Europe"], &["En"], &[]),
        ];
        let prefs = en_prefs();
        let groups = group_roms(roms, &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert!(g.has_preferred_version);
        let preferred = &g.variants[g.preferred_idx.unwrap()];
        assert!(preferred.regions.contains(&"USA".to_string()));
    }

    #[test]
    fn no_preferred_version_when_japan_only() {
        let roms = vec![
            rom("Game", &["Japan"], &[], &[]),
            rom("Game", &["Japan"], &[], &[]),
        ];
        let prefs = en_prefs();
        let groups = group_roms(roms, &prefs);
        assert_eq!(groups[0].preferred_idx, None);
        assert!(!groups[0].has_preferred_version);
    }

    fn group_with_console(console: &str) -> RomGroup {
        let mut r = rom("game", &["USA"], &[], &[]);
        r.console = console.into();
        RomGroup {
            title_normalized: "game".into(),
            console: console.into(),
            variants: vec![r],
            preferred_idx: None,
            has_preferred_version: false,
            is_format_pair: false,
            disc_count: 1,
        }
    }

    #[test]
    fn console_filter_none_returns_all() {
        assert!(group_matches_consoles(&group_with_console("GBA"), &None));
        assert!(group_matches_consoles(&group_with_console("SNES"), &None));
    }

    #[test]
    fn console_filter_some_matches_included() {
        let filter = Some(vec!["GBA".to_string(), "SNES".to_string()]);
        assert!(group_matches_consoles(&group_with_console("GBA"), &filter));
        assert!(group_matches_consoles(&group_with_console("SNES"), &filter));
    }

    #[test]
    fn console_filter_some_excludes_others() {
        let filter = Some(vec!["GBA".to_string()]);
        assert!(!group_matches_consoles(&group_with_console("SNES"), &filter));
        assert!(!group_matches_consoles(&group_with_console("N64"), &filter));
    }

    #[test]
    fn console_filter_empty_vec_matches_nothing() {
        let filter: Option<Vec<String>> = Some(vec![]);
        assert!(!group_matches_consoles(&group_with_console("GBA"), &filter));
    }

    #[test]
    fn merge_format_pairs_collapses_shared_titles() {
        use crate::models::{FileCategory, FileFormat, FormatPair};

        let fds = "Nintendo - Family Computer Disk System (FDS)";
        let qd  = "Nintendo - Family Computer Disk System (QD)";
        let pair = FormatPair {
            console_group: "Nintendo - Family Computer Disk System".into(),
            folder_a: fds.into(),
            folder_b: qd.into(),
            overlap_percent: 1.0,
        };

        let make = |console: &str, title: &str| -> RomFile {
            RomFile {
                path: format!("/roms/{title}.zip"),
                filename: format!("{title}.zip"),
                console: console.into(),
                title: title.into(),
                title_normalized: title.to_lowercase(),
                regions: vec!["Japan".into()],
                languages: vec![],
                status_flags: vec![],
                extra_tags: vec![],
                bad_dump: false,
                revision: 0,
                disc_number: None,
                version: None,
                is_bios: false,
                file_format: FileFormat::Zip,
                file_category: FileCategory::Game,
                filesize: 1024,
                matches_preferred_language: false,
                matches_preferred_region: false,
                is_unofficial_preferred_fallback: false,
            }
        };

        let groups = vec![
            build_group(vec![make(fds, "adian no tsue")], &en_prefs()),
            build_group(vec![make(qd,  "adian no tsue")], &en_prefs()),
            build_group(vec![make(fds, "unique fds title")], &en_prefs()),
        ];

        let merged = merge_format_pairs(groups, &[pair], &en_prefs());

        // "adian no tsue" should be merged into 1 group with 2 variants
        let shared: Vec<_> = merged.iter().filter(|g| g.title_normalized == "adian no tsue").collect();
        assert_eq!(shared.len(), 1, "shared title should produce exactly one merged group");
        assert_eq!(shared[0].variants.len(), 2);
        assert!(shared[0].is_format_pair);

        // "unique fds title" stays as a single-console group
        let unique: Vec<_> = merged.iter().filter(|g| g.title_normalized == "unique fds title").collect();
        assert_eq!(unique.len(), 1);
        assert!(unique[0].is_format_pair);
    }
}
