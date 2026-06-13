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

/// Strip No-Intro trailing article suffix from a lowercased title fragment.
/// No-Intro moves leading articles to the end: "The Blues Brothers" → "Blues Brothers, The".
/// Stripping the suffix lets "Blues Brothers, The" and "Blues Brothers" share the same key.
fn strip_article_suffix(s: &str) -> &str {
    if let Some(t) = s.strip_suffix(", the") {
        t
    } else if let Some(t) = s.strip_suffix(", an") {
        t
    } else if let Some(t) = s.strip_suffix(", a") {
        t
    } else {
        s
    }
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
    // Step 1 + 2: lowercase, map Unicode dashes to ASCII hyphen, strip apostrophes.
    // Apostrophes are stripped so possessive variants ("Hoodlum's" vs "Hoodlums'")
    // and contractions group together — both collapse to "hoodlums".
    let lowered = s
        .to_lowercase()
        .replace(['\u{2013}', '\u{2014}', '\u{2015}'], "-")
        .replace(['\'', '\u{2019}'], "");
    // Step 3: collapse list/subtitle separators surrounded by spaces to a single
    // space.  " - " handles subtitle separators ("Pac-Man - Adventures"); " & "
    // and " + " are interchangeable list separators in No-Intro — Europe uses "&"
    // while USA uses "+" for the same compilation title ("Uno & Skip-Bo" vs
    // "Uno + Skip-Bo").  Word-internal hyphens ("Pac-Man") are untouched.
    let collapsed = lowered.split(" - ").collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.split(" & ").collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.split(" + ").collect::<Vec<_>>().join(" ");
    // Normalize "vs." and "vs" to "v" so "Ecks vs. Sever" (No-Intro dot form) and
    // "Ecks V Sever" (regional abbreviation) resolve to the same group key.
    // Must run after the " - " collapse so only standalone word-separated tokens match.
    let collapsed = collapsed.split(" vs. ").collect::<Vec<_>>().join(" v ");
    let collapsed = collapsed.split(" vs ").collect::<Vec<_>>().join(" v ");
    // Step 4: strip trailing ! / ? and No-Intro article suffix (, the / , a / , an)
    // from the title word (the part before the first " (" variant parenthetical).
    // Article suffix: No-Intro moves leading articles to the end after a comma
    // ("Blues Brothers, The"), so stripping it lets that group with bare "Blues Brothers".
    let stripped = if let Some(paren_start) = collapsed.find(" (") {
        let title = collapsed[..paren_start].trim_end_matches(['!', '?']);
        let title = strip_article_suffix(title);
        format!("{}{}", title, &collapsed[paren_start..])
    } else {
        strip_article_suffix(collapsed.trim_end_matches(['!', '?'])).to_string()
    };
    // Step 5: normalize Roman numeral tokens (II→2, VII→7, etc.) so that
    // "Genesis II" and "Genesis 2" land in the same group.
    // Step 6: normalize Japanese long-vowel romanization: word tokens ending
    // in "ou" are mapped to "o" so "Heiankyou Alien" and "Heiankyo Alien"
    // (same game, inconsistent No-Intro spelling) share the same group key.
    stripped
        .split(' ')
        .map(|tok| {
            let tok = crate::parser::roman_to_arabic(tok)
                .map(|n| n.to_string())
                .unwrap_or_else(|| tok.to_string());
            if tok.ends_with("ou") {
                // Japanese long-vowel romanization: Heiankyou → Heiankyo
                tok[..tok.len() - 1].to_string()
            } else if tok.len() >= 5 && tok.ends_with("our") {
                // British/American spelling: colour→color, honour→honor, behaviour→behavior.
                // len>=5 guards short common words (four, tour, pour, your, hour).
                format!("{}or", &tok[..tok.len() - 3])
            } else {
                tok
            }
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

    // ── List separator normalisation ( & / + ) ───────────────────────────────

    #[test]
    fn ampersand_and_plus_are_equivalent_separators() {
        // No-Intro uses " & " (Europe) and " + " (USA) interchangeably for the
        // same compilation title — they must produce the same group key.
        assert_eq!(
            k("2 Game Pack! \u{2013} Uno & Skip-Bo (Europe) (En,Fr,De,Es,It).zip"),
            k("2 Game Pack! \u{2013} Uno + Skip-Bo (USA).zip"),
        );
        assert_eq!(
            k("2 Game Pack! \u{2013} Uno & Skip-Bo (Europe) (En,Fr,De,Es,It).zip"),
            "2 game pack! uno skip-bo",
        );
    }

    // ── Apostrophe / possessive normalisation ────────────────────────────────

    #[test]
    fn possessive_apostrophe_placement_is_ignored() {
        // "Rayman - Hoodlum's Revenge" (singular possessive) and
        // "Rayman - Hoodlums' Revenge" (plural possessive) are the same GBA game.
        assert_eq!(
            k("Rayman - Hoodlum's Revenge (USA).zip"),
            k("Rayman - Hoodlums' Revenge (Europe) (En,Fr,De,Es,It,Nl).zip"),
            "apostrophe placement must not split the group key"
        );
        // Unicode right-single-quote variant also normalises correctly.
        assert_eq!(
            k("Rayman - Hoodlum\u{2019}s Revenge (USA).zip"),
            k("Rayman - Hoodlums' Revenge (Europe) (En,Fr,De,Es,It,Nl).zip"),
        );
    }

    // ── Versus-separator normalisation ───────────────────────────────────────

    #[test]
    fn vs_dot_and_v_and_vs_are_equivalent_separators() {
        // No-Intro uses "vs." (with period), "vs" (without), and "V" (uppercase
        // abbreviation) for the same "versus" word in different regions/versions.
        // "Ecks vs. Sever" and "Ecks V Sever" are the same GBA title.
        assert_eq!(
            k("Ecks vs. Sever (USA).zip"),
            k("Ecks V Sever (USA).zip"),
            "vs. and V must normalise to the same key"
        );
        assert_eq!(
            k("Ecks vs Sever (USA).zip"),
            k("Ecks V Sever (USA).zip"),
            "vs (no dot) and V must normalise to the same key"
        );
        // "V" is a Roman numeral → 5, so the canonical key lands on "ecks 5 sever"
        // for all three forms. What matters is that they all hash to the same value.
        assert_eq!(k("Ecks V Sever (USA).zip"), "ecks 5 sever");
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
    fn article_suffix_merges_with_bare_title() {
        // No-Intro writes "Blues Brothers, The"; some releases drop the article.
        // Both must land in the same group.
        assert_eq!(k("Blues Brothers, The (USA).zip"), k("Blues Brothers (USA).zip"));
        assert_eq!(k("Blues Brothers, The (USA).zip"), "blues brothers");
        assert_eq!(k("Addams Family, The (USA).zip"), "addams family");
        // Variant parens preserved; article stripped from title portion only
        assert_eq!(
            k("Blues Brothers, The (Special Edition) (USA).zip"),
            "blues brothers (special edition)",
        );
        assert_ne!(
            k("Blues Brothers, The (Special Edition) (USA).zip"),
            k("Blues Brothers, The (USA).zip"),
        );
        // "An" and "A" suffixes
        assert_eq!(k("Game, An (USA).zip"), "game");
        assert_eq!(k("Game, A (USA).zip"), "game");
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
    fn japanese_long_vowel_ou_merges_romanization_variants() {
        // No-Intro is inconsistent about whether to write the Japanese long vowel
        // きょう as "kyo" or "kyou". "Heiankyo Alien" and "Heiankyou Alien" are the
        // same game; the trailing "u" on "ou" endings must be stripped in the key.
        assert_eq!(k("Heiankyou Alien (Japan) (En).zip"), "heiankyo alien");
        assert_eq!(k("Heiankyo Alien (World).zip"), "heiankyo alien");
        assert_eq!(
            k("Heiankyou Alien (Japan) (En).zip"),
            k("Heiankyo Alien (World).zip"),
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
        // Single-char tokens are also normalised: X = 10, V = 5
        assert_eq!(k("Mega Man X (USA).zip"), k("Mega Man 10 (USA).zip"));
    }

    #[test]
    fn compilation_subtitle_before_region_creates_separate_keys() {
        // "4 Games on One Game Pak (Racing)" vs "(Nickelodeon Movies)" vs "(Nicktoons)"
        // are completely different compilation cartridges — the subtitle paren comes
        // BEFORE the region and must be preserved in the group key so each stays
        // in its own group and the wrong one is never marked for deletion.
        assert_ne!(
            k("4 Games on One Game Pak (Racing) (USA) (En,Fr,De,Es,It).zip"),
            k("4 Games on One Game Pak (Nickelodeon Movies) (USA).zip"),
        );
        assert_ne!(
            k("4 Games on One Game Pak (Racing) (USA) (En,Fr,De,Es,It).zip"),
            k("4 Games on One Game Pak (Nicktoons) (USA).zip"),
        );
        assert_ne!(
            k("4 Games on One Game Pak (Nickelodeon Movies) (USA).zip"),
            k("4 Games on One Game Pak (Nicktoons) (USA).zip"),
        );
        assert_eq!(k("4 Games on One Game Pak (Racing) (USA) (En,Fr,De,Es,It).zip"), "4 games on one game pak (racing)");
        assert_eq!(k("4 Games on One Game Pak (Nickelodeon Movies) (USA).zip"), "4 games on one game pak (nickelodeon movies)");
        assert_eq!(k("4 Games on One Game Pak (Nicktoons) (USA).zip"), "4 games on one game pak (nicktoons)");
    }

    // ── British/American spelling normalisation ───────────────────────────────

    #[test]
    fn british_american_colour_spelling_same_group() {
        // "Special Color Edition" (USA) and "Special Colour Edition" (Europe)
        // are the same game — colour→color must normalise to the same key.
        assert_eq!(
            k("Ms. Pac-Man - Special Color Edition (USA) (SGB Enhanced) (GB Compatible).zip"),
            k("Ms. Pac-Man - Special Colour Edition (Europe) (SGB Enhanced) (GB Compatible).zip"),
        );
        // Short words (four, tour, pour, your, hour) must be left untouched.
        assert_eq!(k("Four Swords Adventures (USA).zip"), "four swords adventures");
        assert_eq!(k("Tour de France (Europe).zip"), "tour de france");
    }
}
