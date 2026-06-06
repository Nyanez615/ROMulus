import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConsole(name: string, total_files = 10): ConsoleStats {
  return { name, total_files, total_groups: total_files, game_files: total_files, game_groups: total_files, preferred_groups: total_files, all_groups: total_files, unofficial_files: 0, preferred_count: total_files, preferred_explicit_count: 0, preferred_inferred_count: 0, marked_for_deletion: 0, bytes_to_free: 0, total_bytes: 0 };
}

// Backend computes canonical-level total_groups for all sub-folders of the same
// canonical (union of titles across Multiboot + Video + base = 108 unique titles).
const GBA_CANONICAL_COUNT = 108;
const GBA_CONSOLES: ConsoleStats[] = [
  { ...makeConsole("Nintendo - Game Boy Advance", 100), total_groups: GBA_CANONICAL_COUNT, game_groups: GBA_CANONICAL_COUNT, all_groups: GBA_CANONICAL_COUNT, preferred_groups: GBA_CANONICAL_COUNT },
  { ...makeConsole("Nintendo - Game Boy Advance (Multiboot)", 5), total_groups: GBA_CANONICAL_COUNT, game_groups: GBA_CANONICAL_COUNT, all_groups: GBA_CANONICAL_COUNT, preferred_groups: GBA_CANONICAL_COUNT },
  { ...makeConsole("Nintendo - Game Boy Advance (Video)", 3), total_groups: GBA_CANONICAL_COUNT, game_groups: GBA_CANONICAL_COUNT, all_groups: GBA_CANONICAL_COUNT, preferred_groups: GBA_CANONICAL_COUNT },
];

// Reset stores before each test
beforeEach(() => {
  useScanStore.setState({
    consoles: [],
    selectedConsoles: null,
    status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false },
    progress: null,
  });
  useUIStore.setState({ activeTab: "roms", sidebarOpen: true });
});

// ── NAV_ITEMS order ───────────────────────────────────────────────────────────

describe("Sidebar NAV_ITEMS order", () => {
  it("ROMs appears before System Files; no Hacks or Duplicates tab", () => {
    render(<Sidebar />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent?.trim() ?? "");
    const romsIdx = labels.findIndex((t) => t === "ROMs");
    const sysIdx  = labels.findIndex((t) => t.includes("System Files"));
    expect(romsIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(romsIdx).toBeLessThan(sysIdx);
    expect(labels.findIndex((t) => t.includes("Hacks"))).toBe(-1);
    expect(labels.findIndex((t) => t === "Duplicates")).toBe(-1);
  });
});

// ── Console deduplication ─────────────────────────────────────────────────────

describe("Sidebar console deduplication", () => {
  it("shows one row for 'Game Boy Advance' even with multiple variants", () => {
    useScanStore.setState({ consoles: GBA_CONSOLES });
    render(<Sidebar />);
    // The canonical row button now has title = canonical short name (C1 fix)
    const gbaRow = screen.getByTitle("Game Boy Advance");
    expect(gbaRow).toBeInTheDocument();
    // Only one button with that title
    expect(screen.getAllByTitle("Game Boy Advance")).toHaveLength(1);
  });

  it("shows canonical title count (108) for GBA row — shared across all sub-folders", () => {
    useScanStore.setState({ consoles: GBA_CONSOLES });
    render(<Sidebar />);
    const gbaRow = screen.getByTitle("Game Boy Advance");
    expect(within(gbaRow).getByText("108")).toBeInTheDocument();
  });

  it("click on canonical row sets selectedConsoles to all variant names", () => {
    useScanStore.setState({ consoles: GBA_CONSOLES });
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("Game Boy Advance"));
    const { selectedConsoles } = useScanStore.getState();
    expect(selectedConsoles).toContain("Nintendo - Game Boy Advance");
    expect(selectedConsoles).toContain("Nintendo - Game Boy Advance (Multiboot)");
    expect(selectedConsoles).toContain("Nintendo - Game Boy Advance (Video)");
    expect(selectedConsoles).toHaveLength(3);
  });
});

// ── All ROMs button ───────────────────────────────────────────────────────────

describe("All ROMs button", () => {
  it("sets selectedConsoles to null", () => {
    useScanStore.setState({
      consoles: GBA_CONSOLES,
      selectedConsoles: ["Nintendo - Game Boy Advance"],
    });
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("Show ROMs from all consoles"));
    expect(useScanStore.getState().selectedConsoles).toBeNull();
  });

  it("stays on current console-aware tab when clicked", () => {
    useUIStore.setState({ activeTab: "history", sidebarOpen: true });
    useScanStore.setState({
      consoles: GBA_CONSOLES,
      selectedConsoles: ["Nintendo - Game Boy Advance"],
    });
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("Show ROMs from all consoles"));
    expect(useUIStore.getState().activeTab).toBe("history");
  });

  it("navigates to ROMs when on a non-console-aware tab (e.g. dashboard)", () => {
    useUIStore.setState({ activeTab: "dashboard", sidebarOpen: true });
    useScanStore.setState({ consoles: GBA_CONSOLES, selectedConsoles: null });
    render(<Sidebar />);
    fireEvent.click(screen.getByTitle("Show ROMs from all consoles"));
    expect(useUIStore.getState().activeTab).toBe("roms");
  });
});
