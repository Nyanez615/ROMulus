import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Duplicates from "./Duplicates";
import { useScanStore } from "@/store/scan";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetDuplicates = vi.fn((_consoles?: string[]) => Promise.resolve([] as RomGroup[]));

vi.mock("@/lib/tauri", () => ({
  getDuplicates: (consoles?: string[]) => mockGetDuplicates(consoles),
  formatBytes: (b: number) => `${b} B`,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGroup(title: string, console_name: string): RomGroup {
  const variant = (name: string): RomFile => ({
    path: `/roms/${name}`, filename: name, console: console_name,
    title, title_normalized: title.toLowerCase(),
    regions: ["USA"], languages: [], status_flags: [], extra_tags: [],
    bad_dump: false, revision: 0, disc_number: null, version: null,
    is_bios: false, file_format: "zip", file_category: "game",
    filesize: 1024, matches_preferred_language: true,
    matches_preferred_region: true,
  });
  return {
    title_normalized: title.toLowerCase(),
    console: console_name,
    variants: [variant(`${title} (USA).zip`), variant(`${title} (Europe).zip`)],
    preferred_idx: 0,
    has_preferred_version: true,
    is_format_pair: false,
    disc_count: 1,
  };
}

beforeEach(() => {
  useScanStore.setState({
    consoles: [],
    selectedConsoles: null,
    status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false },
    progress: null,
  });
  mockGetDuplicates.mockReset();
});

// ── Group B tests ─────────────────────────────────────────────────────────────

describe("Duplicates (Group B)", () => {
  it("shows skeleton rows while isLoading is true", () => {
    mockGetDuplicates.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Duplicates />);
    // Skeleton rows are rendered via animate-pulse divs
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state only after loading completes and groups is empty", async () => {
    mockGetDuplicates.mockResolvedValue([]);
    render(<Duplicates />);
    // Should not show empty state while loading
    expect(screen.queryByText(/No duplicates found/)).toBeNull();
    // Wait for load to complete
    await waitFor(() => {
      expect(screen.getByText(/No duplicates found/)).toBeInTheDocument();
    });
  });

  it("shows groups when data arrives", async () => {
    const groups = [makeGroup("Castlevania", "Nintendo - NES")];
    mockGetDuplicates.mockResolvedValue(groups);
    render(<Duplicates />);
    await waitFor(() => {
      expect(screen.getByText("Castlevania")).toBeInTheDocument();
    });
  });

  it("title shows plain 'Duplicates' when no console is selected", async () => {
    mockGetDuplicates.mockResolvedValue([]);
    useScanStore.setState({ selectedConsoles: null });
    render(<Duplicates />);
    await waitFor(() => {
      expect(screen.getByRole("heading")).toHaveTextContent("Duplicates");
      expect(screen.getByRole("heading").textContent).not.toContain("—");
    });
  });

  it("title shows console-scoped format when selectedConsoles is set", async () => {
    mockGetDuplicates.mockResolvedValue([]);
    useScanStore.setState({ selectedConsoles: ["Nintendo - Game Boy Advance"] });
    render(<Duplicates />);
    await waitFor(() => {
      const heading = screen.getByRole("heading");
      expect(heading).toHaveTextContent("Nintendo");
      expect(heading).toHaveTextContent("Game Boy Advance");
      expect(heading).toHaveTextContent("Duplicates");
    });
  });
});
