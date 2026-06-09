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

// Distribution-format / platform variants — minor penalty.
// These are original-era delivery mechanisms (kiosk, broadcast, download service)
// where a standard cartridge/disk release also exists or may exist.
const FORMAT_VARIANT_TAGS: &[&str] = &[
    "Disk Writer",     // FDS kiosk service (Japan)
    "Satellaview",     // SNES satellite broadcast (Japan)
    "Sega Channel",    // Mega Drive online distribution (US/JP)
    "64DD",            // N64 Disk Drive (Japan)
    "Meganet",         // Mega Drive modem service (Japan)
    "NP",              // Nintendo Power flash-cart service (Japan)
    "Animal Crossing", // GBA games embedded in Animal Crossing (GameCube)
    "Batteryless",     // Modified to remove battery-backed save; prefer standard version
    "Netcard",         // Famicom Disk System network service (same tier as Disk Writer)
    "Arcade",          // Arcade-cabinet variant (PlayChoice-10 style); prefer standard release
];

// Third-party / non-standard collections — penalised more heavily.
pub const COLLECTION_TAGS: &[&str] = &[
    // Hardware re-release platforms
    "LodgeNet", "FamicomBox",
    "Evercade", "Atari Flashback", "Retro-Bit", "Retro-Bit Generations",
    "Limited Run Games", "iam8bit", "Strictly Limited Games",
    "GameCube Edition",
    // Digital re-release services
    "Capcom Town", "Project EGG",
    // Nintendo compilations / peripheral re-releases
    "Disney Classic Games", "Collection of Mana", "e-Reader", "e-Reader Edition",
    "Seiken Densetsu Collection", "Collection of SaGa",
    "Zelda Collection",
    // Capcom compilations
    "The Disney Afternoon Collection", "Capcom Classics Mini Mix",
    "Mega Man Legacy Collection", "Mega Man X Legacy Collection",
    "Mega Man Battle Network Legacy Collection",
    "Castlevania Anniversary Collection", "Castlevania Advance Collection",
    "Contra Anniversary Collection", "Arcade Classics Anniversary Collection",
    "Rockman 123",
    // Konami compilations
    "Konami Collector's Series", "Metal Gear Solid Collection",
    // Namco compilations
    "Namcot Collection", "Namco Museum Archives Vol 1", "Namco Museum Archives Vol 2",
    "Namco Anthology 1",
    // SNK / Taito / Square compilations
    "SNK 40th Anniversary Collection", "Darius Cozmic Collection",
    // TMNT / other compilations — both article forms are used by No-Intro
    "The Cowabunga Collection", "Cowabunga Collection",
    "Ninja JaJaMaru Retro Collection",
    "8-bit Adventure Anthology - Volume I",
    // Misc
    "QUByte Classics",
    "Genteiban!",                            // Japanese limited edition re-release
    "Phantasy Star Online Episode I & II",  // Mini-game extracted from PSO disc
    "Pixel Heart",                           // French limited physical release label
];
// Official Nintendo digital re-releases (Virtual Console, Wii Virtual Console,
// Switch Online, Switch, Classic Mini, GameCube) are not listed here — they receive
// the generic extra_tag penalty below (-5) so plain cartridge releases are preferred.

