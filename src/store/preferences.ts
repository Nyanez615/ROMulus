import { create } from "zustand";
import type { UserPreferences } from "@/lib/bindings/UserPreferences";
import type { FilterSettings } from "@/lib/bindings/FilterSettings";

interface PreferencesStore {
  preferences: UserPreferences;
  filterSettings: FilterSettings;
  setPreferences: (p: UserPreferences) => void;
  setFilterSettings: (f: FilterSettings) => void;
  isConfigured: boolean;
  setConfigured: (v: boolean) => void;
}

const defaultFilter: FilterSettings = {
  keep_preferred_only: true,
  remove_if_no_preferred_version: true,
  remove_prerelease: true,
  remove_unofficial: false,
  remove_older_revisions: true,
  keep_unofficial_as_fallback: true,
};

export const usePreferencesStore = create<PreferencesStore>((set) => ({
  preferences: { preferred_languages: [], preferred_regions: [], short_console_names: false },
  filterSettings: defaultFilter,
  isConfigured: false,
  setPreferences: (preferences) => set({ preferences }),
  setFilterSettings: (filterSettings) => set({ filterSettings }),
  setConfigured: (isConfigured) => set({ isConfigured }),
}));
