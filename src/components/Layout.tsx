import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUIStore } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import { getConsoles, onScanProgress, onNewRom } from "@/lib/tauri";
import { isTauri } from "@/lib/env";
import Dashboard from "@/pages/Dashboard";
import Consoles from "@/pages/Consoles";
import Games from "@/pages/Games";
import HacksUnofficial from "@/pages/HacksUnofficial";
import SystemFiles from "@/pages/SystemFiles";
import Duplicates from "@/pages/Duplicates";
import Prune from "@/pages/Prune";
import History from "@/pages/History";
import Settings from "@/pages/Settings";

const PAGES: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  consoles: Consoles,
  games: Games,
  hacks: HacksUnofficial,
  system: SystemFiles,
  duplicates: Duplicates,
  prune: Prune,
  history: History,
  settings: Settings,
};

export function Layout() {
  const { activeTab } = useUIStore();
  const { setConsoles, setProgress, setStatus } = useScanStore();

  // Load consoles on mount and subscribe to scan/watcher events
  useEffect(() => {
    if (!isTauri()) return;
    getConsoles().then(setConsoles).catch(console.error);

    let unlistenScan: (() => void) | null = null;
    let unlistenWatcher: (() => void) | null = null;

    if (!isTauri()) return;
    onScanProgress((p) => {
      setProgress(p);
      setStatus({ scanning: true, scanned: p.scanned, total_estimate: p.total, current_console: p.console, cached: false });
    }).then((fn) => { unlistenScan = fn; });

    onNewRom(() => {
      // Refresh console list when new ROM detected by watcher
      getConsoles().then(setConsoles).catch(console.error);
    }).then((fn) => { unlistenWatcher = fn; });

    return () => {
      unlistenScan?.();
      unlistenWatcher?.();
    };
  }, [setConsoles, setProgress, setStatus]);

  const PageComponent = PAGES[activeTab] ?? Dashboard;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <ErrorBoundary>
          <PageComponent />
        </ErrorBoundary>
      </main>
    </div>
  );
}
