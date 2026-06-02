import { create } from "zustand";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";
import type { ScanStatus } from "@/lib/bindings/ScanStatus";
import type { ScanProgress } from "@/lib/bindings/ScanProgress";

interface ScanStore {
  status: ScanStatus;
  consoles: ConsoleStats[];
  progress: ScanProgress | null;
  setStatus: (s: ScanStatus) => void;
  setConsoles: (c: ConsoleStats[]) => void;
  setProgress: (p: ScanProgress | null) => void;
  selectedConsoles: string[] | null;
  setSelectedConsoles: (c: string[] | null) => void;
  cacheVersion: number;
  bumpCacheVersion: () => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  status: { scanning: false, scanned: 0, total_estimate: 0, current_console: null, cached: false },
  consoles: [],
  progress: null,
  selectedConsoles: null,
  cacheVersion: 0,
  setStatus: (status) => set({ status }),
  setConsoles: (consoles) => set({ consoles }),
  setProgress: (progress) => set({ progress }),
  setSelectedConsoles: (selectedConsoles) => set({ selectedConsoles }),
  bumpCacheVersion: () => set((s) => ({ cacheVersion: s.cacheVersion + 1 })),
}));
