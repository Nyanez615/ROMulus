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
    pub is_unofficial_preferred_fallback: bool,
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
pub struct FilterSettings {
    pub keep_preferred_only: bool,
    pub remove_if_no_preferred_version: bool,
    pub remove_prerelease: bool,
    pub remove_unofficial: bool,
    pub remove_older_revisions: bool,
    pub keep_unofficial_as_fallback: bool,
}

impl Default for FilterSettings {
    fn default() -> Self {
        FilterSettings {
            keep_preferred_only: true,
            remove_if_no_preferred_version: true,
            remove_prerelease: true,
            remove_unofficial: false,
            remove_older_revisions: true,
            keep_unofficial_as_fallback: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppSettings {
    pub rom_roots: Vec<String>,
    pub format_preferences: std::collections::HashMap<String, String>,
    pub preferences: UserPreferences,
    pub onedrive_acknowledged: bool,
    pub terms_accepted: bool,
    pub crash_reporting_enabled: bool,
    #[serde(default)]
    pub allow_permanent_delete: bool,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            rom_roots: vec![],
            format_preferences: std::collections::HashMap::new(),
            preferences: UserPreferences::default(),
            onedrive_acknowledged: false,
            terms_accepted: false,
            crash_reporting_enabled: false,
            allow_permanent_delete: false,
            theme: "dark".into(),
        }
    }
}

// ── Prune / execution types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeletionPlan {
    pub to_delete: Vec<RomFile>,
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
    pub total_files: u32,
    pub preferred_count: u32,
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
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DeleteMode {
    Trash,
    Permanent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionResult {
    pub success_count: u32,
    pub failed: Vec<FailedFile>,
    pub skipped_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FailedFile {
    pub path: String,
    pub error: String,
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
    pub folder_a: String,
    pub folder_b: String,
    pub overlap_percent: f32,
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
        FilterSettings::export_all_to(out).unwrap();
        AppSettings::export_all_to(out).unwrap();
        DeletionPlan::export_all_to(out).unwrap();
        ConsoleStats::export_all_to(out).unwrap();
        ActionLogEntry::export_all_to(out).unwrap();
        ExecutionResult::export_all_to(out).unwrap();
        ScanStatus::export_all_to(out).unwrap();
        OnboardingState::export_all_to(out).unwrap();
        FormatPair::export_all_to(out).unwrap();
        PagedGroups::export_all_to(out).unwrap();
        PagedHistory::export_all_to(out).unwrap();
        DeleteMode::export_all_to(out).unwrap();
        ScanProgress::export_all_to(out).unwrap();
        NewRomEvent::export_all_to(out).unwrap();
        GameMetadata::export_all_to(out).unwrap();
        EnrichmentStatus::export_all_to(out).unwrap();
        DatFile::export_all_to(out).unwrap();
        Completeness::export_all_to(out).unwrap();
        VerificationStatus::export_all_to(out).unwrap();
        HistoryFilter::export_all_to(out).unwrap();
    }
}
