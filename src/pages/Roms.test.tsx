import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Roms from "./Roms";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import type { PagedGroups } from "@/lib/bindings/PagedGroups";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetRoms = vi.fn();
const mockGetThumbnail = vi.fn(() => Promise.resolve(null));

vi.mock("@/lib/tauri", () => ({
  getRoms: (p: unknown) => mockGetRoms(p),
  getThumbnail: () => mockGetThumbnail(),
  formatBytes: (b: number) => `${b} B`,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
// Virtualizer renders nothing in jsdom; stub it out so tests see the count label
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({ getVirtualItems: () => [], getTotalSize: () => 0, measureElement: () => {} }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRom(title: string, regions: string[], statusFlags: string[] = [], langs: string[] = []): RomFile {
  return {
    path: `/roms/${title}.zip`, filename: `${title}.zip`,
    console: "Test", title, title_normalized: title.toLowerCase(),
    regions, languages: langs, status_flags: statusFlags, extra_tags: [],
    bad_dump: false, revision: 0, disc_number: null, version: null,
    is_bios: false, file_format: "zip", file_category: "game",
    filesize: 1024, matches_preferred_language: true,
    matches_preferred_region: true, is_unofficial_preferred_fallback: false,
  };
}

function makeGroup(title: string, variants: RomFile[]): RomGroup {
  return {
    title_normalized: title.toLowerCase(), console: "Test",
    variants, preferred_idx: 0, has_preferred_version: true,
    is_format_pair: false, disc_count: 1,
  };
}

function paged(groups: RomGroup[]): PagedGroups {
  return { total_groups: groups.length, page: 1, per_page: 9999, groups };
}

// Zelda has 2 variants (USA + Japan); Castlevania has Europe+USA; Metroid has Japan + Beta flag
const GROUPS: RomGroup[] = [
  makeGroup("Zelda",       [makeRom("Zelda",     ["USA"]),           makeRom("Zelda (Japan)", ["Japan"])]),
  makeGroup("Castlevania", [makeRom("Castlevania", ["Europe", "USA"])]),
  makeGroup("Metroid",     [makeRom("Metroid",   ["Japan"], ["Beta"])]),
];

function countText(): string {
  return screen.getByText(/\d+ titles/).textContent ?? "";
}

beforeEach(() => {
  useScanStore.setState({ consoles: [], selectedConsoles: null,
    status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false }, progress: null });
  useTagStore.setState({ region: ["USA", "Japan", "Europe"], status: ["Beta"], language: [],
    category: [], file_category: [] });
  mockGetRoms.mockReset();
  mockGetRoms.mockResolvedValue(paged(GROUPS));
});

// ── Sort tests ────────────────────────────────────────────────────────────────

describe("ROMs sort", () => {
  it("A–Z: total count is unchanged after sort change", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "az" } });
    expect(screen.getByText("3 titles")).toBeInTheDocument();
  });

  it("Z–A: total count is unchanged", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "za" } });
    expect(screen.getByText("3 titles")).toBeInTheDocument();
  });

  it("variant count sort: total count is unchanged", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "variants" } });
    expect(screen.getByText("3 titles")).toBeInTheDocument();
  });
});

// ── Filter tests ──────────────────────────────────────────────────────────────

describe("ROMs region filter (ANY within type)", () => {
  it("USA chip shows only groups with a USA variant (2 of 3)", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    await waitFor(() => screen.getByText("USA"));
    fireEvent.click(screen.getByText("USA"));
    // Zelda (USA) and Castlevania (Europe+USA) match; Metroid (Japan) doesn't
    await waitFor(() => expect(countText()).toBe("2 titles"));
  });

  it("USA+Japan chips show all 3 groups (ANY logic)", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    await waitFor(() => screen.getByText("USA"));
    fireEvent.click(screen.getByText("USA"));
    await waitFor(() => expect(countText()).toBe("2 titles"));
    fireEvent.click(screen.getByText("Japan"));
    // Now Metroid (Japan) also matches → 3 titles
    await waitFor(() => expect(countText()).toBe("3 titles"));
  });

  it("region AND status chips use AND logic (0 groups match USA ∧ Beta)", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    // Select USA from Region panel
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    await waitFor(() => screen.getByText("USA"));
    fireEvent.click(screen.getByText("USA"));
    await waitFor(() => expect(countText()).toBe("2 titles"));
    // Switch to Category panel and select Beta
    fireEvent.click(screen.getByRole("button", { name: /Category/i }));
    await waitFor(() => screen.getByText("Beta"));
    fireEvent.click(screen.getByText("Beta")); // Only Metroid has Beta, but Metroid has no USA variant
    await waitFor(() => expect(countText()).toBe("0 titles"));
  });
});

describe("ROMs chip population from useTagStore", () => {
  it("renders region chips from the tag store", async () => {
    render(<Roms />);
    await waitFor(() => expect(screen.getByText("3 titles")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Region/i }));
    await waitFor(() => {
      expect(screen.getByText("USA")).toBeInTheDocument();
      expect(screen.getByText("Japan")).toBeInTheDocument();
      expect(screen.getByText("Europe")).toBeInTheDocument();
    });
  });
});
