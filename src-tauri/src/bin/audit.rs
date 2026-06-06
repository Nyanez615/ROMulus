/// ROMulus scoring audit tool.
/// Usage: cargo run -p romulus --bin audit -- <rom_root>
///
/// Scans a ROM collection root using the same parser + grouper as the live app
/// and emits a TSV report flagging suspicious preferred-variant selections.
///
/// Columns: flag  title  console  variants  preferred  preferred_score  runner_up  runner_up_score
///
/// Flags:
///   OK                 — preferred looks correct
///   COLLECTION_PREF    — preferred has a collection tag but a non-collection original exists
///   PRERELEASE_BUG     — preferred scores −100 (pre-release) yet an official variant exists
///   PRERELEASE_ONLY    — all matching variants are pre-release
///   UNOFFICIAL_ONLY    — no official release; showing best unofficial fallback
///   NO_PREFERRED       — no variant matches user prefs (language/region)
///   GAP_SMALL          — score gap ≤ 5 between preferred and runner-up (tiebreaker zone)
use romulus_lib::{
    FileCategory, RomFile, RomGroup, UserPreferences,
    group_roms, score_rom, COLLECTION_TAGS, parse_file,
};
use std::{path::Path, time::Instant};
use walkdir::WalkDir;

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("Usage: cargo run -p romulus --bin audit -- <rom_root>");

    // Match the user's live Settings: English only, no region preference.
    let prefs = UserPreferences {
        preferred_languages: vec!["En".into()],
        preferred_regions: vec![],
        short_console_names: false,
    };

    eprintln!("Scanning {}…", root);
    let t0 = Instant::now();
    let roms = scan_path(&root);
    eprintln!("  {} files parsed ({:.1}s)", roms.len(), t0.elapsed().as_secs_f64());

    let t1 = Instant::now();
    let mut groups = group_roms(roms, &prefs);
    // Mirror get_roms: only include groups that have at least one Game or Unofficial variant.
    groups.retain(|g| {
        g.variants
            .iter()
            .any(|v| matches!(v.file_category, FileCategory::Game | FileCategory::Unofficial))
    });
    groups.sort_by(|a, b| a.title_normalized.cmp(&b.title_normalized));
    eprintln!("  {} groups built ({:.1}s)", groups.len(), t1.elapsed().as_secs_f64());

    println!("flag\ttitle\tconsole\tvariants\tpreferred\tpreferred_score\trunner_up\trunner_up_score");

    for group in &groups {
        let flag = classify(group, &prefs);
        let (pref_name, pref_score, runner_name, runner_score) = scores_summary(group, &prefs);
        println!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            flag,
            group.title_normalized,
            group.console,
            group.variants.len(),
            pref_name,
            pref_score,
            runner_name,
            runner_score,
        );
    }
}

fn classify(group: &RomGroup, prefs: &UserPreferences) -> &'static str {
    let Some(pidx) = group.preferred_idx else {
        return "NO_PREFERRED";
    };

    let preferred = &group.variants[pidx];
    let (pref_score, _, _) = score_rom(preferred, prefs);

    // PRERELEASE_BUG: preferred is pre-release but an official release also matches prefs
    if pref_score <= -100 {
        let has_official_match = group.variants.iter().enumerate().any(|(i, v)| {
            i != pidx && v.matches_preferred_language && score_rom(v, prefs).0 >= 0
        });
        if has_official_match {
            return "PRERELEASE_BUG";
        }
        return "PRERELEASE_ONLY";
    }

    // UNOFFICIAL_ONLY: preferred is an unofficial fallback
    if pref_score < 0 {
        return "UNOFFICIAL_ONLY";
    }

    // COLLECTION_PREF: preferred has a collection tag yet a non-collection official exists
    let pref_in_collection = has_collection_tag(preferred);
    if pref_in_collection {
        let non_collection_official_exists = group.variants.iter().enumerate().any(|(i, v)| {
            i != pidx
                && matches!(v.file_category, FileCategory::Game)
                && !has_collection_tag(v)
                && v.matches_preferred_language
        });
        if non_collection_official_exists {
            return "COLLECTION_PREF";
        }
    }

    // GAP_SMALL: score gap between preferred and best alternative is ≤ 5
    if group.variants.len() > 1 {
        let best_runner_score = group
            .variants
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != pidx)
            .map(|(_, v)| score_rom(v, prefs).0)
            .max()
            .unwrap_or(i32::MIN);

        if best_runner_score >= 0 && (pref_score - best_runner_score).abs() <= 5 {
            return "GAP_SMALL";
        }
    }

    "OK"
}

fn has_collection_tag(rom: &RomFile) -> bool {
    rom.extra_tags
        .iter()
        .flat_map(|t| t.split(", "))
        .any(|part| COLLECTION_TAGS.contains(&part))
}

fn scores_summary(
    group: &RomGroup,
    prefs: &UserPreferences,
) -> (String, String, String, String) {
    let (pref_name, pref_score) = match group.preferred_idx {
        Some(i) => {
            let rom = &group.variants[i];
            (rom.filename.clone(), fmt_score(score_rom(rom, prefs)))
        }
        None => ("NONE".to_string(), "-".to_string()),
    };

    // Runner-up: highest-scoring non-BIOS variant that isn't the preferred
    let runner = group
        .variants
        .iter()
        .enumerate()
        .filter(|(i, v)| Some(*i) != group.preferred_idx && !v.is_bios)
        .map(|(_, v)| (v.filename.clone(), score_rom(v, prefs)))
        .max_by_key(|(_, s)| *s);

    let (runner_name, runner_score) = match runner {
        Some((name, s)) => (name, fmt_score(s)),
        None => ("-".to_string(), "-".to_string()),
    };

    (pref_name, pref_score, runner_name, runner_score)
}

fn fmt_score(s: (i32, u32, usize)) -> String {
    format!("{}+{}+{}", s.0, s.1, s.2)
}

fn scan_path(root: &str) -> Vec<RomFile> {
    let root_path = Path::new(root);
    let mut roms = Vec::new();

    for entry in WalkDir::new(root_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        // Console name = immediate parent folder (same logic as the live scanner)
        let console = match path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
        {
            Some(c) => c.to_string(),
            None => continue,
        };
        let filesize = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if let Some(rom) = parse_file(path, &console, filesize, 0) {
            roms.push(rom);
        }
    }

    roms
}
