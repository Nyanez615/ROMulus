import { useState, useMemo, useEffect } from "react";
import { PackageOpen, PackagePlus, AlertTriangle, CheckCircle2, Search, CheckSquare, Square, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatBytes, previewExtract, extractZips, previewCompress, compressFiles,
  onExtractProgress, onExtractComplete, onCompressProgress, onCompressComplete,
} from "@/lib/tauri";
import { matchesLang, matchesRegion, matchesStatus, matchesPreferred, matchesStartingLetter, startingLetter, STARTING_LETTERS } from "@/lib/romFilters";
import { FileContextMenu } from "@/components/FileContextMenu";
import { FilterBar } from "@/components/FilterBar";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { ExtractPreview } from "@/lib/bindings/ExtractPreview";
import type { CompressPreview } from "@/lib/bindings/CompressPreview";
import type { DirSpace } from "@/lib/bindings/DirSpace";
import type { FailedFile } from "@/lib/bindings/FailedFile";

function StatCell({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-lg font-bold ${color ?? "text-foreground"}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export interface ArchiveProgress {
  current_file: string;
  done: number;
  total: number;
  success: boolean;
}

interface NormalizedCandidate {
  path: string;
  filename: string;
  console: string;
  parentDir: string;
  primarySize: number;
  secondarySize?: number;
  alreadyDone: boolean;
}

export type ArchiveMode = "extract" | "compress";

const MODE_COPY: Record<ArchiveMode, {
  title: string;
  icon: typeof PackageOpen;
  verb: string;
  verbing: string;
  deleteLabel: string;
  needsLabel: string;
  alreadyLabel: string;
  needsLabelOne: string;
  needsLabelMany: string;
  alreadyLabelOne: string;
  alreadyLabelMany: string;
  redundantNoun: string;
}> = {
  extract: {
    title: "Extract Archives",
    icon: PackageOpen,
    verb: "Extract",
    verbing: "Extracting",
    deleteLabel: "Delete .zip after successful extraction",
    needsLabel: "Needs extraction",
    alreadyLabel: "Already extracted",
    needsLabelOne: "File needs extraction",
    needsLabelMany: "Files need extraction",
    alreadyLabelOne: "File already extracted",
    alreadyLabelMany: "Files already extracted",
    redundantNoun: "zip",
  },
  compress: {
    title: "Compress to Zip",
    icon: PackagePlus,
    verb: "Compress",
    verbing: "Compressing",
    deleteLabel: "Delete original file after successful compression",
    needsLabel: "Needs compression",
    alreadyLabel: "Already compressed",
    needsLabelOne: "File needs compression",
    needsLabelMany: "Files need compression",
    alreadyLabelOne: "File already compressed",
    alreadyLabelMany: "Files already compressed",
    redundantNoun: "file",
  },
};

function toggleChip<T extends string>(active: T[], value: T, set: (v: T[]) => void) {
  set(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
}

export function ArchiveActionDialog({
  mode,
  groups,
  singleFocusPath,
  knownRegions,
  knownLanguages,
  knownCategories,
  onActionComplete,
  onClose,
}: {
  mode: ArchiveMode;
  groups: RomGroup[];
  singleFocusPath: string | null;
  knownRegions: string[];
  knownLanguages: string[];
  knownCategories: string[];
  onActionComplete: () => void;
  onClose: () => void;
}) {
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;

  // ── Filtering (skipped entirely in single-file quick-action mode) ────────────
  const [search, setSearch] = useState("");
  const [activeStatus, setActiveStatus] = useState<string[]>([]);
  const [activeLangs, setActiveLangs] = useState<string[]>([]);
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [activePreferred, setActivePreferred] = useState<string[]>([]);
  const [activeLetters, setActiveLetters] = useState<string[]>([]);

  const availableLetters = useMemo(() => {
    const present = new Set(groups.map((g) => startingLetter(g.title_normalized)));
    return STARTING_LETTERS.filter((l) => present.has(l));
  }, [groups]);

  const candidatePaths = useMemo(() => {
    if (singleFocusPath) return [singleFocusPath];
    const filteredGroups = groups
      .filter((g) => activeLangs.length === 0 || matchesLang(g, activeLangs))
      .filter((g) => activeRegions.length === 0 || matchesRegion(g, activeRegions))
      .filter((g) => activeStatus.length === 0 || matchesStatus(g, activeStatus))
      .filter((g) => activeLetters.length === 0 || matchesStartingLetter(g, activeLetters))
      .filter((g) => matchesPreferred(g, activePreferred));
    return filteredGroups
      .flatMap((g) => g.variants)
      .filter((v) => (mode === "extract" ? v.file_format === "zip" : v.file_format !== "zip"))
      .map((v) => v.path);
  }, [groups, activeLangs, activeRegions, activeStatus, activeLetters, activePreferred, mode, singleFocusPath]);
  const candidateKey = candidatePaths.join("|");

  // ── Preview fetch — re-runs whenever the filtered candidate set changes ──────
  const [preview, setPreview] = useState<ExtractPreview | CompressPreview | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const loading = previewKey !== candidateKey;

  useEffect(() => {
    let cancelled = false;
    const promise = mode === "extract" ? previewExtract(candidatePaths) : previewCompress(candidatePaths);
    promise.then((p) => {
      if (cancelled) return;
      setPreview(p);
      setPreviewKey(candidateKey);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey, mode]);

  const normalized: NormalizedCandidate[] = useMemo(() => {
    if (!preview) return [];
    if (mode === "extract") {
      return (preview as ExtractPreview).candidates.map((c) => ({
        path: c.path, filename: c.filename, console: c.console, parentDir: c.parent_dir,
        primarySize: c.compressed_size, secondarySize: c.uncompressed_size, alreadyDone: c.already_extracted,
      }));
    }
    return (preview as CompressPreview).candidates.map((c) => ({
      path: c.path, filename: c.filename, console: c.console, parentDir: c.parent_dir,
      primarySize: c.source_size, alreadyDone: c.already_compressed,
    }));
  }, [preview, mode]);

  const invalid = mode === "extract" ? (preview as ExtractPreview | null)?.invalid : undefined;
  const availableSpace: DirSpace[] = useMemo(() => preview?.available_space ?? [], [preview]);

  const needsConversion = useMemo(() => normalized.filter((c) => !c.alreadyDone), [normalized]);
  const alreadyDone = useMemo(() => normalized.filter((c) => c.alreadyDone), [normalized]);

  const needsDisplayed = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return needsConversion;
    return needsConversion.filter((c) => c.filename.toLowerCase().includes(q) || c.console.toLowerCase().includes(q));
  }, [needsConversion, search]);
  const doneDisplayed = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return alreadyDone;
    return alreadyDone.filter((c) => c.filename.toLowerCase().includes(q) || c.console.toLowerCase().includes(q));
  }, [alreadyDone, search]);

  // ── Selection: "needs" defaults to all-selected (inverse), "delete" defaults to none ──
  const [uncheckedNeedsPaths, setUncheckedNeedsPaths] = useState<Set<string>>(new Set());
  const [checkedDeletePaths, setCheckedDeletePaths] = useState<Set<string>>(new Set());
  const [deleteAfter, setDeleteAfter] = useState(true);

  // Reset selection whenever the candidate set changes — adjusted during render
  // (React's recommended pattern) rather than via a reset-effect.
  const [prevCandidateKey, setPrevCandidateKey] = useState(candidateKey);
  if (candidateKey !== prevCandidateKey) {
    setPrevCandidateKey(candidateKey);
    setUncheckedNeedsPaths(new Set());
    setCheckedDeletePaths(new Set());
  }

  const checkedNeeds = useMemo(() => needsConversion.filter((c) => !uncheckedNeedsPaths.has(c.path)), [needsConversion, uncheckedNeedsPaths]);
  const checkedDelete = useMemo(() => alreadyDone.filter((c) => checkedDeletePaths.has(c.path)), [alreadyDone, checkedDeletePaths]);

  // Net bytes actually needed = sum over only the currently-checked "needs conversion"
  // items, grouped by directory — recomputed live as the selection (and the delete-after
  // toggle) changes, not a static snapshot over every candidate matching the current
  // filters. Extract writes uncompressed bytes; compress writes an unknown-but-≤-source
  // amount, so the source size is the safe estimate. When "delete after" is on, the
  // original is freed as part of the same operation, so its size is netted out —
  // extracting-then-deleting only needs (uncompressed − compressed) of new headroom, and
  // compressing-then-deleting nets to ~0 under the same worst-case zip-size estimate.
  const diskSpaceWarnings = useMemo(() => {
    const neededByDir = new Map<string, number>();
    for (const c of checkedNeeds) {
      const grossBytes = mode === "extract" ? (c.secondarySize ?? 0) : c.primarySize;
      const freedBytes = deleteAfter ? c.primarySize : 0;
      neededByDir.set(c.parentDir, (neededByDir.get(c.parentDir) ?? 0) + grossBytes - freedBytes);
    }
    return availableSpace
      .map((dir) => ({ parent_dir: dir.parent_dir, needed_bytes: neededByDir.get(dir.parent_dir) ?? 0, available_bytes: dir.available_bytes }))
      .filter((w) => w.needed_bytes > w.available_bytes);
  }, [checkedNeeds, availableSpace, mode, deleteAfter]);

  function toggleNeeds(path: string) {
    setUncheckedNeedsPaths((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  }
  function toggleDelete(path: string) {
    setCheckedDeletePaths((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  }

  // ── Execution ──────────────────────────────────────────────────────────────
  const [executing, setExecuting] = useState<"convert" | "delete" | null>(null);
  const [progress, setProgress] = useState<ArchiveProgress | null>(null);
  const [lastFailures, setLastFailures] = useState<FailedFile[] | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Path -> success, populated live from progress events so completed rows can
  // be marked as done (no separate "started" event exists — progress only
  // fires once a file's outcome is already known).
  const [completedThisRun, setCompletedThisRun] = useState<Map<string, boolean>>(new Map());
  // A fresh byte-weighted ETA snapshot, taken each time a file finishes; the
  // displayed "remaining" value counts down from this between snapshots
  // instead of being recomputed (and drifting upward) every tick.
  const [etaAnchor, setEtaAnchor] = useState<{ remainingMs: number; anchoredAt: number } | null>(null);

  // Ticks once a second while an action runs, purely to re-render the elapsed/
  // remaining-time display — the interval callback is the only thing calling
  // setState here, so this doesn't trip the set-state-in-effect rule.
  useEffect(() => {
    if (!executing) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [executing]);

  const elapsedMs = executing && startTime ? nowTick - startTime : 0;
  const remainingMs = useMemo(() => {
    if (!executing || !etaAnchor) return null;
    return Math.max(0, etaAnchor.remainingMs - (nowTick - etaAnchor.anchoredAt));
  }, [executing, etaAnchor, nowTick]);
  const doneCount = useMemo(() => [...completedThisRun.values()].filter(Boolean).length, [completedThisRun]);
  const failedCount = completedThisRun.size - doneCount;

  async function runAction(kind: "convert" | "delete") {
    const paths = kind === "convert" ? checkedNeeds.map((c) => c.path) : checkedDelete.map((c) => c.path);
    if (paths.length === 0) return;
    const effectiveDeleteAfter = kind === "delete" ? true : deleteAfter;
    setExecuting(kind);
    setProgress(null);
    setLastFailures(null);
    setStartTime(Date.now());
    setCompletedThisRun(new Map());
    setEtaAnchor(null);

    // Byte-weighted ETA bookkeeping — plain closure locals, not refs: this
    // function builds a fresh closure per call and its listener is torn down
    // before another can be registered, so there's no stale-closure risk.
    const sizeByPath = new Map(normalized.map((c) => [c.path, mode === "extract" ? (c.secondarySize ?? c.primarySize) : c.primarySize]));
    const totalBytes = paths.reduce((s, p) => s + (sizeByPath.get(p) ?? 0), 0);
    let bytesDone = 0;
    const runStart = Date.now();

    function trackProgress(p: ArchiveProgress) {
      setProgress(p);
      setCompletedThisRun((prev) => new Map(prev).set(p.current_file, p.success));
      bytesDone += sizeByPath.get(p.current_file) ?? 0;
      const elapsed = Date.now() - runStart;
      if (elapsed > 0 && bytesDone > 0) {
        const bytesPerMs = bytesDone / elapsed;
        const remaining = bytesPerMs > 0 ? Math.max(0, totalBytes - bytesDone) / bytesPerMs : 0;
        setEtaAnchor({ remainingMs: remaining, anchoredAt: Date.now() });
      }
    }

    if (mode === "extract") {
      const unlistenProgress = await onExtractProgress(trackProgress);
      const unlistenComplete = await onExtractComplete(async (result) => {
        unlistenProgress();
        unlistenComplete();
        setExecuting(null);
        setProgress(null);
        setStartTime(null);
        setLastFailures(result.failed.length > 0 ? result.failed : null);
        onActionComplete();
      });
      await extractZips(paths, effectiveDeleteAfter);
    } else {
      const unlistenProgress = await onCompressProgress(trackProgress);
      const unlistenComplete = await onCompressComplete(async (result) => {
        unlistenProgress();
        unlistenComplete();
        setExecuting(null);
        setProgress(null);
        setStartTime(null);
        setLastFailures(result.failed.length > 0 ? result.failed : null);
        onActionComplete();
      });
      await compressFiles(paths, effectiveDeleteAfter);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !executing) onClose(); }}>
      <DialogContent className="max-w-2xl w-full flex flex-col max-h-[90vh] gap-0 p-0 overflow-hidden">

        {/* Fixed header — stats */}
        <div className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold mb-3 flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            {copy.title}
          </DialogTitle>
          <div className="grid grid-cols-3 gap-3 text-center">
            <StatCell value={needsConversion.length.toLocaleString()} label={needsConversion.length === 1 ? copy.needsLabelOne : copy.needsLabelMany} />
            <StatCell value={alreadyDone.length.toLocaleString()} label={alreadyDone.length === 1 ? copy.alreadyLabelOne : copy.alreadyLabelMany} color="text-amber-400" />
            <StatCell
              value={formatBytes(needsConversion.reduce((s, c) => s + c.primarySize, 0))}
              label={mode === "extract" ? "compressed" : "source size"}
            />
          </div>
        </div>

        {/* Filter bar — hidden for the single-file quick action */}
        {!singleFocusPath && (
          <FilterBar
            groups={[
              { key: "letter", label: "Starts With", items: availableLetters, active: activeLetters, onToggle: (v) => toggleChip(activeLetters, v, setActiveLetters), onClear: () => setActiveLetters([]) },
              { key: "status", label: "Category", items: knownCategories, active: activeStatus, onToggle: (v) => toggleChip(activeStatus, v, setActiveStatus), onClear: () => setActiveStatus([]) },
              { key: "language", label: "Language", items: knownLanguages, active: activeLangs, onToggle: (v) => toggleChip(activeLangs, v, setActiveLangs), onClear: () => setActiveLangs([]) },
              { key: "region", label: "Region", items: knownRegions, active: activeRegions, onToggle: (v) => toggleChip(activeRegions, v, setActiveRegions), onClear: () => setActiveRegions([]) },
              { key: "preferred", label: "Preferred", items: ["Has preferred", "No preferred"], active: activePreferred, onToggle: (v) => toggleChip(activePreferred, v, setActivePreferred), onClear: () => setActivePreferred([]) },
            ]}
          />
        )}

        {/* Warnings */}
        {diskSpaceWarnings.length > 0 && (
          <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-start gap-2 shrink-0">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              Not enough free space in {diskSpaceWarnings.length} folder{diskSpaceWarnings.length !== 1 ? "s" : ""}:
              {diskSpaceWarnings.map((w) => (
                <span key={w.parent_dir} className="block font-mono text-[10px] mt-0.5">
                  {w.parent_dir} — needs {formatBytes(w.needed_bytes)}, has {formatBytes(w.available_bytes)}
                </span>
              ))}
            </div>
          </div>
        )}
        {invalid && invalid.length > 0 && (
          <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-muted/30 border border-border text-xs text-muted-foreground flex items-start gap-2 shrink-0">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{invalid.length} file{invalid.length !== 1 ? "s" : ""} couldn't be read as valid zips and were excluded.</span>
          </div>
        )}

        {/* Search toolbar */}
        <div className="shrink-0 border-b border-t border-border px-4 py-2 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0 flex-1"
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {loading && normalized.length === 0 && (
            <div className="px-4 py-8 text-xs text-muted-foreground text-center flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          )}

          {!loading && normalized.length === 0 && (
            <div className="px-4 py-8 text-xs text-muted-foreground text-center">
              Nothing found for the current filters.
            </div>
          )}

          {needsDisplayed.length > 0 && (
            <div>
              <div className="px-4 py-1.5 flex items-center justify-between bg-muted sticky top-0 z-10 border-b border-border/40">
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide">{copy.needsLabel} ({needsConversion.length})</span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setUncheckedNeedsPaths(new Set())} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <CheckSquare className="w-3 h-3" /> All
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={() => setUncheckedNeedsPaths(new Set(needsConversion.map((c) => c.path)))} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <Square className="w-3 h-3" /> None
                  </button>
                </div>
              </div>
              {needsDisplayed.map((c) => {
                const isChecked = !uncheckedNeedsPaths.has(c.path);
                const runResult = completedThisRun.get(c.path);
                return (
                  <FileContextMenu key={c.path} path={c.path}>
                    <div
                      className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20 cursor-pointer ${!isChecked ? "opacity-40" : ""} ${runResult === true ? "opacity-60" : ""} ${runResult === false ? "bg-destructive/10" : ""}`}
                      onClick={() => !executing && toggleNeeds(c.path)}
                    >
                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isChecked ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                        {isChecked && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                      </div>
                      <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground" title={c.filename}>{c.filename}</span>
                      <span className="text-muted-foreground/50 shrink-0 text-[10px]">{c.console}</span>
                      <span className="text-muted-foreground/60 shrink-0 text-[10px] tabular-nums w-16 text-right">{formatBytes(c.primarySize)}</span>
                      {runResult === true && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
                      {runResult === false && <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />}
                    </div>
                  </FileContextMenu>
                );
              })}
            </div>
          )}

          {doneDisplayed.length > 0 && (
            <div>
              <div className="px-4 py-1.5 flex items-center justify-between bg-muted sticky top-0 z-10 border-b border-amber-500/30">
                <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">{copy.alreadyLabel} ({alreadyDone.length}) — {copy.redundantNoun} is redundant</span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setCheckedDeletePaths(new Set(alreadyDone.map((c) => c.path)))} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <CheckSquare className="w-3 h-3" /> All
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={() => setCheckedDeletePaths(new Set())} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                    <Square className="w-3 h-3" /> None
                  </button>
                </div>
              </div>
              {doneDisplayed.map((c) => {
                const isChecked = checkedDeletePaths.has(c.path);
                const runResult = completedThisRun.get(c.path);
                return (
                  <FileContextMenu key={c.path} path={c.path}>
                    <div
                      className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20 cursor-pointer ${runResult === true ? "opacity-60" : ""} ${runResult === false ? "bg-destructive/10" : ""}`}
                      onClick={() => !executing && toggleDelete(c.path)}
                    >
                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isChecked ? "bg-destructive/20 border-destructive/60" : "border-border"}`}>
                        {isChecked && <div className="w-1.5 h-1.5 rounded-sm bg-destructive" />}
                      </div>
                      <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground" title={c.filename}>{c.filename}</span>
                      <span className="text-muted-foreground/50 shrink-0 text-[10px]">{c.console}</span>
                      <span className="text-muted-foreground/60 shrink-0 text-[10px] tabular-nums w-16 text-right">{formatBytes(c.primarySize)}</span>
                      {runResult === true && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
                      {runResult === false && <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />}
                    </div>
                  </FileContextMenu>
                );
              })}
            </div>
          )}
        </div>

        {/* Last-action failures */}
        {lastFailures && lastFailures.length > 0 && (
          <div className="mx-4 my-2 px-3 py-1.5 rounded bg-destructive/10 border border-destructive/30 text-xs text-destructive shrink-0 max-h-24 overflow-y-auto">
            <div className="flex items-center gap-2 font-medium mb-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {lastFailures.length} file{lastFailures.length !== 1 ? "s" : ""} failed
            </div>
            {lastFailures.map((f) => (
              <div key={f.path} className="font-mono text-[10px] text-destructive/80 pl-5">
                {f.path.split(/[\\/]/).pop()} — {f.error}
              </div>
            ))}
          </div>
        )}

        {/* Elapsed / remaining time while running */}
        {executing && (
          <div className="px-6 py-1.5 border-t border-border/50 flex items-center justify-center gap-2 text-[11px] text-muted-foreground shrink-0 tabular-nums">
            <span>{doneCount} done{failedCount > 0 ? ` · ${failedCount} failed` : ""}</span>
            <span>· Elapsed {formatDuration(elapsedMs)}</span>
            {remainingMs !== null && <span>· ~{formatDuration(remainingMs)} remaining</span>}
          </div>
        )}

        {/* Fixed footer */}
        <div className="border-t border-border shrink-0">
          {alreadyDone.length > 0 && (
            <div className="px-6 py-2.5 border-b border-border/50 flex items-center gap-3 bg-amber-500/5">
              <span className="text-xs text-amber-400 flex-1">
                {alreadyDone.length} {copy.redundantNoun}{alreadyDone.length !== 1 ? "s" : ""} redundant — {mode === "extract" ? "the extracted file already exists" : "a matching zip already exists"}.
              </span>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0"
                disabled={!!executing || checkedDelete.length === 0}
                onClick={() => runAction("delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {executing === "delete"
                  ? `Deleting… ${progress?.done ?? 0}/${progress?.total ?? checkedDelete.length}`
                  : `Delete ${checkedDelete.length.toLocaleString()}`}
              </Button>
            </div>
          )}
          <div className="px-6 py-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <div
                className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${deleteAfter ? "bg-primary/20 border-primary/60" : "border-border"}`}
                onClick={() => !executing && setDeleteAfter((v) => !v)}
              >
                {deleteAfter && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
              </div>
              <span onClick={() => !executing && setDeleteAfter((v) => !v)}>{copy.deleteLabel}</span>
            </label>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={onClose} disabled={!!executing}>Close</Button>
            <Button
              size="sm"
              disabled={!!executing || checkedNeeds.length === 0}
              onClick={() => runAction("convert")}
              className="gap-1.5"
            >
              <Icon className="w-3.5 h-3.5" />
              {executing === "convert"
                ? `${copy.verbing}… ${progress?.done ?? 0}/${progress?.total ?? checkedNeeds.length}`
                : `${copy.verb} ${checkedNeeds.length.toLocaleString()} file${checkedNeeds.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
