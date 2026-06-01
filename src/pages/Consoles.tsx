import { useState, useEffect, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { getConsoles } from "@/lib/tauri";
import { ConsoleIcon, PlatformBadge } from "@/components/ConsoleIcon";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";
import { formatBytes } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { getCanonicalConsoleName, getShortConsoleName, getConsoleDisplayName } from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

export default function Consoles() {
  const { consoles, setConsoles, setSelectedConsoles } = useScanStore();
  const { setActiveTab } = useUIStore();
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"alpha" | "count">("alpha");
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(new Set());

  useEffect(() => {
    getConsoles().then(setConsoles).catch(console.error);
  }, [setConsoles]);

  function togglePlatform(platform: string) {
    setCollapsedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  // Build grouped structure: platform → canonical name → variants[]
  const platformGroups = useMemo(() => {
    const filtered = consoles.filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()),
    );

    const platformMap = new Map<string, Map<string, ConsoleStats[]>>();
    for (const c of filtered) {
      const platform = c.name.split(" - ")[0] ?? "Other";
      const canonical = getCanonicalConsoleName(c.name);
      if (!platformMap.has(platform)) platformMap.set(platform, new Map());
      const canonicalMap = platformMap.get(platform)!;
      const arr = canonicalMap.get(canonical) ?? [];
      arr.push(c);
      canonicalMap.set(canonical, arr);
    }

    // Sort platforms A-Z
    const sortedPlatforms = Array.from(platformMap.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    // Sort canonical groups within each platform
    return sortedPlatforms.map(([platform, canonicalMap]) => {
      let entries = Array.from(canonicalMap.entries());
      if (sort === "alpha") {
        entries = entries.sort(([a], [b]) =>
          getShortConsoleName(a).localeCompare(getShortConsoleName(b)),
        );
      } else {
        entries = entries.sort(([, av], [, bv]) => {
          const aTotal = av.reduce((s, c) => s + c.total_files, 0);
          const bTotal = bv.reduce((s, c) => s + c.total_files, 0);
          return bTotal - aTotal;
        });
      }
      return { platform, entries };
    });
  }, [consoles, search, sort]);

  const totalConsoles = platformGroups.reduce((s, { entries }) => s + entries.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground shrink-0">Consoles</h1>
      </div>

      {/* Secondary toolbar: search + sort */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3">
        <Input
          placeholder="Search consoles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {totalConsoles} console{totalConsoles !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Select value={sort} onValueChange={(v) => setSort(v as "alpha" | "count")}>
            <SelectTrigger className="h-8 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alpha">A–Z</SelectItem>
              <SelectItem value="count">ROM count</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {platformGroups.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground">
            {search ? "No consoles match your search." : "No consoles scanned. Run a scan from the Dashboard."}
          </div>
        )}

        {platformGroups.map(({ platform, entries }) => {
          const isCollapsed = collapsedPlatforms.has(platform);
          const platformTotal = entries.reduce(
            (s, [, variants]) => s + variants.reduce((vs, v) => vs + v.total_files, 0),
            0,
          );

          return (
            <div key={platform}>
              {/* Platform header */}
              <button
                onClick={() => togglePlatform(platform)}
                className="w-full flex items-center gap-2 mb-3 group"
                title={`${platform} — ${entries.length} system${entries.length !== 1 ? "s" : ""}, ${platformTotal.toLocaleString()} ROMs`}
              >
                <PlatformBadge consoleName={entries[0][1][0].name} />
                <span className="text-xs text-muted-foreground">
                  ({entries.length} system{entries.length !== 1 ? "s" : ""} · {platformTotal.toLocaleString()} ROMs)
                </span>
                <ChevronRight
                  className={cn(
                    "w-3 h-3 text-muted-foreground ml-auto transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />
              </button>

              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                  {entries.map(([canonical, variants]) => {
                    const totalFiles = variants.reduce((s, v) => s + v.total_files, 0);
                    const preferredCount = variants.reduce((s, v) => s + v.preferred_count, 0);
                    const bytesToFree = variants.reduce((s, v) => s + v.bytes_to_free, 0);
                    const healthPct = totalFiles > 0 ? Math.round((preferredCount / totalFiles) * 100) : 0;
                    const shortName = getShortConsoleName(canonical);

                    return (
                      <button
                        key={canonical}
                        onClick={() => {
                          setSelectedConsoles(variants.map((v) => v.name));
                          setActiveTab("roms");
                        }}
                        title={variants.length > 1
                          ? `${shortName}\n${variants.map((v) => getShortConsoleName(v.name)).join(", ")}`
                          : canonical}
                        className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors text-left w-full"
                      >
                        <ConsoleIcon consoleName={canonical} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{getConsoleDisplayName(variants[0].name, useShort)}</div>
                          <div className="text-xs text-muted-foreground">{totalFiles.toLocaleString()} ROMs</div>
                          {variants.length > 1 && (
                            <div className="text-xs text-muted-foreground/60">{variants.length} formats</div>
                          )}
                          {bytesToFree > 0 && (
                            <div className="text-xs text-muted-foreground/60">{formatBytes(bytesToFree)} to free</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-lg font-bold ${healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {healthPct}%
                          </div>
                          <div className="text-xs text-muted-foreground/60">preferred</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