/// Higher score = more preferred variant.
/// Returns (score, revision, lang_match_count) tuple — all three compared
/// lexicographically so ties break cleanly: same score → higher revision → more
/// preferred-language matches.
pub fn score_rom(rom: &RomFile, prefs: &UserPreferences) -> (i32, u32, usize) {
    // Non-matching language → lowest priority
    if !matches_preferred(rom, prefs) {
        return (-9999, rom.revision, 0);
    }

    // Alt penalty: non-Alt is always preferred over Alt within the same tier.
    // "Alt" is stored in status_flags by the parser.
    let is_alt = rom.status_flags.iter().any(|f| f == "Alt");
    let alt_penalty: i32 = if is_alt { -5 } else { 0 };

    // Pre-release → never keep unless sole copy.
    // Still use lang+region as a tiebreaker so USA Proto beats Europe Proto for English users;
    // apply alt_penalty so non-Alt beats Alt within the same pre-release tier.
    if rom.status_flags.iter().any(|f| {
        matches!(
            f.as_str(),
            "Alpha" | "Beta" | "Proto" | "Possible Proto" | "Demo" | "Sample" | "Promo"
            | "Kiosk" | "Wi-Fi Kiosk"
            | "IS-NITRO-EMULATOR" | "IS-NITRO-PROGRAMMER"
            | "Preview" | "GameCube Preview"
        )
    }) {
        let r_score = region_score(&rom.regions, prefs).max(0) as usize;
        let lang_count = rom.languages.iter()
            .filter(|l| prefs.preferred_languages.contains(*l))
            .count();
        return (-100 + alt_penalty, rom.revision, lang_count * 1000 + r_score);
    }

    // Bad dump → very low; same lang+region+alt tiebreaker for consistency.
    if rom.bad_dump {
        let r_score = region_score(&rom.regions, prefs).max(0) as usize;
        let lang_count = rom.languages.iter()
            .filter(|l| prefs.preferred_languages.contains(*l))
            .count();
        return (-80 + alt_penalty, rom.revision, lang_count * 1000 + r_score);
    }

    // Unofficial (Pirate/Unl/Aftermarket) → low but above prerelease.
    // Base -30 keeps unofficial below all official content (min official score ≥ 0).
    // Tiebreaker encodes both priorities: explicit lang match >> region preference.
    // Multiplier 1000 exceeds any realistic region score (~200 max with 10 preferred regions).
    if matches!(rom.file_category, FileCategory::Unofficial) {
        let r_score = region_score(&rom.regions, prefs).max(0) as usize;
        let lang_count = rom.languages.iter()
            .filter(|l| prefs.preferred_languages.contains(*l))
            .count();
        let format_penalty: i32 =
            if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| COLLECTION_TAGS.contains(&part)) {
                -80
            } else if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| FORMAT_VARIANT_TAGS.contains(&part)) {
                -5
            } else {
                0
            };
        return (-30 + alt_penalty + format_penalty, rom.revision, lang_count * 1000 + r_score);
    }

    // Region score from user's preferred_regions list
    let region_score = region_score(&rom.regions, prefs);

    // Split each extra_tag on ", " before matching so compound tags like
    // "Namcot Collection, Namco Museum Archives Vol 1" hit the penalty correctly.
    let collection_penalty: i32 =
        if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| COLLECTION_TAGS.contains(&part)) {
            // −100: large enough to ensure ANY original release (even Japan = 5) beats
            // ANY collection re-release (even USA = 100): 100 − 100 = 0 < 5.
            -100
        } else if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| FORMAT_VARIANT_TAGS.contains(&part)) {
            -5
        } else if !rom.extra_tags.is_empty() {
            // Any unrecognised extra_tag (e.g. platform-specific variants like (GameCube)
            // or mode variants like (GBC Mode)) gets a minor penalty so the plain release
            // is always preferred when both exist and all other scoring is equal.
            -5
        } else {
            0
        };

    // alt_penalty already computed above (status_flags check); reuse it here.

    // Count how many of the user's preferred languages this ROM explicitly matches —
    // used as a fine-grained tiebreaker after lang_priority and region are applied.
    let lang_matches = if prefs.preferred_languages.is_empty() {
        0
    } else {
        rom.languages
            .iter()
            .filter(|l| prefs.preferred_languages.contains(*l))
            .count()
    };

    // Language-priority bonus: matching a higher-priority preferred language always wins
    // over a lower-priority one, regardless of region.
    // ROMs with no explicit language tag fall back to region inference so that e.g.
    // USA (inferred En) scores identically to Spain (explicit En) and region then
    // decides — preserving the existing USA > Europe ordering for same-language variants.
    // ROMs with explicit tags that don't include a preferred language get priority 0
    // (they already passed `matches_preferred` via region inference; region decides).
    let lang_priority: i32 = if !rom.languages.is_empty() {
        // Explicit language tags present — use those only.
        prefs.preferred_languages
            .iter()
            .position(|l| rom.languages.contains(l))
            .map(|pos| (prefs.preferred_languages.len() - pos) as i32 * 1000)
            .unwrap_or(0)
    } else {
        // No explicit tags — compute priority from the region-inferred language.
        let primary = rom.regions.first().map(|s| s.as_str()).unwrap_or("");
        let inferred = region_default_languages(primary);
        prefs.preferred_languages
            .iter()
            .position(|l| inferred.contains(&l.as_str()))
            .map(|pos| (prefs.preferred_languages.len() - pos) as i32 * 1000)
            .unwrap_or(0)
    };

    // Revision bonus applies only to original (non-penalised) releases.
    // For collection re-releases and distribution-format variants, suppressing the bonus
    // prevents high-revision re-releases from outranking unrevised originals.
    // The score tuple's `revision` field still provides within-tier tiebreaking.
    let revision_bonus = if collection_penalty == 0 { rom.revision as i32 * 100 } else { 0 };

    (lang_priority + region_score + collection_penalty + alt_penalty + revision_bonus, rom.revision, lang_matches)
}

