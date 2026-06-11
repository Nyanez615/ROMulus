use std::collections::{HashMap, HashSet};

use crate::models::{FormatPair, RomFile};

/// Console format suffix pairs that are always merged regardless of title-overlap percentage.
/// These are hardware-format variants of the same system where the game library is identical
/// by definition, so the 80% heuristic is not needed and may fail for small/curated sets.
const KNOWN_FORMAT_SUFFIX_PAIRS: &[(&str, &str)] = &[
    ("(FDS)", "(QD)"),
    ("(Headered)", "(Headerless)"),
];

/// True when `a` and `b` carry a known format-suffix pair, e.g. one contains "(FDS)" and the
/// other contains "(QD)". Base-name match is still required via `likely_format_pair`.
fn is_known_format_pair(a: &str, b: &str) -> bool {
    KNOWN_FORMAT_SUFFIX_PAIRS
        .iter()
        .any(|(x, y)| (a.contains(x) && b.contains(y)) || (a.contains(y) && b.contains(x)))
}

/// Detect console folder pairs that contain the same games in different formats.
/// Known format suffix pairs (FDS/QD, Headered/Headerless) are always merged.
/// Other pairs require ≥80% title overlap to qualify.
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
            let qualifies = is_known_format_pair(a, b) || overlap_percent >= 0.8;
            if qualifies {
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
    // Strip ALL trailing parentheticals so that category suffixes like
    // "(Aftermarket)" don't prevent matching the hardware base name.
    // e.g. "...FDS (Aftermarket)" and "...QD (Aftermarket)" both strip to
    // "Nintendo - Family Computer Disk System".
    strip_trailing_parens(a) == strip_trailing_parens(b)
}

/// Strip all trailing `(…)` parentheticals from `s`, returning the base name.
/// Stops as soon as the string no longer ends with `)`.
fn strip_trailing_parens(s: &str) -> &str {
    let mut result = s.trim();
    while result.ends_with(')') {
        if let Some(idx) = result.rfind('(') {
            result = result[..idx].trim_end();
        } else {
            break;
        }
    }
    result
}

fn derive_group_name(folder: &str) -> String {
    strip_trailing_parens(folder).to_string()
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
    fn strip_trailing_parens_works() {
        assert_eq!(strip_trailing_parens("Nintendo - NES (Headered)"), "Nintendo - NES");
        assert_eq!(strip_trailing_parens("Nintendo - N64 (BigEndian)"), "Nintendo - N64");
        assert_eq!(
            strip_trailing_parens("Nintendo - Family Computer Disk System (FDS) (Aftermarket)"),
            "Nintendo - Family Computer Disk System"
        );
        assert_eq!(
            strip_trailing_parens("Nintendo - Family Computer Disk System (QD) (Aftermarket)"),
            "Nintendo - Family Computer Disk System"
        );
    }

    #[test]
    fn detects_fds_qd_aftermarket_pair() {
        let fds = "Nintendo - Family Computer Disk System (FDS) (Aftermarket)";
        let qd  = "Nintendo - Family Computer Disk System (QD) (Aftermarket)";

        let roms: Vec<RomFile> = (0..10)
            .flat_map(|i| {
                vec![
                    rom(fds, &format!("game{i}")),
                    rom(qd, &format!("game{i}")),
                ]
            })
            .collect();

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty(), "FDS/QD Aftermarket pair not detected");
        let pair = &pairs[0];
        assert!(pair.overlap_percent >= 0.8);
        assert_eq!(pair.console_group, "Nintendo - Family Computer Disk System");
    }

    #[test]
    fn known_format_pair_merged_below_80_percent_overlap() {
        // Simulates downloading a small curated QD set alongside a large FDS set.
        // Only 3 of 10 QD titles exist in the FDS folder (30% overlap) — below the
        // 80% heuristic — but FDS/QD is a known format pair so it must still merge.
        let fds = "Nintendo - Family Computer Disk System (FDS) (Aftermarket)";
        let qd  = "Nintendo - Family Computer Disk System (QD) (Aftermarket)";

        let mut roms: Vec<RomFile> = (0..10).map(|i| rom(fds, &format!("game{i}"))).collect();
        // Only 3 QD titles overlap with the FDS set
        roms.extend((0..3).map(|i| rom(qd, &format!("game{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty(), "known FDS/QD pair should be detected even below 80% overlap");
        assert_eq!(pairs[0].console_group, "Nintendo - Family Computer Disk System");
    }

    #[test]
    fn unknown_pair_below_threshold_not_detected() {
        // Two consoles whose names share a base but whose games barely overlap.
        // Neither is a known format suffix pair, so the 80% heuristic must reject them.
        let a = "Acme - Console (VariantA)";
        let b = "Acme - Console (VariantB)";

        let mut roms: Vec<RomFile> = (0..10).map(|i| rom(a, &format!("game{i}"))).collect();
        // Only 1 title overlaps — 10% — well below 80%
        roms.push(rom(b, "game0"));
        roms.extend((10..20).map(|i| rom(b, &format!("unique{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(pairs.is_empty(), "low-overlap unknown pair should not be detected");
    }
}
