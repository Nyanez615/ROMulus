use crate::parser::KNOWN_REGIONS;

// ── Group key ─────────────────────────────────────────────────────────────────

/// Compute the variant-aware grouping key for a ROM filename.
///
/// Returns everything before the first known-region parenthetical, normalised
/// and lowercased. Catalog numbers are preserved — they are the sole
/// differentiator between distinct amiibo/figurine releases that share the
/// same character name.
///
/// Normalisation applied:
/// - Unicode dash characters (en-dash U+2013, em-dash U+2014) → ASCII `-`
/// - ` - ` (subtitle separator, always surrounded by spaces in No-Intro
///   naming) → single space, so "Traumatarium – Penitent" and "Traumatarium
///   Penitent" land in the same group.  Word-internal hyphens ("Pac-Man")
///   are preserved because they have no surrounding spaces.
///
/// Examples:
/// - `"Isabelle (Sweater) (World).zip"` → `"isabelle (sweater)"`
/// - `"Isabelle (World).zip"` → `"isabelle"`
/// - `"282 - Animal Crossing - Isabelle (World).zip"` → `"282 animal crossing isabelle"`
/// - `"368 - Animal Crossing - Isabelle (World).zip"` → `"368 animal crossing isabelle"` (different!)
/// - `"Traumatarium \u{2013} Penitent (World).zip"` → `"traumatarium penitent"`
/// - `"Traumatarium Penitent (World).zip"` → `"traumatarium penitent"` (same group!)
/// - `"Cloud (Player 2) (World).zip"` → `"cloud (player 2)"`
/// - `"Super Mario Bros. (World).zip"` → `"super mario bros."`
pub fn group_key(filename: &str) -> String {
    let stem = match std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
    {
        Some(s) => s,
        None => return String::new(),
    };

    // Strip [BIOS] prefix
    let stem = stem.strip_prefix("[BIOS]").map(str::trim).unwrap_or(stem);

    // Take everything before the first known-region parenthetical, then normalise.
    // Catalog numbers are intentionally kept — they distinguish different products.
    normalize_key(first_pre_region(stem))
}

