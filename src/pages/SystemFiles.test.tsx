import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import SystemFiles from "./SystemFiles";
import { useScanStore } from "@/store/scan";
import type { PagedGroups } from "@/lib/bindings/PagedGroups";
import type { RomFile } from "@/lib/bindings/RomFile";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetSystemFiles = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getSystemFiles: (params: import("@/lib/tauri").GetGamesParams) => mockGetSystemFiles(params),
  formatBytes: (b: number) => `${b} B`,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(filename: string, category: string, consoleName: string): RomFile {
  return {
    path: `/roms/${filename}`, filename, console: consoleName,
    title: filename, title_normalized: filename.toLowerCase(),
    regions: [], languages: [], status_flags: [], extra_tags: [],
    bad_dump: false, revision: 0, disc_number: null, version: null,
    is_bios: category === "bios",
    file_format: "zip",
    file_category: category as RomFile["file_category"],
    filesize: 512,
    matches_preferred_language: true,
    matches_preferred_region: true,
    is_unofficial_preferred_fallback: false,
  };
}

function pagedGroups(files: RomFile[]): PagedGroups {
  return {
    total_groups: files.length,
    page: 1,
    per_page: 500,
    groups: files.map((f) => ({
      title_normalized: f.title_normalized,
      console: f.console,
      variants: [f],
      preferred_idx: 0,
      has_preferred_version: true,
      is_format_pair: false,
      disc_count: 1,
    })),
  };
}

const GBA_FILES: RomFile[] = [
  makeFile("GBA BIOS.bin", "bios", "Nintendo - Game Boy Advance"),
  makeFile("Card e-Reader.bin", "e_reader", "Nintendo - Game Boy Advance"),
];

const MIXED_FILES: RomFile[] = [
  makeFile("BIOS.bin", "bios", "Nintendo - NES"),
  makeFile("Utility.zip", "utility", "Nintendo - NES"),
];

beforeEach(() => {
  useScanStore.setState({
    consoles: [],
    selectedConsoles: null,
    status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false },
    progress: null,
  });
  mockGetSystemFiles.mockReset();
});

// ── Group D tests ─────────────────────────────────────────────────────────────

describe("SystemFiles (Group D)", () => {
  it("calls getSystemFiles with selectedConsoles array when GBA is selected", async () => {
    const selectedConsoles = ["Nintendo - Game Boy Advance", "Nintendo - Game Boy Advance (Multiboot)"];
    useScanStore.setState({ selectedConsoles });
    mockGetSystemFiles.mockResolvedValue(pagedGroups(GBA_FILES));

    render(<SystemFiles />);

    await waitFor(() => {
      expect(mockGetSystemFiles).toHaveBeenCalledWith(
        expect.objectContaining({ consoles: selectedConsoles }),
      );
    });
  });

  it("calls getSystemFiles with null consoles when no console is selected", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups([]));

    render(<SystemFiles />);

    await waitFor(() => {
      expect(mockGetSystemFiles).toHaveBeenCalledWith(
        expect.objectContaining({ consoles: undefined }),
      );
    });
  });

  it("search bar filters visible files by filename", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups(MIXED_FILES));

    render(<SystemFiles />);
    await waitFor(() => expect(screen.getByText("BIOS.bin")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Search files…"), {
      target: { value: "Utility" },
    });

    expect(screen.queryByText("BIOS.bin")).toBeNull();
    expect(screen.getByText("Utility.zip")).toBeInTheDocument();
  });

  it("category chips filter to the selected category", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups(MIXED_FILES));

    render(<SystemFiles />);
    await waitFor(() => expect(screen.getByText("BIOS.bin")).toBeInTheDocument());

    // Click the "Utilities" chip (it's a button in the toolbar)
    const chips = screen.getAllByRole("button").filter((b) => b.textContent === "Utilities");
    fireEvent.click(chips[0]);

    expect(screen.queryByText("BIOS.bin")).toBeNull();
    expect(screen.getByText("Utility.zip")).toBeInTheDocument();
  });

  it("title shows plain 'System Files' when no console is selected", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups([]));
    render(<SystemFiles />);
    await waitFor(() => {
      expect(screen.getByRole("heading")).toHaveTextContent("System Files");
      expect(screen.getByRole("heading").textContent).not.toContain("—");
    });
  });
});
