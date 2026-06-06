use std::collections::{HashMap, HashSet};

use crate::models::{FormatPair, RomFile};

/// Detect console folder pairs that contain the same games in different formats.
/// Returns pairs where >80% of normalized titles overlap.
pub fn detect_format_pairs(roms: &[RomFile]) -> Vec<FormatPair> {
    // Build a map: console → set of normalized titles
    let mut by_console: HashMap<&str, HashSet<&str>> = HashMap::new();
    for rom in roms {
        by_console
            .entry(&rom.console)
            .or_default()
            .insert(&rom.title_normalized);
    }

    let consoles: Vec<&str> = by_console.keys().copied().collect();
    let mut pairs: Vec<FormatPair> = vec![];

    for i in 0..consoles.len() {
        for j in (i + 1)..consoles.len() {
            let a = consoles[i];
            let b = consoles[j];

            // Only compare consoles whose names look related
            // (share a common "base name" when the format suffix is stripped)
            if !likely_format_pair(a, b) {
                continue;
            }

            let titles_a = &by_console[a];
            let titles_b = &by_console[b];
            let overlap = titles_a.intersection(titles_b).count();
            let count_a = titles_a.len();
            let count_b = titles_b.len();
            let smaller = count_a.min(count_b);

            if smaller == 0 {
                continue;
            }

            let overlap_percent = overlap as f32 / smaller as f32;
            if overlap_percent >= 0.8 {
                // Assign folder_a as the subset (smaller or equal) folder so the frontend
                // always knows which direction the containment goes.
                let (folder_a, folder_b, folder_a_count, folder_b_count) =
                    if count_a <= count_b {
                        (a, b, count_a, count_b)
                    } else {
                        (b, a, count_b, count_a)
                    };
                pairs.push(FormatPair {
                    console_group: derive_group_name(folder_a),
                    folder_a: folder_a.to_string(),
                    folder_b: folder_b.to_string(),
                    overlap_percent,
                    folder_a_count,
                    folder_b_count,
                });
            }
        }
    }

    pairs
}

/// Heuristic: two console folder names are likely format pairs if one is a
/// suffix-variant of the other, e.g. "(Headered)" vs "(Headerless)".
fn likely_format_pair(a: &str, b: &str) -> bool {
    // Strip the last parenthetical suffix from each name
    let base_a = strip_last_paren(a);
    let base_b = strip_last_paren(b);
    base_a == base_b
}

fn strip_last_paren(s: &str) -> &str {
    if let Some(idx) = s.rfind('(') {
        s[..idx].trim()
    } else {
        s
    }
}

fn derive_group_name(folder: &str) -> String {
    strip_last_paren(folder).to_string()
}


// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileCategory, FileFormat};

    fn rom(console: &str, title_normalized: &str) -> RomFile {
        RomFile {
            path: format!("/roms/{title_normalized}.zip"),
            filename: format!("{title_normalized}.zip"),
            console: console.into(),
            title: title_normalized.into(),
            title_normalized: title_normalized.into(),
            regions: vec![],
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
    }

    #[test]
    fn detects_nes_headered_headerless_pair() {
        let headered = "Nintendo - Nintendo Entertainment System (Headered)";
        let headerless = "Nintendo - Nintendo Entertainment System (Headerless)";

        let roms: Vec<RomFile> = (0..10)
            .flat_map(|i| {
                vec![
                    rom(headered, &format!("game{i}")),
                    rom(headerless, &format!("game{i}")),
                ]
            })
            .collect();

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty());
        let pair = &pairs[0];
        assert!(pair.overlap_percent >= 0.8);
    }

    #[test]
    fn no_pair_for_unrelated_consoles() {
        let roms = vec![
            rom("Nintendo - GBA", "mario"),
            rom("Nintendo - SNES", "zelda"),
        ];
        let pairs = detect_format_pairs(&roms);
        assert!(pairs.is_empty());
    }

    #[test]
    fn strip_last_paren_works() {
        assert_eq!(
            strip_last_paren("Nintendo - NES (Headered)"),
            "Nintendo - NES"
        );
        assert_eq!(
            strip_last_paren("Nintendo - N64 (BigEndian)"),
            "Nintendo - N64"
        );
    }
}
