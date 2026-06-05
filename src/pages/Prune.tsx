import { useState, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Download, Trash2, Eye, EyeOff, X, Search, CheckSquare, Square, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  applyFilters, applyFormatPairs, executePrune, executeFormatPairs, exportCsv,
  formatBytes, getSettings, saveSettings,
  getFilterSettings, saveFilterSettings, getFormatPairs,
  reapplyPreferences, scanRoots, getConsoles,
} from "@/lib/tauri";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { FilterSettings } from "@/lib/bindings/FilterSettings";
import type { FormatPair } from "@/lib/bindings/FormatPair";
import type { DeletionItem } from "@/lib/bindings/DeletionItem";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { FileCategory } from "@/lib/bindings/FileCategory";
import { getAbbrev } from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { refreshTagStore } from "@/components/Layout";

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

function matchesCat(fc: FileCategory, cat: "all" | "game" | "system"): boolean {
  if (cat === "all") return true;
  if (cat === "game") return fc === "game" || fc === "unofficial";
  return fc !== "game" && fc !== "unofficial";
}

// ── Filter toggle definitions ─────────────────────────────────────────────────

const FILTER_ROWS: Array<{
  key: keyof FilterSettings;
  section: "official" | "unofficial";
  label: string;
  description: string;
  destructive?: boolean;
}> = [
  {
    key: "keep_preferred_only",
    section: "official",
    label: "Keep one copy per title",
    description: "Keeps only the single highest-scored variant for each title and queues the rest for deletion. Scoring favours your preferred language and region, then the highest revision.",
  },
  {
    key: "remove_if_no_preferred_version",
    section: "official",
    label: "Delete if no preferred version exists",
    description: "When a title has no version matching your language preference, every copy is queued for deletion rather than keeping a non-matching one. Disable this to always keep at least one copy of every title.",
  },
  {
    key: "remove_prerelease",
    section: "official",
    label: "Remove pre-release",
    description: "Queues Beta, Proto, Demo, Sample, Promo, and Kiosk builds for deletion. These are development or promotional releases not intended as final products.",
  },
  {
    key: "remove_older_revisions",
    section: "official",
    label: "Remove older revisions",
    description: "When multiple revisions of the same title exist (Rev 1, Rev 2, …), keeps only the latest and queues older ones for deletion. Titles with a single version are unaffected.",
  },
  {
    key: "keep_unofficial_as_fallback",
    section: "unofficial",
    label: "Keep unofficial as fallback",
    description: "When a title has no official version in your preferred language but an unofficial one (fan translation, hack) does match, that unofficial copy is kept rather than deleted.",
  },
  {
    key: "remove_unofficial",
    section: "unofficial",
    label: "Delete ALL unofficial regardless of language",
    description: "Removes all hacks, fan translations, pirate releases, and aftermarket titles regardless of your language settings. When enabled, this overrides 'Keep unofficial as fallback'.",
    destructive: true,
  },
];

