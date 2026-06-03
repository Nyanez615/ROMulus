import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Download, Trash2, Eye, EyeOff, X, Search, CheckSquare, Square, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  applyFilters, applyFormatPairs, executePrune, executeFormatPairs, exportCsv,
  formatBytes, isOneDrivePath, getSettings, saveSettings,
  getFilterSettings, saveFilterSettings, getFormatPairs,
  reapplyPreferences,
} from "@/lib/tauri";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { FilterSettings } from "@/lib/bindings/FilterSettings";
import type { FormatPair } from "@/lib/bindings/FormatPair";
import type { DeletionItem } from "@/lib/bindings/DeletionItem";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import { usePreferencesStore } from "@/store/preferences";
import { useUIStore } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";

// ── Deletion reason labels ────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  non_preferred_language:     "Non-preferred lang",
  prerelease:                 "Pre-release",
  older_revision:             "Older revision",
  unofficial:                 "Unofficial",
  format_pair_non_preferred:  "Format pair",
  format_pair_no_counterpart: "No counterpart",
  no_preferred_version:       "No preferred ver.",
};

const REASON_COLORS: Record<string, string> = {
  non_preferred_language:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  prerelease:                 "bg-amber-500/15 text-amber-400 border-amber-500/30",
  older_revision:             "bg-purple-500/15 text-purple-400 border-purple-500/30",
  unofficial:                 "bg-orange-500/15 text-orange-400 border-orange-500/30",
  format_pair_non_preferred:  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  format_pair_no_counterpart: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  no_preferred_version:       "bg-red-500/15 text-red-400 border-red-500/30",
};

function reasonKey(r: DeletionItem["reason"]): string {
  return typeof r === "string" ? r : Object.keys(r)[0] ?? "unknown";
}

// ── Filter toggle definitions ─────────────────────────────────────────────────

const FILTER_ROWS: Array<{
  key: keyof FilterSettings;
  section: "official" | "unofficial";
  label: string;
  tooltip: string;
  destructive?: boolean;
}> = [
  {
    key: "keep_preferred_only",
    section: "official",
    label: "Keep one copy per title",
    tooltip: "Deletes all variants except the single highest-scored preferred version.",
  },
  {
    key: "remove_if_no_preferred_version",
    section: "official",
    label: "Delete if no preferred version exists",
    tooltip: "Deletes ALL variants of a title when none match your language preference. Official games only.",
  },
  {
    key: "remove_prerelease",
    section: "official",
    label: "Remove pre-release",
    tooltip: "Deletes Beta, Proto, Demo, Sample, Promo, Kiosk variants.",
  },
  {
    key: "remove_older_revisions",
    section: "official",
    label: "Remove older revisions",
    tooltip: "Keeps only the highest revision; deletes Rev 0, Rev A, etc.",
  },
  {
    key: "keep_unofficial_as_fallback",
    section: "unofficial",
    label: "Keep unofficial as fallback",
    tooltip: "Keeps an unofficial variant when it's the only language-matching copy for a title.",
  },
  {
    key: "remove_unofficial",
    section: "unofficial",
    label: "Delete ALL unofficial regardless of language",
    tooltip: "Deletes Hack, Pirate, Aftermarket, Unl variants.",
    destructive: true,
  },
];

