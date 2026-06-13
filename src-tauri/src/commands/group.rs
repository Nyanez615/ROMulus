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
// Tags that are exempt from the generic −5 unknown-extra-tag penalty.
// These are either hardware capability flags (purely technical, not distribution
// variants) or developer-direct distribution channels where the Patreon/crowdfunded
// release IS the canonical latest version — penalising it would prefer an older
// standard release over a newer developer-published one.
const HARDWARE_FEATURE_TAGS: &[&str] = &[
    // Post-release patch already encoded as revision=1 in the parser; adding a score
    // penalty on top would invert the revision bonus that intentionally rewards it.
    "Bugfix",
    // Game Boy / GBC / GBA / DS hardware-feature descriptors: ROM capability flags.
    // "GB Compatible" = GBC game that also runs on original Game Boy hardware.
    "SGB Enhanced", "CGB Enhanced", "GBC Mode", "GBC Required", "GB Compatible",
    "GBA Mode", "DSi Enhanced", "DSi Exclusive",
    // Memory bank controller specs: purely technical metadata, not release variants.
    "MBC1", "MBC2", "MBC3", "MBC5", "MBC6", "MBC7",
    "HuC1", "HuC3", "MMM01",
    // Developer-direct funding/distribution platform — the Patreon build is
    // typically the latest version from the original author, not a lesser variant.
    // Version tiebreaker then picks the higher version correctly.
    "Patreon",
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
            "Alpha" | "Beta" | "Proto" | "Possible Proto" | "Demo" | "Tech Demo" | "Sample" | "Promo"
            | "Kiosk" | "Wi-Fi Kiosk"
            | "IS-NITRO-EMULATOR" | "IS-NITRO-PROGRAMMER"
            | "Preview" | "GameCube Preview"
        )
    }) {
        let r_score = region_score(&rom.regions, prefs).max(0) as usize;
        let lang_count = rom.languages.iter()
            .filter(|l| prefs.preferred_languages.contains(*l))
            .count();
        // Ordering: numbered protos (Proto N) > dated protos > bare proto.
        // Numbered protos are explicitly sequenced by archivists and represent the
        // most complete builds in the series, so they rank above any dated snapshot.
        // Sentinel 99_000_000 + N safely exceeds any YYYYMMDD value (≤ 20_991_231).
        let build_ord = match (rom.build_date, rom.revision) {
            (Some(d), _) => d,
            (None, r) if r > 0 => 99_000_000 + r,
            _ => 0,
        };
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
        // Version tag or revision both signal a newer/improved release — +6 overcomes the
        // -5 unknown-tag penalty so the most current release beats a plain unversioned one.
        // When two tagged releases tie on this bonus (e.g. v1.2 vs Rev 2), the tuple's
        // `revision` field breaks the tie: Rev 2 (revision=2) beats v1.2 (revision=0).
        let version_bonus: i32 = if rom.version.is_some() || rom.revision > 0 { 6 } else { 0 };
        return (-30 + alt_penalty + format_penalty + completeness_bonus + version_bonus, rom.revision, lang_count * 1000 + r_score);
    }

    // Region score from user's preferred_regions list
    let region_score = region_score(&rom.regions, prefs);

    // Split each extra_tag on ", " before matching so compound tags like
    // "Namcot Collection, Namco Museum Archives Vol 1" hit the penalty correctly.
    let collection_penalty: i32 =
        if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| COLLECTION_TAGS.contains(&part)) {
            // Dynamic penalty: always larger than the ROM's own region_score so the
            // net region contribution is exactly −6.  This means no collection re-release
            // can beat an unpenalised original regardless of how large the region score is —
            // including "World" releases boosted by the World-universal-region rule.
            // Any original (minimum region score = 5) always outscores any collection.
            -(region_score + 6)
        } else if rom.extra_tags.iter().flat_map(|t| t.split(", ")).any(|part| FORMAT_VARIANT_TAGS.contains(&part)) {
            -5
        } else if rom.extra_tags.iter().flat_map(|t| t.split(", "))
            .any(|part| !HARDWARE_FEATURE_TAGS.contains(&part)) {
            // Any unrecognised extra_tag that isn't a hardware capability flag
            // (platform port, store label, studio label, etc.) indicates a
            // platform/distribution variant — prefer the base ROM.
            // Hardware feature tags like "SGB Enhanced" or "GBC Mode" are exempt
            // so they don't suppress the revision_bonus for enhanced editions.
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

    // A version tag signals a newer release — +6 overcomes the -5 unknown-tag penalty
    // so a versioned release beats a plain unversioned one even when it carries a
    // publisher label (e.g. "(Incube8 Games)") in its extra_tags.
    let version_bonus: i32 = if rom.version.is_some() { 6 } else { 0 };

    (lang_priority + region_score + collection_penalty + alt_penalty + revision_bonus + version_bonus, rom.revision, lang_matches)
}

pub(crate) fn region_score(regions: &[String], prefs: &UserPreferences) -> i32 {
    if prefs.preferred_regions.is_empty() {
        // Fallback scoring when no preference set
        let best = regions.iter().map(|r| default_region_score(r.as_str())).max();
        return best.unwrap_or(5);
    }

    let max_priority = prefs.preferred_regions.len() as i32;
    let explicit = regions
        .iter()
        .filter_map(|r| {
            prefs.preferred_regions.iter().position(|p| p == r)
                .map(|idx| (max_priority - idx as i32) * 20)
        })
        .max();

    explicit.unwrap_or_else(|| {
        // "World" is a universal release compatible with every region — treat it as
        // matching the user's top preferred region so a "World (Rev 1)" isn't
        // arbitrarily penalised against a region-specific original.
        if regions.iter().any(|r| r == "World") {
            max_priority * 20
        } else {
            // Country-specific release that doesn't match any preference: use the
            // default table so non-English regions still have sensible ordering.
            regions.iter().map(|r| default_region_score(r.as_str())).max().unwrap_or(5)
        }
    })
}

