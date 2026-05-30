use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── File-level types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileFormat {
    Zip,
    Chd,
    CueBin,
    Iso,
    SevenZip,
    Raw,
}

impl Default for FileFormat {
    fn default() -> Self {
        FileFormat::Zip
    }
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileCategory {
    Game,
    Unofficial,
    Bios,
    Utility,
    Demo,
    Video,
    EReader,
}

impl Default for FileCategory {
    fn default() -> Self {
        FileCategory::Game
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserPreferences {
    /// e.g. ["En"] or ["En", "Fr"] — ordered, first = most preferred
    pub preferred_languages: Vec<String>,
    /// Ordered priority list; user drag-reorders in Settings
    pub preferred_regions: Vec<String>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        UserPreferences {
            preferred_languages: vec![],
            preferred_regions: vec![],
        }
    }
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
    pub bytes_to_free: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanStatus {
    pub scanning: bool,
    pub scanned: u32,
    pub total_estimate: u32,
    pub current_console: Option<String>,
    pub cached: bool,
}

impl Default for ScanStatus {
    fn default() -> Self {
        ScanStatus {
            scanning: false,
            scanned: 0,
            total_estimate: 0,
            current_console: None,
            cached: false,
        }
    }
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
    }
}
