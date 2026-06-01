import { create } from "zustand";

interface TagStore {
  region: string[];
  status: string[];
  language: string[];
  category: string[];
  file_category: string[];
  setRegion: (v: string[]) => void;
  setStatus: (v: string[]) => void;
  setLanguage: (v: string[]) => void;
  setCategory: (v: string[]) => void;
  setFileCategory: (v: string[]) => void;
}

export const useTagStore = create<TagStore>((set) => ({
  region: [],
  status: [],
  language: [],
  category: [],
  file_category: [],
  setRegion: (region) => set({ region }),
  setStatus: (status) => set({ status }),
  setLanguage: (language) => set({ language }),
  setCategory: (category) => set({ category }),
  setFileCategory: (file_category) => set({ file_category }),
}));