/// Converts a version string like "v2.1" or "v1.0.3" into a comparable u64.
/// None (bare/unversioned) → just below v1.0 so that bare outranks any sub-1.0
/// version string (v0.x signals an incomplete build) but loses to v1.0+.
fn version_ord(v: &Option<String>) -> u64 {
    // 27_000_000 is the encoding for v1.0 (major=1, minor=0, patch=0).
    // Bare files are placed at 27_000_000 - 1, one slot below v1.0.
    // This means: bare > v0.x (sub-1.0 indicates incomplete), v1.0+ > bare.
    let s = match v.as_deref().and_then(|s| s.strip_prefix('v')) {
        Some(s) => s,
        // v1.0 encodes as enc("1")*27_000_000 = 27*27_000_000 = 729_000_000.
        // Bare files sit at 729_000_000 - 1: above every sub-1.0 build, below v1.0.
        None => return 27_u64 * 27_000_000 - 1,
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

// ── Catalog-number detection ──────────────────────────────────────────────────

/// Extract the first catalog-number fragment from a ROM's extra_tags.
///
/// Returns the lowercase catalog number string (e.g. `"4b-001"`) if any
/// extra_tag fragment matches the pattern: alphanumeric prefix containing at
/// least one letter, hyphen, all-digit suffix (e.g. `"4B-001"`, `"NWB-01"`).
///
/// This is used to differentiate physical cartridge compilations that share a
/// generic title like "4 in 1" but carry distinct catalog numbers and contain
/// completely different games. Publisher-only extra_tags like "Incube8 Games"
/// or "ModRetro Chromatic" do not match (no all-digit suffix) and return `""`.
fn extract_catalog_number(extra_tags: &[String]) -> String {
    extract_catalog_tag(extra_tags)
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// Same as `extract_catalog_number` but returns the original-case tag string
/// (e.g. `"4B-001, Sachen-Commin"`) for display in the UI.
fn extract_catalog_tag(extra_tags: &[String]) -> Option<&str> {
    for tag in extra_tags {
        for part in tag.split(", ") {
            let part = part.trim();
            if let Some(hyphen) = part.find('-') {
                let prefix = &part[..hyphen];
                let suffix = &part[hyphen + 1..];
                if !prefix.is_empty()
                    && prefix.chars().all(|c| c.is_alphanumeric())
                    && prefix.chars().any(|c| c.is_alphabetic())
                    && !suffix.is_empty()
                    && suffix.chars().all(|c| c.is_ascii_digit())
                {
                    return Some(tag.as_str());
                }
            }
        }
    }
    None
}

/// Pre-release development stage ordering for sort tiebreaking.
/// Alpha < Beta < everything else (Demo/Proto/Sample/etc.) so an explicit
/// stage label beats an earlier one even when version numbers are sub-1.0.
fn prerelease_stage(flags: &[String]) -> u8 {
    for f in flags {
        match f.as_str() {
            "Alpha" => return 0,
            "Beta"  => return 1,
            _       => {}
        }
    }
    2
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

    // Group by (console_group_key, title_key, catalog_number, category_bucket).
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
    //
    // catalog_number separates physically distinct compilations that share a generic
    // title (e.g. "4 in 1") but carry different catalog numbers in their extra_tags
    // (e.g. "4B-001, Sachen" vs "4B-002, Sachen"). Publisher-only extra_tags like
    // "(Incube8 Games)" produce an empty catalog_number and remain in the same group.
    let mut groups: HashMap<(String, String, String, &'static str), Vec<RomFile>> = HashMap::new();

    for rom in roms.drain(..) {
        let bucket: &'static str = match rom.file_category {
            FileCategory::Video   => "video",
            FileCategory::EReader => "ereader",
            _                     => "",
        };
        let key = (
            console_group_key(&rom.console).to_string(),
            crate::picker::group_key(&rom.filename),
            extract_catalog_number(&rom.extra_tags),
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
    // All variants in a catalog-number group share the same catalog tag; grab it
    // from the first variant for display in the Titles view.
    let catalog_number = extract_catalog_tag(&variants[0].extra_tags).map(str::to_string);

    // Detect multi-disc
    let max_disc = variants.iter().filter_map(|r| r.disc_number).max().unwrap_or(0);
    let disc_count = if max_disc > 0 { max_disc } else { 1 };

    // Sort variants: (score, revision, lang_matches) descending; then version descending
    // so "v2.1" beats "v1.0" when everything else ties; build_date descending so the
    // newest build wins when no explicit version tag is present (common for aftermarket
    // releases that tag only a date); filename ascending as the final deterministic
    // tiebreaker so groups are stable across runs.
    variants.sort_by(|a, b| {
        score_rom(b, prefs)
            .cmp(&score_rom(a, prefs))
            .then_with(|| prerelease_stage(&b.status_flags).cmp(&prerelease_stage(&a.status_flags)))
            .then_with(|| version_ord(&b.version).cmp(&version_ord(&a.version)))
            .then_with(|| b.build_date.cmp(&a.build_date))
            .then_with(|| a.filename.cmp(&b.filename))
    });

    // Determine preferred index — None if no variant matches preferences.
    let has_preferred = variants.iter().any(|r| r.matches_preferred_language);

    // Utilities are excluded from preferred_idx only in mixed groups (where at least one
    // non-Utility variant exists). In a Utility-only group, the best Utility is preferred.
    let has_non_utility = variants.iter().any(|r| !matches!(r.file_category, FileCategory::Utility));

    // Unofficial files are excluded from preferred_idx only when a fully-released official
    // variant already matches the preferred language. This ensures:
    //   • Official (USA) + Unofficial hack (USA) → official wins.
    //   • Official (Japan) + fan-translation (En) → fan-translation wins (only En match).
    // Pre-release files (Proto/Demo/Sample/etc.) are excluded from this check even when
    // their file_category is Game — a prototype does not block an Aftermarket full release
    // from being preferred.
    let has_official_preferred_lang = variants.iter().any(|r| {
        r.matches_preferred_language
            && !matches!(r.file_category, FileCategory::Unofficial | FileCategory::Utility | FileCategory::Demo)
            && !r.status_flags.iter().any(|f| matches!(
                f.as_str(),
                "Alpha" | "Beta" | "Proto" | "Possible Proto" | "Sample" | "Promo"
                | "Kiosk" | "Wi-Fi Kiosk"
                | "IS-NITRO-EMULATOR" | "IS-NITRO-PROGRAMMER"
                | "Preview" | "GameCube Preview"
            ))
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
        catalog_number,
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
/// preference. Format preference is a tiebreaker applied only within the same
/// scoring tier: it will not replace a non-Demo winner with a Demo copy, or a
/// non-Unofficial winner with an Unofficial copy.  Within equal tiers it also
/// will not downgrade to a lower revision or version string.
fn apply_format_pref(g: &mut RomGroup, format_prefs: &HashMap<String, String>, prefs: &UserPreferences) {
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
        .max_by_key(|(_, v)| (v.revision, version_ord(&v.version)));

    let Some((pref_idx, pref_var)) = best_in_pref else { return };

    // Don't apply format preference if it would downgrade the release tier
    // (e.g. switching from a full game to a demo, or from an official to a
    // bad dump).  Compare only score_rom.0 (tier score) so that intra-tier
    // ordering differences — particularly build_ord in the pre-release path,
    // where the tuple is (-100, build_date, …) — don't block the override.
    // Example that must still work: "v4.1.0 (Aftermarket)" vs "v3.4.5 (GBA,
    // preferred)" — version_ord check below catches this correctly.
    let curr_score = score_rom(curr, prefs);
    let pref_score = score_rom(pref_var, prefs);
    if curr_score.0 > pref_score.0 {
        return;
    }
    // Don't downgrade to a lower version regardless of tier equality.
    if version_ord(&curr.version) > version_ord(&pref_var.version) {
        return;
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

    // Build effective format prefs: start with user's explicit prefs, then fill in
    // defaults for pairs with no explicit preference. The default is folder_b (the
    // superset/larger folder) so that overlapping titles resolve to the "complete"
    // collection rather than the specialized subset. Without this, the winner is
    // determined by HashMap iteration order, which can flip between runs and cause
    // the Aftermarket copy to be preferred over the base GB copy unpredictably.
    let effective_prefs: HashMap<String, String> = {
        let mut ep = format_prefs.clone();
        for p in pairs {
            let cg = console_group_key(&p.folder_a).to_string();
            ep.entry(cg).or_insert_with(|| p.folder_b.clone());
        }
        ep
    };


    let (paired, mut result): (Vec<RomGroup>, Vec<RomGroup>) = groups
        .into_iter()
        .partition(|g| console_to_key.contains_key(g.console.as_str()));

    // Bucket: (pair_key, group_key, catalog_number) → groups sharing that game across formats.
    //
    // Must use the SAME composite key that group_roms uses: picker::group_key +
    // catalog_number.  Two reasons:
    //
    // 1. group_key (not title_normalized) preserves subtitle parens that come BEFORE
    //    the first region tag.  "4 Games on One Game Pak (Racing) (USA)" and
    //    "(Nickelodeon Movies) (USA)" have the same title_normalized but different
    //    group_keys — collapsing by title_normalized would merge them and wrongly
    //    delete two of the three.
    //
    // 2. catalog_number (not group_key alone) preserves distinct compilations that
    //    share a generic title AND a pre-region group_key.  "4 in 1 (Europe) (4B-001)"
    //    and "4 in 1 (Europe) (4B-002)" both have group_key "4 in 1" — collapsing by
    //    group_key alone would merge them and wrongly delete all but one.
    let mut by_title: HashMap<(String, String, String), Vec<RomGroup>> = HashMap::new();
    for g in paired {
        let key = console_to_key[g.console.as_str()].to_string();
        let gk = g.variants.first()
            .map(|v| crate::picker::group_key(&v.filename))
            .unwrap_or_default();
        let cat = g.variants.first()
            .map(|v| extract_catalog_number(&v.extra_tags))
            .unwrap_or_default();
        by_title
            .entry((key, gk, cat))
            .or_default()
            .push(g);
    }

    for ((_, _, _), mut title_groups) in by_title {
        if title_groups.len() == 1 {
            let mut g = title_groups.remove(0);
            g.is_format_pair = true;
            // group_roms already merged variants from all format folders via console_group_key,
            // so this is always the single-group path. Apply format preference here.
            apply_format_pref(&mut g, &effective_prefs, prefs);
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
            apply_format_pref(&mut merged, &effective_prefs, prefs);
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
    fn catalog_number_in_extra_tags_creates_separate_groups() {
        // Sachen "4 in 1" compilations: each catalog number (4B-001, 4B-002, …) is a
        // physically distinct cartridge containing different games — they must NOT be
        // collapsed into one group and forced to compete for a single preferred slot.
        let make = |filename: &str, extra: &[&str]| -> RomFile {
            let mut r = rom("4 in 1", &["Europe"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Unl".into()];
            r.extra_tags = extra.iter().map(|s| s.to_string()).collect();
            r
        };
        let f1 = make("4 in 1 (Europe) (4B-001, Sachen-Commin) (Unl).zip", &["4B-001, Sachen-Commin"]);
        let f2 = make("4 in 1 (Europe) (4B-002, Sachen) (Unl).zip",        &["4B-002, Sachen"]);
        let f3 = make("4 in 1 (Europe) (4B-003, Sachen-Commin) (Unl).zip", &["4B-003, Sachen-Commin"]);
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let groups = group_roms(vec![f1, f2, f3], &prefs);
        assert_eq!(
            groups.len(), 3,
            "each catalog number must be its own group; got {} group(s)",
            groups.len(),
        );
    }

    #[test]
    fn publisher_tag_without_catalog_number_stays_in_same_group() {
        // Publisher-only extra_tags ("Incube8 Games", "ModRetro Chromatic") must NOT
        // split the group — different publishers of the same game are still variants.
        let make = |filename: &str, version: Option<&str>, extra: &[&str]| -> RomFile {
            let mut r = rom("Lunar Journey", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Aftermarket".into(), "Unl".into()];
            r.version = version.map(|s| s.to_string());
            r.extra_tags = extra.iter().map(|s| s.to_string()).collect();
            r
        };
        let bare   = make("Lunar Journey (World) (Aftermarket) (Unl).zip", None, &[]);
        let tagged = make(
            "Lunar Journey (World) (v2.0.0) (Incube8 Games) (Aftermarket) (Unl).zip",
            Some("v2.0.0"), &["Incube8 Games"],
        );
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let groups = group_roms(vec![bare, tagged], &prefs);
        assert_eq!(
            groups.len(), 1,
            "publisher-tagged variant must stay in the same group as the plain release",
        );
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
    fn versioned_preferred_over_unversioned_when_publisher_tagged() {
        // Regression: "Lunar Journey (World) (v2.0.0) (Incube8 Games) (Aftermarket) (Unl)"
        // was losing to "Lunar Journey (World) (Aftermarket) (Unl)" because (Incube8 Games)
        // applied a -5 extra_tag penalty while version was only a sort tiebreaker.
        // version_bonus (+6) now ensures the versioned release wins.
        let make = |filename: &str, version: Option<&str>, revision: u32, extra: &[&str]| -> RomFile {
            let mut r = rom("Lunar Journey", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Aftermarket".into(), "Unl".into()];
            r.version = version.map(|s| s.to_string());
            r.revision = revision;
            r.extra_tags = extra.iter().map(|s| s.to_string()).collect();
            r
        };
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };

        // Case 1: versioned+publisher tag beats plain unversioned (Lunar Journey).
        let bare = make("Lunar Journey (World) (Aftermarket) (Unl).zip", None, 0, &[]);
        let tagged = make(
            "Lunar Journey (World) (v2.0.0) (Incube8 Games) (Aftermarket) (Unl).zip",
            Some("v2.0.0"), 0, &["Incube8 Games"],
        );
        let groups = group_roms(vec![bare, tagged], &prefs);
        assert_eq!(groups.len(), 1);
        let preferred = groups[0].preferred_idx.map(|i| &groups[0].variants[i]).expect("preferred");
        assert!(
            preferred.filename.contains("v2.0.0"),
            "v2.0.0 must be preferred over unversioned, got: {}",
            preferred.filename,
        );

        // Case 2: Rev 2+publisher tag beats v1.2+publisher tag (Traumatarium Penitent).
        // Both tie on version_bonus; revision tiebreaker (2 > 0) picks Rev 2.
        let v12 = make(
            "Traumatarium Penitent (World) (v1.2) (ModRetro Chromatic) (Aftermarket) (Unl).zip",
            Some("v1.2"), 0, &["ModRetro Chromatic"],
        );
        let rev2 = make(
            "Traumatarium Penitent (World) (Rev 2) (ModRetro Chromatic) (Aftermarket) (Unl).zip",
            None, 2, &["ModRetro Chromatic"],
        );
        let groups2 = group_roms(vec![v12, rev2], &prefs);
        assert_eq!(groups2.len(), 1);
        let preferred2 = groups2[0].preferred_idx.map(|i| &groups2[0].variants[i]).expect("preferred");
        assert!(
            preferred2.filename.contains("Rev 2"),
            "Rev 2 must be preferred over v1.2, got: {}",
            preferred2.filename,
        );
    }

    #[test]
    fn version_ord_multipart_and_alpha_suffix() {
        // Bare (no version) ranks as "just below v1.0": beats sub-1.0 builds, loses to v1.0+.
        assert!(version_ord(&None) > version_ord(&Some("v0.0.1.1.5.2".into())));
        assert!(version_ord(&None) > version_ord(&Some("v0.95".into())));
        assert!(version_ord(&Some("v1.0".into())) > version_ord(&None));
        assert!(version_ord(&Some("v2.1".into())) > version_ord(&None));
        // Alpha suffix ordering within sub-1.0: v0.1 < v0.1a < v0.1b.
        assert!(version_ord(&Some("v0.1a".into())) > version_ord(&Some("v0.1".into())));
        assert!(version_ord(&Some("v0.1b".into())) > version_ord(&Some("v0.1a".into())));
        // Standard ordering: higher major/minor wins.
        assert!(version_ord(&Some("v2.1".into())) > version_ord(&Some("v2.0".into())));
        assert!(version_ord(&Some("v1.0".into())) > version_ord(&Some("v0.95".into())));
    }

    #[test]
    fn bare_prerelease_preferred_over_sub_one_version() {
        // Sub-1.0 versions signal an incomplete/early build; bare (no version tag)
        // should be preferred over v0.x within the same pre-release tier.
        let make_demo = |filename: &str, version: Option<&str>| -> RomFile {
            let mut r = rom("Graveblood", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Demo".into(), "Aftermarket".into(), "Unl".into()];
            r.version = version.map(|s| s.to_string());
            r
        };
        let plain = make_demo("Graveblood (World) (Demo) (Aftermarket) (Unl).zip", None);
        let sub_one = make_demo(
            "Graveblood (World) (v0.0.1.1.5.2) (Demo) (Aftermarket) (Unl).zip",
            Some("v0.0.1.1.5.2"),
        );
        let prefs = en_prefs();

        // Bare beats sub-1.0
        let groups = group_roms(vec![plain.clone(), sub_one], &prefs);
        let preferred = groups[0].preferred_idx.map(|i| &groups[0].variants[i]).expect("must have preferred");
        assert!(
            preferred.version.is_none(),
            "bare Demo must beat v0.0.1.1.5.2 Demo, got: {}",
            preferred.filename,
        );

        // v1.0+ beats bare
        let mut v1 = plain.clone();
        v1.filename = "Graveblood (World) (v1.0) (Demo) (Aftermarket) (Unl).zip".into();
        v1.version = Some("v1.0".into());
        let groups2 = group_roms(vec![plain, v1], &prefs);
        let preferred2 = groups2[0].preferred_idx.map(|i| &groups2[0].variants[i]).expect("must have preferred");
        assert!(
            preferred2.version.as_deref() == Some("v1.0"),
            "v1.0 Demo must beat bare Demo, got: {}",
            preferred2.filename,
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
    fn aftermarket_preferred_over_proto_in_same_group() {
        // Regression: "Broken Circle (Europe) (En,It) (Proto)" was being selected over
        // "Broken Circle (World) (En,It) (Aftermarket) (Unl)" because detect_category
        // returns Game for Proto files (no "Unl"/"Aftermarket" flag), causing them to be
        // treated as "official preferred lang" and blocking the Aftermarket from preferred_idx.
        let mut proto = rom("Broken Circle", &["Europe"], &["En", "It"], &["Proto"]);
        proto.console = "Nintendo - Game Boy Advance".into();
        proto.filename = "Broken Circle (Europe) (En,It) (Proto).zip".into();
        proto.file_category = FileCategory::Game;
        proto.status_flags = vec!["Proto".into()];

        let mut aftermarket = rom("Broken Circle", &["World"], &["En", "It"], &[]);
        aftermarket.console = "Nintendo - Game Boy Advance (Aftermarket)".into();
        aftermarket.filename = "Broken Circle (World) (En,It) (Aftermarket) (Unl).zip".into();
        aftermarket.file_category = FileCategory::Unofficial;
        aftermarket.status_flags = vec!["Aftermarket".into(), "Unl".into()];

        let prefs = en_prefs();
        let groups = group_roms(vec![proto, aftermarket], &prefs);

        assert_eq!(groups.len(), 1, "proto and aftermarket must be in same group");
        let g = &groups[0];
        let preferred = g.preferred_idx.expect("must have a preferred variant");
        assert_eq!(
            g.variants[preferred].filename,
            "Broken Circle (World) (En,It) (Aftermarket) (Unl).zip",
            "Aftermarket full release must beat prototype; got preferred={:?}",
            g.variants[preferred].filename,
        );
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
            catalog_number: None,
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
    fn newer_build_date_preferred_over_older() {
        // Real-world case: "Song of Morus – Ghostly Night (World) (2023-05-20) (Aftermarket) (Unl)"
        // vs "(2023-06-08)". Both score identically; without a build_date tiebreaker the sort
        // falls through to filename ascending, which puts the older date first.
        let prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let mut older = rom("Song of Morus", &["World"], &[], &["Aftermarket"]);
        older.file_category = FileCategory::Unofficial;
        older.build_date = Some(20230520);
        older.filename = "Song of Morus (World) (2023-05-20) (Aftermarket) (Unl).zip".into();
        let mut newer = rom("Song of Morus", &["World"], &[], &["Aftermarket"]);
        newer.file_category = FileCategory::Unofficial;
        newer.build_date = Some(20230608);
        newer.filename = "Song of Morus (World) (2023-06-08) (Aftermarket) (Unl).zip".into();
        let groups = group_roms(vec![older, newer], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.filename.contains("2023-06-08"),
            "newer build date must be preferred, got: {}",
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
    fn hardware_feature_tag_does_not_suppress_revision_bonus() {
        // Real-world case: "Tetris 2 (USA, Europe) (Rev 1) (SGB Enhanced)" must beat
        // "Tetris 2 (USA)" even though the SGB Enhanced edition carries an extra_tag.
        // The official-branch collection_penalty check must exempt HARDWARE_FEATURE_TAGS
        // so "SGB Enhanced" doesn't trigger the -5 penalty and silence revision_bonus.
        let bare_usa = rom("Tetris 2", &["USA"], &[], &[]);
        let mut rev1_sgb = rom("Tetris 2", &["USA", "Europe"], &[], &[]);
        rev1_sgb.revision = 1;
        rev1_sgb.extra_tags = vec!["SGB Enhanced".into()];
        assert!(
            score_rom(&rev1_sgb, &en_prefs()) > score_rom(&bare_usa, &en_prefs()),
            "Rev 1 (SGB Enhanced) {:?} must beat bare USA {:?}",
            score_rom(&rev1_sgb, &en_prefs()),
            score_rom(&bare_usa, &en_prefs()),
        );
    }

    #[test]
    fn gb_compatible_tag_does_not_suppress_revision_bonus() {
        // Real-world case: "Shanghai Pocket (Europe) (Rev 1) (SGB Enhanced) (GB Compatible)"
        // must beat "Shanghai Pocket (USA) (SGB Enhanced) (GB Compatible)".
        // "GB Compatible" describes backward compatibility with original GB hardware —
        // it is a hardware capability flag, not a distribution variant, so it must NOT
        // trigger the -5 penalty that would zero out revision_bonus.
        let mut usa = rom("Shanghai Pocket", &["USA"], &[], &[]);
        usa.extra_tags = vec!["SGB Enhanced".into(), "GB Compatible".into()];
        let mut europe_rev1 = rom("Shanghai Pocket", &["Europe"], &[], &[]);
        europe_rev1.revision = 1;
        europe_rev1.extra_tags = vec!["SGB Enhanced".into(), "GB Compatible".into()];
        assert!(
            score_rom(&europe_rev1, &en_prefs()) > score_rom(&usa, &en_prefs()),
            "Europe Rev 1 (GB Compatible) {:?} must beat USA original {:?}",
            score_rom(&europe_rev1, &en_prefs()),
            score_rom(&usa, &en_prefs()),
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
    fn numbered_proto_beats_dated_proto() {
        // Numbered protos (Proto N) are explicitly sequenced by archivists and represent
        // the most complete builds. They must rank above any dated snapshot.
        let mut proto7 = rom("Army Men", &["USA", "Europe"], &[], &["Proto"]);
        proto7.revision = 7;
        let mut dated = rom("Army Men", &["USA", "Europe"], &[], &["Proto"]);
        dated.build_date = Some(20000914); // 2000-09-14 — a late dated build
        let prefs = en_prefs();
        assert!(
            score_rom(&proto7, &prefs) > score_rom(&dated, &prefs),
            "Proto 7 {:?} must beat dated proto 2000-09-14 {:?}",
            score_rom(&proto7, &prefs),
            score_rom(&dated, &prefs),
        );
        // Proto 1 also beats any dated proto (whole numbered series ranks above dated)
        let mut proto1 = rom("Army Men", &["USA", "Europe"], &[], &["Proto"]);
        proto1.revision = 1;
        assert!(
            score_rom(&proto1, &prefs) > score_rom(&dated, &prefs),
            "Proto 1 must also beat dated proto",
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
    fn world_rev_beats_specific_region_when_world_not_in_prefs() {
        // Real-world case: user has a long preferred_regions list that does NOT include
        // "World". Without the World-fallback fix, "USA" at position 0 with 10 preferred
        // regions gives score 200, while "World" falls through to the generic fallback of 5
        // — making revision_bonus of 100 insufficient to overcome the 195-point gap.
        // With the fix, "World" is treated as equivalent to the user's top preference
        // (max_priority * 20 = 200), so revision_bonus tips "World (Rev 1)" over the top.
        let long_prefs = UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![
                "USA".into(), "Europe".into(), "Japan".into(), "Australia".into(),
                "Brazil".into(), "Korea".into(), "France".into(), "Germany".into(),
                "Spain".into(), "China".into(),
            ],
            short_console_names: false,
        };
        let mut world_rev1 = rom("Donkey Kong", &["World"], &[], &[]);
        world_rev1.revision = 1;
        let japan_usa_en = rom("Donkey Kong", &["Japan", "USA"], &["En"], &[]);
        assert!(
            score_rom(&world_rev1, &long_prefs) > score_rom(&japan_usa_en, &long_prefs),
            "World (Rev 1) {:?} must beat Japan/USA (En) {:?} even when World absent from preferred_regions",
            score_rom(&world_rev1, &long_prefs),
            score_rom(&japan_usa_en, &long_prefs),
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
            catalog_number: None,
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
        apply_format_pref(&mut g, &prefs, &en_prefs());
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
        apply_format_pref(&mut g, &prefs, &en_prefs());
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
        apply_format_pref(&mut g, &prefs, &en_prefs());
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
        apply_format_pref(&mut g, &prefs, &en_prefs());
        assert_eq!(g.preferred_idx, Some(0));
        assert_eq!(g.console, "Nintendo - FDS (FDS)");
    }

    /// Format preference must NOT override a language-quality advantage.
    /// Real case: "Nintendo - Game Boy (Aftermarket)" folder has "(World) (En)" (explicit
    /// English tag), while "Nintendo - Game Boy" has only "(World)" (English inferred from
    /// region). The explicit "(En)" scores higher on lang_count, but since both folders
    /// have the same version (None) and the same tier score, the user's format preference
    /// (GB) must win — the World copy is still fully playable in English.
    #[test]
    fn format_pref_wins_over_explicit_language_when_same_version() {
        use crate::models::FileCategory;

        let gb          = "Nintendo - Game Boy";
        let gb_aftermkt = "Nintendo - Game Boy (Aftermarket)";

        // GB folder: "(World)" only — language inferred from region.
        let mut world_only = rom("Neko Can Dream (World) (Aftermarket) (Unl)", &["World"], &[], &["Aftermarket", "Unl"]);
        world_only.console = gb.into();
        world_only.file_category = FileCategory::Unofficial;

        // GB(Aftermarket) folder: "(World) (En)" — explicit language.
        let mut world_en = rom("Neko Can Dream (World) (En) (Aftermarket) (Unl)", &["World"], &["En"], &["Aftermarket", "Unl"]);
        world_en.console = gb_aftermkt.into();
        world_en.file_category = FileCategory::Unofficial;

        // Scoring puts (World)(En) first on lang_count. preferred_idx = Some(0).
        let mut g = group_with_variants(vec![world_en, world_only], Some(0));
        g.console = gb_aftermkt.into();

        // Format preference points to GB — same version (None) → preference wins.
        let mut format_prefs = HashMap::new();
        format_prefs.insert("Nintendo - Game Boy".to_string(), gb.to_string());

        apply_format_pref(&mut g, &format_prefs, &en_prefs());

        assert_eq!(
            g.preferred_idx,
            Some(1),
            "GB format preference must win when both variants have the same version"
        );
    }

    /// Real case: GBC (preferred) has a versioned demo "(v2)" while GBC (Aftermarket) has
    /// a build-dated demo "(2024-08-15)". The build date gives Aftermarket a higher
    /// build_ord in the pre-release score tuple, but since the tier score is identical
    /// (both -100) and version_ord(None) < version_ord("v2"), the format preference must
    /// apply and the GBC (v2) variant must be preferred.
    #[test]
    fn format_pref_wins_over_build_date_when_preferred_folder_has_higher_version() {
        use crate::models::FileCategory;

        let gbc          = "Nintendo - Game Boy Color";
        let gbc_aftermkt = "Nintendo - Game Boy Color (Aftermarket)";

        // GBC (Aftermarket): dated demo, no version tag → build_ord = 20240815 in score tuple.
        let mut dated = rom("Witches and Butchers (World) (2024-08-15) (Demo)", &["World"], &["En", "Es"], &[]);
        dated.console = gbc_aftermkt.into();
        dated.build_date = Some(20240815);
        dated.file_category = FileCategory::Game; // scored as demo via status_flags
        dated.status_flags = vec!["Demo".into()];

        // GBC: versioned demo "(v2)" → build_ord = 0 but version = Some("v2").
        let mut v2 = rom("Witches and Butchers (World) (v2) (Demo)", &["World"], &[], &[]);
        v2.console = gbc.into();
        v2.version = Some("v2".into());
        v2.file_category = FileCategory::Game;
        v2.status_flags = vec!["Demo".into()];

        // Scorer picks dated (higher build_ord) → preferred_idx = Some(0).
        let mut g = group_with_variants(vec![dated, v2], Some(0));
        g.console = gbc_aftermkt.into();

        let mut format_prefs = HashMap::new();
        format_prefs.insert(gbc.to_string(), gbc.to_string());

        apply_format_pref(&mut g, &format_prefs, &en_prefs());

        assert_eq!(
            g.preferred_idx,
            Some(1),
            "GBC (v2) must win over GBC Aftermarket (2024-08-15) when GBC is the preferred folder and v2 > bare"
        );
    }

    /// Format preference must NOT override a scoring-tier advantage.
    /// Real case: "Nintendo - Game Boy" folder has only a Demo copy of "Athletic World",
    /// but "Nintendo - Game Boy (Private)" has the full release. The full release scores
    /// −30 (Unofficial) vs −100 (Demo/Pre-release) for the Demo — format preference for
    /// GB must not cause the Demo to be kept.
    #[test]
    fn format_pref_does_not_downgrade_demo_over_full_release() {
        use crate::models::FileCategory;

        let gb          = "Nintendo - Game Boy";
        let gb_private  = "Nintendo - Game Boy (Private)";

        // Demo copy in the GB folder — scores −100 (Pre-release).
        let mut demo = rom("Athletic World (World) (Demo) (Aftermarket) (Unl)", &["World"], &[], &["Demo", "Aftermarket", "Unl"]);
        demo.console = gb.into();
        demo.filename = "Athletic World (World) (Demo) (SGB Enhanced) (Aftermarket) (Unl).zip".into();
        demo.file_category = FileCategory::Game; // still Game; score_rom checks status_flags

        // Full release in the Private folder — scores −30 (Unofficial).
        let mut full = rom("Athletic World (World) (Aftermarket) (Unl)", &["World"], &[], &["Aftermarket", "Unl"]);
        full.console = gb_private.into();
        full.filename = "Athletic World (World) (SGB Enhanced) (Aftermarket) (Unl).zip".into();
        full.file_category = FileCategory::Unofficial;

        // Scoring puts the full release first (score −30 > −100 for Demo).
        // preferred_idx = Some(0) → full release wins by score.
        let mut g = group_with_variants(vec![full, demo], Some(0));
        g.console = gb_private.into();

        // User preference (or effective default) points to the GB folder.
        let mut format_prefs = HashMap::new();
        format_prefs.insert("Nintendo - Game Boy".to_string(), gb.to_string());

        apply_format_pref(&mut g, &format_prefs, &en_prefs());

        assert_eq!(
            g.preferred_idx,
            Some(0),
            "full release (Non-preferred GB Private) must remain preferred over Demo (GB folder)"
        );
    }

    // ── End-to-end: GB + GB(Aftermarket) with user format preference ─────────

    /// Real-world Myrient scenario: the Aftermarket ROM appears in BOTH the base
    /// "Nintendo - Game Boy" folder AND the "Nintendo - Game Boy (Aftermarket)"
    /// folder with the SAME filename ("Adulting! (World) (Aftermarket).zip").
    /// Both copies are FileCategory::Unofficial (parser sees "(Aftermarket)").
    /// They have equal scores and equal filenames, so stable sort preserves
    /// insertion order — which is non-deterministic in production.
    ///
    /// This test forces the Aftermarket console copy to be inserted FIRST so that
    /// after grouping and sorting it ends up at index 0 (preferred_idx = Some(0)).
    /// apply_format_pref must then switch preferred_idx to the GB copy (index 1).
    #[test]
    fn format_pref_gb_over_aftermarket_real_filenames_aftermarket_first() {
        use crate::deduper::detect_format_pairs;
        use crate::models::{FileCategory, FileFormat};

        let gb          = "Nintendo - Game Boy";
        let gb_aftermkt = "Nintendo - Game Boy (Aftermarket)";
        // Real Myrient filename: "(Aftermarket)" is present in the filename itself.
        let filename    = "Adulting! (World) (Aftermarket).zip";

        let make = |console: &'static str| RomFile {
            path:              format!("/roms/{console}/{filename}"),
            filename:          filename.into(),
            console:           console.into(),
            title:             "Adulting!".into(),
            title_normalized:  crate::parser::normalize_title("Adulting!"),
            regions:           vec!["World".into()],
            languages:         vec![],
            status_flags:      vec!["Aftermarket".into()],
            extra_tags:        vec![],
            bad_dump:          false,
            revision:          0,
            build_date:        None,
            disc_number:       None,
            version:           None,
            is_bios:           false,
            file_format:       FileFormat::Zip,
            // "(Aftermarket)" in filename → Unofficial, just like the real parser would do.
            file_category:     FileCategory::Unofficial,
            filesize:          1024,
            matches_preferred_language: false,
            matches_preferred_region:   false,
        };

        // CRITICAL: put Aftermarket FIRST so it gets inserted first into group_roms's
        // HashMap and ends up at variants[0] after the stable sort on equal elements.
        let roms = vec![make(gb_aftermkt), make(gb)];
        let prefs = en_prefs();

        let groups       = group_roms(roms.clone(), &prefs);
        let format_pairs = detect_format_pairs(&roms);

        let mut format_prefs: HashMap<String, String> = HashMap::new();
        format_prefs.insert("Nintendo - Game Boy".into(), "Nintendo - Game Boy".into());

        let merged = merge_format_pairs(groups, &format_pairs, &prefs, &format_prefs);

        assert_eq!(merged.len(), 1, "both copies must merge into one group");
        let g = &merged[0];
        assert!(g.is_format_pair, "group must be flagged as a format pair");
        assert_eq!(g.variants.len(), 2, "group must contain both console variants");

        let preferred_idx = g.preferred_idx.expect("group must have a preferred variant");
        assert_eq!(
            g.variants[preferred_idx].console, gb,
            "GB copy must be preferred when Aftermarket was inserted first; got '{}'",
            g.variants[preferred_idx].console
        );
    }

    #[test]
    fn format_pref_gb_over_aftermarket_full_pipeline() {
        // Simulates the scan pipeline for the "Adulting!" case:
        // the same ROM file exists in BOTH "Nintendo - Game Boy" and
        // "Nintendo - Game Boy (Aftermarket)".  After the user selects "GB" as
        // the preferred format folder, the prune pipeline should mark the GB
        // copy as preferred (to_keep) and the Aftermarket copy as NonPreferred
        // (to_delete).
        use crate::deduper::detect_format_pairs;
        use crate::models::{FileCategory, FileFormat};

        let gb          = "Nintendo - Game Boy";
        let gb_aftermkt = "Nintendo - Game Boy (Aftermarket)";

        let make = |console: &str| RomFile {
            path:              format!("/roms/{console}/Adulting! (World).zip"),
            filename:          "Adulting! (World).zip".into(),
            console:           console.into(),
            title:             "Adulting!".into(),
            title_normalized:  crate::parser::normalize_title("Adulting!"),
            regions:           vec!["World".into()],
            languages:         vec![],
            status_flags:      vec![],
            extra_tags:        vec![],
            bad_dump:          false,
            revision:          0,
            build_date:        None,
            disc_number:       None,
            version:           None,
            is_bios:           false,
            file_format:       FileFormat::Zip,
            file_category:     FileCategory::Game,
            filesize:          1024,
            matches_preferred_language: false,
            matches_preferred_region:   false,
        };

        let roms  = vec![make(gb), make(gb_aftermkt)];
        let prefs = en_prefs();

        // Replicate the exact scan pipeline order used by scan_roots.
        let groups       = group_roms(roms.clone(), &prefs);
        let format_pairs = detect_format_pairs(&roms);

        // User selected "Nintendo - Game Boy" as the preferred folder.
        let mut format_prefs: HashMap<String, String> = HashMap::new();
        format_prefs.insert(
            "Nintendo - Game Boy".into(),
            "Nintendo - Game Boy".into(),
        );

        let merged = merge_format_pairs(groups, &format_pairs, &prefs, &format_prefs);

        // Should be a single group with both variants.
        assert_eq!(merged.len(), 1, "both copies should merge into one group");
        let g = &merged[0];
        assert!(g.is_format_pair, "group must be flagged as a format pair");
        assert_eq!(g.variants.len(), 2, "group must contain both console variants");

        let preferred_idx = g
            .preferred_idx
            .expect("group must have a preferred variant");
        assert_eq!(
            g.variants[preferred_idx].console, gb,
            "GB copy must be preferred, not GB (Aftermarket)"
        );
    }

    #[test]
    fn format_pref_gb_over_aftermarket_three_console_folders() {
        // Real-world topology: three parallel console folders (GB, GB(Aftermarket),
        // GB(Private)) producing three format pairs.  After the user selects "GB"
        // as the preferred format folder, the GB copy must be preferred for every
        // game that has a counterpart in the Aftermarket folder.
        use crate::deduper::detect_format_pairs;
        use crate::models::{FileCategory, FileFormat};

        let gb          = "Nintendo - Game Boy";
        let gb_aftermkt = "Nintendo - Game Boy (Aftermarket)";
        let gb_private  = "Nintendo - Game Boy (Private)";

        let make = |console: &str, title: &str| RomFile {
            path:              format!("/roms/{console}/{title}.zip"),
            filename:          format!("{title}.zip"),
            console:           console.into(),
            title:             title.into(),
            title_normalized:  crate::parser::normalize_title(title),
            regions:           vec!["World".into()],
            languages:         vec![],
            status_flags:      vec![],
            extra_tags:        vec![],
            bad_dump:          false,
            revision:          0,
            build_date:        None,
            disc_number:       None,
            version:           None,
            is_bios:           false,
            file_format:       FileFormat::Zip,
            file_category:     FileCategory::Game,
            filesize:          1024,
            matches_preferred_language: false,
            matches_preferred_region:   false,
        };

        // Simulate the real Myrient layout: Private games also appear in the main GB
        // folder (same file in both), so GB×Private has overlap and qualifies as a
        // format pair via `is_category_variant`.
        let roms = vec![
            make(gb,          "Adulting! (World)"),
            make(gb_aftermkt, "Adulting! (World)"),
            make(gb,          "Alphamax (World)"),
            make(gb_aftermkt, "Alphamax (World)"),
            make(gb,          "Art School Pocket (World)"),
            make(gb_aftermkt, "Art School Pocket (World)"),
            make(gb,          "Super Mario Land (World)"),   // GB-only title
            make(gb,          "Tetris (World)"),              // GB-only title
            // Private games ALSO appear in GB — is_category_variant + overlap > 0 → pair qualifies
            make(gb,          "Proto Game A (World)"),
            make(gb_private,  "Proto Game A (World)"),
            make(gb,          "Proto Game B (World)"),
            make(gb_private,  "Proto Game B (World)"),
        ];
        let prefs = en_prefs();

        let groups       = group_roms(roms.clone(), &prefs);
        let format_pairs = detect_format_pairs(&roms);

        // Two pairs detected: GB×Aftermarket and GB×Private (Private×Aftermarket has no overlap).
        assert!(format_pairs.len() >= 2, "should detect at least GB×Aftermarket and GB×Private pairs; got {}", format_pairs.len());

        let mut format_prefs: HashMap<String, String> = HashMap::new();
        format_prefs.insert(
            "Nintendo - Game Boy".into(),
            "Nintendo - Game Boy".into(),
        );

        let merged = merge_format_pairs(groups, &format_pairs, &prefs, &format_prefs);

        // Every group that has both GB and GB(Aftermarket) copies must prefer GB.
        for g in &merged {
            if !g.is_format_pair { continue; }
            let has_gb          = g.variants.iter().any(|v| v.console == gb);
            let has_aftermarket = g.variants.iter().any(|v| v.console == gb_aftermkt);
            if !has_gb || !has_aftermarket { continue; }

            let preferred_idx = g.preferred_idx.expect("format-pair group must have a preferred idx");
            assert_eq!(
                g.variants[preferred_idx].console, gb,
                "for title '{}': GB copy must be preferred, not '{}'",
                g.title_normalized,
                g.variants[preferred_idx].console,
            );
        }
    }

    /// When no format preference has been saved to the DB for a console group, the
    /// superset folder (folder_b = the larger folder) must still win over the subset.
    /// This was the root-cause bug: the user saw GB selected as the default in the UI
    /// (folders sorted by count descending), but never explicitly clicked it, so
    /// format_preferences had no entry for "Nintendo - Game Boy". Without the
    /// effective_prefs defaulting, HashMap insertion order determined the winner,
    /// causing GB(Aftermarket) to appear as preferred.
    #[test]
    fn format_pref_defaults_to_superset_when_no_explicit_preference() {
        use crate::deduper::detect_format_pairs;
        use crate::models::{FileCategory, FileFormat};

        let gb          = "Nintendo - Game Boy";
        let gb_aftermkt = "Nintendo - Game Boy (Aftermarket)";
        let filename    = "Adulting! (World) (Aftermarket).zip";

        let make = |console: &'static str| RomFile {
            path:              format!("/roms/{console}/{filename}"),
            filename:          filename.into(),
            console:           console.into(),
            title:             "Adulting!".into(),
            title_normalized:  crate::parser::normalize_title("Adulting!"),
            regions:           vec!["World".into()],
            languages:         vec![],
            status_flags:      vec!["Aftermarket".into()],
            extra_tags:        vec![],
            bad_dump:          false,
            revision:          0,
            build_date:        None,
            disc_number:       None,
            version:           None,
            is_bios:           false,
            file_format:       FileFormat::Zip,
            file_category:     FileCategory::Unofficial,
            filesize:          1024,
            matches_preferred_language: false,
            matches_preferred_region:   false,
        };

        // Aftermarket first → it ends up at variants[0] after the stable sort on equal elements.
        // Add extra GB-only titles so GB (3 titles) is unambiguously the superset over
        // GB(Aftermarket) (1 title), making detect_format_pairs consistently assign
        // folder_b = "Nintendo - Game Boy" regardless of HashMap iteration order.
        let gb_only_a = {
            let mut r = make(gb);
            r.filename = "Bubsy II (World) (Aftermarket) (Unl).zip".into();
            r.title_normalized = crate::parser::normalize_title("Bubsy II");
            r
        };
        let gb_only_b = {
            let mut r = make(gb);
            r.filename = "Catrap (World) (Aftermarket) (Unl).zip".into();
            r.title_normalized = crate::parser::normalize_title("Catrap");
            r
        };
        let roms = vec![make(gb_aftermkt), make(gb), gb_only_a, gb_only_b];
        let prefs = en_prefs();

        let groups       = group_roms(roms.clone(), &prefs);
        let format_pairs = detect_format_pairs(&roms);

        // No explicit preference saved (empty map — simulates a fresh install).
        let merged = merge_format_pairs(groups, &format_pairs, &prefs, &HashMap::new());

        // The "Adulting" group has 2 variants (GB + GB-Aftermarket); the other two have 1.
        let g = merged.iter()
            .find(|g| g.variants.len() == 2)
            .expect("must find the Adulting group with both console variants");
        assert!(g.is_format_pair, "group must be flagged as a format pair");

        let preferred_idx = g.preferred_idx.expect("group must have a preferred variant");
        assert_eq!(
            g.variants[preferred_idx].console, gb,
            "superset (GB) must be preferred by default when no explicit preference is saved; \
             got '{}' instead",
            g.variants[preferred_idx].console
        );
    }

    #[test]
    fn format_pref_does_not_downgrade_to_lower_version() {
        // Regression: Apotris (World) (v3.4.5) in GBA was being preferred over
        // (v4.1.0) in GBA (Aftermarket) because apply_format_pref only compared
        // score_rom (which ignores version strings) when deciding whether to override.
        // Format preference is a tiebreaker — it must yield to a higher version.
        use crate::models::{FileCategory, FileFormat, FormatPair};

        let gba           = "Nintendo - Game Boy Advance";
        let gba_aftermkt  = "Nintendo - Game Boy Advance (Aftermarket)";

        let make = |console: &str, version: &str| -> RomFile {
            RomFile {
                path:             format!("/roms/{console}/Apotris (World) ({version}) (Aftermarket) (Unl).zip"),
                filename:         format!("Apotris (World) ({version}) (Aftermarket) (Unl).zip"),
                console:          console.into(),
                title:            "Apotris".into(),
                title_normalized: crate::parser::normalize_title("Apotris"),
                regions:          vec!["World".into()],
                languages:        vec![],
                status_flags:     vec!["Aftermarket".into(), "Unl".into()],
                extra_tags:       vec![],
                bad_dump:         false,
                revision:         0,
                build_date:       None,
                disc_number:      None,
                version:          Some(version.to_string()),
                is_bios:          false,
                file_format:      FileFormat::Zip,
                file_category:    FileCategory::Unofficial,
                filesize:         1024,
                matches_preferred_language: false,
                matches_preferred_region:   false,
            }
        };

        let old = make(gba, "v3.4.5");
        let new = make(gba_aftermkt, "v4.1.0");

        let prefs = en_prefs();
        let groups = group_roms(vec![old, new], &prefs);
        assert_eq!(groups.len(), 1);

        let format_pairs = vec![FormatPair {
            console_group: "Nintendo - Game Boy Advance".into(),
            folder_a:      gba_aftermkt.into(),
            folder_b:      gba.into(),
            overlap_percent: 1.0,
            folder_a_count:  1,
            folder_b_count:  1,
        }];

        // User has explicitly set "prefer GBA over GBA (Aftermarket)".
        let mut format_prefs = HashMap::new();
        format_prefs.insert("Nintendo - Game Boy Advance".to_string(), gba.to_string());

        let merged = merge_format_pairs(groups, &format_pairs, &prefs, &format_prefs);
        assert_eq!(merged.len(), 1);
        let g = &merged[0];
        let preferred_idx = g.preferred_idx.expect("must have preferred");
        assert_eq!(
            g.variants[preferred_idx].version.as_deref(), Some("v4.1.0"),
            "v4.1.0 must be preferred over v3.4.5 even when GBA folder is the preferred format; \
             format preference must not override a higher version"
        );
    }

    #[test]
    fn patreon_tag_exempt_from_penalty_so_higher_version_wins() {
        // "Patreon" is a developer-direct distribution channel — the Patreon build is
        // typically the latest version from the original author.  It must be exempt from
        // the generic −5 extra-tag penalty so that a higher version (v1.1) is not passed
        // over in favour of an older untagged release (v0.95).
        //
        // Regression: Anguna – Warriors of Virtue (World) (v1.1) (Patreon) (Aftermarket) (Unl)
        // was being deleted because (Patreon) incurred −5, giving it score 81 vs v0.95's 86.
        let make = |filename: &str, version: Option<&str>, extra: &[&str]| -> RomFile {
            let mut r = rom("Anguna - Warriors of Virtue", &["World"], &[], &[]);
            r.filename = filename.to_string();
            r.file_category = FileCategory::Unofficial;
            r.status_flags = vec!["Aftermarket".into(), "Unl".into()];
            r.version = version.map(|s| s.to_string());
            r.extra_tags = extra.iter().map(|s| s.to_string()).collect();
            r.matches_preferred_language = true;
            r
        };
        let v095 = make(
            "Anguna - Warriors of Virtue (World) (v0.95) (Aftermarket) (Unl).zip",
            Some("v0.95"), &[],
        );
        let v11_patreon = make(
            "Anguna - Warriors of Virtue (World) (v1.1) (Patreon) (Aftermarket) (Unl).zip",
            Some("v1.1"), &["Patreon"],
        );
        let prefs = en_prefs();
        let groups = group_roms(vec![v095, v11_patreon], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert_eq!(
            preferred.version.as_deref(), Some("v1.1"),
            "v1.1 (Patreon) must beat v0.95 (no Patreon) via version tiebreaker once \
             the Patreon tag is exempt from the −5 penalty; got: {}",
            preferred.filename,
        );
    }

    #[test]
    fn four_games_on_one_pak_compilations_are_separate_groups() {
        // "4 Games on One Game Pak (Racing)", "(Nickelodeon Movies)", "(Nicktoons)" are three
        // distinct compilation cartridges — their subtitle parentheticals come BEFORE the
        // region tag in the No-Intro filename, so picker::group_key preserves them and each
        // should end up in its own RomGroup.  Regression: if parse_from_filename + group_roms
        // collapses them into one group, two would be wrongly flagged for deletion.
        let console = "Nintendo - Game Boy Advance";
        let f1 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Racing) (USA) (En,Fr,De,Es,It).zip", console,
        ).expect("parse Racing");
        let f2 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Nickelodeon Movies) (USA).zip", console,
        ).expect("parse Nickelodeon Movies");
        let f3 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Nicktoons) (USA).zip", console,
        ).expect("parse Nicktoons");

        // Print the group keys so a failing test shows us what went wrong.
        let k1 = crate::picker::group_key(&f1.filename);
        let k2 = crate::picker::group_key(&f2.filename);
        let k3 = crate::picker::group_key(&f3.filename);
        assert_ne!(k1, k2, "Racing vs Nickelodeon Movies must have different group keys; got '{k1}' == '{k2}'");
        assert_ne!(k1, k3, "Racing vs Nicktoons must have different group keys; got '{k1}' == '{k3}'");
        assert_ne!(k2, k3, "Nickelodeon Movies vs Nicktoons must have different group keys; got '{k2}' == '{k3}'");

        let prefs = en_prefs();
        let groups = group_roms(vec![f1, f2, f3], &prefs);
        assert_eq!(
            groups.len(), 3,
            "each compilation must be its own group; got {} group(s) with keys: '{k1}', '{k2}', '{k3}'",
            groups.len(),
        );

        // Regression: merge_format_pairs used title_normalized as its bucket key,
        // which is "4 games on one game pak" for all three — causing the separate
        // groups to collapse into one and two compilations to be wrongly deleted.
        // The bucket key must be picker::group_key so subtitle parens are preserved.
        let f1 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Racing) (USA) (En,Fr,De,Es,It).zip", console,
        ).expect("parse Racing");
        let f2 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Nickelodeon Movies) (USA).zip", console,
        ).expect("parse Nickelodeon Movies");
        let f3 = crate::parser::parse_from_filename(
            "4 Games on One Game Pak (Nicktoons) (USA).zip", console,
        ).expect("parse Nicktoons");
        let groups = group_roms(vec![f1, f2, f3], &prefs);
        // Simulate a format pair where GBA and GBA Aftermarket are paired.
        // None of these three files are in GBA Aftermarket, but GBA IS a paired console,
        // so all three groups go into the "paired" bucket in merge_format_pairs.
        let pair = crate::models::FormatPair {
            console_group: console.to_string(),
            folder_a: console.to_string(),
            folder_b: format!("{console} (Aftermarket)"),
            folder_a_count: 5000,
            folder_b_count: 100,
            overlap_percent: 100.0,
        };
        let format_prefs = std::collections::HashMap::new();
        let merged = merge_format_pairs(groups, &[pair.clone()], &prefs, &format_prefs);
        assert_eq!(
            merged.len(), 3,
            "merge_format_pairs must not collapse separate compilation groups; got {} group(s)",
            merged.len(),
        );
        // None should be deleted — all three are single-variant groups
        for g in &merged {
            assert_eq!(g.variants.len(), 1,
                "each merged group must have exactly 1 variant; '{}' has {}",
                g.title_normalized, g.variants.len()
            );
        }

        // Second regression: catalog-number groups ("4 in 1 (4B-001)" vs "4 in 1 (4B-002)")
        // share group_key = "4 in 1" but must stay separate through merge_format_pairs.
        let gb = "Nintendo - Game Boy";
        let g1 = crate::parser::parse_from_filename(
            "4 in 1 (Europe) (4B-001, Sachen-Commin) (Unl).zip", gb,
        ).expect("parse 4B-001");
        let g2 = crate::parser::parse_from_filename(
            "4 in 1 (Europe) (4B-002, Sachen) (Unl).zip", gb,
        ).expect("parse 4B-002");
        let gb_groups = group_roms(vec![g1, g2], &prefs);
        assert_eq!(gb_groups.len(), 2, "each catalog number must be its own group before merge");
        let gb_pair = crate::models::FormatPair {
            console_group: gb.to_string(),
            folder_a: gb.to_string(),
            folder_b: format!("{gb} (Aftermarket)"),
            folder_a_count: 500,
            folder_b_count: 50,
            overlap_percent: 100.0,
        };
        let gb_merged = merge_format_pairs(gb_groups, &[gb_pair], &prefs, &format_prefs);
        assert_eq!(
            gb_merged.len(), 2,
            "merge_format_pairs must not collapse catalog-number groups; got {} group(s)",
            gb_merged.len(),
        );
    }
}
