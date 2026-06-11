use std::path::Path;

use crate::models::{FileCategory, FileFormat, RomFile};

// ── Known vocabulary ──────────────────────────────────────────────────────────

pub(crate) const KNOWN_REGIONS: &[&str] = &[
    "USA", "Japan", "Europe", "World", "Germany", "France", "Australia",
    "Korea", "Brazil", "Taiwan", "China", "Russia", "Spain", "Italy",
    "United Kingdom", "Unknown", "Asia", "Hong Kong", "Netherlands",
    "Sweden", "Norway", "Denmark",
    // Extended set
    "Canada", "New Zealand", "South Africa", "India", "Austria",
    "Switzerland", "Belgium", "Finland", "Portugal", "Mexico",
    "Latin America", "Argentina", "South America", "Greece",
    "Poland", "Czech Republic", "Hungary", "Romania", "Turkey", "Scandinavia",
];

const STATUS_FLAGS: &[&str] = &[
    "Alpha", "Beta", "Proto", "Demo", "Promo", "Kiosk", "Sample",
    "Preview", "GameCube Preview", "Possible Proto",
    // Developer-hardware variants: never the consumer release.
    "IS-NITRO-EMULATOR", "IS-NITRO-PROGRAMMER",
    // Kiosk sub-variants not caught by the plain "Kiosk" token.
    "Wi-Fi Kiosk",
    "Aftermarket", "Unl", "Pirate", "Hack", "Alt",
];

/// ISO 639-1 single-language codes seen in No-Intro filenames.
/// Multi-language combos (e.g. "En,Fr", "Fr,De") are accepted dynamically by
/// `is_language_tag` — no need to list them exhaustively here.
const LANGUAGE_CODES: &[&str] = &[
    "Af", "Ar", "Be", "Bg", "Br", "Ca", "Co", "Cs", "Cy", "Da", "De", "El", "En",
    "Eo", "Es", "Et", "Eu", "Fi", "Fr", "Ga", "Gd", "Gl", "He", "Hr", "Hu",
    "Hy", "Id", "Is", "It", "Ja", "Ka", "Ko", "Kw", "Lt", "Lv", "Mk", "Ms",
    "Mt", "Nl", "No", "Oc", "Pl", "Pt", "Ro", "Ru", "Sk", "Sl", "Sq", "Sr",
    "Sv", "Sw", "Th", "Tl", "Tr", "Uk", "Ur", "Vi", "Yi", "Zh",
];

/// Tags that mark a utility / non-game ROM.
const UTILITY_TAGS: &[&str] = &[
    "Cart Present", "No Cart Present", "Action Replay", "Game Shark",
    "Test Program", "Debug", "Competition Cart", "PC10", "VS",
    "Program", "Music Program",
];

// ── Region → default language inference ──────────────────────────────────────

pub fn region_default_languages(region: &str) -> &'static [&'static str] {
    match region {
        "USA" | "Australia" | "United Kingdom" | "New Zealand"
        | "South Africa" | "India" | "World" | "Europe" => &["En"],
        "Canada"           => &["En", "Fr"],
        "Japan"            => &["Ja"],
        "Korea"            => &["Ko"],
        "China" | "Taiwan" | "Hong Kong" => &["Zh"],
        "Germany" | "Austria" => &["De"],
        "Switzerland"      => &["De", "Fr", "It"],
        "France"           => &["Fr"],
        "Belgium"          => &["Fr", "Nl"],
        "Spain"            => &["Es"],
        "Italy"            => &["It"],
        "Netherlands"      => &["Nl"],
        "Sweden"           => &["Sv"],
        "Norway"           => &["No"],
        "Denmark"          => &["Da"],
        "Scandinavia"      => &["Sv", "No", "Da"],
        "Finland"          => &["Fi"],
        "Portugal" | "Brazil" => &["Pt"],
        "Russia"           => &["Ru"],
        "Mexico" | "Latin America" | "Argentina" => &["Es"],
        "South America"    => &["Es", "Pt"],
        "Greece"           => &["El"],
        "Poland"           => &["Pl"],
        "Czech Republic"   => &["Cs"],
        "Hungary"          => &["Hu"],
        "Romania"          => &["Ro"],
        "Turkey"           => &["Tr"],
        "Asia"             => &["Zh", "Ja", "Ko"],
        _                  => &[],
    }
}

// ── Title normalisation ───────────────────────────────────────────────────────

