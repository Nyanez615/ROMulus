import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Settings from "./Settings";
import type { AppSettings } from "@/lib/bindings/AppSettings";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSaveSettings = vi.fn((_s?: unknown) => Promise.resolve());
const mockGetSettings = vi.fn(() => Promise.resolve({} as AppSettings));

vi.mock("@/lib/tauri", () => ({
  getSettings: () => mockGetSettings(),
  saveSettings: (s: unknown) => mockSaveSettings(s),
  reapplyPreferences: () => Promise.resolve(),
  isCloudPath: (path: string) =>
    path.toLowerCase().includes("onedrive") || path.toLowerCase().includes("cloudstorage"),
  isOneDrivePath: (path: string) =>
    path.toLowerCase().includes("onedrive") || path.toLowerCase().includes("cloudstorage"),
  getFormatPairs: () => Promise.resolve([]),
  hasIgdbCredentials: () => Promise.resolve(false),
  hasSteamGridDbKey: () => Promise.resolve(false),
  getDatFiles: () => Promise.resolve([]),
  setIgdbCredentials: () => Promise.resolve(),
  clearIgdbCredentials: () => Promise.resolve(),
  setSteamGridDbKey: () => Promise.resolve(),
  clearSteamGridDbKey: () => Promise.resolve(),
  importDat: () => Promise.resolve({ console: "Test", entry_count: 0, version: "" }),
  removeDat: () => Promise.resolve(),
  verifyRoms: () => Promise.resolve(),
  enrichAllGames: () => Promise.resolve(),
  scanRoots: () => Promise.resolve({}),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.2.2"),
}));

const mockOpen = vi.fn(() => Promise.resolve(null as string | null));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => mockOpen() }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseSettings: AppSettings = {
  rom_roots: [],
  format_preferences: {},
  preferences: { preferred_languages: ["En"], preferred_regions: ["USA", "World", "Europe"], short_console_names: false },
  terms_accepted: true,
  crash_reporting_enabled: false,
  theme: "dark",
};

async function renderSettings(overrides: Partial<AppSettings> = {}) {
  mockGetSettings.mockResolvedValue({ ...baseSettings, ...overrides });
  render(<Settings />);
  await screen.findByText("ROM Libraries");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Section order", () => {
  it("shows ROM Libraries before Language & Region", async () => {
    await renderSettings();
    const headings = screen.getAllByRole("heading", { level: 2 });
    const names = headings.map((h) => h.textContent ?? "");
    const romIdx = names.findIndex((n) => n.includes("ROM Libraries"));
    const langIdx = names.findIndex((n) => n.includes("Language"));
    expect(romIdx).toBeGreaterThanOrEqual(0);
    expect(langIdx).toBeGreaterThanOrEqual(0);
    expect(romIdx).toBeLessThan(langIdx);
  });
});

describe("Section icons", () => {
  it("all named sections have an icon in their title row", async () => {
    await renderSettings();
    const sectionNames = ["ROM Libraries", "Language", "Appearance", "Privacy", "IGDB", "SteamGridDB", "DAT File"];
    for (const name of sectionNames) {
      const heading = screen.getAllByRole("heading", { level: 2 }).find((h) => h.textContent?.includes(name));
      expect(heading, `heading for "${name}" should exist`).toBeTruthy();
      const container = heading!.parentElement;
      expect(container?.querySelector("svg"), `icon missing for "${name}"`).toBeTruthy();
    }
  });
});

describe("ROM Libraries", () => {
  it("shows Add folder button when no roots set", async () => {
    await renderSettings();
    expect(screen.getByText("Add folder")).toBeInTheDocument();
  });

  it("displays existing roots", async () => {
    await renderSettings({ rom_roots: ["/Users/test/ROMs"] });
    expect(screen.getByText("/Users/test/ROMs")).toBeInTheDocument();
  });

  it("adds a folder when the picker returns a path", async () => {
    await renderSettings();
    mockOpen.mockResolvedValue("/Users/test/No-Intro");
    fireEvent.click(screen.getByText("Add folder"));
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ rom_roots: ["/Users/test/No-Intro"] }),
      );
    });
  });

  it("shows section-level cloud error for cloud paths already in roots", async () => {
    await renderSettings({ rom_roots: ["/Users/test/Library/CloudStorage/OneDrive-Personal/ROMs"] });
    expect(screen.getByText(/Cloud storage paths are not supported/)).toBeInTheDocument();
  });

  it("blocks adding a cloud path and shows an error", async () => {
    await renderSettings();
    mockOpen.mockResolvedValue("/Users/test/Library/CloudStorage/OneDrive-Personal/ROMs");
    fireEvent.click(screen.getByText("Add folder"));
    await waitFor(() => {
      expect(screen.getByText(/Cloud storage paths cannot be used/)).toBeInTheDocument();
    });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe("Language section", () => {
  it("deselects a language chip when already selected", async () => {
    // Use En+Ja so removing En doesn't hit the empty-list guard
    await renderSettings({ preferences: { preferred_languages: ["En", "Ja"], preferred_regions: ["USA", "World", "Europe"], short_console_names: false } });
    fireEvent.click(screen.getByText("En"));
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ preferred_languages: ["Ja"] }),
        }),
      );
    });
  });

  it("selects a language chip when not selected", async () => {
    await renderSettings();
    fireEvent.click(screen.getByText("Ja"));
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            preferred_languages: expect.arrayContaining(["En", "Ja"]),
          }),
        }),
      );
    });
  });
});

describe("Region section", () => {
  it("removes a region when its × button is clicked", async () => {
    await renderSettings();
    const usaRow = screen.getByText("USA").closest("div");
    const removeBtn = usaRow?.querySelector("button:last-child");
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn!);
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            preferred_regions: expect.not.arrayContaining(["USA"]),
          }),
        }),
      );
    });
  });

  it("adds a region via the + chip", async () => {
    await renderSettings();
    fireEvent.click(screen.getByText(/Germany/));
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            preferred_regions: expect.arrayContaining(["Germany"]),
          }),
        }),
      );
    });
  });
});

describe("Appearance section", () => {
  it("saves light theme when dark mode switch is toggled off", async () => {
    await renderSettings({ theme: "dark" });
    const label = screen.getByText("Dark mode");
    const row = label.closest("div[class*='flex items-center justify-between']");
    const sw = row?.querySelector('[role="switch"]');
    expect(sw).toBeTruthy();
    fireEvent.click(sw!);
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    });
  });
});

describe("Privacy section", () => {
  it("saves crash_reporting_enabled=true when switch is toggled on", async () => {
    await renderSettings({ crash_reporting_enabled: false });
    const label = screen.getByText("Crash reporting");
    const row = label.closest("div[class*='flex items-center justify-between']");
    const sw = row?.querySelector('[role="switch"]');
    expect(sw).toBeTruthy();
    fireEvent.click(sw!);
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ crash_reporting_enabled: true }));
    });
  });
});

describe("Saved badge", () => {
  it("shows Saved ✓ after a save action", async () => {
    await renderSettings();
    fireEvent.click(screen.getByText("Ja"));
    await waitFor(() => {
      expect(screen.getByText("Saved ✓")).toBeInTheDocument();
    });
  });
});
