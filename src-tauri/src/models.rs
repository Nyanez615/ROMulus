use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── File-level types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileFormat {
    #[default]
    Zip,
    Chd,
    CueBin,
    Iso,
    SevenZip,
    Raw,
}

impl FileFormat {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "zip" => FileFormat::Zip,
            "chd" => FileFormat::Chd,
            "cue" => FileFormat::CueBin,
            "iso" => FileFormat::Iso,
            "7z" => FileFormat::SevenZip,
            _ => FileFormat::Raw,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileCategory {
    #[default]
    Game,
    Unofficial,
    Bios,
    Utility,
    Demo,
    Video,
    EReader,
    /// Physical peripheral data (NFC dumps, figurine/card data).
    /// Currently covers Nintendo amiibo; excluded from the ROMs tab.
    Accessory,
}

// ── Core ROM types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RomFile {
    pub path: String,
    pub filename: String,
    pub console: String,
    pub title: String,
    pub title_normalized: String,
    pub regions: Vec<String>,
    pub languages: Vec<String>,
    pub status_flags: Vec<String>,
    pub extra_tags: Vec<String>,
    pub bad_dump: bool,
    pub revision: u32,
    /// ISO build date parsed from `(YYYY-MM-DD)` tags, stored as YYYYMMDD.
    /// Separate from `revision` so date-stamped proto builds sort chronologically
    /// without inflating `revision` for finished releases.
    pub build_date: Option<u32>,
    pub disc_number: Option<u32>,
    pub version: Option<String>,
    pub is_bios: bool,
    pub file_format: FileFormat,
    pub file_category: FileCategory,
    #[ts(type = "number")]
    pub filesize: u64,
    /// Computed from UserPreferences at grouping time — never hardcoded.
    pub matches_preferred_language: bool,
    pub matches_preferred_region: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RomGroup {
    pub title_normalized: String,
    pub console: String,
    pub variants: Vec<RomFile>,
    /// None when no variant matches the user's preferred language → delete all.
    pub preferred_idx: Option<usize>,
    pub has_preferred_version: bool,
    pub is_format_pair: bool,
    /// >1 means this group contains multi-disc files that are kept/deleted together.
    pub disc_count: u32,
    /// Original-case catalog number (e.g. "4B-001, Sachen-Commin") when this group
    /// was split from others sharing the same title by a catalog-number extra_tag.
    /// None for the vast majority of groups that have no catalog number.
    pub catalog_number: Option<String>,
}

// ── User settings ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserPreferences {
    /// e.g. ["En"] or ["En", "Fr"] — ordered, first = most preferred
    pub preferred_languages: Vec<String>,
    /// Ordered priority list; user drag-reorders in Settings
    pub preferred_regions: Vec<String>,
    /// Show abbreviated console names (GBA, NES) instead of full names
    #[serde(default)]
    pub short_console_names: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppSettings {
    pub rom_roots: Vec<String>,
    pub format_preferences: std::collections::HashMap<String, String>,
    pub preferences: UserPreferences,
    pub terms_accepted: bool,
    pub crash_reporting_enabled: bool,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            rom_roots: vec![],
            format_preferences: std::collections::HashMap::new(),
            preferences: UserPreferences::default(),
            terms_accepted: false,
            crash_reporting_enabled: false,
            theme: "dark".into(),
        }
    }
}

