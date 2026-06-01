import { create } from "zustand";

export type TabId =
  | "dashboard"
  | "roms"
  | "hacks"
  | "system"
  | "duplicates"
  | "prune"
  | "history"
  | "settings";

interface UIStore {
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
  onedriveAcknowledged: boolean;
  setOnedriveAcknowledged: (v: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeTab: "dashboard",
  setActiveTab: (activeTab) => set({ activeTab }),
  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  theme: "dark",
  setTheme: (theme) => {
    document.documentElement.classList.toggle("light", theme === "light");
    set({ theme });
  },
  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  onedriveAcknowledged: false,
  setOnedriveAcknowledged: (onedriveAcknowledged) => set({ onedriveAcknowledged }),
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
