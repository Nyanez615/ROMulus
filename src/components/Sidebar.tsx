import { useState, useMemo } from "react";
import {
  LayoutDashboard, Gamepad2, Skull, Cpu,
  CopyX, Scissors, History, Settings, PanelLeftClose, PanelLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConsoleIcon } from "./ConsoleIcon";
import {
  getConsoleParts,
  getConsoleColor,
  getConsoleDisplayName,
  resolveConsoleVariants,
  canonicalTitleCount,
} from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";
import { useUIStore, type TabId } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard",  label: "Dashboard",          icon: LayoutDashboard },
  { id: "roms",       label: "ROMs",                icon: Gamepad2        },
  { id: "hacks",      label: "Hacks & Unofficial",  icon: Skull           },
  { id: "duplicates", label: "Duplicates",          icon: CopyX           },
  { id: "system",     label: "System Files",        icon: Cpu             },
  { id: "prune",      label: "Prune",               icon: Scissors        },
  { id: "history",    label: "History",             icon: History         },
  { id: "settings",   label: "Settings",            icon: Settings        },
];

const CONSOLE_AWARE_TABS: TabId[] = ["roms", "hacks", "system", "duplicates", "prune", "history"];

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useUIStore();
  const { consoles, selectedConsoles, setSelectedConsoles, status } = useScanStore();
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<string[]>([]);

  // A1c: Two-level deduplication — platform → canonical short name → variants[]
  const platformGroups = useMemo(() => {
    const map = new Map<string, Map<string, ConsoleStats[]>>();
    for (const c of consoles) {
      const { platform, canonical } = getConsoleParts(c.name);
      if (!map.has(platform)) map.set(platform, new Map());
      const canonMap = map.get(platform)!;
      const arr = canonMap.get(canonical) ?? [];
      arr.push(c);
      canonMap.set(canonical, arr);
    }
    return map;
  }, [consoles]);

  // Game-only title counts, accounting for alias sub-folders like N64DD that
  // have a different strip_format_suffix base from the main canonical variants.
  const allTitles = useMemo(() => {
    let total = 0;
    for (const canonicalMap of platformGroups.values())
      for (const variants of canonicalMap.values())
        total += canonicalTitleCount(variants);
    return total;
  }, [platformGroups]);

  function togglePlatform(platform: string) {
    setCollapsedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }

  function handleConsoleClick(canonical: string) {
    const variants = resolveConsoleVariants(canonical, consoles);
    const isAlreadySelected =
      selectedConsoles !== null &&
      variants.length === selectedConsoles.length &&
      variants.every((v) => selectedConsoles.includes(v));
    setSelectedConsoles(isAlreadySelected ? null : variants);
    if (!CONSOLE_AWARE_TABS.includes(activeTab)) setActiveTab("roms");
  }

  function handleAllRomsClick() {
    setSelectedConsoles(null);
    if (!CONSOLE_AWARE_TABS.includes(activeTab)) setActiveTab("roms");
  }

  function isCanonicalSelected(variants: ConsoleStats[]): boolean {
    if (!selectedConsoles) return false;
    return variants.some((v) => selectedConsoles.includes(v.name));
  }

  // ── Collapsed icon rail ───────────────────────────────────────────────────
  if (!sidebarOpen) {
    return (
      <aside className="flex flex-col w-10 shrink-0 border-r border-border bg-card overflow-hidden">
        <div className="flex items-center justify-center h-14 border-b border-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label="Show sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>
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
      <div className="flex items-center h-14 px-4 border-b border-border">
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

        {/* Platform groups + deduplicated console list */}
        {consoles.length > 0 && (
          <div className="mt-4 px-2">
            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {status.scanning ? "Scanning…" : `${platformGroups.size} Platform${platformGroups.size !== 1 ? "s" : ""}`}
            </div>

            {/* "All ROMs" — deselects console filter */}
            <ul className="mt-1 space-y-0.5">
              <li>
                <button
                  onClick={handleAllRomsClick}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                    selectedConsoles === null
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                  title="Show ROMs from all consoles"
                >
                  <span className="flex-1 text-left">All</span>
                  <span className="text-muted-foreground/60 tabular-nums">
                    {allTitles.toLocaleString()}
                  </span>
                </button>
              </li>
            </ul>

            {/* Per-platform collapsible groups */}
            {Array.from(platformGroups.entries()).map(([platform, canonicalMap]) => {
              const isCollapsed = collapsedPlatforms.includes(platform);
              // Sum canonical title counts; canonicalTitleCount handles N64DD-style aliases
              const platformTotal = Array.from(canonicalMap.values())
                .reduce((s, variants) => s + canonicalTitleCount(variants), 0);
              const platformColor = getConsoleColor(canonicalMap.values().next().value?.[0]?.name ?? "");

              return (
                <div key={platform} className="mt-2">
                  {/* Platform header */}
                  <button
                    onClick={() => togglePlatform(platform)}
                    className="w-full flex items-center gap-1.5 px-3 py-1 rounded-md hover:bg-muted/40 transition-colors"
                    title={`${platform} — ${canonicalMap.size} console${canonicalMap.size !== 1 ? "s" : ""}`}
                  >
                    <ChevronRight
                      className={cn(
                        "w-3 h-3 text-muted-foreground transition-transform shrink-0",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: platformColor }}>
                      {platform}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums shrink-0">
                      {platformTotal.toLocaleString()}
                    </span>
                  </button>

                  {/* Deduplicated console list under platform */}
                  {!isCollapsed && (
                    <ul className="mt-0.5 space-y-0.5 pl-2">
                      {Array.from(canonicalMap.entries()).map(([canonical, variants]) => {
                        const rowTotal = canonicalTitleCount(variants);
                        const selected = isCanonicalSelected(variants);
                        const representativeName = variants[0]?.name ?? "";
                        const accentColor = getConsoleColor(representativeName);
                        return (
                          <li key={canonical}>
                            <button
                              onClick={() => handleConsoleClick(canonical)}
                              title={canonical}
                              className={cn(
                                "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                                selected
                                  ? "bg-muted text-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                              )}
                              style={selected ? { borderLeft: `2px solid ${accentColor}` } : undefined}
                            >
                              <ConsoleIcon consoleName={representativeName} size="sm" />
                              <span className="flex-1 truncate text-left">
                                {getConsoleDisplayName(canonical, useShort)}
                              </span>
                              <span className="text-muted-foreground/60 tabular-nums">
                                {rowTotal.toLocaleString()}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Scan stats footer */}
      {!status.scanning && status.scanned > 0 && (
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{allTitles.toLocaleString()} titles</div>
          <div className="text-muted-foreground/70">{consoles.reduce((s, c) => s + c.game_files, 0).toLocaleString()} ROMs · {platformGroups.size} platform{platformGroups.size !== 1 ? "s" : ""}</div>
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
