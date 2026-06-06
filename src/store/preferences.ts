import { create } from "zustand";
import type { UserPreferences } from "@/lib/bindings/UserPreferences";

interface PreferencesStore {
  preferences: UserPreferences;
  setPreferences: (p: UserPreferences) => void;
  isConfigured: boolean;
  setConfigured: (v: boolean) => void;
}

export const usePreferencesStore = create<PreferencesStore>((set) => ({
  preferences: { preferred_languages: [], preferred_regions: [], short_console_names: false },
  isConfigured: false,
  setPreferences: (preferences) => set({ preferences }),
  setConfigured: (isConfigured) => set({ isConfigured }),
}));
