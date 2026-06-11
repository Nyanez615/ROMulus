import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUIStore } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { getConsoles, onScanProgress, onNewRom, getKnownTags, onPreferencesRegrouped, onScanComplete } from "@/lib/tauri";
import { isTauri } from "@/lib/env";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { CommandPalette } from "./CommandPalette";
import Dashboard from "@/pages/Dashboard";
import Roms from "@/pages/Roms";
import SystemFiles from "@/pages/SystemFiles";
import Downloads from "@/pages/Downloads";
import History from "@/pages/History";
import Settings from "@/pages/Settings";

const PAGES: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  roms: Roms,
  system: SystemFiles,
  downloads: Downloads,
  history: History,
  settings: Settings,
};

/** Load all tag types from DB and populate the tag store. Called at startup and after scan. */
export function refreshTagStore() {
  const { setRegion, setStatus, setLanguage, setCategory, setFileCategory } = useTagStore.getState();
  getKnownTags("region").then(setRegion).catch(console.error);
  getKnownTags("status").then(setStatus).catch(console.error);
  getKnownTags("language").then(setLanguage).catch(console.error);
  getKnownTags("category").then(setCategory).catch(console.error);
  getKnownTags("file_category").then(setFileCategory).catch(console.error);
}

export function Layout() {
  const { activeTab } = useUIStore();
  const { setConsoles, setProgress, setStatus, bumpCacheVersion } = useScanStore();
  useKeyboardShortcuts();

  // Load consoles + tags on mount; subscribe to scan/watcher events
  useEffect(() => {
    if (!isTauri()) return;
    getConsoles().then(setConsoles).catch(console.error);
    refreshTagStore();

    let unlistenScan: (() => void) | null = null;
    let unlistenWatcher: (() => void) | null = null;
    let unlistenRegroup: (() => void) | null = null;
    let unlistenScanComplete: (() => void) | null = null;

    onScanProgress((p) => {
      setProgress(p);
      setStatus({ scanning: true, scanned: p.scanned, total_estimate: p.total, current_console: p.console, cached: false });
    }).then((fn) => { unlistenScan = fn; });

    onNewRom(() => {
      getConsoles().then(setConsoles).catch(console.error);
    }).then((fn) => { unlistenWatcher = fn; });

    onPreferencesRegrouped(() => {
      getConsoles().then(setConsoles).catch(console.error);
      bumpCacheVersion();
    }).then((fn) => { unlistenRegroup = fn; });

    onScanComplete((s) => {
      setStatus(s);
      getConsoles().then(setConsoles).catch(console.error);
      refreshTagStore();
      bumpCacheVersion();
    }).then((fn) => { unlistenScanComplete = fn; });

    return () => {
      unlistenScan?.();
      unlistenWatcher?.();
      unlistenRegroup?.();
      unlistenScanComplete?.();
    };
  }, [setConsoles, setProgress, setStatus, bumpCacheVersion]);

  const PageComponent = PAGES[activeTab] ?? Dashboard;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto [scrollbar-gutter:stable]">
        <ErrorBoundary>
          <PageComponent />
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}
