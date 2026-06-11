import { useEffect, useMemo, useState } from "react";
import { Gamepad2, Server, HardDrive, Zap, AlertTriangle, History, Sparkles, Database, Info, Globe, ChevronRight, Loader2, LibraryBig, Files, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SortControl } from "@/components/SortControl";
import type { SortDir } from "@/lib/romUtils";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getConsoles, getInterruptedSession, resumeSession,
  getEmptyRoots, cleanupEmptyRoots,
  getHistory, scanRoots, getSettings, formatBytes, getDatFiles, getCompleteness,
  onEnrichProgress, onEnrichComplete, getEnrichmentStatus,

} from "@/lib/tauri";
import type { InterruptedSession } from "@/lib/bindings/InterruptedSession";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";
import type { EnrichmentStatus } from "@/lib/bindings/EnrichmentStatus";
import type { Completeness } from "@/lib/bindings/Completeness";
import type { DatFile } from "@/lib/bindings/DatFile";
import type { ActionLogEntry } from "@/lib/bindings/ActionLogEntry";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";
import {
  getConsoleParts,
  getConsoleColor,
  getConsoleDisplayName,
  resolveConsoleVariants,
  getPlatform,
  PLATFORMS,
  canonicalTitleCount,
  canonicalAllTitleCount,
  canonicalFieldSum,
} from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";
import { refreshTagStore } from "@/components/Layout";