export default function Prune() {
  const { filterSettings, setFilterSettings } = usePreferencesStore();
  const { setOnedriveAcknowledged, onedriveAcknowledged } = useUIStore();
  const { selectedConsoles, cacheVersion } = useScanStore();
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── Format pair state ────────────────────────────────────────────────────────
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);
  // Full AppSettings needed to save format_preferences updates
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [fpPlan, setFpPlan] = useState<DeletionPlan | null>(null);
  const [fpPreviewSearch, setFpPreviewSearch] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpExecuting, setFpExecuting] = useState(false);
  const [fpResult, setFpResult] = useState<{ success: number; failed: number; foldersRemoved: number } | null>(null);

  // Load format pairs + AppSettings on mount / cache change
  useEffect(() => {
    getFormatPairs().then(setFormatPairs).catch(console.error);
    getSettings().then(setAppSettings).catch(console.error);
  }, [cacheVersion]);

  useEffect(() => {
    if (settingsLoaded) return;
    getFilterSettings().then((fs) => {
      setFilterSettings(fs);
      setSettingsLoaded(true);
    }).catch(console.error);
  }, [settingsLoaded, setFilterSettings]);

  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [hasOneDrive, setHasOneDrive] = useState(false);
  const [allowPermanentDelete, setAllowPermanentDelete] = useState(false);

  // Staging area — paths the user has unchecked (will NOT be executed/exported)
  const [uncheckedPaths, setUncheckedPaths] = useState<Set<string>>(new Set());
  // Search within the to-delete preview list
  const [previewSearch, setPreviewSearch] = useState("");

  async function preview() {
    setLoading(true);
    setPlan(null);
    setUncheckedPaths(new Set());
    setPreviewSearch("");
    try {
      const p = await applyFilters(filterSettings, selectedConsoles ?? undefined);
      setPlan(p);
      const settings = await getSettings();
      setHasOneDrive(settings.rom_roots.some(isOneDrivePath));
      setAllowPermanentDelete(settings.allow_permanent_delete ?? false);
    } finally {
      setLoading(false);
    }
  }

  // Items visible in the preview after search filter
  const filteredItems = useMemo(() => {
    if (!plan) return [];
    const q = previewSearch.toLowerCase();
    return plan.to_delete.filter(
      (item) => !q || item.rom.filename.toLowerCase().includes(q) || item.rom.title.toLowerCase().includes(q),
    );
  }, [plan, previewSearch]);

  // Items that are checked (approved for deletion)
  const checkedItems = useMemo(
    () => (plan?.to_delete ?? []).filter((item) => !uncheckedPaths.has(item.rom.path)),
    [plan, uncheckedPaths],
  );

  function toggleCheck(path: string) {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function selectAll() { setUncheckedPaths(new Set()); }
  function deselectAll() {
    setUncheckedPaths(new Set((plan?.to_delete ?? []).map((i) => i.rom.path)));
  }

  async function doExportCsv() {
    if (!plan) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const now = new Date().toISOString().slice(0, 10);
    const filePath = await save({ defaultPath: `romulus-prune-${now}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!filePath) return;
    // Export only checked items
    await exportCsv(checkedItems, filePath);
  }

  async function doExecute() {
    if (!plan) return;
    setExecuting(true);
    try {
      const mode = allowPermanentDelete ? "permanent" : "trash";
      const toDelete = checkedItems.map((item) => item.rom);
      const res = await executePrune(toDelete, mode, onedriveAcknowledged);
      setResult({ success: res.success_count, failed: res.failed.length });
      setPlan(null);
    } finally {
      setExecuting(false);
    }
  }

  function toggle(key: keyof FilterSettings) {
    const next = { ...filterSettings, [key]: !filterSettings[key] };
    setFilterSettings(next);
    saveFilterSettings(next).catch(console.error);
  }

  // ── Format pair helpers ──────────────────────────────────────────────────────

  function selectFormatFolder(consoleGroup: string, folder: string) {
    if (!appSettings) return;
    const next: AppSettings = {
      ...appSettings,
      format_preferences: { ...appSettings.format_preferences, [consoleGroup]: folder },
    };
    setAppSettings(next);
    saveSettings(next).catch(console.error);
  }

  async function previewFormatPairs() {
    setFpLoading(true);
    setFpPlan(null);
    try {
      const p = await applyFormatPairs();
      setFpPlan(p);
    } finally {
      setFpLoading(false);
    }
  }

  async function executeFormatPairsAction() {
    if (!fpPlan || fpPlan.to_delete.length === 0) return;
    setFpExecuting(true);
    try {
      const mode = (appSettings?.allow_permanent_delete) ? "permanent" : "trash";
      const toDelete = fpPlan.to_delete.map((d) => d.rom);
      const res = await executeFormatPairs(toDelete, mode);
      setFpResult({ success: res.success_count, failed: res.failed.length, foldersRemoved: res.folders_removed.length });
      setFpPlan(null);
      setFpPreviewSearch("");
      // Refresh AppSettings (rom_roots may have changed) and cache
      getSettings().then(setAppSettings).catch(console.error);
      await reapplyPreferences().catch(console.error);
    } finally {
      setFpExecuting(false);
    }
  }

  const formatPrefs = appSettings?.format_preferences ?? {};
  const anyFormatPrefSet = Object.keys(formatPrefs).length > 0;

  // Filtered + searched format pair preview items.
  // No-counterpart items always sort to the top so they're immediately visible.
  const filteredFpItems = useMemo(() => {
    if (!fpPlan) return [];
    const q = fpPreviewSearch.toLowerCase();
    const items = fpPlan.to_delete.filter(
      (d) => !q || d.rom.filename.toLowerCase().includes(q) || d.rom.title.toLowerCase().includes(q),
    );
    return items.sort((a, b) => {
      const aNC = reasonKey(a.reason) === "format_pair_no_counterpart" ? 0 : 1;
      const bNC = reasonKey(b.reason) === "format_pair_no_counterpart" ? 0 : 1;
      return aNC - bNC;
    });
  }, [fpPlan, fpPreviewSearch]);

  const fpNoCounterpartCount = useMemo(
    () => fpPlan?.to_delete.filter((d) => reasonKey(d.reason) === "format_pair_no_counterpart").length ?? 0,
    [fpPlan],
  );

  const filters = filterSettings;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="Prune" />
      </div>

      <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {!plan && !result && !loading && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="pending deletions">
            <div className="text-sm text-muted-foreground text-center py-4">Nothing to prune — click Preview to check for deletions.</div>
          </ConsoleEmptyState>
        )}

        {result && (
          <Alert className="border-green-500/40 bg-green-500/10">
            <AlertDescription className="text-green-300 text-sm">
              ✓ Moved {result.success} files to Trash. {result.failed > 0 && `${result.failed} failed.`}
            </AlertDescription>
          </Alert>
        )}

        {/* ── Format Pair Cleanup ─────────────────────────────────────── */}
        {formatPairs.length > 0 && (
          <>
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Format Pair Cleanup</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Select your preferred format for each paired console folder. Click "Analyze" to preview which
                files will be removed, then execute to delete the non-preferred copies.
              </p>

              {/* Pair selection cards */}
              {[...formatPairs].sort((a, b) => a.console_group.localeCompare(b.console_group)).map((pair) => {
                const pref = formatPrefs[pair.console_group];
                const sortedFolders = [pair.folder_a, pair.folder_b].sort((a, b) => a.localeCompare(b));
                return (
                  <div key={pair.console_group} className="border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
                      {Math.round(pair.overlap_percent * 100)}% title overlap
                    </div>
                    <div className="divide-y divide-border">
                      {sortedFolders.map((folder) => (
                        <button
                          key={folder}
                          onClick={() => selectFormatFolder(pair.console_group, folder)}
                          className={[
                            "w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors",
                            pref === folder ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/30",
                          ].join(" ")}
                        >
                          <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${pref === folder ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                          <span className={pref === folder ? "text-foreground font-medium" : "text-muted-foreground"}>
                            {folder.split(" - ")[1] ?? folder}
                          </span>
                          {pref === folder && <span className="text-xs text-primary ml-auto">preferred</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Success result */}
              {fpResult && (
                <Alert className="border-green-500/40 bg-green-500/10">
                  <AlertDescription className="text-green-300 text-sm">
                    ✓ Removed {fpResult.success} files.
                    {fpResult.foldersRemoved > 0 && ` ${fpResult.foldersRemoved} empty folder${fpResult.foldersRemoved !== 1 ? "s" : ""} deleted from scan roots.`}
                    {fpResult.failed > 0 && ` ${fpResult.failed} failed.`}
                  </AlertDescription>
                </Alert>
              )}

              {/* No-counterpart warning */}
              {fpNoCounterpartCount > 0 && (
                <Alert className="border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-sm">
                    {fpNoCounterpartCount} file{fpNoCounterpartCount !== 1 ? "s have" : " has"} no counterpart in the preferred folder and will also be deleted.
                  </AlertDescription>
                </Alert>
              )}

              {/* Full preview with search */}
              {fpPlan && fpPlan.to_delete.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {fpPlan.to_delete.length.toLocaleString()} files · {formatBytes(fpPlan.total_bytes_freed)} to remove
                    </span>
                    <button onClick={() => { setFpPlan(null); setFpPreviewSearch(""); }} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Search bar */}
                  <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <Input
                      placeholder="Search files…"
                      value={fpPreviewSearch}
                      onChange={(e) => setFpPreviewSearch(e.target.value)}
                      className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0"
                    />
                  </div>
                  <ScrollArea className="h-64">
                    {filteredFpItems.map((item, i) => {
                      const rk = reasonKey(item.reason);
                      const isNoCounterpart = rk === "format_pair_no_counterpart";
                      const colorClass = REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2 px-4 py-1.5 border-b text-xs ${
                            isNoCounterpart
                              ? "border-l-2 border-l-amber-500/50 border-b-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10"
                              : "border-b-border/40 hover:bg-muted/20"
                          }`}
                        >
                          <span className={`flex-1 truncate font-mono ${isNoCounterpart ? "text-amber-300/80" : "text-muted-foreground"}`}>
                            {item.rom.filename}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>
                            {REASON_LABELS[rk] ?? rk}
                          </span>
                          <span className="text-muted-foreground/60 shrink-0">{item.rom.console.split(" - ")[1] ?? item.rom.console}</span>
                        </div>
                      );
                    })}
                    {filteredFpItems.length === 0 && fpPreviewSearch && (
                      <div className="px-4 py-4 text-xs text-muted-foreground text-center">No matches for "{fpPreviewSearch}"</div>
                    )}
                  </ScrollArea>
                </div>
              )}

              {fpPlan && fpPlan.to_delete.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing to remove — all files are already in the preferred format.</p>
              )}

              {/* Format pair actions */}
              <div className="flex gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={fpLoading || !anyFormatPrefSet}
                  onClick={previewFormatPairs}
                  className="gap-2"
                >
                  {fpLoading ? "Analyzing…" : fpPlan ? "Re-analyze" : "Analyze Removals"}
                </Button>
                {fpPlan && fpPlan.to_delete.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={fpExecuting} className="gap-2">
                        <Trash2 className="w-3.5 h-3.5" />
                        {fpExecuting ? "Removing…" : `Remove ${fpPlan.to_delete.length.toLocaleString()} files`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove format-pair files?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {fpPlan.to_delete.length.toLocaleString()} files from non-preferred format folders
                          ({formatBytes(fpPlan.total_bytes_freed)}) will be{" "}
                          {appSettings?.allow_permanent_delete ? "permanently deleted" : "moved to the Trash"}.
                          {fpNoCounterpartCount > 0 && (
                            <span className="block mt-1 text-amber-400">
                              {fpNoCounterpartCount} file{fpNoCounterpartCount !== 1 ? "s have" : " has"} no counterpart in the preferred folder.
                            </span>
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executeFormatPairsAction} className="bg-destructive hover:bg-destructive/90">
                          {appSettings?.allow_permanent_delete ? "Delete permanently" : "Move to Trash"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </section>

            <Separator />
          </>
        )}

        {/* ── Variant Pruning ─────────────────────────────────────────── */}
        {/* Official ROMs filters */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Official ROMs</h2>
          {FILTER_ROWS.filter((r) => r.section === "official").map((row) => (
            <FilterRow
              key={row.key}
              label={row.label}
              tooltip={row.tooltip}
              checked={filters[row.key]}
              onToggle={() => toggle(row.key)}
            />
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Unofficial ROMs</h2>
          {FILTER_ROWS.filter((r) => r.section === "unofficial").map((row) => (
            <FilterRow
              key={row.key}
              label={row.label}
              tooltip={row.tooltip}
              checked={filters[row.key]}
              onToggle={() => toggle(row.key)}
              destructive={row.destructive}
            />
          ))}
        </section>

        {/* OneDrive warning */}
        {hasOneDrive && !onedriveAcknowledged && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm space-y-2">
              <p>OneDrive path detected. Deletions will sync to the cloud.</p>
              <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300" onClick={() => setOnedriveAcknowledged(true)}>
                I understand — proceed
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Plan summary */}
        {plan && (
          <div className="border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Preview</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={doExportCsv} className="text-xs gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPlan(null)} className="text-xs gap-1 text-muted-foreground">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-4 py-3 grid grid-cols-3 gap-4 text-center border-b border-border">
              <div>
                <div className="text-xl font-bold text-red-400">{checkedItems.length.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">approved to delete</div>
              </div>
              <div>
                <div className="text-xl font-bold text-green-400">{plan.to_keep.length.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">to keep</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">
                  {formatBytes(checkedItems.reduce((s, i) => s + i.rom.filesize, 0))}
                </div>
                <div className="text-xs text-muted-foreground">to reclaim</div>
              </div>
            </div>

            {plan.no_preferred_version_count > 0 && (
              <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/10 border-b border-border">
                {plan.no_preferred_version_count} game{plan.no_preferred_version_count !== 1 ? "s" : ""} deleted — no preferred-language version exists
              </div>
            )}

            {/* Search + select-all controls */}
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search files…"
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0"
              />
              <div className="flex gap-1 shrink-0">
                <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  <CheckSquare className="w-3 h-3" /> All
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button onClick={deselectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  <Square className="w-3 h-3" /> None
                </button>
              </div>
            </div>

            {/* Deletion item list with checkboxes */}
            <ScrollArea className="h-64">
              {filteredItems.slice(0, 200).map((item, i) => {
                const checked = !uncheckedPaths.has(item.rom.path);
                const rk = reasonKey(item.reason);
                const colorClass = REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20 cursor-pointer ${!checked ? "opacity-40" : ""}`}
                    onClick={() => toggleCheck(item.rom.path)}
                  >
                    <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                      {checked && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                    </div>
                    <span className="flex-1 truncate font-mono text-muted-foreground">{item.rom.filename}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}
                    >
                      {REASON_LABELS[rk] ?? rk}
                    </span>
                    <span className="text-muted-foreground/60 shrink-0">{item.rom.console.split(" - ")[1] ?? item.rom.console}</span>
                  </div>
                );
              })}
              {filteredItems.length > 200 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">…and {(filteredItems.length - 200).toLocaleString()} more</div>
              )}
              {filteredItems.length === 0 && previewSearch && (
                <div className="px-4 py-4 text-xs text-muted-foreground text-center">No matches for "{previewSearch}"</div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={plan ? () => setPlan(null) : preview}
            disabled={loading}
            variant="outline"
            className="gap-2"
          >
            {plan ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {loading ? "Computing…" : plan ? "Hide preview" : "Preview"}
          </Button>
          {plan && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={executing || checkedItems.length === 0 || (hasOneDrive && !onedriveAcknowledged)}
                  variant="destructive"
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  {executing
                    ? (allowPermanentDelete ? "Deleting…" : "Moving to Trash…")
                    : `${allowPermanentDelete ? "Delete" : "Move"} ${checkedItems.length.toLocaleString()} files ${allowPermanentDelete ? "permanently" : "to Trash"}`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                  <AlertDialogDescription>
                    {allowPermanentDelete
                      ? `${checkedItems.length.toLocaleString()} files will be permanently deleted (${formatBytes(checkedItems.reduce((s, i) => s + i.rom.filesize, 0))} freed). This cannot be undone.`
                      : `${checkedItems.length.toLocaleString()} files will be moved to the Trash (${formatBytes(checkedItems.reduce((s, i) => s + i.rom.filesize, 0))} freed). This action can be undone from the Trash.`}
                    {uncheckedPaths.size > 0 && (
                      <span className="block mt-1 text-muted-foreground">{uncheckedPaths.size} unchecked file{uncheckedPaths.size !== 1 ? "s" : ""} will be skipped.</span>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={doExecute} className="bg-destructive hover:bg-destructive/90">
                    {allowPermanentDelete ? "Delete permanently" : "Move to Trash"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function FilterRow({ label, tooltip, checked, onToggle, destructive }: {
  label: string;
  tooltip: string;
  checked: boolean;
  onToggle: () => void;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-card/50">
      <div className="flex-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label className={`text-sm cursor-default ${destructive ? "text-red-400" : "text-foreground"}`}>{label}</Label>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        className={`shrink-0 mt-0.5${destructive ? " data-[state=checked]:bg-destructive" : ""}`}
      />
    </div>
  );
}
