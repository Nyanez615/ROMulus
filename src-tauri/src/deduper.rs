use std::collections::{HashMap, HashSet};

use crate::models::{FormatPair, RomFile};


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
            // All pairs reaching this point have passed `likely_format_pair`, which
            // requires strip_trailing_parens(a) == strip_trailing_parens(b) — i.e. the
            // two folders are variants of the same console (same hardware, different
            // format/encryption/distribution suffix).  They always qualify as a format
            // pair regardless of title overlap.  Low or zero overlap just means the
            // user's collection happens to have different titles in each folder; the
            // preference setting is still useful (pre-download filter) and harmless when
            // there is nothing to merge in the prune step.
            {
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
    fn category_subfolder_detected_with_any_overlap() {
        // Myrient full sets place aftermarket games in BOTH the base folder and a
        // dedicated "(Aftermarket)" subfolder.  The user should be able to configure
        // which copy to keep — this requires the pair to appear in Format Variant
        // Preferences.  The 80% heuristic may fail if only some titles overlap, so
        // `is_category_variant` qualifies the pair as soon as any title is shared.
        let base = "Nintendo - Game Boy";
        let aftermarket = "Nintendo - Game Boy (Aftermarket)";

        // Simulate 5 games in the base folder; 3 of those also appear in Aftermarket.
        let mut roms: Vec<RomFile> = (0..5).map(|i| rom(base, &format!("game{i}"))).collect();
        roms.extend((0..3).map(|i| rom(aftermarket, &format!("game{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty(), "base + Aftermarket subfolder should be detected with 60% overlap");
        assert_eq!(pairs[0].console_group, "Nintendo - Game Boy");
    }

    #[test]
    fn category_subfolder_detected_even_with_zero_overlap() {
        // An Aftermarket folder containing only unique titles (no base-folder overlap)
        // must still appear as a format pair so the user can configure a preference.
        // The preference is harmless when overlap is 0 (nothing to merge in the prune
        // step), but hiding the pair prevents the user from setting it proactively.
        let base = "Nintendo - Game Boy";
        let aftermarket = "Nintendo - Game Boy (Aftermarket)";

        let mut roms: Vec<RomFile> = (0..5).map(|i| rom(base, &format!("official{i}"))).collect();
        roms.extend((0..5).map(|i| rom(aftermarket, &format!("homebrew{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty(), "zero-overlap Aftermarket subfolder must still be detected as a format pair");
        assert_eq!(pairs[0].console_group, "Nintendo - Game Boy");
    }

    #[test]
    fn same_base_different_suffix_always_detected() {
        // Any two folders that strip to the same canonical base are format variants
        // by definition, regardless of title overlap.  The old 80% guard is gone —
        // low overlap just means the user's collection has different titles in each
        // folder, but the preference setting is still meaningful.
        let a = "Acme - Console (VariantA)";
        let b = "Acme - Console (VariantB)";

        let mut roms: Vec<RomFile> = (0..10).map(|i| rom(a, &format!("game{i}"))).collect();
        roms.push(rom(b, "game0")); // 10% overlap — would have been rejected before
        roms.extend((10..20).map(|i| rom(b, &format!("unique{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(!pairs.is_empty(), "same canonical base must always be detected as a format pair");
    }

    #[test]
    fn multi_suffix_variant_detected_with_zero_overlap() {
        // "Nintendo - New Nintendo 3DS (Digital) (Deprecated)" has two trailing parens,
        // so `is_category_variant` (one-paren check) misses it.  It must still appear
        // alongside "(Decrypted)" and "(Encrypted)" as a format pair because all three
        // strip to the same canonical base "Nintendo - New Nintendo 3DS".
        let decrypted = "Nintendo - New Nintendo 3DS (Decrypted)";
        let deprecated = "Nintendo - New Nintendo 3DS (Digital) (Deprecated)";

        // Non-overlapping title sets simulate a real collection where the deprecated
        // digital set happens to have entirely different titles from the decrypted set.
        let mut roms: Vec<RomFile> = (0..4).map(|i| rom(decrypted, &format!("exclusive{i}"))).collect();
        roms.extend((0..20).map(|i| rom(deprecated, &format!("digital{i}"))));

        let pairs = detect_format_pairs(&roms);
        assert!(
            !pairs.is_empty(),
            "multi-suffix variant with zero overlap must still be detected as a format pair"
        );
        let group = &pairs[0].console_group;
        assert_eq!(group, "Nintendo - New Nintendo 3DS");
    }

    #[test]
    fn unrelated_consoles_never_paired() {
        // Two consoles with completely different names must never form a pair.
        let roms = vec![
            rom("Nintendo - Game Boy Advance", "mario"),
            rom("Nintendo - Super Nintendo Entertainment System", "zelda"),
        ];
        let pairs = detect_format_pairs(&roms);
        assert!(pairs.is_empty(), "unrelated consoles must never be detected as a format pair");
    }
}
