use std::path::Path;

use crate::models::{FileCategory, FileFormat, RomFile};

// ── Known vocabulary ──────────────────────────────────────────────────────────

const KNOWN_REGIONS: &[&str] = &[
    "USA", "Japan", "Europe", "World", "Germany", "France", "Australia",
    "Korea", "Brazil", "Taiwan", "China", "Russia", "Spain", "Italy",
    "United Kingdom", "Unknown", "Asia", "Hong Kong", "Netherlands",
    "Sweden", "Norway", "Denmark",
];

const STATUS_FLAGS: &[&str] = &[
    "Beta", "Proto", "Demo", "Promo", "Kiosk", "Sample",
    "Aftermarket", "Unl", "Pirate", "Hack",
];

/// Tags that mark a re-release / collection variant (lower scoring priority).
const COLLECTION_TAGS: &[&str] = &[
    "Virtual Console", "Wii Virtual Console", "Switch Online", "Switch",
    "Classic Mini", "Evercade", "NP", "GameCube", "LodgeNet",
    "Limited Run Games", "Retro-Bit Generations",
];

/// Tags that mark a utility / non-game ROM.
const UTILITY_TAGS: &[&str] = &[
    "Cart Present", "No Cart Present", "Action Replay", "Game Shark",
    "Test Program", "Debug", "Competition Cart", "PC10", "VS",
];

// ── Region → default language inference ──────────────────────────────────────

pub fn region_default_languages(region: &str) -> &'static [&'static str] {
    match region {
        "USA" | "Australia" | "United Kingdom" => &["En"],
        "Japan" => &["Ja"],
        "Germany" => &["De"],
        "France" => &["Fr"],
        "Spain" => &["Es"],
        "Italy" => &["It"],
        "Korea" => &["Ko"],
        "Brazil" => &["Pt"],
        "Russia" => &["Ru"],
        "China" | "Taiwan" | "Hong Kong" => &["Zh"],
        "Netherlands" => &["Nl"],
        "Sweden" | "Norway" | "Denmark" => &["Sv"],
        _ => &[],
    }
}

// ── Title normalisation ───────────────────────────────────────────────────────

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
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ── Tag parsing ───────────────────────────────────────────────────────────────

struct ParsedTags {
    regions: Vec<String>,
    languages: Vec<String>,
    status_flags: Vec<String>,
    extra_tags: Vec<String>,
    bad_dump: bool,
    revision: u32,
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
            continue;
        }

        // Everything else is an extra tag
        extra_tags.push(content.to_string());
    }

    ParsedTags { regions, languages, status_flags, extra_tags, bad_dump, revision, disc_number, version }
}

fn is_language_tag(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.split(',').all(|part| {
        let bytes = part.as_bytes();
        (bytes.len() == 2 || bytes.len() == 3)
            && bytes.iter().all(|b| b.is_ascii_alphabetic())
            && part.chars().next().is_some_and(|c| c.is_uppercase())
    })
}

fn parse_revision(s: &str) -> Option<u32> {
    s.strip_prefix("Rev ")?.parse().ok()
}

fn parse_disc(s: &str) -> Option<u32> {
    s.strip_prefix("Disc ")?.parse().ok()
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
/// `matches_preferred_*` and `is_unofficial_preferred_fallback` default to `false`
/// and are populated later by the grouper.
pub fn parse_file(path: &Path, console: &str, filesize: u64, _mtime: u64) -> Option<RomFile> {
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
        | "v64" | "nds" | "3ds" | "gcm" | "bin" => FileFormat::from_extension(ext),
        _ => return None,
    };

    // Skip companion .bin files — the .cue is the primary entry
    if ext.to_lowercase() == "bin" {
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
        disc_number: tags.disc_number,
        version: tags.version,
        is_bios,
        file_format,
        file_category,
        filesize,
        matches_preferred_language: false,
        matches_preferred_region: false,
        is_unofficial_preferred_fallback: false,
    })
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
    fn cue_file_is_cuebin_format() {
        let p = PathBuf::from("/roms/PS1/Final Fantasy VII (USA) (Disc 1).cue");
        let r = parse_file(&p, "Sony - PlayStation", 0, 0).unwrap();
        assert_eq!(r.file_format, FileFormat::CueBin);
        assert_eq!(r.disc_number, Some(1));
    }

    #[test]
    fn bin_file_is_skipped() {
        let p = PathBuf::from("/roms/PS1/Game (USA).bin");
        assert!(parse_file(&p, "Sony - PlayStation", 0, 0).is_none());
    }

    #[test]
    fn unknown_extension_is_skipped() {
        let p = PathBuf::from("/roms/NES/readme.txt");
        assert!(parse_file(&p, "Nintendo - NES", 0, 0).is_none());
    }
}