export default function Prune() {
  const { filterSettings, setFilterSettings } = usePreferencesStore();
  const { selectedConsoles, cacheVersion, setConsoles, setStatus, bumpCacheVersion } = useScanStore();

  // Stable key derived from selectedConsoles — used to auto-invalidate keyed state on console switch.
  // Memoized so derived values (plan, fpPlan, etc.) are stable references when consoles don't change.
  const consolesKey = useMemo(
    () => (selectedConsoles === null ? "" : [...selectedConsoles].sort().join("\0")),
    [selectedConsoles],
  );

  // loadedKey pattern: state stored alongside the consolesKey it was generated for.
  // Derived value reads as null when consolesKey changes, clearing stale alerts without synchronous setState.
  const [planStore, setPlanStore] = useState<{ key: string; plan: DeletionPlan } | null>(null);
  const plan = planStore?.key === consolesKey ? planStore.plan : null;

  const [resultStore, setResultStore] = useState<{ key: string; success: number; failed: number } | null>(null);
  const result = resultStore?.key === consolesKey ? resultStore : null;

  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── Format pair state ────────────────────────────────────────────────────────
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);
  // Tracks which pair groups are included in analysis (all selected by default).
  // Plain Record rather than Set so the React Compiler can reason about it as a memo dep.
  const [selectedPairGroups, setSelectedPairGroups] = useState<Record<string, true>>({});
  // Tracks previously-known groups so we can distinguish new vs deselected on rescan.
  const prevPairGroupsRef = useRef<Set<string>>(new Set());
  // Full AppSettings needed to save format_preferences updates.
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [fpPlan, setFpPlan] = useState<DeletionPlan | null>(null);

  const [fpResultStore, setFpResultStore] = useState<{ key: string; success: number; failed: number; foldersRemoved: number } | null>(null);
  const fpResult = fpResultStore?.key === consolesKey ? fpResultStore : null;

  const [fpPreviewSearch, setFpPreviewSearch] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpExecuting, setFpExecuting] = useState(false);
  const [fpScanState, setFpScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [pruneScanState, setPruneScanState] = useState<"idle" | "scanning" | "done">("idle");

  // Load format pairs + AppSettings on mount / cache change
  useEffect(() => {
    getFormatPairs().then((pairs) => {
      setFormatPairs(pairs);
      const incomingGroups = new Set(pairs.map((p) => p.console_group));
      setSelectedPairGroups((prev) => {
        const next: Record<string, true> = {};
        for (const g of incomingGroups) {
          if (prevPairGroupsRef.current.has(g)) {
            // Known group: preserve selection state
            if (prev[g]) next[g] = true;
          } else {
            // New group: default to selected
            next[g] = true;
          }
        }
        return next;
      });
      prevPairGroupsRef.current = incomingGroups;
    }).catch(console.error);
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

  // Staging area — paths the user has unchecked (will NOT be executed/exported)
  const [uncheckedPaths, setUncheckedPaths] = useState<Set<string>>(new Set());
  // Search within the to-delete preview list
  const [previewSearch, setPreviewSearch] = useState("");
  const [showAllPreview, setShowAllPreview] = useState(false);
  // Category filter for the preview panel
  const [previewCategory, setPreviewCategory] = useState<"all" | "game" | "system">("all");

  async function preview() {
    setLoading(true);
    setPlanStore(null);
    setUncheckedPaths(new Set());
    setPreviewSearch("");
    setShowAllPreview(false);
    setPreviewCategory("all");
    try {
      const p = await applyFilters(filterSettings, selectedConsoles ?? undefined);
      setPlanStore({ key: consolesKey, plan: p });
    } finally {
      setLoading(false);
    }
  }

  // On console switch: clear stale FP plan/search, and auto-refresh the variant plan if one is showing.
  // All setState calls are inside .then() callbacks, matching the project convention
  // (react-hooks/set-state-in-effect). result/fpResult auto-clear via loadedKey derivation.
  useEffect(() => {
    // Always clear stale FP plan and search when consoles change
    Promise.resolve().then(() => {
      setFpPlan(null);
      setFpPreviewSearch("");
    });

    if (planStore === null || loading) return;
    const key = consolesKey;
    const consoles = selectedConsoles;
    const fs = filterSettings;
    Promise.resolve()
      .then(() => {
        setLoading(true);
        setPlanStore(null);
        setUncheckedPaths(new Set());
        setPreviewSearch("");
        setPreviewCategory("all");
        return applyFilters(fs, consoles ?? undefined);
      })
      .then((p) => {
        setPlanStore({ key, plan: p });
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConsoles]);

  // Pairs visible under the current console filter
  const visiblePairs = useMemo(() => {
    if (selectedConsoles == null) return formatPairs;
    const consoleSet = new Set(selectedConsoles);
    return formatPairs.filter((p) => consoleSet.has(p.folder_a) || consoleSet.has(p.folder_b));
  }, [formatPairs, selectedConsoles]);

  // Category-filtered base lists — all subsequent derivations build on these
  const catDeleteItems = useMemo(
    () => (plan?.to_delete ?? []).filter((item) => matchesCat(item.rom.file_category, previewCategory)),
    [plan, previewCategory],
  );
  const catKeepItems = useMemo(
    () => (plan?.to_keep ?? []).filter((rom) => matchesCat(rom.file_category, previewCategory)),
    [plan, previewCategory],
  );

  // Items visible in the preview after search filter
  const filteredItems = useMemo(() => {
    const q = previewSearch.toLowerCase();
    return catDeleteItems.filter(
      (item) => !q || item.rom.filename.toLowerCase().includes(q) || item.rom.title.toLowerCase().includes(q),
    );
  }, [catDeleteItems, previewSearch]);

  // Items that are checked (approved for deletion)
  const checkedItems = useMemo(
    () => catDeleteItems.filter((item) => !uncheckedPaths.has(item.rom.path)),
    [catDeleteItems, uncheckedPaths],
  );

  function toggleCheck(path: string) {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function selectAll() {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      catDeleteItems.forEach((i) => next.delete(i.rom.path));
      return next;
    });
  }
  function deselectAll() {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      catDeleteItems.forEach((i) => next.add(i.rom.path));
      return next;
    });
  }

  const noPreferredCount = useMemo(() => {
    if (!plan) return 0;
    if (previewCategory === "all") return plan.no_preferred_version_count;
    return new Set(
      catDeleteItems
        .filter((i) => i.reason === "no_preferred_version")
        .map((i) => i.rom.title_normalized)
    ).size;
  }, [plan, previewCategory, catDeleteItems]);

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
    setPruneScanState("idle");
    let settings = appSettings;
    try {
      const toDelete = checkedItems.map((item) => item.rom);
      const res = await executePrune(toDelete);
      setResultStore({ key: consolesKey, success: res.success_count, failed: res.failed.length });
      setPlanStore(null);
      settings = await getSettings().catch(() => appSettings);
      if (settings) setAppSettings(settings);
    } finally {
      setExecuting(false);
    }
    // Auto-rescan: flush deleted entries from cache and update all counts everywhere.
    if (!settings?.rom_roots.length) return;
    setPruneScanState("scanning");
    try {
      const scanResult = await scanRoots(settings.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
      setPruneScanState("done");
    } catch {
      setPruneScanState("idle");
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

  function togglePairGroup(group: string) {
    setSelectedPairGroups((prev) => {
      if (prev[group]) {
        const next = { ...prev };
        delete next[group];
        return next;
      }
      return { ...prev, [group]: true };
    });
  }

  function selectAllPairs() {
    const all: Record<string, true> = {};
    for (const p of visiblePairs) all[p.console_group] = true;
    setSelectedPairGroups(all);
  }

  function deselectAllPairs() {
    setSelectedPairGroups({});
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
    if (!fpPlan || activeFpItems.length === 0) return;
    setFpScanState("idle");
    setFpExecuting(true);
    let settings = appSettings;
    try {
      const toDelete = activeFpItems.map((d) => d.rom);
      const res = await executeFormatPairs(toDelete);
      setFpResultStore({ key: consolesKey, success: res.success_count, failed: res.failed.length, foldersRemoved: res.folders_removed.length });
      setFpPlan(null);
      setFpPreviewSearch("");
      settings = await getSettings().catch(() => appSettings);
      setAppSettings(settings);
      await reapplyPreferences().catch(console.error);
    } finally {
      setFpExecuting(false);
    }
    // Auto-rescan: flush deleted entries from cache and update all counts everywhere.
    if (!settings?.rom_roots.length) return;
    setFpScanState("scanning");
    try {
      const scanResult = await scanRoots(settings.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
      setFpScanState("done");
    } catch {
      setFpScanState("idle"); // rescan failed — counts may be stale, user can rescan from Dashboard
    }
  }

  // Memoized to avoid unstable object reference from the `?? {}` fallback
  const formatPrefs = useMemo(
    () => appSettings?.format_preferences ?? {},
    [appSettings],
  );

  // At least one visible+checked pair has a preference set
  const anySelectedPrefSet = useMemo(
    () => visiblePairs.some((p) => selectedPairGroups[p.console_group] && formatPrefs[p.console_group] !== undefined),
    [visiblePairs, selectedPairGroups, formatPrefs],
  );

  // All format-pair folder names — drives the "not a format-pair console" check in activeFpItems.
  const formatPairFolderSet = useMemo(
    () => new Set(formatPairs.flatMap((p) => [p.folder_a, p.folder_b])),
    [formatPairs],
  );

  // FP plan items filtered to selected+visible pairs only — source of truth for stats + execute.
  // Computed without useMemo so the React Compiler can generate its own memoization without conflict.
  const activeFpItems = (fpPlan?.to_delete ?? []).filter((d) =>
    !formatPairFolderSet.has(d.rom.console) ||
    visiblePairs.some(
      (p) =>
        (p.folder_a === d.rom.console || p.folder_b === d.rom.console) &&
        !!selectedPairGroups[p.console_group],
    )
  );

  // activeFpItems + search filter + sort → display only
  const filteredFpItems = useMemo(() => {
    const q = fpPreviewSearch.toLowerCase();
    const items = activeFpItems.filter(
      (d) => !q || d.rom.filename.toLowerCase().includes(q) || d.rom.title.toLowerCase().includes(q),
    );
    return items.sort((a, b) => {
      const aNC = reasonKey(a.reason) === "format_pair_no_counterpart" ? 0 : 1;
      const bNC = reasonKey(b.reason) === "format_pair_no_counterpart" ? 0 : 1;
      return aNC - bNC;
    });
  }, [activeFpItems, fpPreviewSearch]);

  const fpNoCounterpartCount = useMemo(
    () => activeFpItems.filter((d) => reasonKey(d.reason) === "format_pair_no_counterpart").length,
    [activeFpItems],
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
            <AlertDescription className="text-green-300 text-sm flex items-center gap-2">
              ✓ Permanently deleted {result.success} files. {result.failed > 0 && `${result.failed} failed.`}
              {pruneScanState === "scanning" && (
                <span className="flex items-center gap-1 text-xs text-green-300/70 ml-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Rescanning…
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* ── Format Pair Cleanup ─────────────────────────────────────── */}
        {visiblePairs.length > 0 && (
          <>
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Format Pair Cleanup</h2>
                <div className="flex gap-1 ml-auto">
                  <button onClick={selectAllPairs} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <CheckSquare className="w-3 h-3" /> All
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={deselectAllPairs} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <Square className="w-3 h-3" /> None
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Select your preferred format for each paired console folder. Click "Analyze" to preview which
                files will be removed, then execute to delete the non-preferred copies.
              </p>

              {/* Pair selection cards */}
              {[...visiblePairs].sort((a, b) => a.console_group.localeCompare(b.console_group)).map((pair) => {
                const pref = formatPrefs[pair.console_group];
                const isSelected = !!selectedPairGroups[pair.console_group];
                // folder_a is always the smaller (subset) folder; folder_b is larger or equal.
                const isProperSubset = pair.folder_a_count < pair.folder_b_count;
                const isIdentical   = pair.folder_a_count === pair.folder_b_count && pair.overlap_percent >= 0.999;
                const shortA = getAbbrev(pair.folder_a);
                const shortB = getAbbrev(pair.folder_b);
                const headerLabel = isProperSubset
                  ? `${shortA} ⊂ ${shortB} · ${pair.folder_a_count} of ${pair.folder_b_count} titles`
                  : isIdentical
                  ? `${pair.folder_a_count} titles each · 100% overlap`
                  : `${Math.round(pair.overlap_percent * 100)}% overlap · ${pair.folder_a_count} / ${pair.folder_b_count} titles`;
                return (
                  <div key={pair.console_group} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => togglePairGroup(pair.console_group)}
                      className="w-full px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-2 hover:bg-muted/50 transition-colors"
                    >
                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isSelected ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                      </div>
                      {headerLabel}
                    </button>
                    <div className={`divide-y divide-border${!isSelected ? " opacity-50 pointer-events-none" : ""}`}>
                      {[pair.folder_a, pair.folder_b].map((folder) => {
                        const count = folder === pair.folder_a ? pair.folder_a_count : pair.folder_b_count;
                        const isSubsetFolder = isProperSubset && folder === pair.folder_a;
                        return (
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
                              {getAbbrev(folder)}
                            </span>
                            <span className="text-xs text-muted-foreground/50 ml-1">{count} titles</span>
                            {isSubsetFolder && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">subset</span>
                            )}
                            {pref === folder && <span className="text-xs text-primary ml-auto">preferred</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Success result */}
              {fpResult && (
                <Alert className="border-green-500/40 bg-green-500/10">
                  <AlertDescription className="text-green-300 text-sm flex items-center justify-between gap-3 flex-wrap">
                    <span>
                      ✓ Removed {fpResult.success} file{fpResult.success !== 1 ? "s" : ""}.
                      {fpResult.foldersRemoved > 0 && ` ${fpResult.foldersRemoved} empty folder${fpResult.foldersRemoved !== 1 ? "s" : ""} deleted from scan roots.`}
                      {fpResult.failed > 0 && ` ${fpResult.failed} failed.`}
                    </span>
                    {fpScanState === "scanning" && (
                      <span className="flex items-center gap-1.5 text-green-400/70 text-xs shrink-0">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Rescanning collection…
                      </span>
                    )}
                    {fpScanState === "done" && (
                      <span className="text-green-400/70 text-xs shrink-0">Collection updated.</span>
                    )}
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
              {fpPlan && activeFpItems.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {activeFpItems.length.toLocaleString()} files · {formatBytes(activeFpItems.reduce((s, d) => s + d.rom.filesize, 0))} to remove
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
                  <div className="h-64 overflow-y-auto overflow-x-hidden">
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
                          <span className={`min-w-0 flex-1 truncate font-mono ${isNoCounterpart ? "text-amber-300/80" : "text-muted-foreground"}`}>
                            {item.rom.filename}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>
                            {REASON_LABELS[rk] ?? rk}
                          </span>
                          <span className="text-muted-foreground/60 shrink-0">{getAbbrev(item.rom.console)}</span>
                        </div>
                      );
                    })}
                    {filteredFpItems.length === 0 && fpPreviewSearch && (
                      <div className="px-4 py-4 text-xs text-muted-foreground text-center">No matches for "{fpPreviewSearch}"</div>
                    )}
                  </div>
                </div>
              )}

              {fpPlan && activeFpItems.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {fpPlan.to_delete.length === 0
                    ? "Nothing to remove — all files are already in the preferred format."
                    : "No items match the selected pairs."}
                </p>
              )}

              {/* Format pair actions */}
              <div className="flex gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={fpLoading || !anySelectedPrefSet}
                  onClick={previewFormatPairs}
                  className="gap-2"
                >
                  {fpLoading ? "Analyzing…" : fpPlan ? "Re-analyze" : "Analyze Removals"}
                </Button>
                {fpPlan && activeFpItems.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={fpExecuting} className="gap-2">
                        <Trash2 className="w-3.5 h-3.5" />
                        {fpExecuting ? "Removing…" : `Remove ${activeFpItems.length.toLocaleString()} files`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove format-pair files?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {activeFpItems.length.toLocaleString()} files from non-preferred format folders
                          ({formatBytes(activeFpItems.reduce((s, d) => s + d.rom.filesize, 0))}) will be permanently deleted.
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
                          Delete permanently
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
              description={row.description}
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
              description={row.description}
              checked={filters[row.key]}
              onToggle={() => toggle(row.key)}
              destructive={row.destructive}
            />
          ))}
        </section>

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
                <Button size="sm" variant="ghost" onClick={() => setPlanStore(null)} className="text-xs gap-1 text-muted-foreground">
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
                <div className="text-xl font-bold text-green-400">{catKeepItems.length.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">to keep</div>
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">
                  {formatBytes(checkedItems.reduce((s, i) => s + i.rom.filesize, 0))}
                </div>
                <div className="text-xs text-muted-foreground">to reclaim</div>
              </div>
            </div>

            {/* Category filter tabs */}
            {(() => {
              const tabs = [
                { key: "all" as const,        label: "All",                 count: plan.to_delete.length },
                { key: "game" as const,   label: "ROMs",         count: plan.to_delete.filter(i => i.rom.file_category === "game" || i.rom.file_category === "unofficial").length },
                { key: "system" as const, label: "System Files", count: plan.to_delete.filter(i => i.rom.file_category !== "game" && i.rom.file_category !== "unofficial").length },
              ].filter(t => t.key === "all" || t.count > 0 || (plan.to_keep.filter(r => matchesCat(r.file_category, t.key)).length > 0));
              return tabs.length > 1 ? (
                <div className="px-4 py-2 border-b border-border flex items-center gap-1 flex-wrap">
                  {tabs.map(({ key, label, count }) => (
                    <button
                      key={key}
                      onClick={() => { setPreviewCategory(key); setPreviewSearch(""); setShowAllPreview(false); }}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${previewCategory === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}{key !== "all" && <span className="ml-1 opacity-60">({count})</span>}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}

            {(previewCategory === "all" || previewCategory === "game") && noPreferredCount > 0 && (
              <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/10 border-b border-border">
                {noPreferredCount} title{noPreferredCount !== 1 ? "s" : ""} deleted — no preferred-language version exists
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
            <div className="h-72 overflow-y-auto overflow-x-hidden">
              {(showAllPreview ? filteredItems : filteredItems.slice(0, 200)).map((item, i) => {
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
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{item.rom.filename}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>
                      {REASON_LABELS[rk] ?? rk}
                    </span>
                    <span className="text-muted-foreground/60 shrink-0">{getAbbrev(item.rom.console)}</span>
                  </div>
                );
              })}
              {!showAllPreview && filteredItems.length > 200 && (
                <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
                  <span>…and {(filteredItems.length - 200).toLocaleString()} more</span>
                  <button
                    onClick={() => setShowAllPreview(true)}
                    className="text-primary hover:underline"
                  >
                    Show all
                  </button>
                </div>
              )}
              {filteredItems.length === 0 && previewSearch && (
                <div className="px-4 py-4 text-xs text-muted-foreground text-center">No matches for "{previewSearch}"</div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={plan ? () => setPlanStore(null) : preview}
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
                  disabled={executing || checkedItems.length === 0}
                  variant="destructive"
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  {executing
                    ? "Deleting…"
                    : `Delete ${checkedItems.length.toLocaleString()} files permanently`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                  <AlertDialogDescription>
                    {checkedItems.length.toLocaleString()} files will be permanently deleted ({formatBytes(checkedItems.reduce((s, i) => s + i.rom.filesize, 0))} freed). This cannot be undone.
                    {uncheckedPaths.size > 0 && (
                      <span className="block mt-1 text-muted-foreground">{uncheckedPaths.size} unchecked file{uncheckedPaths.size !== 1 ? "s" : ""} will be skipped.</span>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={doExecute} className="bg-destructive hover:bg-destructive/90">
                    Delete permanently
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

function FilterRow({ label, description, checked, onToggle, destructive }: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border bg-card/50">
      <div className="flex-1 space-y-0.5">
        <Label className={`text-sm cursor-default ${destructive ? "text-red-400" : "text-foreground"}`}>{label}</Label>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        className={`shrink-0 mt-0.5${destructive ? " data-[state=checked]:bg-destructive" : ""}`}
      />
    </div>
  );
}
