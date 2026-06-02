import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Prune from "./Prune";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { FilterSettings } from "@/lib/bindings/FilterSettings";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import { usePreferencesStore } from "@/store/preferences";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockApplyFilters = vi.fn(() => Promise.resolve({} as DeletionPlan));
const mockExecutePrune = vi.fn(() => Promise.resolve({ success_count: 2, failed: [], skipped_count: 0 }));
const mockExportCsv = vi.fn(() => Promise.resolve());
const mockGetSettings = vi.fn(() => Promise.resolve({} as AppSettings));
const mockGetFilterSettings = vi.fn(() => Promise.resolve({} as FilterSettings));
const mockSaveFilterSettings = vi.fn(() => Promise.resolve());

vi.mock("@/lib/tauri", () => ({
  applyFilters: () => mockApplyFilters(),
  executePrune: () => mockExecutePrune(),
  exportCsv: () => mockExportCsv(),
  getSettings: () => mockGetSettings(),
  getFilterSettings: () => mockGetFilterSettings(),
  saveFilterSettings: (s: unknown) => { void s; return mockSaveFilterSettings(); },
  isOneDrivePath: (path: string) => path.toLowerCase().includes("onedrive"),
  formatBytes: (b: number) => `${b} B`,
}));

const mockDialogSave = vi.fn(() => Promise.resolve("/tmp/prune.csv"));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: () => mockDialogSave() }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseSettings: AppSettings = {
  rom_roots: [],
  format_preferences: {},
  preferences: { preferred_languages: ["En"], preferred_regions: ["USA"], short_console_names: false },
  onedrive_acknowledged: false,
  terms_accepted: true,
  crash_reporting_enabled: false,
  allow_permanent_delete: false,
  theme: "dark",
};

const emptyPlan: DeletionPlan = { to_delete: [], to_keep: [], no_preferred_version_count: 0, total_bytes_freed: 0, console_summary: [] };

const fakeRom = {
  path: "/roms/Game (Europe).zip", filename: "Game (Europe).zip",
  console: "Nintendo - GBA", title: "Game", title_normalized: "game",
  regions: ["Europe"], languages: [], status_flags: [], extra_tags: [],
  bad_dump: false, revision: 0, disc_number: null, version: null,
  is_bios: false, file_format: "zip" as const, file_category: "game" as const,
  filesize: 1024, matches_preferred_language: false,
  matches_preferred_region: false, is_unofficial_preferred_fallback: false,
};

const fakePlan: DeletionPlan = {
  to_delete: [{ rom: fakeRom, reason: "non_preferred_language" as const }],
  to_keep: [],
  no_preferred_version_count: 0,
  total_bytes_freed: 1024, console_summary: [],
};

const defaultFilters: FilterSettings = {
  keep_preferred_only: true,
  remove_if_no_preferred_version: true,
  remove_prerelease: true,
  remove_unofficial: false,
  remove_older_revisions: true,
  keep_unofficial_as_fallback: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ ...baseSettings });
  mockGetFilterSettings.mockResolvedValue({ ...defaultFilters });
  mockApplyFilters.mockResolvedValue(emptyPlan);
  usePreferencesStore.setState({ filterSettings: { ...defaultFilters } });
});

describe("Filter toggles", () => {
  it("toggles keep_preferred_only off", async () => {
    render(<Prune />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);
    expect(usePreferencesStore.getState().filterSettings.keep_preferred_only).toBe(false);
  });

  it("toggles remove_if_no_preferred_version off", async () => {
    render(<Prune />);
    fireEvent.click(screen.getAllByRole("switch")[1]);
    expect(usePreferencesStore.getState().filterSettings.remove_if_no_preferred_version).toBe(false);
  });

  it("toggles remove_prerelease off", async () => {
    render(<Prune />);
    fireEvent.click(screen.getAllByRole("switch")[2]);
    expect(usePreferencesStore.getState().filterSettings.remove_prerelease).toBe(false);
  });

  it("toggles remove_older_revisions off", async () => {
    render(<Prune />);
    fireEvent.click(screen.getAllByRole("switch")[3]);
    expect(usePreferencesStore.getState().filterSettings.remove_older_revisions).toBe(false);
  });

  it("toggles keep_unofficial_as_fallback off", async () => {
    render(<Prune />);
    fireEvent.click(screen.getAllByRole("switch")[4]);
    expect(usePreferencesStore.getState().filterSettings.keep_unofficial_as_fallback).toBe(false);
  });

  it("toggles remove_unofficial on", async () => {
    render(<Prune />);
    fireEvent.click(screen.getAllByRole("switch")[5]);
    expect(usePreferencesStore.getState().filterSettings.remove_unofficial).toBe(true);
  });
});

describe("Destructive switch styling", () => {
  it("Delete ALL unofficial switch has destructive class", () => {
    render(<Prune />);
    const switches = screen.getAllByRole("switch");
    expect((switches[5] as Element).className).toContain("data-[state=checked]:bg-destructive");
  });

  it("other switches do not have the destructive class", () => {
    render(<Prune />);
    const switches = screen.getAllByRole("switch");
    for (let i = 0; i < 5; i++) {
      expect((switches[i] as Element).className).not.toContain("data-[state=checked]:bg-destructive");
    }
  });
});

describe("Preview toggle", () => {
  it("Preview button calls applyFilters", async () => {
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => expect(mockApplyFilters).toHaveBeenCalledOnce());
  });

  it("shows plan stats after preview", async () => {
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => expect(screen.getByText("approved to delete")).toBeInTheDocument());
  });

  it("Hide preview button clears the plan", async () => {
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    await screen.findByText("Hide preview");
    fireEvent.click(screen.getByText("Hide preview"));
    expect(screen.queryByText("approved to delete")).not.toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("X button in preview header clears the plan", async () => {
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    const previewLabel = await screen.findByText("Preview", { selector: "span" });
    const header = previewLabel.closest("div");
    const closeBtn = header?.querySelector("button:last-child");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(screen.queryByText("approved to delete")).not.toBeInTheDocument();
  });
});

describe("CSV export", () => {
  it("Export CSV button is shown with plan and calls exportCsv", async () => {
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    await screen.findByText("Export CSV");
    fireEvent.click(screen.getByText("Export CSV"));
    await waitFor(() => expect(mockExportCsv).toHaveBeenCalledOnce());
  });
});

describe("OneDrive guard", () => {
  it("shows OneDrive warning when a root is an OneDrive path", async () => {
    mockGetSettings.mockResolvedValue({
      ...baseSettings,
      rom_roots: ["/Users/test/Library/CloudStorage/OneDrive-Personal/ROMs"],
    });
    mockApplyFilters.mockResolvedValue(fakePlan);
    render(<Prune />);
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => {
      expect(screen.getByText(/OneDrive path detected/)).toBeInTheDocument();
    });
  });
});
