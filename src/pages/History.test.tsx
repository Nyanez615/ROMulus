import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import History from "./History";
import { useScanStore } from "@/store/scan";
import type { PagedHistory } from "@/lib/bindings/PagedHistory";
import type { HistoryFilter } from "@/lib/bindings/HistoryFilter";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetHistory = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getHistory: (consoles: string[] | null, filter: HistoryFilter | null, page: number, perPage: number) =>
    mockGetHistory(consoles, filter, page, perPage),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyHistory(): PagedHistory {
  return { total: 0, page: 1, per_page: 50, entries: [] };
}

beforeEach(() => {
  useScanStore.setState({
    consoles: [], selectedConsoles: null,
    status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false },
    progress: null,
  });
  mockGetHistory.mockReset();
  mockGetHistory.mockResolvedValue(emptyHistory());
});

describe("History (Group E)", () => {
  it("calls getHistory with no filter when no chips active", async () => {
    render(<History />);
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(null, null, 1, 50),
    );
  });

  it("Deleted chip sends moved_to_trash + deleted actions", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Deleted"));
    fireEvent.click(screen.getByText("Deleted"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ actions: expect.arrayContaining(["moved_to_trash", "deleted"]) }),
        1,
        50,
      ),
    );
  });

  it("Kept chip sends kept actions", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Kept"));
    fireEvent.click(screen.getByText("Kept"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ actions: ["kept"] }),
        1,
        50,
      ),
    );
  });

  it("Skipped chip sends skipped actions", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Skipped"));
    fireEvent.click(screen.getByText("Skipped"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ actions: ["skipped"] }),
        1,
        50,
      ),
    );
  });

  it("Deferred chip sends deferred + pending actions", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Deferred"));
    fireEvent.click(screen.getByText("Deferred"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ actions: expect.arrayContaining(["deferred", "pending"]) }),
        1,
        50,
      ),
    );
  });

  it("Today date filter sends since_days=1", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Today"));
    fireEvent.click(screen.getByText("Today"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ since_days: 1 }),
        1,
        50,
      ),
    );
  });

  it("Last 7 days filter sends since_days=7", async () => {
    render(<History />);
    await waitFor(() => screen.getByText("Last 7 days"));
    fireEvent.click(screen.getByText("Last 7 days"));
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ since_days: 7 }),
        1,
        50,
      ),
    );
  });

  it("console filter scopes to selectedConsoles", async () => {
    useScanStore.setState({ selectedConsoles: ["Nintendo - GBA", "Nintendo - GBA (Multiboot)"] });
    render(<History />);
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(
        ["Nintendo - GBA", "Nintendo - GBA (Multiboot)"],
        null,
        1,
        50,
      ),
    );
  });

  it("no console selected passes null consoles to backend", async () => {
    render(<History />);
    await waitFor(() =>
      expect(mockGetHistory).toHaveBeenCalledWith(null, null, 1, 50),
    );
  });
});
