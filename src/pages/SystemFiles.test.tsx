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
  applyFilters: vi.fn(() => Promise.resolve({ to_delete: [], to_keep: [], no_preferred_version_count: 0 })),
  executePrune: vi.fn(() => Promise.resolve({ success_count: 0, failed: [] })),
  scanRoots: vi.fn(() => Promise.resolve({ scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false })),
  getSettings: vi.fn(() => Promise.resolve({ rom_roots: [], theme: "dark", permanent_delete: false })),
  getConsoles: vi.fn(() => Promise.resolve([])),
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
  makeFile("Video.bin", "video", "Nintendo - NES"),
];

const DEMO_FILES: RomFile[] = [
  makeFile("Pocket Monsters (Japan) (Demo).zip", "demo", "Nintendo - Game Boy"),
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
      target: { value: "Video" },
    });

    expect(screen.queryByText("BIOS.bin")).toBeNull();
    expect(screen.getByText("Video.bin")).toBeInTheDocument();
  });

  it("category chips filter to the selected category", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups(MIXED_FILES));

    render(<SystemFiles />);
    await waitFor(() => expect(screen.getByText("BIOS.bin")).toBeInTheDocument());

    // Click the "Video" chip (it's a button in the toolbar)
    const chips = screen.getAllByRole("button").filter((b) => b.textContent === "Video");
    fireEvent.click(chips[0]);

    expect(screen.queryByText("BIOS.bin")).toBeNull();
    expect(screen.getByText("Video.bin")).toBeInTheDocument();
  });

  it("demo files are not rendered in System Files (moved to ROMs tab)", async () => {
    useScanStore.setState({ selectedConsoles: null });
    mockGetSystemFiles.mockResolvedValue(pagedGroups(DEMO_FILES));

    render(<SystemFiles />);

    // The component receives demo files from the server but must not render
    // a "Demos" section — that category was removed from ALL_CATEGORIES.
    await waitFor(() => {
      expect(mockGetSystemFiles).toHaveBeenCalled();
    });
    expect(screen.queryByText("Demos")).toBeNull();
    expect(screen.queryByText("Pocket Monsters (Japan) (Demo).zip")).toBeNull();
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
