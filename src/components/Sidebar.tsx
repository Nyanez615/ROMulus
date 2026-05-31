import {
  LayoutDashboard, Server, Gamepad2, Skull, Cpu,
  CopyX, Scissors, History, Settings, PanelLeftClose, PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConsoleIcon, getConsoleColor } from "./ConsoleIcon";
import { useUIStore, type TabId } from "@/store/ui";
import { useScanStore } from "@/store/scan";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard",  label: "Dashboard",     icon: LayoutDashboard },
  { id: "consoles",   label: "Consoles",       icon: Server          },
  { id: "games",      label: "Games",          icon: Gamepad2        },
  { id: "hacks",      label: "Hacks & Unofficial", icon: Skull       },
  { id: "system",     label: "System Files",   icon: Cpu             },
  { id: "duplicates", label: "Duplicates",     icon: CopyX           },
  { id: "prune",      label: "Prune",          icon: Scissors        },
  { id: "history",    label: "History",        icon: History         },
  { id: "settings",   label: "Settings",       icon: Settings        },
];

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useUIStore();
  const { consoles, selectedConsole, setSelectedConsole, status } = useScanStore();

  // ── Collapsed icon rail ───────────────────────────────────────────────────
  if (!sidebarOpen) {
    return (
      <aside className="flex flex-col w-10 shrink-0 border-r border-border bg-card overflow-hidden">
        {/* Expand button — same height as the open header */}
        <div className="flex items-center justify-center py-[18px] border-b border-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label="Show sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>
        {/* Nav icons */}
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="space-y-0.5 px-1">
            {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
              <li key={id}>
                <button
                  onClick={() => setActiveTab(id)}
                  title={label}
                  className={cn(
                    "w-full flex items-center justify-center p-2 rounded-md transition-colors",
                    activeTab === id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    );
  }

  // ── Full sidebar ──────────────────────────────────────────────────────────
  return (
    <aside className="flex flex-col w-56 shrink-0 border-r border-border bg-card overflow-hidden">
      {/* Header: ROMulus wordmark + collapse toggle */}
      <div className="flex items-center px-4 py-4 border-b border-border">
        <span className="font-bold text-lg tracking-tight text-foreground flex-1">ROMulus</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => setActiveTab(id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  activeTab === id
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            </li>
          ))}
        </ul>

        {/* Console list */}
        {consoles.length > 0 && (
          <div className="mt-4 px-2">
            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {status.scanning ? "Scanning…" : `${consoles.length} Consoles`}
            </div>
            <ul className="mt-1 space-y-0.5">
              {consoles.map((c) => (
                <li key={c.name}>
                  <button
                    onClick={() => {
                      setSelectedConsole(selectedConsole === c.name ? null : c.name);
                      setActiveTab("games");
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                      selectedConsole === c.name
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                    )}
                    style={selectedConsole === c.name ? { borderLeft: `2px solid ${getConsoleColor(c.name)}` } : undefined}
                  >
                    <ConsoleIcon consoleName={c.name} size="sm" />
                    <span className="flex-1 truncate text-left">
                      {c.name.split(" - ")[1] ?? c.name}
                    </span>
                    <span className="text-muted-foreground/60 tabular-nums">
                      {c.total_files.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* Scan stats footer */}
      {!status.scanning && status.scanned > 0 && (
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{status.scanned.toLocaleString()} ROMs</div>
          <div className="text-muted-foreground/70">across {consoles.length} consoles</div>
        </div>
      )}
      {status.scanning && (
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground animate-pulse">
          Scanning {status.current_console ?? "…"}
        </div>
      )}
    </aside>
  );
}
