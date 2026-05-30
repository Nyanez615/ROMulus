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
import { isTauri } from "./env";
import type { AppSettings } from "./bindings/AppSettings";
import type { ConsoleStats } from "./bindings/ConsoleStats";
import type { DeleteMode } from "./bindings/DeleteMode";
import type { DeletionPlan } from "./bindings/DeletionPlan";
import type { ExecutionResult } from "./bindings/ExecutionResult";
import type { FilterSettings } from "./bindings/FilterSettings";
import type { PagedHistory } from "./bindings/PagedHistory";
import type { RomGroup } from "./bindings/RomGroup";
import type { NewRomEvent } from "./bindings/NewRomEvent";
import type { OnboardingState } from "./bindings/OnboardingState";
import type { PagedGroups } from "./bindings/PagedGroups";
import type { RomFile } from "./bindings/RomFile";
import type { ScanProgress } from "./bindings/ScanProgress";
import type { ScanStatus } from "./bindings/ScanStatus";
import type { FormatPair } from "./bindings/FormatPair";

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
  preferences: { preferred_languages: ["En"], preferred_regions: ["USA", "World", "Europe"] },
  onedrive_acknowledged: false,
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
  console?: string;
  search?: string;
  page: number;
  perPage: number;
}

export const getGames = (params: GetGamesParams): Promise<PagedGroups> =>
  isTauri()
    ? invoke("get_games", {
        console: params.console ?? null,
        search: params.search ?? null,
        page: params.page,
        perPage: params.perPage,
      })
    : Promise.resolve({ total_groups: 0, page: 1, per_page: 50, groups: [] });

// ── Prune ─────────────────────────────────────────────────────────────────────

export const executePrune = (
  toDelete: RomFile[],
  mode: DeleteMode,
  onedriveAcknowledged: boolean,
): Promise<ExecutionResult> =>
  isTauri()
    ? invoke("execute_prune", { toDelete, mode, onedriveAcknowledged })
    : Promise.resolve({ success_count: 0, failed: [], skipped_count: 0 });

export const getInterruptedSession = (): Promise<boolean> =>
  isTauri() ? invoke("get_interrupted_session") : Promise.resolve(false);

export const applyFilters = (settings: FilterSettings): Promise<DeletionPlan> =>
  isTauri()
    ? invoke("apply_filters", { settings })
    : Promise.resolve({ to_delete: [], to_keep: [], no_preferred_version_count: 0, total_bytes_freed: 0, console_summary: [] });

export const exportCsv = (toDelete: RomFile[], path: string): Promise<void> =>
  isTauri() ? invoke("export_csv", { toDelete, path }) : Promise.resolve();

export const getUnofficial = (params: GetGamesParams): Promise<PagedGroups> =>
  isTauri()
    ? invoke("get_unofficial", { console: params.console ?? null, search: params.search ?? null, page: params.page, perPage: params.perPage })
    : Promise.resolve({ total_groups: 0, page: 1, per_page: 50, groups: [] });

export const getSystemFiles = (params: GetGamesParams): Promise<PagedGroups> =>
  isTauri()
    ? invoke("get_system_files", { console: params.console ?? null, search: params.search ?? null, page: params.page, perPage: params.perPage })
    : Promise.resolve({ total_groups: 0, page: 1, per_page: 50, groups: [] });

export const getDuplicates = (console?: string): Promise<RomGroup[]> =>
  isTauri()
    ? invoke("get_duplicates", { console: console ?? null })
    : Promise.resolve([]);

export const getFormatPairs = (): Promise<FormatPair[]> =>
  isTauri() ? invoke("get_format_pairs") : Promise.resolve([]);

export const getHistory = (page: number, perPage: number): Promise<PagedHistory> =>
  isTauri()
    ? invoke("get_history", { page, perPage })
    : Promise.resolve({ total: 0, page: 1, per_page: 50, entries: [] });

// ── Settings & onboarding ─────────────────────────────────────────────────────

export const getSettings = (): Promise<AppSettings> =>
  isTauri() ? invoke("get_settings") : Promise.resolve(DEFAULT_SETTINGS);

export const saveSettings = (settings: AppSettings): Promise<void> =>
  isTauri() ? invoke("save_settings", { settings }) : Promise.resolve();

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

// ── Utilities ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

export function isOneDrivePath(path: string): boolean {
  return path.includes("OneDrive") || path.includes("CloudStorage");
}
