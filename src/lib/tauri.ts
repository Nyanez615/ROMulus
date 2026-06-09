/**
 * Typed wrappers around Tauri invoke() and listen().
 * Import from here — never call invoke() directly in components.
 *
 * All functions return safe defaults when running outside the Tauri WebView
 * (e.g. in the Vite browser preview) so the UI can be developed without
 * a native window.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isTauri } from "./env";
import type { AppSettings } from "./bindings/AppSettings";
import type { ConsoleStats } from "./bindings/ConsoleStats";
import type { DeletionItem } from "./bindings/DeletionItem";
import type { DeletionPlan } from "./bindings/DeletionPlan";
import type { ExecutionResult } from "./bindings/ExecutionResult";
import type { PagedHistory } from "./bindings/PagedHistory";
import type { NewRomEvent } from "./bindings/NewRomEvent";
import type { OnboardingState } from "./bindings/OnboardingState";
import type { PagedGroups } from "./bindings/PagedGroups";
import type { RomFile } from "./bindings/RomFile";
import type { ScanProgress } from "./bindings/ScanProgress";
import type { ScanStatus } from "./bindings/ScanStatus";
import type { FormatPair } from "./bindings/FormatPair";
import type { HistoryFilter } from "./bindings/HistoryFilter";
import type { InterruptedSession } from "./bindings/InterruptedSession";

// ── Defaults for browser-preview mode ────────────────────────────────────────

const DEFAULT_ONBOARDING: OnboardingState = {
  terms_accepted: true,
  crash_reporting_opted_in: false,
  preferences_configured: true,
  roots_added: true,
  first_scan_complete: true,
  is_complete: true,
};

const DEFAULT_SCAN_STATUS: ScanStatus = {
  scanning: false,
  scanned: 0,
  total_estimate: 0,
  current_console: null,
  cached: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  rom_roots: [],
  format_preferences: {},
  preferences: { preferred_languages: ["En"], preferred_regions: ["USA", "World", "Europe"], short_console_names: false },
  terms_accepted: true,
  crash_reporting_enabled: false,
  theme: "dark",
};

// ── Scan ──────────────────────────────────────────────────────────────────────

export const getScanStatus = (): Promise<ScanStatus> =>
  isTauri() ? invoke("get_scan_status") : Promise.resolve(DEFAULT_SCAN_STATUS);

export const getConsoles = (): Promise<ConsoleStats[]> =>
  isTauri() ? invoke("get_consoles") : Promise.resolve([]);


export const scanRoots = (roots: string[]): Promise<ScanStatus> =>
  isTauri() ? invoke("scan_roots", { roots }) : Promise.resolve(DEFAULT_SCAN_STATUS);

// ── Games / groups ────────────────────────────────────────────────────────────

export interface GetGamesParams {
  consoles?: string[];
  search?: string;
  page: number;
  perPage: number;
}

export const getRoms = (params: GetGamesParams): Promise<PagedGroups> =>
  isTauri()
    ? invoke("get_roms", {
        consoles: params.consoles ?? null,
        search: params.search ?? null,
        page: params.page,
        perPage: params.perPage,
      })
    : Promise.resolve({ total_groups: 0, page: 1, per_page: 50, groups: [] });

// ── Prune ─────────────────────────────────────────────────────────────────────

export const executePrune = (
  toDelete: RomFile[],
): Promise<ExecutionResult> =>
  isTauri()
    ? invoke("execute_prune", { toDelete })
    : Promise.resolve({ success_count: 0, failed: [], skipped_count: 0, folders_removed: [] });

export const executeFormatPairs = (
  toDelete: RomFile[],
): Promise<ExecutionResult> =>
  isTauri()
    ? invoke("execute_format_pairs", { toDelete })
    : Promise.resolve({ success_count: 0, failed: [], skipped_count: 0, folders_removed: [] });

export const getInterruptedSession = (): Promise<InterruptedSession | null> =>
  isTauri() ? invoke("get_interrupted_session") : Promise.resolve(null);

export const resumeSession = (): Promise<ExecutionResult> =>
  isTauri()
    ? invoke("resume_session")
    : Promise.resolve({ success_count: 0, failed: [], skipped_count: 0, folders_removed: [] });

export const getEmptyRoots = (): Promise<string[]> =>
  isTauri() ? invoke("get_empty_roots") : Promise.resolve([]);

export const cleanupEmptyRoots = (paths: string[]): Promise<number> =>
  isTauri() ? invoke("cleanup_empty_roots", { paths }) : Promise.resolve(0);

export const applyFilters = (consoles?: string[]): Promise<DeletionPlan> =>
  isTauri()
    ? invoke("apply_filters", { consoles: consoles ?? null })
    : Promise.resolve({ to_delete: [], to_keep: [], no_preferred_version_count: 0, total_bytes_freed: 0, console_summary: [] });

export const applyFormatPairs = (): Promise<DeletionPlan> =>
  isTauri()
    ? invoke("apply_format_pairs")
    : Promise.resolve({ to_delete: [], to_keep: [], no_preferred_version_count: 0, total_bytes_freed: 0, console_summary: [] });

export const exportCsv = (toDelete: DeletionItem[], path: string): Promise<void> =>
  isTauri() ? invoke("export_csv", { toDelete, path }) : Promise.resolve();

export const getSystemFiles = (params: GetGamesParams): Promise<PagedGroups> =>
  isTauri()
    ? invoke("get_system_files", { consoles: params.consoles ?? null, search: params.search ?? null, page: params.page, perPage: params.perPage })
    : Promise.resolve({ total_groups: 0, page: 1, per_page: 50, groups: [] });

export const getFormatPairs = (): Promise<FormatPair[]> =>
  isTauri() ? invoke("get_format_pairs") : Promise.resolve([]);

export const clearHistory = (): Promise<number> =>
  isTauri() ? invoke("clear_history") : Promise.resolve(0);

export const getHistory = (
  consoles: string[] | null,
  filter: HistoryFilter | null,
  page: number,
  perPage: number,
): Promise<PagedHistory> =>
  isTauri()
    ? invoke("get_history", { consoles, filter, page, perPage })
    : Promise.resolve({ total: 0, page: 1, per_page: 50, entries: [] });

export const getKnownTags = (tagType?: string): Promise<string[]> =>
  isTauri()
    ? invoke("get_known_tags", { tagType: tagType ?? null })
    : Promise.resolve([]);

// ── Phase 4: Metadata, Thumbnails, DAT ───────────────────────────────────────

import type { GameMetadata } from "./bindings/GameMetadata";
import type { EnrichmentStatus } from "./bindings/EnrichmentStatus";
import type { DatFile } from "./bindings/DatFile";
import type { Completeness } from "./bindings/Completeness";
import type { VerificationStatus } from "./bindings/VerificationStatus";
import type { DownloadList } from "./bindings/DownloadList";
import type { DownloadEntry } from "./bindings/DownloadEntry";
import type { ExportFormat } from "./bindings/ExportFormat";

// IGDB credentials
export const setIgdbCredentials = (clientId: string, secret: string): Promise<void> =>
  isTauri() ? invoke("set_igdb_credentials", { clientId, secret }) : Promise.resolve();
export const hasIgdbCredentials = (): Promise<boolean> =>
  isTauri() ? invoke("has_igdb_credentials") : Promise.resolve(false);
export const clearIgdbCredentials = (): Promise<void> =>
  isTauri() ? invoke("clear_igdb_credentials") : Promise.resolve();

// IGDB metadata
export const getGameMetadata = (title: string, console: string): Promise<GameMetadata | null> =>
  isTauri() ? invoke("get_game_metadata", { title, console }) : Promise.resolve(null);
export const getEnrichmentStatus = (): Promise<EnrichmentStatus> =>
  isTauri() ? invoke("get_enrichment_status") : Promise.resolve({ running: false, enriched: 0, total: 0, current_title: null });
export const enrichAllGames = (): Promise<void> =>
  isTauri() ? invoke("enrich_all_games") : Promise.resolve();

// SteamGridDB
export const setSteamGridDbKey = (key: string): Promise<void> =>
  isTauri() ? invoke("set_steamgriddb_key", { key }) : Promise.resolve();
export const hasSteamGridDbKey = (): Promise<boolean> =>
  isTauri() ? invoke("has_steamgriddb_key") : Promise.resolve(false);
export const clearSteamGridDbKey = (): Promise<void> =>
  isTauri() ? invoke("clear_steamgriddb_key") : Promise.resolve();
export const getThumbnail = (title: string, console: string): Promise<string | null> =>
  isTauri() ? invoke("get_thumbnail", { title, console }) : Promise.resolve(null);

// DAT files
export const readDatHeader = (path: string): Promise<[string, string]> =>
  isTauri() ? invoke("read_dat_header", { path }) : Promise.resolve(["", ""]);

export const importDat = (path: string, console: string): Promise<DatFile> =>
  isTauri() ? invoke("import_dat", { path, console }) : Promise.resolve({ console, filename: "", version: null, entry_count: 0, imported_at: "" });
export const getDatFiles = (): Promise<DatFile[]> =>
  isTauri() ? invoke("get_dat_files") : Promise.resolve([]);
export const removeDat = (console: string): Promise<void> =>
  isTauri() ? invoke("remove_dat", { console }) : Promise.resolve();
export const verifyRoms = (console?: string): Promise<void> =>
  isTauri() ? invoke("verify_roms", { console: console ?? null }) : Promise.resolve();
export const getVerificationStatus = (): Promise<VerificationStatus> =>
  isTauri() ? invoke("get_verification_status") : Promise.resolve({ running: false, verified: 0, modified: 0, unknown: 0, total: 0 });
export const getCompleteness = (console: string): Promise<Completeness> =>
  isTauri() ? invoke("get_completeness", { console }) : Promise.resolve({ console, have: 0, total: 0, percent: 0 });

export const generateDownloadList = (console: string): Promise<DownloadList> =>
  isTauri()
    ? invoke("generate_download_list", { console })
    : Promise.resolve({ console, to_download: [], total_in_dat: 0, preferred_count: 0, prerelease_only_count: 0, excluded_count: 0 });

export const exportDownloadList = (entries: DownloadEntry[], path: string, format: ExportFormat): Promise<void> =>
  isTauri() ? invoke("export_download_list", { entries, path, format }) : Promise.resolve();

// Event listeners for Phase 4 background tasks
export const onEnrichProgress = (cb: (s: EnrichmentStatus) => void): Promise<UnlistenFn> =>
  isTauri() ? listen<EnrichmentStatus>("enrich:progress", (e) => cb(e.payload)) : Promise.resolve(noop);
export const onEnrichComplete = (cb: (s: EnrichmentStatus) => void): Promise<UnlistenFn> =>
  isTauri() ? listen<EnrichmentStatus>("enrich:complete", (e) => cb(e.payload)) : Promise.resolve(noop);
export const onVerifyComplete = (cb: (s: VerificationStatus) => void): Promise<UnlistenFn> =>
  isTauri() ? listen<VerificationStatus>("verify:complete", (e) => cb(e.payload)) : Promise.resolve(noop);

// ── Settings & onboarding ─────────────────────────────────────────────────────

export const getSettings = (): Promise<AppSettings> =>
  isTauri() ? invoke("get_settings") : Promise.resolve(DEFAULT_SETTINGS);

export const saveSettings = (settings: AppSettings): Promise<void> =>
  isTauri() ? invoke("save_settings", { settings }) : Promise.resolve();

export const reapplyPreferences = (): Promise<void> =>
  isTauri() ? invoke("reapply_preferences") : Promise.resolve();

export const getOnboardingState = (): Promise<OnboardingState> =>
  isTauri() ? invoke("get_onboarding_state") : Promise.resolve(DEFAULT_ONBOARDING);

export const completeOnboardingStep = (step: number): Promise<OnboardingState> =>
  isTauri()
    ? invoke("complete_onboarding_step", { step })
    : Promise.resolve(DEFAULT_ONBOARDING);

// ── Events ────────────────────────────────────────────────────────────────────

const noop: UnlistenFn = () => {};

export const onScanProgress = (
  cb: (progress: ScanProgress) => void,
): Promise<UnlistenFn> =>
  isTauri()
    ? listen<ScanProgress>("scan:progress", (e) => cb(e.payload))
    : Promise.resolve(noop);

export const onNewRom = (
  cb: (event: NewRomEvent) => void,
): Promise<UnlistenFn> =>
  isTauri()
    ? listen<NewRomEvent>("watcher:new_rom", (e) => cb(e.payload))
    : Promise.resolve(noop);

export const onPreferencesRegrouped = (cb: () => void): Promise<UnlistenFn> =>
  isTauri() ? listen("preferences:regrouped", cb) : Promise.resolve(noop);

export const onScanComplete = (cb: (status: ScanStatus) => void): Promise<UnlistenFn> =>
  isTauri()
    ? listen<ScanStatus>("scan:complete", (e) => cb(e.payload))
    : Promise.resolve(noop);

// ── Utilities ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

export function isCloudPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    p.includes("/CloudStorage/") ||
    p.includes("Mobile Documents/com~apple~CloudDocs") ||
    p.includes("OneDrive") ||
    p.includes("/Dropbox/") ||
    p.includes("/Google Drive/") ||
    p.includes("/iCloudDrive/") ||
    p.includes("/iCloud Drive/") ||
    p.includes("/Box/")
  );
}

export const isOneDrivePath = isCloudPath;

// ── File system helpers ───────────────────────────────────────────────────────

/** Opens the file's parent folder with the file selected (Finder / Explorer / Files). */
export const revealInFinder = (path: string): Promise<void> =>
  isTauri() ? revealItemInDir(path) : Promise.resolve();
