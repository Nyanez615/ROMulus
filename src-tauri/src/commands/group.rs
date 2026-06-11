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
// Hardware capability / patch tags — not platform variants; exempt from the unknown penalty.
const HARDWARE_FEATURE_TAGS: &[&str] = &[
    // Post-release patch already encoded as revision=1 in the parser; adding a score
    // penalty on top would invert the revision bonus that intentionally rewards it.
    "Bugfix",
    // Game Boy / GBC / GBA / DS hardware-feature descriptors: ROM capability flags.
    "SGB Enhanced", "CGB Enhanced", "GBC Mode", "GBC Required",
    "GBA Mode", "DSi Enhanced", "DSi Exclusive",
    // Memory bank controller specs: purely technical metadata, not release variants.
    "MBC1", "MBC2", "MBC3", "MBC5", "MBC6", "MBC7",
    "HuC1", "HuC3", "MMM01",
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
        // build_date (YYYYMMDD) orders dated protos chronologically; fall back to
        // the explicit sequence number (e.g. "Proto 2") when no date is present.
        let build_ord = rom.build_date.unwrap_or(rom.revision);
        return (-100 + alt_penalty, build_ord, lang_count * 1000 + r_score);
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
            } else if rom.extra_tags.iter().flat_map(|t| t.split(", "))
                .any(|part| !HARDWARE_FEATURE_TAGS.contains(&part)) {
                // Any unrecognised extra_tag that isn't a hardware capability flag
                // (platform port, store label, date stamp, studio label, etc.)
                // indicates a platform/distribution variant — prefer the base ROM.
                -5
            } else {
                0
            };
        // Completeness bonus: positive signals that the ROM is the most complete artifact.
        //   Digital  = developer-native release (physical cartridge is a manufactured product)
        //   Unlocked = full version with no content gate (vs a locked jam/Patreon entry)
        // +6 overcomes the -5 unknown-tag penalty, netting -29 vs bare physical -30.
        let completeness_bonus: i32 = if rom.extra_tags.iter().flat_map(|t| t.split(", "))
            .any(|part| part == "Digital" || part == "Unlocked") { 6 } else { 0 };
        return (-30 + alt_penalty + format_penalty + completeness_bonus, rom.revision, lang_count * 1000 + r_score);
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
    // Base-27 encoding per component: "N" → N*27, "Na" → N*27+1, "Nb" → N*27+2 …
    // This preserves ordering across alpha variants ("v0.1a" < "v0.1b") and handles
    // 4+ part versions ("v0.0.1.1.5.2") by taking the first three components.
    // Scale chosen so one major unit always dominates a fully-saturated minor:
    //   max minor contribution ≈ 999*27+26 = 26 999  ×  27 000 ≈ 729 M
    //   min major unit          = 1*27      =     27  ×  27 000 000 = 729 M  (27 000 > 26 999 ✓)
    let enc = |p: &str| -> u64 {
        let digit_end = p.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(p.len());
        let num: u64 = p[..digit_end].parse().unwrap_or(0);
        let alpha: u64 = p.as_bytes().get(digit_end)
            .map(|&b| (b.to_ascii_lowercase().saturating_sub(b'a') as u64) + 1)
            .unwrap_or(0);
        num * 27 + alpha
    };
    let mut parts = s.split('.');
    let major = parts.next().map(enc).unwrap_or(0);
    let minor = parts.next().map(enc).unwrap_or(0);
    let patch = parts.next().map(enc).unwrap_or(0);
    major * 27_000_000 + minor * 27_000 + patch
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

// ── Console key normalisation ─────────────────────────────────────────────────

