import { useEffect } from "react";
import { useUIStore } from "@/store/ui";

/**
 * App-wide keyboard shortcuts. Mount once in Layout.tsx.
 *
 * ⌘K / Ctrl+K — open command palette
 * ⌘F / Ctrl+F — focus search bar
 * Escape       — close command palette / clear search
 * ⌘1–⌘9       — jump to tab by number
 * ⌘Z           — (reserved for undo — wired in Phase 5+)
 */
const TABS = [
  "dashboard", "roms",
  "system", "duplicates", "history", "settings",
] as const;

export function useKeyboardShortcuts() {
  const { setCommandPaletteOpen, setActiveTab, setSearchQuery, commandPaletteOpen } = useUIStore();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // ⌘K — command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // ⌘F — focus search (handled in page; emit a custom event pages listen to)
      if (mod && e.key === "f") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("romulus:focus-search"));
        return;
      }

      // Escape — close palette or clear search
      if (e.key === "Escape") {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          setSearchQuery("");
          window.dispatchEvent(new CustomEvent("romulus:clear-search"));
        }
        return;
      }

      // ⌘1–⌘9 — jump to tab
      if (mod && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (TABS[idx]) {
          e.preventDefault();
          setActiveTab(TABS[idx] as Parameters<typeof setActiveTab>[0]);
        }
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setActiveTab, setCommandPaletteOpen, setSearchQuery]);
}