pub(crate) fn region_score(regions: &[String], prefs: &UserPreferences) -> i32 {
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

/// Converts a version string like "v2.1" or "v1.0.3" into a comparable u64.
/// None / unparseable → 0.  Used as a sort tiebreaker so newer versions rank first.
fn version_ord(v: &Option<String>) -> u64 {
    let s = match v.as_deref().and_then(|s| s.strip_prefix('v')) {
        Some(s) => s,
        None => return 0,
    };
    let parts: Vec<u64> = s.split('.').filter_map(|p| p.parse().ok()).collect();
    match parts.as_slice() {
        [major]               => major * 1_000_000,
        [major, minor]        => major * 1_000_000 + minor * 1_000,
        [major, minor, patch] => major * 1_000_000 + minor * 1_000 + patch,
        _                     => 0,
    }
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

    // Group by (console, title_normalized, category_bucket).
    // The category_bucket prevents Video / EReader files from merging into Game
    // groups: "Professor Layton (Video)" and "Professor Layton (USA)" share the
    // same title_normalized but are completely different content — grouping them
    // causes the Video ROM to score below the game and be flagged for deletion.
    // Video ROMs still group with other Video ROMs of the same title across regions.
    let mut groups: HashMap<(String, String, &'static str), Vec<RomFile>> = HashMap::new();

    for rom in roms.drain(..) {
        let bucket: &'static str = match rom.file_category {
            FileCategory::Video   => "video",
            FileCategory::EReader => "ereader",
            _                     => "",
        };
        let key = (rom.console.clone(), rom.title_normalized.clone(), bucket);
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

    // Sort variants: (score, revision, lang_matches) descending; then version descending
    // so "v2.1" beats "v1.0" when everything else ties; filename ascending as the final
    // deterministic tiebreaker so groups are stable across runs.
    variants.sort_by(|a, b| {
        score_rom(b, prefs)
            .cmp(&score_rom(a, prefs))
            .then_with(|| version_ord(&b.version).cmp(&version_ord(&a.version)))
            .then_with(|| a.filename.cmp(&b.filename))
    });

    // Determine preferred index — None if no variant matches preferences.
    let has_preferred = variants.iter().any(|r| r.matches_preferred_language);

    // Utilities are excluded from preferred_idx only in mixed groups (where at least one
    // non-Utility variant exists). In a Utility-only group, the best Utility is preferred.
    let has_non_utility = variants.iter().any(|r| !matches!(r.file_category, FileCategory::Utility));

    // Unofficial files are excluded from preferred_idx only when an official variant
    // (non-Unofficial, non-Utility) already matches the preferred language. This ensures:
    //   • Official (USA) + Unofficial hack (USA) → official wins.
    //   • Official (Japan) + fan-translation (En) → fan-translation wins (only En match).
    let has_official_preferred_lang = variants.iter().any(|r| {
        r.matches_preferred_language
            && !matches!(r.file_category, FileCategory::Unofficial | FileCategory::Utility)
    });

    let preferred_idx = if has_preferred {
        variants.iter().position(|r| {
            r.matches_preferred_language
                && (!has_non_utility || !matches!(r.file_category, FileCategory::Utility))
                && (!has_official_preferred_lang || !matches!(r.file_category, FileCategory::Unofficial))
        })
    } else {
        None
    };

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
            if !g.variants.iter().any(|v| matches!(v.file_category, FileCategory::Game | FileCategory::Unofficial | FileCategory::Demo | FileCategory::Utility)) {
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

/// Returns system file groups (BIOS, Utility, Video, EReader).
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
                    FileCategory::Bios | FileCategory::Video | FileCategory::EReader
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
    fn world_matches_english_preference() {
        let r = rom("Game (World)", &["World"], &[], &[]);
        assert!(matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn europe_matches_english_preference() {
        let r = rom("Game (Europe)", &["Europe"], &[], &[]);
        assert!(matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn canada_matches_english_preference() {
        let r = rom("Game (Canada)", &["Canada"], &[], &[]);
        assert!(matches_preferred(&r, &en_prefs()));
    }

    #[test]
    fn scandinavia_matches_swedish() {
        let r = rom("Game (Scandinavia)", &["Scandinavia"], &[], &[]);
        let prefs = UserPreferences {
            preferred_languages: vec!["Sv".into()],
            preferred_regions: vec!["Scandinavia".into()],
            short_console_names: false,
        };
        assert!(matches_preferred(&r, &prefs));
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
    fn higher_version_preferred_when_score_tied() {
        // All four are Aftermarket (unofficial) World ROMs — identical scores.
        // Version tiebreaker must pick v2.1 over v2.0, v1.0, and no-version.
        let make_unofficial = |filename: &str, version: Option<&str>| -> RomFile {
            let mut r = rom("Ciao Nonna", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.version = version.map(|s| s.to_string());
            r
        };
        let bare  = make_unofficial("Ciao Nonna (World) (Aftermarket) (Unl).zip", None);
        let v11   = make_unofficial("Ciao Nonna (World) (v1.1) (Aftermarket) (Unl).zip", Some("v1.1"));
        let v20   = make_unofficial("Ciao Nonna (World) (v2.0) (Aftermarket) (Unl).zip", Some("v2.0"));
        let v21   = make_unofficial("Ciao Nonna (World) (v2.1) (Aftermarket) (Unl).zip", Some("v2.1"));
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let groups = group_roms(vec![bare, v11, v20, v21], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.filename.contains("v2.1"),
            "v2.1 must be preferred, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn non_alt_preferred_over_alt_pre_release() {
        // (Demo) (Unl) (Alt) must score lower than (Demo) (Unl) with no Alt tag.
        let mut alt = rom("Doctor GB Card Demo", &["World"], &[], &[]);
        alt.status_flags = vec!["Demo".into(), "Unl".into(), "Alt".into()];
        alt.file_category = FileCategory::Unofficial;
        alt.filename = "Doctor GB Card Demo (World) (Demo) (Unl) (Alt).zip".into();

        let mut base = rom("Doctor GB Card Demo", &["World"], &[], &[]);
        base.status_flags = vec!["Demo".into(), "Unl".into()];
        base.file_category = FileCategory::Unofficial;
        base.filename = "Doctor GB Card Demo (World) (Demo) (Unl).zip".into();

        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        assert!(
            score_rom(&base, &prefs) > score_rom(&alt, &prefs),
            "non-Alt {:?} must score above Alt {:?}",
            score_rom(&base, &prefs),
            score_rom(&alt, &prefs),
        );

        let groups = group_roms(vec![alt, base], &prefs);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            !preferred.status_flags.contains(&"Alt".to_string()),
            "non-Alt must be preferred, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn usa_proto_scores_higher_than_europe_proto() {
        // Both are pre-release; region tiebreaker must still apply so USA beats Europe.
        let mut usa = rom("Game", &["USA"], &[], &["Proto"]);
        usa.status_flags = vec!["Proto".into()];
        let mut eu = rom("Game", &["Europe"], &[], &["Proto"]);
        eu.status_flags = vec!["Proto".into()];
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        assert!(
            score_rom(&usa, &prefs) > score_rom(&eu, &prefs),
            "USA Proto {:?} must score above Europe Proto {:?}",
            score_rom(&usa, &prefs),
            score_rom(&eu, &prefs),
        );
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
        let (score, _, _) = score_rom(&jp, &prefs);
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
    fn preview_tag_scores_as_prerelease() {
        let preview = rom("Pokemon Puzzle Collection (USA) (GameCube Preview)", &["USA"], &[], &["GameCube Preview"]);
        let release = rom("Pokemon Puzzle Collection (USA)", &["USA"], &[], &[]);
        let prefs = en_prefs();
        assert!(
            score_rom(&release, &prefs) > score_rom(&preview, &prefs),
            "release must score higher than GameCube Preview"
        );
        let (score, _, _) = score_rom(&preview, &prefs);
        assert_eq!(score, -100, "GameCube Preview must score -100 (pre-release)");
    }

    #[test]
    fn standalone_preview_scores_as_prerelease() {
        let preview = rom("Game (USA) (Preview)", &["USA"], &[], &["Preview"]);
        let prefs = en_prefs();
        let (score, _, _) = score_rom(&preview, &prefs);
        assert_eq!(score, -100);
    }

    #[test]
    fn grouper_prefers_release_over_gamecube_preview() {
        // Both ROMs share the same canonical title (as the real parser produces);
        // only filename and metadata differ.
        let mut preview = rom("Pokemon Puzzle Collection", &["USA"], &[], &["GameCube Preview"]);
        preview.filename = "Pokemon Puzzle Collection (USA) (GameCube Preview).zip".into();
        let mut release = rom("Pokemon Puzzle Collection", &["USA", "Europe"], &[], &[]);
        release.filename = "Pokemon Puzzle Collection (USA, Europe).zip".into();
        let prefs = en_prefs();
        let groups = group_roms(vec![preview, release], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = &g.variants[g.preferred_idx.unwrap()];
        assert!(preferred.regions.contains(&"USA".to_string()), "release (USA/Europe) must be preferred over GameCube Preview");
        assert!(!preferred.status_flags.iter().any(|f| f == "GameCube Preview"), "preferred must not be the preview ROM");
    }

    #[test]
    fn lang_count_tiebreaker_prefers_more_lang_matches() {
        // (Europe)(En,Fr,De) vs (Europe)(En,Ja,Fr) when preferred = [En, De]
        // (En,Fr,De) matches 2 preferred (En + De); (En,Ja,Fr) matches 1 (En only)
        let mut enfr_de = rom("Pokemon Tetris", &["Europe"], &["En", "Fr", "De"], &[]);
        enfr_de.filename = "Pokemon Tetris (Europe) (En,Fr,De).zip".into();
        let mut en_ja_fr = rom("Pokemon Tetris", &["Europe"], &["En", "Ja", "Fr"], &[]);
        en_ja_fr.filename = "Pokemon Tetris (Europe) (En,Ja,Fr).zip".into();
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into(), "De".into()],
            preferred_regions: vec!["Europe".into()],
            short_console_names: false,
        };
        assert!(
            score_rom(&enfr_de, &prefs) > score_rom(&en_ja_fr, &prefs),
            "(En,Fr,De) must score higher when preferred includes De"
        );
    }

    #[test]
    fn lang_count_tiebreaker_falls_back_to_filename() {
        // When both variants match identical preferred langs, filename decides alphabetically.
        let mut enfr_de = rom("Pokemon Tetris", &["Europe"], &["En", "Fr", "De"], &[]);
        enfr_de.filename = "Pokemon Tetris (Europe) (En,Fr,De).zip".into();
        let mut en_ja_fr = rom("Pokemon Tetris", &["Europe"], &["En", "Ja", "Fr"], &[]);
        en_ja_fr.filename = "Pokemon Tetris (Europe) (En,Ja,Fr).zip".into();
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["Europe".into()],
            short_console_names: false,
        };
        // Scores are tied (both match 1 preferred lang); filename "De" < "Ja" alphabetically
        // → build_group sorts ascending on filename for ties → (En,Fr,De) ends up first → preferred_idx = 0
        let groups = group_roms(vec![enfr_de, en_ja_fr], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = &g.variants[g.preferred_idx.unwrap()];
        assert!(
            preferred.filename.contains("En,Fr,De"),
            "filename tiebreaker must pick (En,Fr,De) over (En,Ja,Fr)"
        );
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
            folder_a_count: 0,
            folder_b_count: 0,
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

    #[test]
    fn virtual_console_scores_below_plain_release() {
        // Official Nintendo digital re-releases get the generic extra_tag penalty (−5)
        // so plain cartridge releases are preferred when both are in the collection.
        let mut vc = rom("Game", &["Japan"], &["En"], &[]);
        vc.extra_tags = vec!["Virtual Console".into()];
        let base = rom("Game", &["Japan"], &["En"], &[]);
        assert!(
            score_rom(&base, &en_prefs()) > score_rom(&vc, &en_prefs()),
            "plain release must score above Virtual Console re-release"
        );
    }

    #[test]
    fn disk_writer_and_virtual_console_score_equally() {
        // Both Disk Writer (FORMAT_VARIANT_TAGS, −5) and Virtual Console (generic extra_tag
        // catch-all, −5) receive the same minor penalty — both lose to a plain release.
        let mut dw = rom("Game", &["Japan"], &["En"], &[]);
        dw.extra_tags = vec!["Disk Writer".into()];
        dw.filename = "Game (Japan) (En) (Disk Writer).zip".into();
        let mut vc = rom("Game", &["Japan"], &["En"], &[]);
        vc.extra_tags = vec!["Virtual Console".into()];
        vc.filename = "Game (Japan) (En) (Virtual Console).zip".into();
        let base = rom("Game", &["Japan"], &["En"], &[]);
        assert_eq!(
            score_rom(&vc, &en_prefs()),
            score_rom(&dw, &en_prefs()),
            "Virtual Console and Disk Writer must score equally (both −5)"
        );
        assert!(
            score_rom(&base, &en_prefs()) > score_rom(&vc, &en_prefs()),
            "plain release must beat both format variants"
        );
    }

    #[test]
    fn satellaview_scores_below_standard_release() {
        let mut sat = rom("Game", &["Japan"], &["Ja"], &[]);
        sat.extra_tags = vec!["Satellaview".into()];
        let base = rom("Game", &["Japan"], &["Ja"], &[]);
        let prefs = UserPreferences {
            preferred_languages: vec!["Ja".into()],
            preferred_regions: vec!["Japan".into()],
            short_console_names: false,
        };
        assert!(score_rom(&base, &prefs) > score_rom(&sat, &prefs));
    }

    #[test]
    fn namcot_collection_penalized() {
        let mut namcot = rom("Pac-Man", &["Japan"], &["En"], &[]);
        namcot.extra_tags = vec!["Namcot Collection".into()];
        let original = rom("Pac-Man", &["Japan"], &["En"], &[]);
        assert!(
            score_rom(&original, &en_prefs()) > score_rom(&namcot, &en_prefs()),
            "original must beat Namcot Collection re-release"
        );
    }

    #[test]
    fn compound_collection_tag_penalized() {
        // "Namcot Collection, Namco Museum Archives Vol 1" is a single extra_tag string.
        // The split-on-", " fix must find "Namcot Collection" within it.
        let mut compound = rom("Pac-Man", &["Japan"], &["En"], &[]);
        compound.extra_tags = vec!["Namcot Collection, Namco Museum Archives Vol 1".into()];
        let original = rom("Pac-Man", &["Japan"], &["En"], &[]);
        assert!(
            score_rom(&original, &en_prefs()) > score_rom(&compound, &en_prefs()),
            "compound collection tag must still trigger −80 penalty"
        );
    }

    #[test]
    fn famicombox_penalized() {
        let mut fb = rom("Game", &["Japan"], &["En"], &[]);
        fb.extra_tags = vec!["FamicomBox".into()];
        let original = rom("Game", &["Japan"], &["En"], &[]);
        assert!(score_rom(&original, &en_prefs()) > score_rom(&fb, &en_prefs()));
    }

    #[test]
    fn possible_proto_scores_as_prerelease() {
        let mut pp = rom("Game", &["USA"], &[], &["Possible Proto"]);
        pp.status_flags = vec!["Possible Proto".into()];
        let release = rom("Game", &["USA"], &[], &[]);
        let (score, _, _) = score_rom(&pp, &en_prefs());
        assert_eq!(score, -100, "Possible Proto must score −100");
        assert!(score_rom(&release, &en_prefs()) > score_rom(&pp, &en_prefs()));
    }

    #[test]
    fn rev_letter_beats_no_revision() {
        // Rev B (revision=2) should outscore an unrevised original of the same game.
        let mut rev_b = rom("Game", &["USA"], &[], &[]);
        rev_b.revision = 2;
        let original = rom("Game", &["USA"], &[], &[]);
        assert!(
            score_rom(&rev_b, &en_prefs()) > score_rom(&original, &en_prefs()),
            "Rev B must beat unrevised original via revision_bonus"
        );
    }

    #[test]
    fn beta_preferred_over_alpha() {
        // Both score −100 as pre-release; version_ord(v0.1.1) > 0 in build_group's
        // sort puts the versioned Beta above the unversioned Alpha.
        let mut alpha = rom("Nyghtmare - Betrayed", &["World"], &[], &["Alpha"]);
        alpha.file_category = FileCategory::Unofficial;
        alpha.filename = "Nyghtmare - Betrayed (World) (Alpha A) (Aftermarket) (Unl).zip".into();

        let mut beta = rom("Nyghtmare - Betrayed", &["World"], &[], &["Beta"]);
        beta.file_category = FileCategory::Unofficial;
        beta.version = Some("v0.1.1".into());
        beta.filename = "Nyghtmare - Betrayed (World) (v0.1.1) (Beta) (Aftermarket) (Unl).zip".into();

        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let groups = group_roms(vec![alpha, beta], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.filename.contains("v0.1.1"),
            "Beta (v0.1.1) must be preferred over Alpha A, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn batteryless_scores_below_standard_release() {
        let mut batteryless = rom("Little Tales of Alexandria", &["World"], &[], &[]);
        batteryless.extra_tags = vec!["MBC3".into(), "SGB Enhanced".into(), "Batteryless".into()];
        batteryless.file_category = FileCategory::Unofficial;
        let mut standard = rom("Little Tales of Alexandria", &["World"], &[], &[]);
        standard.extra_tags = vec!["MBC3".into(), "SGB Enhanced".into()];
        standard.file_category = FileCategory::Unofficial;
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        assert!(
            score_rom(&standard, &prefs) > score_rom(&batteryless, &prefs),
            "standard must score above Batteryless variant"
        );
    }

    #[test]
    fn third_party_collection_still_penalized() {
        let mut evercade = rom("Game", &["USA"], &[], &[]);
        evercade.extra_tags = vec!["Evercade".into()];
        let base = rom("Game", &["USA"], &[], &[]);
        assert!(score_rom(&base, &en_prefs()) > score_rom(&evercade, &en_prefs()));
    }

    #[test]
    fn japan_en_beats_world_collection_for_english_user() {
        // Real-world case: Contra (Japan) (En) vs Contra (World) (Contra Anniversary Collection).
        // Both are English-playable, but the Japan original must be preferred over the
        // World compilation re-release. Requires collection penalty ≥ 96 (100 − 5 + 1).
        let japan_en = rom("Contra", &["Japan"], &["En"], &[]);
        let mut world_collection = rom("Contra", &["World"], &[], &[]);
        world_collection.extra_tags = vec!["Contra Anniversary Collection".into()];
        assert!(
            score_rom(&japan_en, &en_prefs()) > score_rom(&world_collection, &en_prefs()),
            "Japan (En) original {:?} must beat World (Collection) {:?}",
            score_rom(&japan_en, &en_prefs()),
            score_rom(&world_collection, &en_prefs()),
        );
    }

    #[test]
    fn proto2_preferred_over_proto1() {
        // Proto 2 is a later, more complete prototype than Proto 1.
        // Both score (−100, revision, r_score); higher revision wins.
        let mut proto1 = rom("John Madden Football", &["USA"], &[], &["Proto"]);
        proto1.revision = 1;
        let mut proto2 = rom("John Madden Football", &["USA"], &[], &["Proto"]);
        proto2.revision = 2;
        assert!(
            score_rom(&proto2, &en_prefs()) > score_rom(&proto1, &en_prefs()),
            "Proto 2 {:?} must beat Proto 1 {:?}",
            score_rom(&proto2, &en_prefs()),
            score_rom(&proto1, &en_prefs()),
        );
    }

    #[test]
    fn rev1_beats_unrevised_original_regardless_of_region() {
        // Real-world case: Donkey Kong (World) (Rev 1) must beat Donkey Kong (Japan, USA) (En).
        // Revision bonus (100 per rev) must overcome the USA region advantage (100 pts)
        // so that any revised version beats the unrevised original from any region.
        let mut world_rev1 = rom("Donkey Kong", &["World"], &[], &[]);
        world_rev1.revision = 1;
        let japan_usa_en = rom("Donkey Kong", &["Japan", "USA"], &["En"], &[]);
        assert!(
            score_rom(&world_rev1, &en_prefs()) > score_rom(&japan_usa_en, &en_prefs()),
            "World (Rev 1) {:?} must beat Japan/USA (En) original {:?}",
            score_rom(&world_rev1, &en_prefs()),
            score_rom(&japan_usa_en, &en_prefs()),
        );
        // Also verify Japan Rev 1 beats USA original (worst-case region gap).
        let mut japan_rev1 = rom("Game", &["Japan"], &["En"], &[]);
        japan_rev1.revision = 1;
        let usa_orig = rom("Game", &["USA"], &["En"], &[]);
        assert!(
            score_rom(&japan_rev1, &en_prefs()) > score_rom(&usa_orig, &en_prefs()),
            "Japan (En) (Rev 1) must beat USA (En) original",
        );
    }

    #[test]
    fn spain_en_es_beats_europe_fr_de_for_english_user() {
        // Scoring logic test (ROMs are hand-constructed with explicit language arrays,
        // bypassing the parser). The parser regression is covered in parser.rs tests.
        // Real-world case: user prefs = En only, no preferred regions.
        // Spain (En,Es) must be preferred over Europe (Fr,De).
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let spain = rom("Asterix & Obelix", &["Spain"], &["En", "Es"], &[]);
        let europe = rom("Asterix & Obelix", &["Europe"], &["Fr", "De"], &[]);

        // Europe (Fr,De) must not match an En-only user at all
        assert!(!matches_preferred(&europe, &prefs), "Europe (Fr,De) must not match En prefs");
        assert!(matches_preferred(&spain, &prefs), "Spain (En,Es) must match En prefs");

        // Spain must score strictly higher than Europe
        assert!(
            score_rom(&spain, &prefs) > score_rom(&europe, &prefs),
            "Spain (En,Es) {:?} must score above Europe (Fr,De) {:?}",
            score_rom(&spain, &prefs),
            score_rom(&europe, &prefs),
        );

        // In a group, Spain must be the preferred variant
        let mut spain_with_filename = spain.clone();
        spain_with_filename.filename = "Asterix & Obelix (Spain) (En,Es) (SGB Enhanced).zip".into();
        let mut europe_with_filename = europe.clone();
        europe_with_filename.filename = "Asterix & Obelix (Europe) (Fr,De) (SGB Enhanced).zip".into();

        let groups = group_roms(vec![spain_with_filename, europe_with_filename], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]);
        assert!(
            preferred.is_some(),
            "group must have a preferred variant"
        );
        assert!(
            preferred.unwrap().filename.contains("Spain"),
            "preferred must be Spain (En,Es), got: {}",
            preferred.unwrap().filename,
        );
    }

    // ── Demo category grouping ────────────────────────────────────────────────

    fn demo_rom(title: &str, regions: &[&str]) -> RomFile {
        let mut r = rom(title, regions, &[], &["Demo"]);
        r.file_category = FileCategory::Demo;
        r.status_flags = vec!["Demo".into()];
        r
    }

    #[test]
    fn demo_only_group_has_preferred_idx() {
        // A Demo-only group with a language-matching variant must get preferred_idx set.
        let d = demo_rom("Pocket Monsters (Japan) (Demo)", &["World"]);
        let prefs = en_prefs();
        let groups = group_roms(vec![d], &prefs);
        assert_eq!(groups.len(), 1);
        assert!(
            groups[0].preferred_idx.is_some(),
            "Demo-only group must have preferred_idx set when language matches"
        );
    }

    #[test]
    fn demo_group_included_in_get_roms_filter() {
        // get_roms includes groups with Game | Unofficial | Demo | Utility variant.
        // Simulate the group-level filter logic used by get_roms.
        let game = rom("Zelda (USA)", &["USA"], &[], &[]);
        let demo = demo_rom("Zelda (Japan) (Demo)", &["Japan"]);
        let prefs = en_prefs();
        let groups = group_roms(vec![game.clone(), demo.clone()], &prefs);
        // Both should coalesce into one group (same title_normalized)
        // The group qualifies for get_roms because it has a Game variant.
        let qualifies_roms = groups.iter().any(|g| {
            g.variants.iter().any(|v| {
                matches!(v.file_category, FileCategory::Game | FileCategory::Unofficial | FileCategory::Demo | FileCategory::Utility)
            })
        });
        assert!(qualifies_roms, "group with Game+Demo must qualify for ROMs tab");

        // A Demo-only group must also qualify.
        let demo_only = demo_rom("Spaceworld Demo (Japan)", &["Japan"]);
        let solo_groups = group_roms(vec![demo_only], &prefs);
        let qualifies_demo_only = solo_groups.iter().any(|g| {
            g.variants.iter().any(|v| {
                matches!(v.file_category, FileCategory::Game | FileCategory::Unofficial | FileCategory::Demo | FileCategory::Utility)
            })
        });
        assert!(qualifies_demo_only, "Demo-only group must qualify for ROMs tab");
    }

    #[test]
    fn demo_group_excluded_from_get_system_files_filter() {
        // get_system_files includes Bios | Video | EReader only (no Demo, no Utility).
        let demo = demo_rom("Pocket Monsters (Japan) (Demo)", &["Japan"]);
        let prefs = en_prefs();
        let groups = group_roms(vec![demo], &prefs);
        let qualifies_system = groups.iter().any(|g| {
            g.variants.iter().any(|v| {
                matches!(
                    v.file_category,
                    FileCategory::Bios | FileCategory::Video | FileCategory::EReader
                )
            })
        });
        assert!(!qualifies_system, "Demo-only group must NOT qualify for System Files tab");
    }

    // ── Utility preferred_idx ────────────────────────────────────────────────

    #[test]
    fn utility_only_group_gets_preferred_idx() {
        // A group containing only Utility files must have preferred_idx set
        // when at least one variant matches the user's language preference.
        // Use explicit simple titles so both normalize to the same string.
        let mut u1 = rom("Test Program", &["USA", "Europe"], &[], &[]);
        u1.file_category = FileCategory::Utility;
        u1.path = "/roms/test_program_usa.zip".into();
        u1.filename = "Test Program (USA, Europe).zip".into();
        let mut u2 = rom("Test Program", &["Japan"], &[], &[]);
        u2.file_category = FileCategory::Utility;
        u2.path = "/roms/test_program_jpn.zip".into();
        u2.filename = "Test Program (Japan).zip".into();
        let prefs = en_prefs();
        let groups = group_roms(vec![u1, u2], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert!(
            g.preferred_idx.is_some(),
            "Utility-only group must have preferred_idx when a language-matching variant exists"
        );
        // USA/Europe should win over Japan for an English user.
        let preferred = &g.variants[g.preferred_idx.unwrap()];
        assert!(
            preferred.regions.iter().any(|r| r == "USA" || r == "Europe"),
            "preferred Utility must be the USA/Europe variant, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn is_nitro_emulator_scores_as_prerelease() {
        // IS-NITRO-EMULATOR is developer hardware — must score −100, same tier as Kiosk/Beta.
        let dev = rom("Nintendo DS Firmware", &["World"], &["En", "Ja", "Fr", "De", "Es", "It"], &["IS-NITRO-EMULATOR"]);
        let prefs = en_prefs();
        let (score, _, _) = score_rom(&dev, &prefs);
        assert_eq!(score, -100, "IS-NITRO-EMULATOR firmware must score −100 (developer hardware)");
    }

    #[test]
    fn consumer_firmware_preferred_over_is_nitro() {
        // Consumer firmware (later date = higher revision) must beat IS-NITRO despite
        // IS-NITRO having the highest date-derived revision number.
        let mut consumer = rom("Nintendo DS Firmware", &["World"], &["En", "Ja", "Fr", "De", "Es", "It"], &[]);
        consumer.revision = 20051207; // 2005-12-07 — latest consumer firmware
        consumer.extra_tags = vec!["2005-12-07".into()];
        let mut dev = rom("Nintendo DS Firmware", &["World"], &["En", "Ja", "Fr", "De", "Es", "It"], &["IS-NITRO-EMULATOR"]);
        dev.revision = 20060220; // 2006-02-20 — later date but developer hardware
        dev.extra_tags = vec!["2006-02-20".into(), "IS-NITRO-EMULATOR".into()];
        let prefs = en_prefs();
        let groups = group_roms(vec![consumer.clone(), dev], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert_eq!(preferred.revision, 20051207,
            "consumer firmware (2005-12-07) must be preferred over IS-NITRO (2006-02-20)");
    }

    #[test]
    fn wifi_kiosk_scores_as_prerelease() {
        let kiosk = rom("Nintendo DS Lite Firmware", &["World"], &["En", "Ja", "Fr", "De", "Es", "It"], &["Wi-Fi Kiosk"]);
        let prefs = en_prefs();
        let (score, _, _) = score_rom(&kiosk, &prefs);
        assert_eq!(score, -100, "Wi-Fi Kiosk firmware must score −100");
    }

    #[test]
    fn mixed_game_utility_group_prefers_game_variant() {
        // In a mixed group, a Game variant must be preferred over a Utility variant.
        let game = rom("Zelda", &["USA"], &[], &[]);
        let mut util = rom("Zelda", &["USA"], &[], &[]);
        util.file_category = FileCategory::Utility;
        util.path = "/roms/Zelda_util.zip".into();
        util.filename = "Zelda (USA) (Test Program).zip".into();
        let prefs = en_prefs();
        let groups = group_roms(vec![game, util], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            matches!(preferred.file_category, FileCategory::Game),
            "Game variant must be preferred over Utility in a mixed group"
        );
    }

    #[test]
    fn video_rom_does_not_merge_into_game_group() {
        // A (Video) ROM of the same title as a game ROM must form its own group,
        // not score against the game and be flagged for deletion.
        // Real-world case: "Professor Layton and the Unwound Future (USA) (Video)"
        // vs "Professor Layton and the Unwound Future (USA)".
        let game = rom("Professor Layton and the Unwound Future", &["USA"], &[], &[]);
        let mut video = rom("Professor Layton and the Unwound Future", &["USA"], &[], &[]);
        video.file_category = FileCategory::Video;
        video.extra_tags = vec!["Video".into()];
        video.filename = "Professor Layton and the Unwound Future (USA) (Video).zip".into();
        let prefs = en_prefs();
        let groups = group_roms(vec![game, video], &prefs);
        assert_eq!(groups.len(), 2, "Video ROM must be in its own group, not merged with the game group");
        // Both groups should have exactly one variant and a preferred index.
        for g in &groups {
            assert_eq!(g.variants.len(), 1, "each group should have exactly one variant");
            assert!(g.preferred_idx.is_some(), "single-variant group must have preferred_idx");
        }
    }

    #[test]
    fn video_roms_of_same_title_group_together() {
        // Two Video ROMs of the same title (different regions) should still group
        // so the preferred region is selected between them.
        let mut usa_vid = rom("Some Game", &["USA"], &[], &[]);
        usa_vid.file_category = FileCategory::Video;
        let mut eur_vid = rom("Some Game", &["Europe"], &[], &[]);
        eur_vid.file_category = FileCategory::Video;
        let prefs = en_prefs();
        let groups = group_roms(vec![usa_vid, eur_vid], &prefs);
        assert_eq!(groups.len(), 1, "Video ROMs of the same title must group together");
        assert_eq!(groups[0].variants.len(), 2);
    }
}