// ── Prune / execution types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DeletionReason {
    NonPreferred,
    NoPreferredVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeletionItem {
    pub rom: RomFile,
    pub reason: DeletionReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeletionPlan {
    pub to_delete: Vec<DeletionItem>,
    pub to_keep: Vec<RomFile>,
    pub no_preferred_version_count: u32,
    #[ts(type = "number")]
    pub total_bytes_freed: u64,
    pub console_summary: Vec<ConsoleStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConsoleStats {
    pub name: String,
    /// All ROM files regardless of category (games + hacks + BIOS + demos + …)
    pub total_files: u32,
    /// Unique title groups across all categories (canonical-level, deduplicated)
    pub total_groups: u32,
    /// ROM files that are FileCategory::Game only (matches ROMs-tab counts)
    pub game_files: u32,
    /// Unique game title groups (canonical-level, game category only)
    pub game_groups: u32,
    /// Unique game-or-unofficial title groups with ≥1 preferred-language variant
    pub preferred_groups: u32,
    /// Unique game-or-unofficial title groups — main title denominator
    pub all_groups: u32,
    /// Files that are FileCategory::Unofficial
    pub unofficial_files: u32,
    pub preferred_count: u32,
    /// Subset of preferred_count where the ROM has an explicit language tag matching the preference.
    pub preferred_explicit_count: u32,
    /// Subset of preferred_count matched via region→language inference (no explicit tag).
    pub preferred_inferred_count: u32,
    /// Non-playable files (Bios + Video + EReader + Accessory)
    pub system_file_count: u32,
    pub marked_for_deletion: u32,
    #[ts(type = "number")]
    pub bytes_to_free: u64,
    #[ts(type = "number")]
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ActionType {
    MovedToTrash,
    Deleted,
    Kept,
    Skipped,
    Deferred,
    Pending,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActionLogEntry {
    pub id: i64,
    pub timestamp: String,
    pub action: ActionType,
    pub path: String,
    pub console: String,
    pub title: String,
    pub reason: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionResult {
    pub success_count: u32,
    pub failed: Vec<FailedFile>,
    pub skipped_count: u32,
    /// Source directories that were empty after file deletion and were removed.
    /// Also removed from rom_roots. Empty vec for regular execute_prune calls.
    pub folders_removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FailedFile {
    pub path: String,
    pub error: String,
}

/// Returned by get_interrupted_session when there are pending action_log rows.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct InterruptedSession {
    pub pending_count: u32,
    /// Distinct console names from pending rows, alphabetically sorted.
    pub consoles: Vec<String>,
}

// ── Scan & background event payloads ────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanStatus {
    pub scanning: bool,
    pub scanned: u32,
    pub total_estimate: u32,
    pub current_console: Option<String>,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanProgress {
    pub console: String,
    pub scanned: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewRomEvent {
    pub path: String,
    pub console: String,
}

// ── Onboarding ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OnboardingState {
    pub terms_accepted: bool,
    pub crash_reporting_opted_in: bool,
    pub preferences_configured: bool,
    pub roots_added: bool,
    pub first_scan_complete: bool,
    pub is_complete: bool,
}

// ── Format pairs ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FormatPair {
    pub console_group: String,
    /// The smaller (subset) folder — every title here also appears in folder_b.
    pub folder_a: String,
    /// The larger (superset) folder, or equal-sized when counts match.
    pub folder_b: String,
    pub overlap_percent: f32,
    /// Number of distinct normalized titles in folder_a (the subset).
    pub folder_a_count: usize,
    /// Number of distinct normalized titles in folder_b (the superset).
    pub folder_b_count: usize,
}

// ── History filter ───────────────────────────────────────────────────────────

/// Optional filter applied to get_history queries.
/// action values are the snake_case DB strings: "moved_to_trash", "deleted", etc.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistoryFilter {
    /// Restrict to entries whose action is one of these values.
    pub actions: Option<Vec<String>>,
    /// Restrict to entries within the last N days.
    pub since_days: Option<u32>,
}

// ── Pagination ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PagedGroups {
    pub total_groups: u32,
    pub page: u32,
    pub per_page: u32,
    pub groups: Vec<RomGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PagedHistory {
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub entries: Vec<ActionLogEntry>,
}

// ── Phase 4: Metadata, DAT, Enrichment ───────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GameMetadata {
    pub title_normalized: String,
    pub console: String,
    pub igdb_id: Option<i64>,
    pub name: Option<String>,
    pub release_year: Option<i32>,
    pub genres: Vec<String>,
    pub summary: Option<String>,
    pub rating: Option<f64>,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnrichmentStatus {
    pub running: bool,
    pub enriched: u32,
    pub total: u32,
    pub current_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DatFile {
    pub console: String,
    pub filename: String,
    pub version: Option<String>,
    pub entry_count: u32,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Completeness {
    pub console: String,
    pub have: u32,
    pub total: u32,
    pub percent: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerificationStatus {
    pub running: bool,
    pub verified: u32,
    pub modified: u32,
    pub unknown: u32,
    pub total: u32,
}

// ── Download list types ──────────────────────────────────────────────────────

/// Status of a preferred variant chosen for the download list.
///
/// Note: `BestAvailable` is intentionally absent. `build_group()` only sets
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DownloadStatus {
    /// Preferred-language variant found and selected.
    Preferred,
    /// Only pre-release (Alpha/Beta/Proto/Demo/…) variants exist in the DAT;
    /// the highest-scoring one is included so the user can opt in.
    PrereleaseOnly,
    /// No language-matching variant exists, but the content type (BIOS or amiibo)
    /// is language-agnostic — best-available regional variant is included.
    FallbackOnly,
}

/// One entry in a download list — the preferred variant for a single title group.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DownloadEntry {
    /// Exact ROM filename from the DAT `<rom name="…">` attribute
    /// (e.g. `"Super Mario 3D Land (USA) (En,Fr,De,Es,Pt,It).3ds"`).
    pub rom_name: String,
    /// Human-readable game title from the DAT `<game name="…">` attribute.
    pub game_title: String,
    pub title_normalized: String,
    pub regions: Vec<String>,
    pub languages: Vec<String>,
    pub status_flags: Vec<String>,
    pub file_category: FileCategory,
    pub status: DownloadStatus,
    #[ts(type = "number")]
    pub score: i32,
}

/// Full result of a `generate_download_list` command call.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DownloadList {
    pub console: String,
    pub to_download: Vec<DownloadEntry>,
    /// Count of DAT entries with a parseable `rom_name` (0 → re-import needed).
    pub total_in_dat: u32,
    pub preferred_count: u32,
    pub prerelease_only_count: u32,
    /// BIOS / amiibo entries included despite no language match (best-available variant).
    pub fallback_count: u32,
    /// Groups with no language-matching variant (regular ROM titles, not BIOS/amiibo).
    pub excluded_count: u32,
}


// ── qBittorrent integration types ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtSettings {
    pub host: String,
    pub user: String,
    pub has_password: bool,
    pub no_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtTorrent {
    pub hash: String,
    pub name: String,
    pub num_files: u32,
    /// Immediate parent folder of the torrent files (e.g. "Nintendo - amiibo").
    /// `None` when the torrent has no sub-folder structure.
    pub console_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtFileDecision {
    pub filename: String,
    pub download: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtGroupInfo {
    /// Normalized lowercase group key — used as a stable React key, not for display
    pub key: String,
    /// Properly-cased display title (pre-region portion of the chosen filename)
    pub display_title: String,
    /// Chosen filename (will be set to priority 1)
    pub chosen: String,
    /// Skipped filenames (will be set to priority 0)
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtFilterPreview {
    /// Console name inferred from torrent folder, if detectable
    pub console_name: Option<String>,
    pub total: u32,
    pub to_download: u32,
    pub to_skip: u32,
    /// Every file in the torrent with its download/skip decision
    pub files: Vec<QbtFileDecision>,
    /// Only groups where >1 variant exists (single-variant groups are silently kept)
    pub multi_variant_groups: Vec<QbtGroupInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QbtApplyResult {
    pub to_download: u32,
    pub to_skip: u32,
}

// ── Type export test ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ts_rs::TS;

    #[test]
    fn export_typescript_bindings() {
        let out = "../src/lib/bindings";
        std::fs::create_dir_all(out).unwrap();
        RomFile::export_all_to(out).unwrap();
        RomGroup::export_all_to(out).unwrap();
        UserPreferences::export_all_to(out).unwrap();
        AppSettings::export_all_to(out).unwrap();
        DeletionReason::export_all_to(out).unwrap();
        DeletionItem::export_all_to(out).unwrap();
        DeletionPlan::export_all_to(out).unwrap();
        ConsoleStats::export_all_to(out).unwrap();
        ActionLogEntry::export_all_to(out).unwrap();
        ExecutionResult::export_all_to(out).unwrap();
        ScanStatus::export_all_to(out).unwrap();
        OnboardingState::export_all_to(out).unwrap();
        FormatPair::export_all_to(out).unwrap();
        PagedGroups::export_all_to(out).unwrap();
        PagedHistory::export_all_to(out).unwrap();
        ScanProgress::export_all_to(out).unwrap();
        NewRomEvent::export_all_to(out).unwrap();
        GameMetadata::export_all_to(out).unwrap();
        EnrichmentStatus::export_all_to(out).unwrap();
        DatFile::export_all_to(out).unwrap();
        Completeness::export_all_to(out).unwrap();
        VerificationStatus::export_all_to(out).unwrap();
        HistoryFilter::export_all_to(out).unwrap();
        InterruptedSession::export_all_to(out).unwrap();
        DownloadStatus::export_all_to(out).unwrap();
        DownloadEntry::export_all_to(out).unwrap();
        DownloadList::export_all_to(out).unwrap();
        QbtSettings::export_all_to(out).unwrap();
        QbtTorrent::export_all_to(out).unwrap();
        QbtFileDecision::export_all_to(out).unwrap();
        QbtGroupInfo::export_all_to(out).unwrap();
        QbtFilterPreview::export_all_to(out).unwrap();
        QbtApplyResult::export_all_to(out).unwrap();
    }
}