/// Console-directory suffixes stripped before grouping so ROMs from variant
/// folders land in the same title group and scoring can pick the best one.
///
/// This is the Rust mirror of `VARIANT_SUFFIXES` in `consoleUtils.ts`.  Keep
/// both lists in sync when No-Intro adds new folder-naming conventions.
///
/// Suffixes are stripped iteratively from the trailing end so that compound
/// names like "…(FDS) (Aftermarket)" or "…(Steam) (Hentai)" collapse to their
/// base name in one pass.
///
/// Format-pair detection (`detect_format_pairs`) still runs on the raw
/// `rom.console` values, so the Prune bulk-delete workflow for paired
/// directories (FDS/QD, Headered/Headerless, etc.) is unaffected — those groups
/// are already merged by `console_group_key` and `merge_format_pairs` simply
/// marks them `is_format_pair = true`.
const CONSOLE_VARIANT_SUFFIXES: &[&str] = &[
    // Famicom Disk System media formats
    "(FDS)", "(QD)",
    // Game Boy Advance special cart types
    "(Multiboot)", "(Video)", "(e-Reader)", "(Play-Yan)",
    // Nintendo 64 byte-order variants
    "(BigEndian)", "(ByteSwapped)",
    // NES ROM header variants
    "(Headered)", "(Headerless)",
    // Nintendo DS / 3DS / DSi encryption + distribution variants
    "(Encrypted)", "(Decrypted)", "(Download Play)", "(Digital)", "(CDN)",
    "(SpotPass)", "(Pre-Install)", "(Dev ROMs)", "(Lotcheck)", "(Dev)",
    "(DSvision SD cards)", "(Updates and DLC)", "(Split DLC)", "(WAD)",
    // Nintendo kiosk / GameCube special media
    "(CardImage)", "(Extracted)", "(Memory Card)", "(NPDP Carts)",
    "(Starlight Fun Center)", "(Mario no Photopi SmartMedia)",
    // Nintendo audio content
    "(M4A)", "(Tracks)",
    // PlayStation distribution variants (PSP / PS3 / Vita)
    "(PSN)", "(NoNpDrm)", "(PSVgameSD)", "(Minis)", "(UMD Video)", "(UMD Music)",
    "(PS one Classics)", "(Avatars)", "(Content)", "(DLC)", "(Themes)", "(Updates)",
    // Sony Vita / PSP unofficial formats
    "(BlackFinPSV)", "(VPK)", "(PSX2PSP)", "(BD-Video Extras)",
    // Xbox 360 digital storefronts
    "(Games on Demand)", "(XBLA)", "(Title Updates)",
    // Content-category variants (same hardware, different ROM-set status)
    "(Aftermarket)", "(Private)",
    // Atari container formats
    "(A78)", "(LNX)", "(LYX)", "(BLL)", "(JAG)", "(J64)", "(ROM)", "(ABS)", "(COF)", "(BIN)",
    // Commodore
    "(PP)",
    // Casio Loopy byte-order
    "(LittleEndian)",
    // NEC disk formats / floppy preservation
    "(Greaseweazle)", "(HardDisk)", "(HDM)",
    "(Flux)", "(A2R)", "(WOZ)", "(Kryoflux)", "(KryoFlux)", "(IPF)", "(SCP)",
    "(Bitstream)", "(Sector)", "(DC42)", "(Floppies)", "(FluxDumps)",
    // Apple Macintosh BETA releases
    "(BETA)",
    // Tape / audio formats
    "(Tapes)", "(Waveform)", "(WAV)",
    // Sega special hardware accessories
    "(Visual Memory Unit)", "(Development Kit Hard Drives)",
    // Preservation / content formats
    "(WARC)", "(Mame)", "(PDF)", "(CBZ)", "(RAW)", "(JPEG)",
    "(Playbutton)", "(Catalog)", "(itch.io)", "(APK)",
    "(Amazon Appstore)", "(Google Play Store)", "(Samsung Galaxy Apps)",
    // Deprecation / misc
    "(WIP)", "(Deprecated)", "(Uncategorized)", "(Misc)", "(Various)",
    // IBM PC digital storefronts
    "(Tiger Electronics - Net Jet)",
    "(Steam)", "(GOG)", "(Epic Games Launcher)", "(Humble Bundle)", "(GamersGate)",
    "(Microsoft Store)", "(Amazon)", "(BOOTH)", "(Ci-en)", "(DLsite)", "(Denpasoft)",
    "(Desura)", "(FANZA)", "(Freem!)", "(Getchu.com)", "(Groupees)", "(JAST USA)",
    "(Johren)", "(Kagura Games)", "(MangaGamer)", "(NovelGameCollection)",
    "(Games for Windows Live)", "(Games for Windows Marketplace)",
    "(Press Kits)", "(LooseFilesArchive)", "(Flash)", "(Doujin)", "(Hentai)",
    "(Unknown)", "(Spillover Tracks)",
    // Dev-stage variants — not in TypeScript VARIANT_SUFFIXES (those suffixes only
    // appear in ROM filenames, not directory names in No-Intro) but kept here for
    // user-organised collections and defensive coverage.
    "(Demo)", "(Beta)", "(Alpha)", "(Prototype)", "(Proto)", "(Sample)", "(Promo)",
];