/// Convert a multi-character Roman numeral token (II–XXXIX) to its Arabic digit
/// string. Single-character tokens (I, V, X, …) are intentionally excluded to
/// avoid false positives like "Mega Man X" ≠ "Mega Man 10".
pub fn roman_to_arabic(s: &str) -> Option<u32> {
    if s.len() < 2 { return None; }
    Some(match s {
        "ii"     => 2,  "iii"    => 3,  "iv"     => 4,
        "vi"     => 6,  "vii"    => 7,  "viii"   => 8,
        "ix"     => 9,  "xi"     => 11, "xii"    => 12,
        "xiii"   => 13, "xiv"    => 14, "xv"     => 15,
        "xvi"    => 16, "xvii"   => 17, "xviii"  => 18,
        "xix"    => 19, "xx"     => 20, "xxi"    => 21,
        "xxii"   => 22, "xxiii"  => 23, "xxiv"   => 24,
        "xxv"    => 25, "xxvi"   => 26, "xxvii"  => 27,
        "xxviii" => 28, "xxix"   => 29, "xxx"    => 30,
        "xxxi"   => 31, "xxxii"  => 32, "xxxiii" => 33,
        "xxxiv"  => 34, "xxxv"   => 35, "xxxvi"  => 36,
        "xxxvii" => 37, "xxxviii"=> 38, "xxxix"  => 39,
        _ => return None,
    })
}