/// Normalise a pre-region title fragment into a stable grouping key.
///
/// 1. Lowercase.
/// 2. Fold Unicode dash variants (en-dash, em-dash) to ASCII `-`.
/// 3. Collapse ` - ` subtitle separators to a single space.
/// 4. Strip trailing `!` / `?` from the title portion (not from inside variant
///    parentheticals) so that "Globlins!" and "Globlins" land in the same group.
///    Word-internal punctuation (e.g. "Pac-Man") and paren contents are untouched.
fn normalize_key(s: &str) -> String {
    // Step 1 + 2: lowercase and map Unicode dashes to ASCII hyphen.
    let lowered = s
        .to_lowercase()
        .replace(['\u{2013}', '\u{2014}', '\u{2015}'], "-");
    // Step 3: collapse space-hyphen-space (subtitle separator with spaces on
    // both sides) to a single space. Word-internal hyphens like "Pac-Man" have
    // no surrounding spaces and are untouched.
    let collapsed = lowered.split(" - ").collect::<Vec<_>>().join(" ");
    // Step 4: strip trailing ! / ? from the title word (the part before the first
    // " (" variant parenthetical, if any).  Paren contents are left intact.
    let stripped = if let Some(paren_start) = collapsed.find(" (") {
        let title = collapsed[..paren_start].trim_end_matches(['!', '?']);
        format!("{}{}", title, &collapsed[paren_start..])
    } else {
        collapsed.trim_end_matches(['!', '?']).to_string()
    };
    // Step 5: normalize Roman numeral tokens (II→2, VII→7, etc.) so that
    // "Genesis II" and "Genesis 2" land in the same group.
    stripped
        .split(' ')
        .map(|tok| {
            crate::parser::roman_to_arabic(tok)
                .map(|n| n.to_string())
                .unwrap_or_else(|| tok.to_string())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Same as `group_key` but preserves original casing — use for display only.
pub fn display_title(filename: &str) -> String {
    let stem = match std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
    {
        Some(s) => s,
        None => return String::new(),
    };
    let stem = stem.strip_prefix("[BIOS]").map(str::trim).unwrap_or(stem);
    first_pre_region(stem).to_string()
}

/// Returns the filename stem portion before the first known-region parenthetical,
/// with trailing whitespace trimmed.
fn first_pre_region(stem: &str) -> &str {
    let mut i = 0;
    let bytes = stem.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'(' {
            if let Some(rel_close) = stem[i + 1..].find(')') {
                let close = i + 1 + rel_close;
                let content = &stem[i + 1..close];
                if is_region_paren(content) {
                    return stem[..i].trim_end();
                }
                i = close + 1;
            } else {
                break; // unmatched paren — treat rest as title
            }
        } else {
            i += 1;
        }
    }
    stem.trim_end()
}

/// True when `content` is a single known region or a comma-separated list of known regions.
fn is_region_paren(content: &str) -> bool {
    if content.is_empty() {
        return false;
    }
    if content.contains(", ") {
        let parts: Vec<&str> = content.split(", ").collect();
        parts.iter().all(|p| KNOWN_REGIONS.contains(p))
    } else {
        KNOWN_REGIONS.contains(&content)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn k(filename: &str) -> String {
        group_key(filename)
    }

    // ── Variant parentheticals preserved ─────────────────────────────────────

    #[test]
    fn sweater_isabelle_separate_from_plain() {
        assert_ne!(k("Isabelle (Sweater) (World).zip"), k("Isabelle (World).zip"));
        assert_eq!(k("Isabelle (Sweater) (World).zip"), "isabelle (sweater)");
        assert_eq!(k("Isabelle (World).zip"), "isabelle");
    }

    #[test]
    fn player_two_variant_separate_from_base() {
        assert_ne!(k("Cloud (Player 2) (World).zip"), k("Cloud (World).zip"));
        assert_eq!(k("Cloud (Player 2) (World).zip"), "cloud (player 2)");
        assert_eq!(k("Cloud (World).zip"), "cloud");
    }

    #[test]
    fn multiple_pre_region_parens_all_preserved() {
        assert_eq!(
            k("Isabelle (Sweater) (Animal Crossing) (World).zip"),
            "isabelle (sweater) (animal crossing)"
        );
    }

    // ── Same title, different regions → same group ────────────────────────────

    #[test]
    fn same_title_different_regions_same_group() {
        assert_eq!(k("Super Mario Bros. (World).zip"), k("Super Mario Bros. (USA).zip"));
        assert_eq!(k("Super Mario Bros. (World).zip"), "super mario bros.");
    }

    #[test]
    fn multi_region_paren_is_boundary() {
        assert_eq!(k("Tetris (USA, Europe).zip"), "tetris");
    }

    // ── Revision tags come after region → same group ──────────────────────────

    #[test]
    fn revision_not_in_key() {
        assert_eq!(
            k("Super Mario Bros. (World) (Rev 1).zip"),
            k("Super Mario Bros. (World).zip"),
        );
    }

    // ── Catalog numbers are PRESERVED — different numbers = different products ─

    #[test]
    fn different_catalog_numbers_are_different_groups() {
        // The same character with different catalog numbers is a different amiibo release.
        // " - " separators are collapsed to spaces, but the numeric prefix still differs.
        assert_ne!(
            k("282 - Animal Crossing - Isabelle (World) (Animal Crossing) (Card).zip"),
            k("368 - Animal Crossing - Isabelle (World) (Animal Crossing) (Card).zip"),
        );
        assert_eq!(
            k("282 - Animal Crossing - Isabelle (World) (Animal Crossing) (Card).zip"),
            "282 animal crossing isabelle",
        );
    }

    #[test]
    fn catalog_number_with_variant_paren_preserved() {
        assert_eq!(
            k("Animal Crossing - 424 - Isabelle (Sweater) (World).zip"),
            "animal crossing 424 isabelle (sweater)",
        );
    }

    #[test]
    fn wave_label_preserved() {
        // Different waves are different products
        assert_ne!(
            k("Splatoon - Wave 1 - Callie (World) (Figurine).zip"),
            k("Splatoon - Wave 2 - Marina (World) (Figurine).zip"),
        );
    }

    #[test]
    fn starter_vs_booster_series_different_groups() {
        // Different catalog numbers = different groups even with same character name
        assert_ne!(
            k("Street Fighter 6 - 17 - Zangief (World) (Starter Set Series) (Street Fighter 6).zip"),
            k("Street Fighter 6 - 47 - Zangief (World) (Booster Pack Series) (Street Fighter 6).zip"),
        );
    }

    // ── BIOS prefix stripped ──────────────────────────────────────────────────

    #[test]
    fn bios_prefix_stripped() {
        assert_eq!(
            k("[BIOS] Nintendo Game Boy Color Boot ROM (World) (Rev 1).zip"),
            "nintendo game boy color boot rom"
        );
    }

    // ── Post-region tags ignored ──────────────────────────────────────────────

    #[test]
    fn post_region_tags_ignored() {
        assert_eq!(
            k("Isabelle (Sweater) (World) (Animal Crossing) (Card).zip"),
            "isabelle (sweater)",
        );
    }

    // ── No region → full stem used ────────────────────────────────────────────

    #[test]
    fn no_region_uses_full_stem() {
        assert_eq!(k("Some Game Without Region.zip"), "some game without region");
    }

    // ── No extension ─────────────────────────────────────────────────────────

    #[test]
    fn no_extension_works() {
        assert_eq!(k("Isabelle (Sweater) (World)"), "isabelle (sweater)");
    }

    // ── Dash / subtitle-separator normalisation ───────────────────────────────

    #[test]
    fn en_dash_subtitle_separator_merges_with_space_version() {
        // "Traumatarium – Penitent" (en-dash U+2013) and "Traumatarium Penitent"
        // are the same game with different naming conventions and must group together.
        assert_eq!(
            k("Traumatarium \u{2013} Penitent (World) (Aftermarket) (Unl).zip"),
            k("Traumatarium Penitent (World) (Aftermarket) (Unl).zip"),
        );
        assert_eq!(
            k("Traumatarium \u{2013} Penitent (World) (Aftermarket) (Unl).zip"),
            "traumatarium penitent",
        );
    }

    #[test]
    fn hyphen_subtitle_separator_merges_with_space_version() {
        // " - " used as a subtitle separator (spaces on both sides) collapses to a space.
        assert_eq!(
            k("Mega Man - Battle Network (USA).zip"),
            k("Mega Man Battle Network (USA).zip"),
        );
    }

    #[test]
    fn word_internal_hyphen_preserved() {
        // Hyphens with no surrounding spaces are part of the word and must be kept.
        assert_eq!(k("Pac-Man (USA).zip"), "pac-man");
        assert_ne!(k("Pac-Man (USA).zip"), k("Pac Man (USA).zip"));
    }

    #[test]
    fn em_dash_normalised_to_hyphen_then_collapsed() {
        // em-dash (U+2014) → ASCII hyphen → collapsed with surrounding spaces
        assert_eq!(
            k("Title \u{2014} Subtitle (World).zip"),
            k("Title Subtitle (World).zip"),
        );
    }

    #[test]
    fn trailing_exclamation_merges_with_plain() {
        // "Globlins!" and "Globlins" are the same game — different torrent dumps
        // differ only in whether the filename includes the trailing exclamation mark.
        assert_eq!(
            k("Globlins! (World) (Demo 2) (MAGFest 2025) (Aftermarket) (Unl).zip"),
            k("Globlins (World) (Demo 2) (MAGFest 2025) (Aftermarket) (Unl).zip"),
        );
        assert_eq!(
            k("Globlins! (World) (Demo 2) (MAGFest 2025) (Aftermarket) (Unl).zip"),
            "globlins",
        );
    }

    #[test]
    fn trailing_question_mark_merges() {
        assert_eq!(k("Quiz Game? (World).zip"), k("Quiz Game (World).zip"));
    }

    #[test]
    fn trailing_punct_inside_paren_preserved() {
        // Variant parens like "(Sweater!)" are kept verbatim — they distinguish variants.
        assert_ne!(k("Isabelle (Sweater!) (World).zip"), k("Isabelle (Sweater) (World).zip"));
    }

    #[test]
    fn version_after_region_shares_group_key() {
        assert_eq!(k("NESert Golfing (World) (Aftermarket) (Unl).zip"), "nesert golfing");
        assert_eq!(k("NESert Golfing (World) (v1.1) (Aftermarket) (Unl).zip"), "nesert golfing");
        assert_eq!(
            k("NESert Golfing (World) (Aftermarket) (Unl).zip"),
            k("NESert Golfing (World) (v1.1) (Aftermarket) (Unl).zip"),
        );
    }

    #[test]
    fn roman_numeral_titles_share_group_key() {
        // Arabic and Roman numeral sequel designations must produce the same key
        assert_eq!(k("Genesis 2 (World) (Aftermarket) (Unl).zip"), "genesis 2");
        assert_eq!(k("Genesis II (World) (Demo) (Aftermarket) (Unl).zip"), "genesis 2");
        assert_eq!(
            k("Genesis 2 (World) (Aftermarket) (Unl).zip"),
            k("Genesis II (World) (Demo) (Aftermarket) (Unl).zip"),
        );
        // Final Fantasy VII ↔ 7
        assert_eq!(k("Final Fantasy VII (USA).zip"), k("Final Fantasy 7 (USA).zip"));
        // Single-char Roman tokens must NOT be normalised (Mega Man X ≠ Mega Man 10)
        assert_ne!(k("Mega Man X (USA).zip"), k("Mega Man 10 (USA).zip"));
    }
}