/// Return the console key used for grouping, with trailing variant suffixes
/// removed. The original `rom.console` value is kept for display purposes.
fn console_group_key(console: &str) -> &str {
    let mut s = console.trim_end();
    let mut changed = true;
    while changed {
        changed = false;
        for &suffix in CONSOLE_VARIANT_SUFFIXES {
            if let Some(stripped) = s.strip_suffix(suffix) {
                s = stripped.trim_end();
                changed = true;
                break;
            }
        }
    }
    s
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

    // Group by (console_group_key, title_key, category_bucket).
    //
    // console_group_key strips content-category suffixes like "(Aftermarket)" and
    // "(Private)" and dev-stage suffixes like "(Demo)" and "(Beta)" before grouping,
    // so ROMs from parallel torrent folders ("Nintendo - Game Boy (Aftermarket)" and
    // "Nintendo - Game Boy (Private)") land in the same title group and scoring can
    // pick the best variant across all folders. The raw rom.console is kept for
    // display — only the hash key is normalised.
    //
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
        let key = (
            console_group_key(&rom.console).to_string(),
            crate::picker::group_key(&rom.filename),
            bucket,
        );
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

/// Override `preferred_idx` on a group when the user has saved a format folder
/// preference. Format preference is a tiebreaker: it only overrides scoring when
/// the preferred-folder's best variant is not version-inferior to the current
/// winner. If the current winner has a higher revision or version string the
/// scoring result stands — we never downgrade a newer release for a format.
fn apply_format_pref(g: &mut RomGroup, format_prefs: &HashMap<String, String>) {
    let cg = console_group_key(&g.console);
    let Some(preferred_folder) = format_prefs.get(cg) else { return };

    let Some(curr_idx) = g.preferred_idx else { return };
    let Some(curr) = g.variants.get(curr_idx) else { return };

    // Already from the preferred folder — sync the display console name only.
    if curr.console == *preferred_folder {
        g.console = preferred_folder.clone();
        return;
    }

    // Find the best variant from the preferred folder (highest revision, then
    // highest version string as secondary key).
    let best_in_pref = g.variants.iter().enumerate()
        .filter(|(_, v)| v.console.as_str() == preferred_folder.as_str())
        .max_by_key(|(_, v)| (v.revision, v.version.as_deref().unwrap_or("")));

    let Some((pref_idx, pref_var)) = best_in_pref else { return };

    // Don't override if the current winner has a strictly higher revision.
    if curr.revision > pref_var.revision {
        return;
    }
    // Don't override if revisions are equal but the current winner carries a
    // version tag the preferred variant lacks, or a lexicographically higher one.
    if curr.revision == pref_var.revision {
        match (&curr.version, &pref_var.version) {
            (Some(cv), Some(pv)) if cv.as_str() > pv.as_str() => return,
            (Some(_), None) => return,
            _ => {}
        }
    }

    g.preferred_idx = Some(pref_idx);
    g.console = preferred_folder.clone();
}

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
    format_prefs: &HashMap<String, String>,
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

    for ((_, _), mut title_groups) in by_title {
        if title_groups.len() == 1 {
            let mut g = title_groups.remove(0);
            g.is_format_pair = true;
            // group_roms already merged variants from all format folders via console_group_key,
            // so this is always the single-group path. Apply format preference here.
            apply_format_pref(&mut g, format_prefs);
            result.push(g);
        } else {
            // Fallback for the rare case where group_roms produced separate groups
            // (e.g. future category-bucket changes).
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
            apply_format_pref(&mut merged, format_prefs);
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
                    FileCategory::Bios | FileCategory::Video | FileCategory::EReader | FileCategory::Accessory
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
            build_date: None,
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
    fn version_ord_multipart_and_alpha_suffix() {
        // 4-part version must outrank unversioned (Graveblood regression).
        assert!(version_ord(&Some("v0.0.1.1.5.2".into())) > version_ord(&None));
        // Alpha suffix ordering: v0.1 < v0.1a < v0.1b.
        assert!(version_ord(&Some("v0.1a".into())) > version_ord(&Some("v0.1".into())));
        assert!(version_ord(&Some("v0.1b".into())) > version_ord(&Some("v0.1a".into())));
        // Standard ordering still holds.
        assert!(version_ord(&Some("v2.1".into())) > version_ord(&Some("v2.0".into())));
        assert!(version_ord(&Some("v1.0".into())) > version_ord(&Some("v0.95".into())));
    }

    #[test]
    fn versioned_prerelease_preferred_over_unversioned() {
        // v0.0.1.1.5.2 (Demo) must be preferred over plain (Demo) — version tiebreaker.
        let make_demo = |filename: &str, version: Option<&str>| -> RomFile {
            let mut r = rom("Graveblood", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Demo".into(), "Aftermarket".into(), "Unl".into()];
            r.version = version.map(|s| s.to_string());
            r
        };
        let plain = make_demo("Graveblood (World) (Demo) (Aftermarket) (Unl).zip", None);
        let versioned = make_demo(
            "Graveblood (World) (v0.0.1.1.5.2) (Demo) (Aftermarket) (Unl).zip",
            Some("v0.0.1.1.5.2"),
        );
        let prefs = en_prefs();
        let groups = group_roms(vec![plain, versioned], &prefs);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.version.as_deref() == Some("v0.0.1.1.5.2"),
            "versioned Demo must be preferred, got: {}",
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
    fn digital_aftermarket_preferred_over_physical() {
        // "(Digital)" indicates the developer-made digital release; the physical cartridge
        // is a manufactured product. Digital should win the tiebreaker.
        let mut physical = rom("Batty Zabella", &["World"], &[], &[]);
        physical.file_category = FileCategory::Unofficial;
        physical.status_flags = vec!["Aftermarket".into(), "Unl".into()];
        physical.filename = "Batty Zabella (World) (Aftermarket) (Unl).zip".into();

        let mut digital = rom("Batty Zabella", &["World"], &[], &[]);
        digital.file_category = FileCategory::Unofficial;
        digital.status_flags = vec!["Aftermarket".into(), "Unl".into()];
        digital.extra_tags = vec!["Digital".into()];
        digital.filename = "Batty Zabella (World) (Digital) (Aftermarket) (Unl).zip".into();

        let prefs = en_prefs();
        assert!(
            score_rom(&digital, &prefs) > score_rom(&physical, &prefs),
            "Digital {:?} must score above physical {:?}",
            score_rom(&digital, &prefs),
            score_rom(&physical, &prefs),
        );

        let groups = group_roms(vec![physical, digital], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.extra_tags.contains(&"Digital".to_string()),
            "Digital must be preferred, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn unlocked_aftermarket_preferred_over_locked() {
        // "(Unlocked)" = full version with no content gate; locked jam entry is a demo.
        let mut locked = rom("Toadally Awesome", &["World"], &[], &[]);
        locked.file_category = FileCategory::Unofficial;
        locked.status_flags = vec!["Aftermarket".into(), "Unl".into()];
        locked.extra_tags = vec!["GBA Jam 2021".into()];
        locked.filename = "Toadally Awesome (World) (GBA Jam 2021) (Aftermarket) (Unl).zip".into();

        let mut unlocked = rom("Toadally Awesome", &["World"], &[], &[]);
        unlocked.file_category = FileCategory::Unofficial;
        unlocked.status_flags = vec!["Aftermarket".into(), "Unl".into()];
        unlocked.extra_tags = vec!["GBA Jam 2021".into(), "Unlocked".into()];
        unlocked.filename =
            "Toadally Awesome (World) (GBA Jam 2021) (Unlocked) (Aftermarket) (Unl).zip".into();

        let prefs = en_prefs();
        assert!(
            score_rom(&unlocked, &prefs) > score_rom(&locked, &prefs),
            "Unlocked {:?} must score above locked {:?}",
            score_rom(&unlocked, &prefs),
            score_rom(&locked, &prefs),
        );

        let groups = group_roms(vec![locked, unlocked], &prefs);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.extra_tags.contains(&"Unlocked".to_string()),
            "Unlocked must be preferred, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn demo_folder_and_release_folder_merge_into_one_group() {
        // Simulates two torrents unpacked into sibling directories:
        //   "Nintendo - Game Boy (Aftermarket)"         → full release
        //   "Nintendo - Game Boy (Aftermarket) (Demo)"  → demo build
        // Both must land in the same group so scoring can pick the full release.
        let release_console = "Nintendo - Game Boy (Aftermarket)";
        let demo_console    = "Nintendo - Game Boy (Aftermarket) (Demo)";

        let mut full = rom("Dragon Battle", &["World"], &[], &[]);
        full.console = release_console.into();
        full.filename = "Dragon Battle (World) (Aftermarket) (Unl).zip".into();
        full.file_category = FileCategory::Unofficial;
        full.status_flags = vec!["Aftermarket".into(), "Unl".into()];

        let mut demo = rom("Dragon Battle", &["World"], &[], &[]);
        demo.console = demo_console.into();
        demo.filename = "Dragon Battle (World) (Demo) (Aftermarket) (Unl).zip".into();
        demo.file_category = FileCategory::Unofficial;
        demo.status_flags = vec!["Demo".into(), "Aftermarket".into(), "Unl".into()];

        let prefs = en_prefs();
        let groups = group_roms(vec![full, demo], &prefs);

        assert_eq!(groups.len(), 1, "Demo and full release must be in the same group");
        let g = &groups[0];
        assert_eq!(g.variants.len(), 2);
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            !preferred.status_flags.contains(&"Demo".to_string()),
            "Full release must be preferred over demo, got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn same_console_demo_and_release_already_group_together() {
        // When both files live in the exact same console directory they must land in
        // one group without any fix — this test documents the invariant and lets us
        // detect if something downstream ever breaks it.
        let console = "Nintendo - Game Boy (Aftermarket)";

        let mut full = rom("Dragon Battle", &["World"], &[], &[]);
        full.console = console.into();
        full.filename = "Dragon Battle (World) (Aftermarket) (Unl).zip".into();
        full.file_category = FileCategory::Unofficial;
        full.status_flags = vec!["Aftermarket".into(), "Unl".into()];

        let mut demo = rom("Dragon Battle", &["World"], &[], &[]);
        demo.console = console.into();
        demo.filename = "Dragon Battle (World) (Demo) (Aftermarket) (Unl).zip".into();
        demo.file_category = FileCategory::Unofficial;
        demo.status_flags = vec!["Demo".into(), "Aftermarket".into(), "Unl".into()];

        let prefs = en_prefs();
        let groups = group_roms(vec![full, demo], &prefs);

        assert_eq!(groups.len(), 1, "Same-console Demo and full release must be in one group");
        assert_eq!(groups[0].variants.len(), 2);
    }

    #[test]
    fn console_group_key_strips_variant_suffixes() {
        // Content-category suffixes are stripped
        assert_eq!(console_group_key("Nintendo - Game Boy (Aftermarket)"), "Nintendo - Game Boy");
        assert_eq!(console_group_key("Nintendo - Game Boy (Private)"), "Nintendo - Game Boy");
        // Dev-stage suffixes are stripped
        assert_eq!(console_group_key("Nintendo - Game Boy (Demo)"), "Nintendo - Game Boy");
        assert_eq!(console_group_key("Nintendo - Game Boy (Beta)"), "Nintendo - Game Boy");
        // Multiple trailing suffixes are stripped iteratively
        assert_eq!(console_group_key("Nintendo - Game Boy (Aftermarket) (Demo)"), "Nintendo - Game Boy");
        assert_eq!(console_group_key("Nintendo - Game Boy (Aftermarket) (Beta)"), "Nintendo - Game Boy");
        assert_eq!(console_group_key("Nintendo - Game Boy (Aftermarket) (Demo) (Beta)"), "Nintendo - Game Boy");
        // Format-pair suffixes are also stripped (merge_format_pairs marks them is_format_pair)
        assert_eq!(console_group_key("Nintendo - Family Computer Disk System (FDS)"), "Nintendo - Family Computer Disk System");
        assert_eq!(console_group_key("Nintendo - Family Computer Disk System (QD)"), "Nintendo - Family Computer Disk System");
        assert_eq!(console_group_key("Nintendo - Nintendo Entertainment System (Headered)"), "Nintendo - Nintendo Entertainment System");
        assert_eq!(console_group_key("Nintendo - Nintendo Entertainment System (Headerless)"), "Nintendo - Nintendo Entertainment System");
        assert_eq!(console_group_key("Nintendo - Nintendo 64 (BigEndian)"), "Nintendo - Nintendo 64");
        assert_eq!(console_group_key("Nintendo - Nintendo 64 (ByteSwapped)"), "Nintendo - Nintendo 64");
        // IBM PC digital storefronts collapse to base
        assert_eq!(console_group_key("IBM - PC and Compatibles (Digital) (Steam)"), "IBM - PC and Compatibles");
        assert_eq!(console_group_key("IBM - PC and Compatibles (Digital) (GOG)"), "IBM - PC and Compatibles");
        // Compound content+format suffixes collapse completely
        assert_eq!(console_group_key("Nintendo - Family Computer Disk System (FDS) (Aftermarket)"), "Nintendo - Family Computer Disk System");
        // Base name without any suffix is unchanged
        assert_eq!(console_group_key("Nintendo - Game Boy"), "Nintendo - Game Boy");
    }

    #[test]
    fn aftermarket_and_private_folders_merge_into_one_group() {
        // Reproduces the observed Athletic World / Cat and His Boy split: the same
        // title exists in both "(Aftermarket)" and "(Private)" console directories.
        // Without normalisation the two directories produced separate 1-variant groups.
        let mut aftermarket = rom("Athletic World", &["World"], &[], &[]);
        aftermarket.console = "Nintendo - Game Boy (Aftermarket)".into();
        aftermarket.filename =
            "Athletic World (World) (SGB Enhanced) (Aftermarket) (Unl).zip".into();
        aftermarket.file_category = FileCategory::Unofficial;
        aftermarket.status_flags = vec!["Aftermarket".into(), "Unl".into()];

        let mut private = rom("Athletic World", &["World"], &[], &[]);
        private.console = "Nintendo - Game Boy (Private)".into();
        private.filename = "Athletic World (World) (SGB Enhanced) (Unl).zip".into();
        private.file_category = FileCategory::Unofficial;
        private.status_flags = vec!["Unl".into()];

        let prefs = en_prefs();
        let groups = group_roms(vec![aftermarket, private], &prefs);

        assert_eq!(
            groups.len(),
            1,
            "Aftermarket and Private copies of the same title must be one group"
        );
        assert_eq!(groups[0].variants.len(), 2);
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
                build_date: None,
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

        let merged = merge_format_pairs(groups, &[pair], &en_prefs(), &HashMap::new());

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

    // ── apply_format_pref tiebreaker tests ───────────────────────────────────

    fn make_group_with_console(console: &str, revision: u32, version: Option<&str>) -> RomFile {
        let mut r = rom("Game (World)", &["World"], &["En"], &[]);
        r.console = console.to_string();
        r.revision = revision;
        r.version = version.map(|s| s.to_string());
        r
    }

    fn group_with_variants(variants: Vec<RomFile>, preferred_idx: Option<usize>) -> RomGroup {
        let console = variants.first().map(|v| v.console.clone()).unwrap_or_default();
        RomGroup {
            title_normalized: "game (world)".into(),
            console,
            variants,
            preferred_idx,
            has_preferred_version: true,
            is_format_pair: true,
            disc_count: 1,
        }
    }

    #[test]
    fn format_pref_applies_when_versions_equal() {
        // FDS and QD both have the same (base) version — format preference should pick FDS.
        let fds = make_group_with_console("Nintendo - FDS (FDS)", 0, None);
        let qd  = make_group_with_console("Nintendo - FDS (QD)",  0, None);
        // Scoring picked QD (idx 1) — format preference should override to FDS (idx 0).
        let mut g = group_with_variants(vec![fds, qd], Some(1));
        let mut prefs = HashMap::new();
        prefs.insert(
            "Nintendo - FDS".to_string(),
            "Nintendo - FDS (FDS)".to_string(),
        );
        apply_format_pref(&mut g, &prefs);
        assert_eq!(g.preferred_idx, Some(0), "FDS should be preferred when versions are equal");
    }

    #[test]
    fn format_pref_does_not_downgrade_higher_version() {
        // FDS has base version; Aftermarket has v1.1 — scoring picked Aftermarket (idx 1).
        // Format preference for FDS must NOT override because v1.1 > base.
        let fds         = make_group_with_console("Nintendo - FDS (FDS)",         0, None);
        let aftermarket = make_group_with_console("Nintendo - FDS (Aftermarket)",  0, Some("v1.1"));
        let mut g = group_with_variants(vec![fds, aftermarket], Some(1));
        let mut prefs = HashMap::new();
        prefs.insert(
            "Nintendo - FDS".to_string(),
            "Nintendo - FDS (FDS)".to_string(),
        );
        apply_format_pref(&mut g, &prefs);
        assert_eq!(
            g.preferred_idx, Some(1),
            "Aftermarket v1.1 should remain preferred over FDS base version",
        );
    }

    #[test]
    fn format_pref_does_not_downgrade_higher_revision() {
        // FDS base; QD Rev 1 — format preference for FDS must not override.
        let fds = make_group_with_console("Nintendo - FDS (FDS)", 0, None);
        let qd  = make_group_with_console("Nintendo - FDS (QD)",  1, None); // Rev 1
        let mut g = group_with_variants(vec![fds, qd], Some(1));
        let mut prefs = HashMap::new();
        prefs.insert(
            "Nintendo - FDS".to_string(),
            "Nintendo - FDS (FDS)".to_string(),
        );
        apply_format_pref(&mut g, &prefs);
        assert_eq!(
            g.preferred_idx, Some(1),
            "QD Rev 1 should remain preferred over FDS base revision",
        );
    }

    #[test]
    fn format_pref_no_op_when_winner_already_preferred_folder() {
        // Winner is already from the preferred folder — preferred_idx must not change.
        let fds = make_group_with_console("Nintendo - FDS (FDS)", 0, None);
        let qd  = make_group_with_console("Nintendo - FDS (QD)",  0, None);
        let mut g = group_with_variants(vec![fds, qd], Some(0)); // FDS already wins
        let mut prefs = HashMap::new();
        prefs.insert(
            "Nintendo - FDS".to_string(),
            "Nintendo - FDS (FDS)".to_string(),
        );
        apply_format_pref(&mut g, &prefs);
        assert_eq!(g.preferred_idx, Some(0));
        assert_eq!(g.console, "Nintendo - FDS (FDS)");
    }
}