pub fn normalize_title(title: &str) -> String {
    let t = title.to_lowercase();
    // Strip leading articles
    let t = t
        .strip_prefix("the ")
        .or_else(|| t.strip_prefix("a "))
        .or_else(|| t.strip_prefix("an "))
        .unwrap_or(&t);
    // Keep only alphanumeric + spaces
    let t: String = t.chars().filter(|c| c.is_alphanumeric() || *c == ' ').collect();
    // Normalize Roman numeral tokens so "Genesis II" and "Genesis 2" group together
    t.split_whitespace()
        .map(|tok| roman_to_arabic(tok).map(|n| n.to_string()).unwrap_or_else(|| tok.to_string()))
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Tag parsing ───────────────────────────────────────────────────────────────

struct ParsedTags {
    regions: Vec<String>,
    languages: Vec<String>,
    status_flags: Vec<String>,
    extra_tags: Vec<String>,
    bad_dump: bool,
    revision: u32,
    build_date: Option<u32>,
    disc_number: Option<u32>,
    version: Option<String>,
}

fn parse_tags(raw_paren: &[&str], raw_bracket: &[&str]) -> ParsedTags {
    let mut regions = vec![];
    let mut languages = vec![];
    let mut status_flags = vec![];
    let mut extra_tags = vec![];
    let mut bad_dump = false;
    let mut revision = 0u32;
    let mut build_date: Option<u32> = None;
    let mut disc_number: Option<u32> = None;
    let mut version: Option<String> = None;

    for &content in raw_bracket {
        if content == "b" {
            bad_dump = true;
        } else {
            extra_tags.push(content.to_string());
        }
    }

    for &content in raw_paren {
        // Multi-region: "USA, Europe" — split on ", " when all parts are known regions
        if content.contains(", ") {
            let parts: Vec<&str> = content.split(", ").collect();
            if parts.iter().all(|p| KNOWN_REGIONS.contains(p)) {
                regions.extend(parts.iter().map(|s| s.to_string()));
                continue;
            }
        }

        // Single region
        if KNOWN_REGIONS.contains(&content) {
            regions.push(content.to_string());
            continue;
        }

        // Language tag: comma-separated 2-char codes with NO spaces, all letters
        // e.g. "En", "En,Fr", "En,Fr,De,Es,It"
        if is_language_tag(content) {
            languages.extend(content.split(',').map(|s| s.to_string()));
            continue;
        }

        // Revision: "Rev 1", "Rev 2"
        if let Some(n) = parse_revision(content) {
            revision = n;
            continue;
        }

        // Disc: "Disc 1", "Disc 2"
        if let Some(n) = parse_disc(content) {
            disc_number = Some(n);
            continue;
        }

        // Version: "v1.0", "v2.0.5"
        if content.starts_with('v') && content.chars().nth(1).is_some_and(|c| c.is_ascii_digit()) {
            version = Some(content.to_string());
            continue;
        }

        // Status flags (allow numeric suffix: "Beta 1", "Proto 2")
        if let Some(flag) = STATUS_FLAGS.iter().find(|&&f| content == f || content.starts_with(&format!("{f} "))) {
            status_flags.push((*flag).to_string());
            // Capture the sequence number (e.g. 1 from "Proto 1") into revision so that
            // Proto 2 scores higher than Proto 1 in the pre-release tiebreaker.
            // Only set when no "Rev N" was already parsed (revision == 0).
            if revision == 0 {
                if let Some(num_str) = content.strip_prefix(&format!("{flag} ")) {
                    if let Ok(n) = num_str.parse::<u32>() {
                        revision = n;
                    }
                }
            }
            continue;
        }

        // Bugfix: post-release patch; treat as revision 1 when no Rev or sequence
        // number is already set so that the fixed version beats the base release.
        // Fall through so "Bugfix" is also kept in extra_tags for display.
        if content == "Bugfix" && revision == 0 {
            revision = 1;
        }

        // ISO build date "YYYY-MM-DD": stored separately as build_date (YYYYMMDD)
        // so proto builds sort chronologically without inflating `revision` for
        // finished releases. Fall through so the date string stays in extra_tags
        // for display.
        if build_date.is_none() {
            if let Some(date_num) = parse_iso_date(content) {
                build_date = Some(date_num);
            }
        }

        // Everything else is an extra tag
        extra_tags.push(content.to_string());
    }

    ParsedTags { regions, languages, status_flags, extra_tags, bad_dump, revision, build_date, disc_number, version }
}

/// Returns true for No-Intro catalog/product codes like "4B-003", "8B-001".
/// Rule: exactly one hyphen; prefix = non-empty, all ASCII uppercase/digits,
/// at least one uppercase letter; suffix = non-empty, all ASCII digits.
/// "Sachen-Commin" → false (suffix has letters). "EEPROM" → false (no hyphen).
fn is_catalog_code(s: &str) -> bool {
    match s.split_once('-') {
        Some((pre, suf)) if !pre.is_empty() && !suf.is_empty() => {
            pre.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && pre.chars().any(|c| c.is_ascii_uppercase())
                && suf.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

fn is_language_tag(s: &str) -> bool {
    // Accept any comma-separated sequence where every part is a known single-language code.
    // Handles "En", "En,Fr", "Fr,De", "Ja,Zh", "Sv,No,Da", etc. without an exhaustive list.
    s.split(',').all(|part| LANGUAGE_CODES.contains(&part))
}

fn parse_revision(s: &str) -> Option<u32> {
    if let Some(rest) = s.strip_prefix("Rev ") {
        if let Ok(n) = rest.parse::<u32>() { return Some(n); }
        // Rev 1.2, Rev 1.4 → major * 100 + minor (e.g. 102, 104)
        if let Some((maj, min)) = rest.split_once('.') {
            if let (Ok(major), Ok(minor)) = (maj.parse::<u32>(), min.parse::<u32>()) {
                return Some(major * 100 + minor);
            }
        }
        // Rev A, Rev B … → 1, 2 …
        if rest.len() == 1 {
            let c = rest.chars().next()?;
            if c.is_ascii_uppercase() { return Some(c as u32 - b'A' as u32 + 1); }
        }
    }
    // REV-A, REV-B … (uppercase + hyphen variant)
    if let Some(rest) = s.strip_prefix("REV-") {
        if rest.len() == 1 {
            let c = rest.chars().next()?;
            if c.is_ascii_uppercase() { return Some(c as u32 - b'A' as u32 + 1); }
        }
    }
    None
}

fn parse_disc(s: &str) -> Option<u32> {
    s.strip_prefix("Disc ")?.parse().ok()
}

/// Parses "YYYY-MM-DD" → YYYYMMDD as a u32 so date-stamped protos sort chronologically.
fn parse_iso_date(s: &str) -> Option<u32> {
    if s.len() != 10 { return None; }
    let (y_str, rest) = s.split_once('-')?;
    let (m_str, d_str) = rest.split_once('-')?;
    if y_str.len() != 4 || m_str.len() != 2 || d_str.len() != 2 { return None; }
    let y: u32 = y_str.parse().ok()?;
    let m: u32 = m_str.parse().ok()?;
    let d: u32 = d_str.parse().ok()?;
    if !(1970..=2100).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(y * 10000 + m * 100 + d)
}

// ── File category detection ───────────────────────────────────────────────────

fn detect_category(
    is_bios: bool,
    status_flags: &[String],
    extra_tags: &[String],
    console: &str,
) -> FileCategory {
    if is_bios {
        return FileCategory::Bios;
    }
    if status_flags.iter().any(|f| matches!(f.as_str(), "Pirate" | "Unl" | "Aftermarket" | "Hack")) {
        return FileCategory::Unofficial;
    }
    if extra_tags.iter().any(|t| UTILITY_TAGS.contains(&t.as_str())) {
        return FileCategory::Utility;
    }
    if status_flags.iter().any(|f| matches!(f.as_str(), "Demo")) {
        return FileCategory::Demo;
    }
    if console.contains("(Video)") || extra_tags.iter().any(|t| t == "Video") {
        return FileCategory::Video;
    }
    if console.contains("e-Reader") {
        return FileCategory::EReader;
    }
    // NFC peripheral data (amiibo figurine/card dumps) — not playable ROMs.
    if console.to_ascii_lowercase().contains("amiibo") {
        return FileCategory::Accessory;
    }
    FileCategory::Game
}

// ── Main parser ───────────────────────────────────────────────────────────────

/// Extracts all tags from a filename stem using paren/bracket scanning.
/// Returns `(title, paren_tags, bracket_tags)`.
fn extract_tags(stem: &str) -> (String, Vec<&str>, Vec<&str>) {
    let mut title_end = stem.len();
    let mut paren_tags: Vec<&str> = vec![];
    let mut bracket_tags: Vec<&str> = vec![];

    let bytes = stem.as_bytes();
    let mut i = 0;
    let mut title_found = false;

    while i < bytes.len() {
        match bytes[i] {
            b'(' if !title_found => {
                title_end = i;
                title_found = true;
                // Find closing ')'
                if let Some(end) = stem[i + 1..].find(')') {
                    let content = &stem[i + 1..i + 1 + end];
                    paren_tags.push(content);
                    i += 1 + end + 1;
                } else {
                    i += 1;
                }
            }
            b'(' => {
                if let Some(end) = stem[i + 1..].find(')') {
                    let content = &stem[i + 1..i + 1 + end];
                    paren_tags.push(content);
                    i += 1 + end + 1;
                } else {
                    i += 1;
                }
            }
            b'[' => {
                if !title_found {
                    title_end = i;
                    title_found = true;
                }
                if let Some(end) = stem[i + 1..].find(']') {
                    let content = &stem[i + 1..i + 1 + end];
                    bracket_tags.push(content);
                    i += 1 + end + 1;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    let title = stem[..title_end].trim().to_string();
    (title, paren_tags, bracket_tags)
}

/// Parse a single ROM file path into a `RomFile`.
/// `matches_preferred_*` default to `false` and are populated later by the grouper.
pub fn parse_file(path: &Path, console: &str, filesize: u64, _mtime: u64) -> Option<RomFile> {
    // Scanner context: skip companion .bin files — the .cue is the primary entry on disk.
    parse_file_inner(path, console, filesize, _mtime, true)
}

fn parse_file_inner(path: &Path, console: &str, filesize: u64, _mtime: u64, skip_bin_companions: bool) -> Option<RomFile> {
    let filename = path.file_name()?.to_str()?;

    // Strip extension
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) => (s, e),
        None => return None,
    };

    // Only process known ROM extensions
    let file_format = match ext.to_lowercase().as_str() {
        "zip" | "chd" | "cue" | "iso" | "7z"
        | "nes" | "sfc" | "smc" | "gb" | "gbc" | "gba" | "n64" | "z64"
        | "v64" | "nds" | "3ds" | "gcm" | "bin"
        // Console-specific native formats
        | "fds"   // Family Computer Disk System
        | "dsi"   // Nintendo DSi
        | "min"   // Pokémon Mini
        | "vb"    // Virtual Boy
        | "raw"   // GBA e-Reader strips
        => FileFormat::from_extension(ext),
        _ => return None,
    };

    // In scanner context, skip companion .bin files (the .cue is the primary entry).
    // In DAT context each entry is independent, so .bin BIOS/system files must pass through.
    if skip_bin_companions && ext.to_lowercase() == "bin" {
        return None;
    }

    // BIOS detection — "[BIOS]" prefix
    let (is_bios, stem) = if let Some(stripped) = stem.strip_prefix("[BIOS]") {
        (true, stripped.trim())
    } else {
        (false, stem)
    };

    let (title, paren_tags, bracket_tags) = extract_tags(stem);

    if title.is_empty() {
        return None;
    }

    let tags = parse_tags(&paren_tags, &bracket_tags);

    // If a catalog code is present (e.g. "4B-003"), append it to the title so
    // same-named compilations produce distinct title_normalized values and form
    // separate groups. "4 in 1 (4B-003)" and "4 in 1 (4B-001)" are different games.
    // Extra tags like "(4B-003, Sachen-Commin)" are stored whole; split on ", " to
    // examine each comma-separated component individually.
    let title = if let Some(code) = tags.extra_tags.iter()
        .flat_map(|t| t.split(", "))
        .find(|part| is_catalog_code(part))
    {
        format!("{} ({})", title, code)
    } else {
        title
    };
    let title_normalized = normalize_title(&title);

    let file_category = detect_category(is_bios, &tags.status_flags, &tags.extra_tags, console);

    Some(RomFile {
        path: path.to_string_lossy().into_owned(),
        filename: filename.to_string(),
        console: console.to_string(),
        title,
        title_normalized,
        regions: tags.regions,
        languages: tags.languages,
        status_flags: tags.status_flags,
        extra_tags: tags.extra_tags,
        bad_dump: tags.bad_dump,
        revision: tags.revision,
        build_date: tags.build_date,
        disc_number: tags.disc_number,
        version: tags.version,
        is_bios,
        file_format,
        file_category,
        filesize,
        matches_preferred_language: false,
        matches_preferred_region: false,
    })
}

/// Parse a ROM filename string without any filesystem access.
/// Delegates to `parse_file_inner` with `skip_bin_companions = false` so all
/// DAT entries — including `.bin` BIOS and system files — are included.
/// `filesize` and `mtime` are zeroed — irrelevant for pre-download scoring.
///
/// `Path::new("Game (USA).3ds").file_name()` returns `"Game (USA).3ds"` (the full
/// string, since there is no directory component), so the returned `RomFile.filename`
/// equals `filename` verbatim — safe to use as a lookup key.
pub fn parse_from_filename(filename: &str, console: &str) -> Option<RomFile> {
    parse_file_inner(std::path::Path::new(filename), console, 0, 0, false)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn parse(filename: &str) -> RomFile {
        let p = PathBuf::from(format!("/roms/Console/{filename}"));
        parse_file(&p, "Nintendo - NES", 1024, 0)
            .unwrap_or_else(|| panic!("Failed to parse: {filename}"))
    }

    #[test]
    fn basic_usa_rom() {
        let r = parse("Castlevania (USA).zip");
        assert_eq!(r.title, "Castlevania");
        assert_eq!(r.regions, vec!["USA"]);
        assert!(r.languages.is_empty());
        assert_eq!(r.file_format, FileFormat::Zip);
        assert_eq!(r.file_category, FileCategory::Game);
    }

    #[test]
    fn multi_region_tag() {
        let r = parse("Tetris (USA, Europe).zip");
        assert_eq!(r.regions, vec!["USA", "Europe"]);
    }

    #[test]
    fn language_tag() {
        let r = parse("Lucky Luke (Europe) (En,Fr,De,Es).zip");
        assert_eq!(r.regions, vec!["Europe"]);
        assert_eq!(r.languages, vec!["En", "Fr", "De", "Es"]);
    }

    #[test]
    fn non_en_multi_language_tag() {
        // "Fr,De" must be stored as explicit languages, not dropped.
        // Bug regression: previously `languages=[]`, causing Europe to infer English
        // and outscore an explicit Spain (En,Es) variant for English-only users.
        let r = parse("Asterix & Obelix (Europe) (Fr,De) (SGB Enhanced).zip");
        assert_eq!(r.regions, vec!["Europe"]);
        assert_eq!(r.languages, vec!["Fr", "De"]);
    }

    #[test]
    fn non_en_two_lang_combo() {
        let r = parse("Game (Brazil, Portugal) (Es,Pt).zip");
        assert_eq!(r.languages, vec!["Es", "Pt"]);
    }

    #[test]
    fn non_en_three_lang_combo() {
        let r = parse("Game (Scandinavia) (Sv,No,Da).zip");
        assert_eq!(r.languages, vec!["Sv", "No", "Da"]);
    }

    #[test]
    fn revision_tag() {
        let r = parse("10-Yard Fight (Japan) (En) (Rev 1).zip");
        assert_eq!(r.revision, 1);
        assert_eq!(r.languages, vec!["En"]);
    }

    #[test]
    fn disc_number() {
        let r = parse("Final Fantasy VII (USA) (Disc 2).zip");
        assert_eq!(r.disc_number, Some(2));
        assert_eq!(r.title, "Final Fantasy VII");
    }

    #[test]
    fn beta_status_with_number() {
        let r = parse("Some Game (USA) (Beta 1).zip");
        assert_eq!(r.status_flags, vec!["Beta"]);
    }

    #[test]
    fn proto_status() {
        let r = parse("Prototype Game (Japan) (Proto).zip");
        assert_eq!(r.status_flags, vec!["Proto"]);
    }

    #[test]
    fn pirate_is_unofficial() {
        let r = parse("100-in-1 (Asia) (En) (Pirate).zip");
        assert_eq!(r.file_category, FileCategory::Unofficial);
        assert!(r.status_flags.contains(&"Pirate".to_string()));
    }

    #[test]
    fn aftermarket_is_unofficial() {
        let r = parse("Homebrew Game (World) (Aftermarket) (Unl).zip");
        assert_eq!(r.file_category, FileCategory::Unofficial);
    }

    #[test]
    fn bios_prefix() {
        let p = PathBuf::from("/roms/GBC/[BIOS] Nintendo Game Boy Color Boot ROM (World) (Rev 1).zip");
        let r = parse_file(&p, "Nintendo - GBC", 256, 0).unwrap();
        assert!(r.is_bios);
        assert_eq!(r.title, "Nintendo Game Boy Color Boot ROM");
        assert_eq!(r.file_category, FileCategory::Bios);
        assert_eq!(r.revision, 1);
    }

    #[test]
    fn bad_dump_bracket() {
        let r = parse("Bionic Commando (USA) (Capcom Classics Mini Mix) [b].zip");
        assert!(r.bad_dump);
        assert!(r.extra_tags.contains(&"Capcom Classics Mini Mix".to_string()));
    }

    #[test]
    fn apostrophe_title() {
        let r = parse("'93 Chaoji Hun (Asia) (En) (Spread Gun Cheat) (Pirate).zip");
        assert_eq!(r.title, "'93 Chaoji Hun");
        assert_eq!(r.regions, vec!["Asia"]);
        assert_eq!(r.languages, vec!["En"]);
    }

    #[test]
    fn version_tag() {
        let r = parse("Homebrew (World) (v1.03) (Aftermarket) (Unl).zip");
        assert_eq!(r.version, Some("v1.03".to_string()));
    }

    #[test]
    fn normalize_title_strips_article() {
        assert_eq!(normalize_title("The Legend of Zelda"), "legend of zelda");
        assert_eq!(normalize_title("A Link to the Past"), "link to the past");
    }

    #[test]
    fn normalize_title_removes_punctuation() {
        assert_eq!(normalize_title("Castlevania: Symphony of the Night"), "castlevania symphony of the night");
    }

    #[test]
    fn normalize_title_roman_numerals() {
        // Roman numerals in sequel positions normalise to Arabic digits
        assert_eq!(normalize_title("Genesis II"), "genesis 2");
        assert_eq!(normalize_title("Genesis 2"), "genesis 2");
        assert_eq!(normalize_title("Final Fantasy VII"), "final fantasy 7");
        assert_eq!(normalize_title("Final Fantasy IX"), "final fantasy 9");
        assert_eq!(normalize_title("Ultima XIV"), "ultima 14");
        // Single-char tokens (I, V, X) must NOT be converted — too many false positives
        assert_eq!(normalize_title("Mega Man X"), "mega man x");
        assert_eq!(normalize_title("Street Fighter V"), "street fighter v");
    }

    #[test]
    fn cue_file_is_cuebin_format() {
        let p = PathBuf::from("/roms/PS1/Final Fantasy VII (USA) (Disc 1).cue");
        let r = parse_file(&p, "Sony - PlayStation", 0, 0).unwrap();
        assert_eq!(r.file_format, FileFormat::CueBin);
        assert_eq!(r.disc_number, Some(1));
    }

    #[test]
    fn bin_file_is_skipped() {
        // Scanner context: companion .bin for CUE/BIN pairs must be excluded.
        let p = PathBuf::from("/roms/PS1/Game (USA).bin");
        assert!(parse_file(&p, "Sony - PlayStation", 0, 0).is_none());
    }

    #[test]
    fn bin_file_included_in_dat_context() {
        // DAT context: BIOS/system .bin entries must pass through parse_from_filename.
        let rom = parse_from_filename(
            "[BIOS] Family Computer Disk System (Japan) (Rev 1).bin",
            "Nintendo - Family Computer Disk System",
        );
        assert!(rom.is_some());
        let rom = rom.unwrap();
        assert!(rom.is_bios);
        assert_eq!(rom.file_format, FileFormat::Raw); // .bin → Raw (catch-all)
    }

    #[test]
    fn unknown_extension_is_skipped() {
        let p = PathBuf::from("/roms/NES/readme.txt");
        assert!(parse_file(&p, "Nintendo - NES", 0, 0).is_none());
    }

    // ── Language whitelist regression tests ───────────────────────────────────

    #[test]
    fn unl_only_is_unofficial_not_language() {
        let r = parse("Some Game (USA) (Unl).zip");
        assert!(r.languages.is_empty(), "Unl must not be classified as a language");
        assert!(r.status_flags.contains(&"Unl".to_string()), "Unl must be a status flag");
        assert_eq!(r.file_category, FileCategory::Unofficial, "Unl-only must be Unofficial");
    }

    #[test]
    fn alt_is_status_flag_not_language() {
        let r = parse("Some Game (USA) (Alt).zip");
        assert!(r.languages.is_empty(), "Alt must not be classified as a language");
        assert!(r.status_flags.contains(&"Alt".to_string()), "Alt must be a status flag");
    }

    #[test]
    fn ces_is_extra_tag_not_language() {
        let r = parse("Some Game (USA) (CES).zip");
        assert!(r.languages.is_empty(), "CES must not be classified as a language");
        assert!(r.extra_tags.contains(&"CES".to_string()), "CES must be an extra tag");
    }

    #[test]
    fn dsi_enhanced_is_extra_tag_not_language() {
        let r = parse("Some Game (USA) (DSi Enhanced).zip");
        assert!(r.languages.is_empty(), "DSi Enhanced must not be classified as a language");
        assert!(r.extra_tags.contains(&"DSi Enhanced".to_string()), "DSi Enhanced must be an extra tag");
    }

    // ── Preview / demo-disc tag tests ─────────────────────────────────────────

    #[test]
    fn standalone_preview_is_status_flag() {
        let r = parse("Some Game (USA) (Preview).zip");
        assert!(r.status_flags.contains(&"Preview".to_string()), "(Preview) must be a status flag");
        assert!(r.languages.is_empty());
        assert!(r.extra_tags.is_empty());
    }

    #[test]
    fn preview_with_number_is_status_flag() {
        // starts_with("Preview ") matches "Preview 2"
        let r = parse("Some Game (USA) (Preview 2).zip");
        assert!(r.status_flags.iter().any(|f| f.starts_with("Preview")), "(Preview 2) must be a status flag");
    }

    #[test]
    fn gamecube_preview_is_status_flag() {
        let r = parse("Pokemon Puzzle Collection (USA) (GameCube Preview).zip");
        assert!(r.status_flags.contains(&"GameCube Preview".to_string()), "(GameCube Preview) must be a status flag");
        assert!(r.extra_tags.is_empty(), "(GameCube Preview) must not leak into extra_tags");
    }

    // ── Pre-release sequence number tests ─────────────────────────────────────

    #[test]
    fn proto_sequence_number_stored_in_revision() {
        let r = parse("John Madden Football (USA) (Proto 2) (SGB Enhanced).zip");
        assert!(r.status_flags.contains(&"Proto".to_string()));
        assert_eq!(r.revision, 2, "Proto 2 → revision = 2");
    }

    #[test]
    fn beta_sequence_number_stored_in_revision() {
        let r = parse("Some Game (USA) (Beta 3).zip");
        assert!(r.status_flags.contains(&"Beta".to_string()));
        assert_eq!(r.revision, 3, "Beta 3 → revision = 3");
    }

    #[test]
    fn plain_proto_leaves_revision_zero() {
        let r = parse("Some Game (USA) (Proto).zip");
        assert_eq!(r.revision, 0);
    }

    // ── Bugfix revision tests ─────────────────────────────────────────────────

    #[test]
    fn bugfix_sets_revision_one() {
        let r = parse("Perfect Blend (World) (v0.9) (Bugfix) (Aftermarket) (Unl).zip");
        assert_eq!(r.revision, 1, "Bugfix → revision = 1");
        assert!(r.extra_tags.contains(&"Bugfix".to_string()), "Bugfix must remain in extra_tags");
    }

    #[test]
    fn bugfix_preferred_over_base_same_version() {
        let mut base = parse("Perfect Blend (World) (v0.9) (Aftermarket) (Unl).zip");
        let mut fixed = parse("Perfect Blend (World) (v0.9) (Bugfix) (Aftermarket) (Unl).zip");
        base.title_normalized  = "perfect blend".into();
        fixed.title_normalized = "perfect blend".into();
        let prefs = crate::models::UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec![],
            short_console_names: false,
        };
        let groups = crate::commands::group::group_roms(vec![base, fixed], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.extra_tags.contains(&"Bugfix".to_string()),
            "Bugfix variant must be preferred, got: {}",
            preferred.filename,
        );
    }

    // ── Utility tag tests ─────────────────────────────────────────────────────

    #[test]
    fn program_tag_is_utility() {
        let r = parse("Family BASIC (Japan) (Program).zip");
        assert_eq!(r.file_category, FileCategory::Utility, "(Program) must be Utility");
    }

    #[test]
    fn music_program_tag_is_utility() {
        let r = parse("Famicom Music Disk (Japan) (Music Program).zip");
        assert_eq!(r.file_category, FileCategory::Utility, "(Music Program) must be Utility");
    }

    // ── Possible Proto tests ──────────────────────────────────────────────────

    #[test]
    fn possible_proto_is_status_flag() {
        let r = parse("Some Game (USA) (Possible Proto).zip");
        assert!(r.status_flags.contains(&"Possible Proto".to_string()), "Possible Proto must be a status flag");
        assert!(!r.extra_tags.contains(&"Possible Proto".to_string()), "Possible Proto must not leak into extra_tags");
    }

    // ── Letter revision tests ─────────────────────────────────────────────────

    #[test]
    fn rev_letter_stored_as_revision() {
        let r = parse("Some Game (USA) (Rev B).zip");
        assert_eq!(r.revision, 2, "Rev B → revision = 2");
    }

    #[test]
    fn rev_dash_letter_stored_as_revision() {
        let r = parse("Some Game (USA) (REV-C).zip");
        assert_eq!(r.revision, 3, "REV-C → revision = 3");
    }

    // ── Alpha status flag tests ───────────────────────────────────────────────

    #[test]
    fn alpha_is_status_flag() {
        let r = parse("Nyghtmare - Betrayed (World) (Alpha A) (Aftermarket) (Unl).zip");
        assert!(r.status_flags.contains(&"Alpha".to_string()), "Alpha must be a status flag");
        assert!(!r.extra_tags.contains(&"Alpha A".to_string()), "Alpha A must not leak into extra_tags");
    }

    // ── ISO date build-stamp tests ────────────────────────────────────────────

    #[test]
    fn iso_date_stored_as_build_date() {
        let r = parse("Mick & Mack as the Global Gladiators (USA) (Proto) (1993-07-20).zip");
        assert!(r.status_flags.contains(&"Proto".to_string()));
        assert_eq!(r.build_date, Some(19930720), "1993-07-20 → build_date = Some(19930720)");
        assert_eq!(r.revision, 0, "no explicit Rev tag → revision stays 0");
        assert!(r.extra_tags.contains(&"1993-07-20".to_string()), "date must remain in extra_tags for display");
    }

    #[test]
    fn later_date_proto_preferred_over_earlier() {
        // 1994-01-18 is a later, more complete build than 1993-07-20.
        let mut early = parse("Mick & Mack as the Global Gladiators (USA) (Proto) (1993-07-20).zip");
        let mut late  = parse("Mick & Mack as the Global Gladiators (USA) (Proto) (1994-01-18).zip");
        early.title_normalized = "mick mack as the global gladiators".into();
        late.title_normalized  = "mick mack as the global gladiators".into();
        let prefs = crate::models::UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["USA".into(), "World".into(), "Europe".into()],
            short_console_names: false,
        };
        let groups = crate::commands::group::group_roms(vec![early, late], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert!(
            preferred.extra_tags.contains(&"1994-01-18".to_string()),
            "latest proto (1994-01-18) must be preferred, got extra_tags: {:?}",
            preferred.extra_tags,
        );
    }

    #[test]
    fn explicit_rev_preferred_over_dated_release() {
        // A finished release with (Rev 2) must beat one with only a date stamp.
        // Previously both were Unofficial, date set revision=YYYYMMDD (20241016>>2),
        // which incorrectly made the dated version win.
        let prefs = crate::models::UserPreferences {
            preferred_languages: vec!["En".into()],
            preferred_regions: vec!["World".into()],
            short_console_names: false,
        };
        let dated = parse("Some Game (World) (2024-10-16) (Aftermarket) (Unl).zip");
        let revised = parse("Some Game (World) (Rev 2) (Aftermarket) (Unl).zip");
        assert_eq!(dated.build_date, Some(20241016), "date must land in build_date");
        assert_eq!(dated.revision, 0, "date must not inflate revision");
        assert_eq!(revised.revision, 2, "Rev 2 must set revision = 2");
        assert_eq!(revised.build_date, None, "Rev 2 must not set build_date");
        let groups = crate::commands::group::group_roms(vec![dated, revised], &prefs);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        let preferred = g.preferred_idx.map(|i| &g.variants[i]).expect("must have preferred");
        assert_eq!(preferred.revision, 2, "Rev 2 must be preferred over dated release");
    }

    // ── Catalog number split tests ─────────────────────────────────────────────

    #[test]
    fn catalog_code_appended_to_title() {
        // "4B-003" is a catalog code → appended to title.
        // "Sachen-Commin" is a publisher name (non-digit suffix) → not appended.
        let r = parse("4 in 1 (Taiwan) (En,Zh) (4B-003, Sachen-Commin) (Unl).zip");
        assert_eq!(r.title, "4 in 1 (4B-003)");
        assert!(r.title_normalized.contains("4b003"), "normalized title must include catalog code");
    }

    #[test]
    fn catalog_code_splits_groups() {
        // Two "4 in 1" compilations with different catalog codes must have distinct
        // title_normalized values so group_roms() puts them in separate groups.
        let a = parse("4 in 1 (Europe) (4B-001, Sachen-Commin) (Unl).zip");
        let b = parse("4 in 1 (Taiwan) (En,Zh) (4B-003, Sachen-Commin) (Unl).zip");
        assert_ne!(a.title_normalized, b.title_normalized);
    }

    #[test]
    fn publisher_name_not_catalog_code() {
        // "Sachen-Commin" has a non-digit suffix → not a catalog code → title unchanged.
        let r = parse("Some Game (Europe) (Sachen-Commin) (Unl).zip");
        assert_eq!(r.title, "Some Game");
    }

    // ── Developer-hardware tag tests ──────────────────────────────────────────

    #[test]
    fn is_nitro_emulator_is_status_flag() {
        let r = parse("[BIOS] Nintendo DS Firmware (World) (En,Ja,Fr,De,Es,It) (2006-02-20) (IS-NITRO-EMULATOR).zip");
        assert!(r.status_flags.contains(&"IS-NITRO-EMULATOR".to_string()),
            "IS-NITRO-EMULATOR must be a status flag, not an extra_tag");
        assert!(!r.extra_tags.iter().any(|t| t == "IS-NITRO-EMULATOR"),
            "IS-NITRO-EMULATOR must not leak into extra_tags");
        // The date should still be stored as extra_tag for display
        assert!(r.extra_tags.iter().any(|t| t.contains("2006-02-20")),
            "date must remain in extra_tags");
    }

    #[test]
    fn wifi_kiosk_is_status_flag() {
        let r = parse("[BIOS] Nintendo DS Lite Firmware (World) (En,Ja,Fr,De,Es,It) (2006-01-26) (Wi-Fi Kiosk).zip");
        assert!(r.status_flags.contains(&"Wi-Fi Kiosk".to_string()),
            "Wi-Fi Kiosk must be a status flag");
        assert!(!r.extra_tags.iter().any(|t| t == "Wi-Fi Kiosk"),
            "Wi-Fi Kiosk must not leak into extra_tags");
    }
}