export default function Dashboard() {
  const { consoles, setConsoles, status, setStatus, setSelectedConsoles, bumpCacheVersion, cacheVersion } = useScanStore();
  const { setActiveTab } = useUIStore();
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);
  const [interrupted, setInterrupted] = useState<InterruptedSession | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeResult, setResumeResult] = useState<string | null>(null);
  const [emptyRoots, setEmptyRoots] = useState<string[]>([]);
  const [recentActions, setRecentActions] = useState<ActionLogEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichmentStatus | null>(null);
  const [completeness, setCompleteness] = useState<Completeness[]>([]);
  const [consoleSearch, setConsoleSearch] = useState("");
  const [sortField, setSortField] = useState<"name" | "count">("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<string[]>([]);

  useEffect(() => {
    getConsoles().then(setConsoles).catch(console.error);
    getInterruptedSession().then(setInterrupted).catch(console.error);
    getEmptyRoots().then(setEmptyRoots).catch(console.error);
    getHistory(null, null, 1, 5).then((h) => setRecentActions(h.entries)).catch(console.error);
    getEnrichmentStatus().then((s) => { if (s.total > 0) setEnrichment(s); }).catch(console.error);
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    onEnrichProgress((s) => setEnrichment(s)).then((fn) => { unlistenProgress = fn; });
    onEnrichComplete((s) => setEnrichment(s)).then((fn) => { unlistenComplete = fn; });
    return () => { unlistenProgress?.(); unlistenComplete?.(); };
  }, [setConsoles]);

  // Re-fetch completeness whenever a scan finishes (cacheVersion bumps after each scan)
  useEffect(() => {
    getDatFiles().then((dats) => {
      Promise.all(dats.map((d: DatFile) => getCompleteness(d.console)))
        .then(setCompleteness).catch(console.error);
    }).catch(console.error);
  }, [cacheVersion]);

  const { totalTitles, officialTitles, preferredGroupsTotal, allGroupsTotal } = useMemo(() => {
    const byCanonical = new Map<string, typeof consoles>();
    for (const c of consoles) {
      const { canonical } = getConsoleParts(c.name);
      const arr = byCanonical.get(canonical) ?? [];
      arr.push(c);
      byCanonical.set(canonical, arr);
    }
    let titles = 0, official = 0, preferred = 0, all = 0;
    for (const variants of byCanonical.values()) {
      titles    += canonicalAllTitleCount(variants);
      official  += canonicalTitleCount(variants);   // game_groups only
      preferred += canonicalFieldSum(variants, "preferred_groups");
      all       += canonicalFieldSum(variants, "all_groups");
    }
    return { totalTitles: titles, officialTitles: official, preferredGroupsTotal: preferred, allGroupsTotal: all };
  }, [consoles]);

  const totalPlayableFiles = useMemo(
    () => consoles.reduce((s, c) => s + c.game_files + c.unofficial_files, 0),
    [consoles],
  );
  const unofficialRomCount = useMemo(
    () => consoles.reduce((s, c) => s + c.unofficial_files, 0),
    [consoles],
  );
  const totalFiles = useMemo(
    () => consoles.reduce((s, c) => s + c.total_files, 0),
    [consoles],
  );
  const totalSystemFiles = useMemo(
    () => consoles.reduce((s, c) => s + c.system_file_count, 0),
    [consoles],
  );
  const totalBytes = consoles.reduce((s, c) => s + c.total_bytes, 0);
  const healthPct = allGroupsTotal > 0
    ? Math.round(preferredGroupsTotal / allGroupsTotal * 100) : 0;

  async function handleScan() {
    setScanning(true);
    try {
      const settings = await getSettings();
      if (settings.rom_roots.length === 0) { setActiveTab("settings"); return; }
      const s = await scanRoots(settings.rom_roots);
      setStatus(s);
      const updated = await getConsoles();
      setConsoles(updated);
      refreshTagStore();
      bumpCacheVersion();
    } finally {
      setScanning(false);
    }
  }

  async function handleResume() {
    if (!interrupted) return;
    setResuming(true);
    try {
      const result = await resumeSession();
      const parts: string[] = [];
      if (result.success_count > 0)
        parts.push(`${result.success_count} file${result.success_count !== 1 ? "s" : ""} moved to Trash`);
      if (result.folders_removed.length > 0)
        parts.push(`${result.folders_removed.length} empty folder${result.folders_removed.length !== 1 ? "s" : ""} removed`);
      setResumeResult(parts.join(". ") || "Done.");
      setInterrupted(null);
      setEmptyRoots([]);
      const updated = await getConsoles();
      setConsoles(updated);
      bumpCacheVersion();
    } catch (e) {
      setResumeResult(`Error: ${String(e)}`);
    } finally {
      setResuming(false);
    }
  }

  async function handleCleanupRoots() {
    await cleanupEmptyRoots(emptyRoots).catch(console.error);
    setEmptyRoots([]);
    const updated = await getConsoles();
    setConsoles(updated);
  }

  // Platform summary stats — game-only counts to match the ROMs tab.
  // We accumulate sub-folders per (platform, canonical) and call canonicalTitleCount
  // once per canonical so alias sub-folders like N64DD are included correctly.
  const platformStats = useMemo(() => {
    const map = new Map<string, { consoles: Set<string>; titles: number; files: number; roms: number; systemFiles: number; bytes: number }>();
    // Also collect variants per (platform, canonical) for canonicalTitleCount
    const variantsByCanonical = new Map<string, typeof consoles>();
    for (const c of consoles) {
      const { platform, canonical } = getConsoleParts(c.name);
      const entry = map.get(platform) ?? { consoles: new Set(), titles: 0, files: 0, roms: 0, systemFiles: 0, bytes: 0 };
      entry.consoles.add(canonical);
      entry.files += c.total_files;
      entry.roms += c.game_files + c.unofficial_files;
      entry.systemFiles += c.system_file_count;
      entry.bytes += c.total_bytes;
      map.set(platform, entry);
      const key = `${platform}\0${canonical}`;
      const arr = variantsByCanonical.get(key) ?? [];
      arr.push(c);
      variantsByCanonical.set(key, arr);
    }
    // Add title counts once per canonical (after all sub-folders collected)
    for (const [key, variants] of variantsByCanonical) {
      const platform = key.split("\0")[0]!;
      const entry = map.get(platform);
      if (entry) entry.titles += canonicalAllTitleCount(variants);
    }
    return map;
  }, [consoles]);

  // Canonical console groups for cards — filtered by search, sorted, grouped by platform
  const canonicalGroups = useMemo(() => {
    const byPlatform = new Map<string, [string, ConsoleStats[]][]>();
    const interim = new Map<string, Map<string, ConsoleStats[]>>();
    for (const c of consoles) {
      const { platform, canonical } = getConsoleParts(c.name);
      if (!interim.has(platform)) interim.set(platform, new Map());
      const pm = interim.get(platform)!;
      pm.set(canonical, [...(pm.get(canonical) ?? []), c]);
    }
    for (const [platform, canonicalMap] of interim.entries()) {
      let entries = Array.from(canonicalMap.entries());
      // Apply search filter
      if (consoleSearch) {
        const q = consoleSearch.toLowerCase();
        entries = entries.filter(([canonical]) => canonical.toLowerCase().includes(q));
      }
      if (entries.length === 0) continue;
      // Apply sort
      if (sortField === "count") {
        entries.sort(([, av], [, bv]) => {
          const a = canonicalTitleCount(av);
          const b = canonicalTitleCount(bv);
          return sortDir === "desc" ? b - a : a - b;
        });
      } else {
        entries.sort(([a], [b]) => sortDir === "asc" ? a.localeCompare(b) : b.localeCompare(a));
      }
      byPlatform.set(platform, entries);
    }
    return byPlatform;
  }, [consoles, consoleSearch, sortField, sortDir]);

  const totalCanonicals = useMemo(() => {
    const keys = new Set<string>();
    for (const c of consoles) {
      const { platform, canonical } = getConsoleParts(c.name);
      keys.add(`${platform}\0${canonical}`);
    }
    return keys.size;
  }, [consoles]);

  function togglePlatform(platform: string) {
    setCollapsedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex justify-end">
        <Button onClick={handleScan} disabled={scanning || status.scanning} size="sm">
          <Zap className="w-4 h-4 mr-1.5" />
          {scanning || status.scanning ? "Scanning…" : "Rescan collection"}
        </Button>
      </div>
      {interrupted && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <AlertDescription className="text-amber-300 text-sm space-y-2">
            <div>
              <p className="font-medium">Last session was interrupted mid-deletion.</p>
              <p className="text-amber-400/70 text-xs mt-0.5">
                {interrupted.pending_count} file{interrupted.pending_count !== 1 ? "s" : ""} remain pending
                {interrupted.consoles.length > 0 && ` · ${interrupted.consoles.join(", ")}`}
              </p>
            </div>
            {resumeResult ? (
              <p className="text-green-400 text-xs">{resumeResult}</p>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white"
                  disabled={resuming}
                  onClick={handleResume}
                >
                  {resuming ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      Moving {interrupted.pending_count} file{interrupted.pending_count !== 1 ? "s" : ""} to Trash…
                    </>
                  ) : (
                    "Resume deletion"
                  )}
                </Button>
                <button
                  className="text-xs underline text-amber-300/70 hover:text-amber-300"
                  onClick={() => setActiveTab("history")}
                >
                  Review in History →
                </button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {emptyRoots.length > 0 && !interrupted && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <AlertDescription className="text-blue-300 text-sm flex items-center justify-between gap-3 flex-wrap">
            <span>
              {emptyRoots.length} empty scan root{emptyRoots.length !== 1 ? "s" : ""} detected
              {" "}({emptyRoots.map((r) => r.split("/").pop()).join(", ")})
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-blue-300 hover:text-blue-100 shrink-0"
              onClick={handleCleanupRoots}
            >
              Remove from scan roots
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={Files}
          label="Files"
          value={totalFiles > 0 ? totalFiles.toLocaleString() : "—"}
        />
        <StatCard
          icon={Gamepad2}
          label="ROMs"
          value={totalPlayableFiles > 0 ? totalPlayableFiles.toLocaleString() : "—"}
          labelSuffix={unofficialRomCount > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="text-xs space-y-0.5 text-muted-foreground">
                  <p>{(totalPlayableFiles - unofficialRomCount).toLocaleString()} official</p>
                  <p>{unofficialRomCount.toLocaleString()} unofficial</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : undefined}
        />
        <StatCard
          icon={LibraryBig}
          label="Titles"
          value={totalTitles > 0 ? totalTitles.toLocaleString() : "—"}
          labelSuffix={totalTitles > officialTitles ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="text-xs space-y-0.5 text-muted-foreground">
                  <p>{officialTitles.toLocaleString()} official</p>
                  <p>{(totalTitles - officialTitles).toLocaleString()} unofficial</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : undefined}
        />
        <StatCard
          icon={Shield}
          label="System Files"
          value={totalSystemFiles > 0 ? totalSystemFiles.toLocaleString() : "—"}
        />
        <StatCard icon={Server} label="Consoles" value={totalCanonicals > 0 ? totalCanonicals.toString() : "—"} />
        <StatCard icon={Globe} label="Platforms" value={platformStats.size > 0 ? platformStats.size.toString() : "—"} />
        {/* F1: Use total_bytes for collection size */}
        <StatCard icon={HardDrive} label="Collection size" value={totalBytes > 0 ? formatBytes(totalBytes) : "—"} />
        {/* F2: Language Match tile with breakdown tooltip */}
        <StatCard
          icon={Zap}
          label="Language Match"
          labelSuffix={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs space-y-1">
                  {allGroupsTotal > 0 ? (
                    <>
                      <p className="font-medium text-foreground">Language match breakdown</p>
                      <div className="space-y-0.5 text-muted-foreground">
                        <p>{preferredGroupsTotal.toLocaleString()} titles — preferred language matched</p>
                        <p>{(allGroupsTotal - preferredGroupsTotal).toLocaleString()} titles — no preferred match</p>
                        <p className="border-t border-border/60 pt-0.5 mt-0.5 text-foreground">{allGroupsTotal.toLocaleString()} total playable titles</p>
                      </div>
                    </>
                  ) : (
                    <p>Percentage of your playable titles matching your preferred language/region setting.</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          value={allGroupsTotal > 0 ? `${healthPct}%` : "—"}
          sub={allGroupsTotal > 0 ? "preferred language" : "Scan to see"}
          accent={healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-red-400"}
        />
      </div>

      {/* Consoles section — replaces standalone Consoles tab */}
      {consoles.length > 0 && (
        <div>
          {/* Section header with search + sort controls */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Consoles</h2>
            <Input
              placeholder="Search consoles…"
              value={consoleSearch}
              onChange={(e) => setConsoleSearch(e.target.value)}
              className="max-w-xs h-7 text-xs"
            />
            <span className="text-xs text-muted-foreground ml-auto shrink-0">{totalCanonicals} consoles</span>
            <SortControl
              fields={[
                { value: "name" as const, label: "Name" },
                { value: "count" as const, label: "Title count" },
              ]}
              field={sortField}
              dir={sortDir}
              onField={setSortField}
              onDir={setSortDir}
            />
          </div>

          {canonicalGroups.size === 0 && consoleSearch && (
            <p className="text-xs text-muted-foreground py-4">No consoles match "{consoleSearch}".</p>
          )}

          {Array.from(canonicalGroups.entries()).map(([platform, entries]) => {
            const pStats = platformStats.get(platform);
            const platformColor = getConsoleColor(consoles.find((c) => getPlatform(c.name) === platform)?.name ?? "");
            const isCollapsed = collapsedPlatforms.includes(platform);
            return (
              <div key={platform} className="mb-6">
                {/* Collapsible platform header */}
                <button
                  onClick={() => togglePlatform(platform)}
                  className="w-full flex items-center gap-2 mb-3 px-1 group"
                >
                  <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform shrink-0", !isCollapsed && "rotate-90")} />
                  <span className="text-sm font-semibold" style={{ color: platformColor }}>
                    {PLATFORMS[platform.toLowerCase() as keyof typeof PLATFORMS]?.name ?? platform}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {pStats?.consoles.size ?? 0} console{(pStats?.consoles.size ?? 0) !== 1 ? "s" : ""}
                    · {(pStats?.titles ?? 0).toLocaleString()} titles
                    · {(pStats?.files ?? 0).toLocaleString()} files
                    · {(pStats?.roms ?? 0).toLocaleString()} ROMs
                    {(pStats?.systemFiles ?? 0) > 0 && ` · ${pStats!.systemFiles.toLocaleString()} sys`}
                    · {pStats && pStats.bytes > 0 ? formatBytes(pStats.bytes) : "—"}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {entries.map(([canonical, variants]) => (
                      <CanonicalConsoleCard
                        key={canonical}
                        canonicalName={canonical}
                        variants={variants}
                        onClick={() => {
                          setSelectedConsoles(resolveConsoleVariants(canonical, consoles));
                          setActiveTab("roms");
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {consoles.length === 0 && !status.scanning && (
        <div className="text-center py-16 space-y-3">
          <Gamepad2 className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No ROMs scanned yet.</p>
          <Button onClick={handleScan} disabled={scanning}>Start scan</Button>
        </div>
      )}

      {enrichment && enrichment.total > 0 && (
        <div className="border border-border rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className={`w-4 h-4 ${enrichment.running ? "text-primary animate-pulse" : "text-green-400"}`} />
            <span className="text-sm font-medium text-foreground">
              {enrichment.running ? "Enriching metadata…" : "Metadata enrichment complete"}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">{enrichment.enriched}/{enrichment.total}</span>
          </div>
          <Progress value={enrichment.total > 0 ? (enrichment.enriched / enrichment.total) * 100 : 0} className="h-1.5" />
          {enrichment.current_title && (
            <p className="text-xs text-muted-foreground truncate">{enrichment.current_title}</p>
          )}
        </div>
      )}

      {completeness.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Collection completeness</h2>
          </div>
          <div className="space-y-2">
            {completeness.map((c) => (
              <div key={c.console} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-foreground truncate">{getConsoleDisplayName(c.console, useShort)}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{c.have.toLocaleString()} / {c.total.toLocaleString()}</span>
                  </div>
                  <Progress value={c.percent} className="h-1" />
                </div>
                <span className={`text-sm font-semibold shrink-0 ${c.percent >= 80 ? "text-green-400" : c.percent >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                  {Math.round(c.percent)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentActions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent activity</h2>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setActiveTab("history")}>View all →</button>
          </div>
          <div className="space-y-1">
            {recentActions.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-card border border-border text-sm">
                <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-foreground">{a.title}</span>
                <span className="text-xs text-muted-foreground capitalize shrink-0">{String(a.action).replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, labelSuffix, value, sub, accent }: {
  icon: React.ElementType; label: string; labelSuffix?: React.ReactNode;
  value: string; sub?: string; accent?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />{label}
          {labelSuffix}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function CanonicalConsoleCard({ canonicalName, variants, onClick }: {
  canonicalName: string;
  variants: ConsoleStats[];
  onClick: () => void;
}) {
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);
  const totalAllFiles = variants.reduce((s, v) => s + v.total_files, 0);
  const totalRoms = variants.reduce((s, v) => s + v.game_files + v.unofficial_files, 0);
  const totalSystemFiles = variants.reduce((s, v) => s + v.system_file_count, 0);
  const totalBytes = variants.reduce((s, v) => s + v.total_bytes, 0);
  const totalGroups = canonicalAllTitleCount(variants);
  const preferredGroups = canonicalFieldSum(variants, "preferred_groups");
  const allGroups = canonicalFieldSum(variants, "all_groups");
  const healthPct = allGroups > 0 ? Math.round((preferredGroups / allGroups) * 100) : 0;
  const displayName = getConsoleDisplayName(canonicalName, useShort);
  // Only count variants that actually have files — avoids showing a chip bar when
  // all files belong to a single format (e.g. only BigEndian N64 remains after pruning).
  const filledVariants = variants.filter((v) => v.game_files + v.unofficial_files > 0);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors text-left w-full"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
        <div className="text-xs text-muted-foreground">
          {totalGroups.toLocaleString()} titles · {totalAllFiles.toLocaleString()} files · {totalRoms.toLocaleString()} ROMs{totalSystemFiles > 0 ? ` · ${totalSystemFiles.toLocaleString()} sys` : ""} · {formatBytes(totalBytes)}
        </div>
        {filledVariants.length > 1 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {variants.map((v) => {
              const playable = v.game_files + v.unofficial_files;
              if (playable === 0) return null;
              const suffix = v.name.slice(v.name.indexOf(canonicalName) + canonicalName.length).trim();
              return suffix ? (
                <span key={v.name} className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                  {suffix} {playable.toLocaleString()}
                </span>
              ) : (
                <span key={v.name} className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                  base {playable.toLocaleString()}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {allGroups > 0 && (
        <div className="text-right shrink-0">
          <div className={`text-sm font-semibold ${healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>{healthPct}%</div>
          <div className="text-xs text-muted-foreground/60">preferred</div>
        </div>
      )}
    </button>
  );
}
