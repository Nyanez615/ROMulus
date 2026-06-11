import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wifi, WifiOff, RefreshCw, Play, CheckCircle2, Scissors,
  Download, X, Search, ChevronDown, ChevronRight, ChevronsUpDown, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { useUIStore } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import { refreshTagStore } from "@/components/Layout";
import {
  getQbtSettings,
  listQbtTorrents,
  previewQbtFilter,
  applyQbtFilter,
  testQbtConnection,
  applyFilters,
  executePrune,
  scanRoots,
  getSettings,
  getConsoles,
  formatBytes,
} from "@/lib/tauri";
import type { QbtSettings } from "@/lib/bindings/QbtSettings";
import type { QbtTorrent } from "@/lib/bindings/QbtTorrent";
import type { QbtFilterPreview } from "@/lib/bindings/QbtFilterPreview";
import type { QbtApplyResult } from "@/lib/bindings/QbtApplyResult";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { RomFile } from "@/lib/bindings/RomFile";

const SHOW_ALL_THRESHOLD = 200;

// ── Pre-download section ──────────────────────────────────────────────────────

function PreDownloadSection() {
  const { setActiveTab } = useUIStore();
  const { setConsoles, setStatus, bumpCacheVersion } = useScanStore();
  const [qbtSettings, setQbtSettings] = useState<QbtSettings | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [torrents, setTorrents] = useState<QbtTorrent[]>([]);
  const [torrentsLoading, setTorrentsLoading] = useState(false);
  const [selectedHash, setSelectedHash] = useState("");
  const [torrentComboOpen, setTorrentComboOpen] = useState(false);
  const [manualHash, setManualHash] = useState("");
  const [preview, setPreview] = useState<QbtFilterPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<QbtApplyResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyScanState, setApplyScanState] = useState<"idle" | "scanning" | "done">("idle");

  // Preview panel state
  const [fileTab, setFileTab] = useState<"groups" | "all" | "download" | "skip">("groups");
  const [fileSearch, setFileSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    getQbtSettings().then((s) => {
      setQbtSettings(s);
      testQbtConnection()
        .then((ok) => setConnected(ok))
        .catch(() => setConnected(false));
    });
  }, []);

  const handleLoadTorrents = useCallback(async () => {
    setTorrentsLoading(true);
    setPreview(null);
    setApplyResult(null);
    try {
      const list = await listQbtTorrents();
      setTorrents(list);
      if (list.length > 0 && !selectedHash) {
        const sorted = [...list].sort((a, b) => torrentLabel(a).localeCompare(torrentLabel(b)));
        setSelectedHash(sorted[0].hash);
      }
    } catch {
      setConnected(false);
    } finally {
      setTorrentsLoading(false);
    }
  }, [selectedHash]);

  async function handlePreview() {
    const hash = selectedHash || manualHash.trim();
    if (!hash) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setApplyResult(null);
    setFileTab("groups");
    setFileSearch("");
    setShowAll(false);
    setExpandedGroups(new Set());
    try {
      const result = await previewQbtFilter(hash);
      setPreview(result);
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    const hash = selectedHash || manualHash.trim();
    if (!hash) return;
    setApplying(true);
    setApplyError(null);
    setApplyScanState("idle");
    try {
      const result = await applyQbtFilter(hash);
      setApplyResult(result);
      // Rescan so the sidebar/dashboard reflect the newly-queued files.
      const settings = await getSettings().catch(() => null);
      if (settings?.rom_roots.length) {
        setApplyScanState("scanning");
        try {
          const scanResult = await scanRoots(settings.rom_roots);
          setStatus(scanResult);
          setConsoles(await getConsoles());
          refreshTagStore();
          bumpCacheVersion();
          setApplyScanState("done");
        } catch {
          setApplyScanState("idle");
        }
      }
    } catch (e) {
      setApplyError(String(e));
    } finally {
      setApplying(false);
    }
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeHash = selectedHash || manualHash.trim();

  // Derived filtered file list for flat-list tabs
  const filteredFiles = useMemo(() => {
    if (!preview) return [];
    let files = preview.files;
    if (fileTab === "download") files = files.filter((f) => f.download);
    if (fileTab === "skip") files = files.filter((f) => !f.download);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      files = files.filter((f) => f.filename.toLowerCase().includes(q));
    }
    return files;
  }, [preview, fileTab, fileSearch]);

  const visibleFiles = showAll ? filteredFiles : filteredFiles.slice(0, SHOW_ALL_THRESHOLD);
  const hasMore = filteredFiles.length > SHOW_ALL_THRESHOLD && !showAll;

  const filteredGroups = useMemo(() => {
    if (!preview) return [];
    // Backend already sorts alphabetically; filter by search if active.
    if (!fileSearch.trim()) return preview.multi_variant_groups;
    const q = fileSearch.toLowerCase();
    return preview.multi_variant_groups.filter(
      (g) =>
        g.display_title.toLowerCase().includes(q) ||
        g.chosen.toLowerCase().includes(q) ||
        g.skipped.some((s) => s.toLowerCase().includes(q)),
    );
  }, [preview, fileSearch]);


  function torrentLabel(t: QbtTorrent): string {
    const primary = t.console_folder ?? t.name;
    const secondary = t.console_folder ? ` · ${t.name}` : "";
    return `${primary}${secondary} (${t.num_files.toLocaleString()} files)`;
  }

  const sortedTorrents = useMemo(
    () => [...torrents].sort((a, b) => torrentLabel(a).localeCompare(torrentLabel(b))),
    [torrents], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selectedTorrent = sortedTorrents.find((t) => t.hash === selectedHash) ?? null;

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-6 rounded-full bg-primary" />
        <h2 className="text-sm font-semibold text-foreground">Pre-download: filter torrent priorities</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Connect to qBittorrent, select a No-Intro torrent, and set file priorities before downloading begins.
        Your region and language preferences are applied automatically.
      </p>

      {/* Connection status */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border",
          connected === true
            ? "border-green-500/30 bg-green-500/10 text-green-400"
            : connected === false
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground",
        )}>
          {connected === true
            ? <><Wifi className="w-3 h-3" /> Connected to {qbtSettings?.host}</>
            : connected === false
              ? <><WifiOff className="w-3 h-3" /> Not connected</>
              : <><WifiOff className="w-3 h-3" /> Checking…</>}
        </div>
        <button
          onClick={() => setActiveTab("settings")}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Configure in Settings
        </button>
      </div>

      {/* Torrent selector */}
      <div className="space-y-2">
        <button
          onClick={handleLoadTorrents}
          disabled={torrentsLoading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3 h-3", torrentsLoading && "animate-spin")} />
          {torrents.length > 0 ? "Refresh torrents" : "Load torrents"}
        </button>

        {sortedTorrents.length > 0 && (
          <Popover open={torrentComboOpen} onOpenChange={setTorrentComboOpen}>
            <PopoverTrigger asChild>
              <button
                role="combobox"
                aria-expanded={torrentComboOpen}
                className="w-full flex items-center justify-between text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
              >
                <span className="truncate text-left">
                  {selectedTorrent ? torrentLabel(selectedTorrent) : "Select a torrent…"}
                </span>
                <ChevronsUpDown className="w-3 h-3 ml-2 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="p-0 w-[var(--radix-popover-trigger-width)]"
              align="start"
            >
              <Command>
                <CommandInput placeholder="Search torrents…" className="text-xs h-8" />
                <CommandList className="max-h-64">
                  <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                    No torrent found.
                  </CommandEmpty>
                  <CommandGroup>
                    {sortedTorrents.map((t) => (
                      <CommandItem
                        key={t.hash}
                        value={torrentLabel(t)}
                        onSelect={() => {
                          setSelectedHash(t.hash);
                          setPreview(null);
                          setApplyResult(null);
                          setTorrentComboOpen(false);
                        }}
                        className="text-xs gap-2"
                      >
                        <Check className={cn("w-3 h-3 shrink-0", t.hash === selectedHash ? "opacity-100" : "opacity-0")} />
                        {torrentLabel(t)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {torrents.length === 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Or enter a torrent hash manually:</p>
            <input
              type="text"
              value={manualHash}
              onChange={(e) => { setManualHash(e.target.value); setPreview(null); setApplyResult(null); }}
              placeholder="e.g. a1b2c3d4e5f6…"
              className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>
        )}
      </div>

      {/* Preview button */}
      <button
        onClick={handlePreview}
        disabled={!activeHash || previewLoading}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Play className={cn("w-3 h-3", previewLoading && "animate-pulse")} />
        {previewLoading ? "Analyzing…" : "Preview"}
      </button>

      {previewError && (
        <p className="text-xs text-destructive">{previewError}</p>
      )}

      {/* ── Preview results — mirrors PrunePreviewDialog layout ── */}
      {preview && (
        <div className="border border-border rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: "60vh" }}>

          {/* Fixed header: console chip + 3-column stats */}
          <div className="px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              {preview.console_name && (
                <span className="text-xs font-medium text-foreground bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">
                  {preview.console_name}
                </span>
              )}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  <span className="text-foreground font-semibold tabular-nums">
                    {preview.total.toLocaleString()}
                  </span>{" "}total
                </span>
                <span className="text-green-400">
                  <span className="font-semibold tabular-nums">
                    {preview.to_download.toLocaleString()}
                  </span>{" "}download
                </span>
                <span className="text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">
                    {preview.to_skip.toLocaleString()}
                  </span>{" "}skip
                </span>
              </div>
            </div>
          </div>

          {/* Filter tabs + search — non-scrolling */}
          <div className="px-4 pt-2 pb-2 border-b border-border shrink-0 space-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              {([
                { id: "groups", label: "Titles", count: preview.multi_variant_groups.length },
                { id: "all",    label: "All",    count: preview.total },
                { id: "download", label: "Download", count: preview.to_download },
                { id: "skip",   label: "Skip",   count: preview.to_skip },
              ] as const).map(({ id, label, count }) => (
                <button
                  key={id}
                  onClick={() => { setFileTab(id); setShowAll(false); }}
                  className={cn(
                    "text-xs px-3 py-1 rounded-md border transition-colors",
                    fileTab === id
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  {label} <span className="tabular-nums ml-1 opacity-70">{count.toLocaleString()}</span>
                </button>
              ))}
              {fileTab === "groups" && filteredGroups.some((g) => g.skipped.length > 0) && (
                <button
                  onClick={() => {
                    const expandable = filteredGroups.filter((g) => g.skipped.length > 0).map((g) => g.key);
                    if (expandedGroups.size >= expandable.length) {
                      setExpandedGroups(new Set());
                    } else {
                      setExpandedGroups(new Set(expandable));
                    }
                  }}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expandedGroups.size >= filteredGroups.filter((g) => g.skipped.length > 0).length ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={fileSearch}
                onChange={(e) => { setFileSearch(e.target.value); setShowAll(false); }}
                placeholder={fileTab === "groups" ? "Search titles…" : "Search files…"}
                className="w-full text-xs bg-background border border-border rounded-md pl-7 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {fileTab === "groups" ? (
              /* ── Groups accordion ── */
              filteredGroups.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No titles match.</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredGroups.map((g) => {
                    const isMulti = g.skipped.length > 0;
                    const isExpanded = expandedGroups.has(g.key);
                    return (
                      <div key={g.key}>
                        {isMulti ? (
                          /* Multi-variant: expandable accordion row */
                          <button
                            onClick={() => toggleGroup(g.key)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/30 transition-colors"
                          >
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                              : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                            <span className="text-xs text-foreground font-medium flex-1 truncate">{g.display_title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {(g.skipped.length + 1).toLocaleString()} variants
                            </span>
                          </button>
                        ) : (
                          /* Single-variant: flat row, always download */
                          <div className="flex items-center gap-2 px-4 py-2">
                            <Download className="w-3 h-3 text-green-400 shrink-0" />
                            <span className="text-xs text-foreground flex-1 truncate">{g.display_title}</span>
                          </div>
                        )}
                        {isMulti && isExpanded && (
                          <div className="px-8 pb-2 space-y-1">
                            <div className="flex items-start gap-2">
                              <Download className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                              <span className="text-xs text-foreground font-mono break-all">{g.chosen}</span>
                            </div>
                            {g.skipped.map((s) => (
                              <div key={s} className="flex items-start gap-2">
                                <X className="w-3 h-3 text-muted-foreground/50 shrink-0 mt-0.5" />
                                <span className="text-xs text-muted-foreground font-mono break-all">{s}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              /* ── Flat file list (All / Download / Skip) ── */
              filteredFiles.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No files match.</p>
              ) : (
                <div className="divide-y divide-border/40">
                  {visibleFiles.map((f) => (
                    <div key={f.filename} className="flex items-start gap-2.5 px-4 py-1.5">
                      {f.download
                        ? <Download className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                        : <X className="w-3 h-3 text-muted-foreground/50 shrink-0 mt-0.5" />}
                      <span className={cn(
                        "text-xs font-mono break-all leading-relaxed",
                        f.download ? "text-foreground" : "text-muted-foreground",
                      )}>
                        {f.filename}
                      </span>
                    </div>
                  ))}
                  {hasMore && (
                    <div className="px-4 py-2">
                      <button
                        onClick={() => setShowAll(true)}
                        className="text-xs text-primary hover:underline"
                      >
                        Show all {filteredFiles.length.toLocaleString()} files…
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          {/* Footer: apply button + piece-size note */}
          {!applyResult && (
            <div className="px-4 py-3 border-t border-border bg-muted/10 shrink-0 space-y-2">
              <button
                onClick={handleApply}
                disabled={applying}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className={cn("w-3.5 h-3.5", applying && "animate-pulse")} />
                {applying ? "Applying…" : "Apply priorities in qBittorrent"}
              </button>
            </div>
          )}
        </div>
      )}

      {applyError && <p className="text-xs text-destructive">{applyError}</p>}

      {applyResult && (
        <div className="flex items-center justify-between gap-3 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Priorities set — {applyResult.to_download.toLocaleString()} files to download,{" "}
            {applyResult.to_skip.toLocaleString()} skipped.
          </span>
          {applyScanState === "scanning" && (
            <span className="flex items-center gap-1.5 text-green-400/70 shrink-0">
              <RefreshCw className="w-3 h-3 animate-spin" /> Scanning…
            </span>
          )}
          {applyScanState === "done" && <span className="text-green-400/70 shrink-0">Collection updated.</span>}
        </div>
      )}
    </section>
  );
}

// ── Post-download section ─────────────────────────────────────────────────────

function PostDownloadSection() {
  const { setSelectedConsoles } = useScanStore();
  const { setActiveTab } = useUIStore();
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deleted: number; bytes: number } | null>(null);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeError(null);
    setPlan(null);
    setResult(null);
    try {
      const p = await applyFilters();
      setPlan(p);
    } catch (e) {
      setAnalyzeError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleExecute() {
    if (!plan) return;
    const toDelete = plan.to_delete.map((d) => d.rom as RomFile);
    const bytes = plan.total_bytes_freed;
    setExecuting(true);
    setExecuteError(null);
    try {
      const res = await executePrune(toDelete);
      setResult({ deleted: res.success_count, bytes });
      setPlan(null);
      const settings = await getSettings().catch(() => null);
      if (settings?.rom_roots.length) {
        await scanRoots(settings.rom_roots);
        await getConsoles();
      }
    } catch (e) {
      setExecuteError(String(e));
    } finally {
      setExecuting(false);
    }
  }

  function handleReviewInRoms() {
    setSelectedConsoles(null);
    setActiveTab("roms");
  }

  const toDeleteCount = plan?.to_delete.length ?? 0;
  const bytesFreed = plan?.total_bytes_freed ?? 0;

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-6 rounded-full bg-muted-foreground/40" />
        <h2 className="text-sm font-semibold text-foreground">Post-download: prune local duplicates</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        After downloading, remove non-preferred regional variants from your local library.
        Uses the same region and language preferences as the pre-download filter above.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors disabled:opacity-50"
        >
          <Scissors className={cn("w-3 h-3", analyzing && "animate-pulse")} />
          {analyzing ? "Analyzing…" : "Analyze duplicates"}
        </button>
        <button
          onClick={handleReviewInRoms}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Review in ROMs tab
        </button>
      </div>

      {analyzeError && <p className="text-xs text-destructive">{analyzeError}</p>}

      {plan && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-3 bg-muted/30 border-b border-border">
            <span className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{toDeleteCount.toLocaleString()}</span> files to delete
            </span>
            <span className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{formatBytes(bytesFreed)}</span> freed
            </span>
            {plan.no_preferred_version_count > 0 && (
              <span className="text-xs text-yellow-400">
                {plan.no_preferred_version_count.toLocaleString()} groups with no preferred variant
              </span>
            )}
          </div>

          {toDeleteCount === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Nothing to prune — your library already contains only preferred variants.
            </p>
          ) : (
            <div className="px-4 py-3 border-t border-border bg-muted/10 space-y-2">
              <p className="text-xs text-destructive/80">
                {toDeleteCount.toLocaleString()} files ({formatBytes(bytesFreed)}) will be permanently deleted.
                This cannot be undone.
              </p>
              <button
                onClick={handleExecute}
                disabled={executing}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                <Scissors className={cn("w-3.5 h-3.5", executing && "animate-pulse")} />
                {executing ? "Deleting…" : `Delete ${toDeleteCount.toLocaleString()} files permanently`}
              </button>
            </div>
          )}
        </div>
      )}

      {executeError && <p className="text-xs text-destructive">{executeError}</p>}

      {result && (
        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Deleted {result.deleted.toLocaleString()} files · {formatBytes(result.bytes)} freed.
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Downloads() {
  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">Downloads</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto p-8 space-y-10">
          <PreDownloadSection />
          <div className="border-t border-border/50" />
          <PostDownloadSection />
        </div>
      </div>
    </div>
  );
}
