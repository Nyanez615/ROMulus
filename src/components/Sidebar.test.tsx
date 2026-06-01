import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConsole(name: string, total_files = 10): ConsoleStats {
  return { name, total_files, preferred_count: total_files, marked_for_deletion: 0, bytes_to_free: 0, total_bytes: 0 };
}

const GBA_CONSOLES: ConsoleStats[] = [
  makeConsole("Nintendo - Game Boy Advance", 100),
  makeConsole("Nintendo - Game Boy Advance (Multiboot)", 5),
  makeConsole("Nintendo - Game Boy Advance (Video)", 3),
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
  it("Duplicates appears between Hacks & Unofficial and System Files", () => {
    render(<Sidebar />);
    const allButtons = screen.getAllByRole("button");
    const labels = allButtons.map((b) => b.textContent?.trim() ?? "");
    const hacksIdx = labels.findIndex((t) => t.includes("Hacks"));
    const dupsIdx = labels.findIndex((t) => t === "Duplicates");
    const sysIdx = labels.findIndex((t) => t.includes("System Files"));
    expect(hacksIdx).toBeGreaterThanOrEqual(0);
    expect(dupsIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(hacksIdx).toBeLessThan(dupsIdx);
    expect(dupsIdx).toBeLessThan(sysIdx);
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

  it("shows ROM count as sum of all variants (100+5+3=108)", () => {
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
