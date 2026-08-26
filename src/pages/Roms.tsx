import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronRight, ChevronDown, CheckCircle2, AlertCircle, HelpCircle, Trash2, Loader2, PackageOpen, PackagePlus } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getRoms, applyFilters, executePrune, scanRoots, getSettings, getConsoles, formatBytes, getPlayEntries, setPlayEntry, deletePlayEntry } from "@/lib/tauri";
import type { PlayEntry, PlayStatus } from "@/lib/tauri";
import { getRegionDefaultLanguages } from "@/lib/regionUtils";
import { matchesLang, matchesRegion, matchesStatus, matchesPreferred } from "@/lib/romFilters";
import { ROM_SORT_FIELDS, isArchive, type RomSortField, type SortDir } from "@/lib/romUtils";
import { SortControl } from "@/components/SortControl";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import { PrunePreviewDialog } from "@/components/PrunePreviewDialog";
import { ArchiveActionDialog } from "@/components/ArchiveActionDialog";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { usePreferencesStore } from "@/store/preferences";
import { getShortConsoleName, getConsoleDisplayName, getCanonicalConsoleName } from "@/lib/consoleUtils";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { FileContextMenu } from "@/components/FileContextMenu";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { FilterBar } from "@/components/FilterBar";
import { RomThumbnail } from "@/components/RomThumbnail";
import { AlphabetScrubber } from "@/components/AlphabetScrubber";
import { VariantCountScrubber } from "@/components/VariantCountScrubber";
import { refreshTagStore } from "@/components/Layout";
import { PlayStatusBadge } from "@/components/PlayStatusBadge";
import { StarRating } from "@/components/StarRating";

// ── Journal popover (inline edit inside ROMs tab) ────────────────────────────

const ALL_PLAY_STATUSES: PlayStatus[] = ["backlog", "testing", "playing", "completed", "dropped"];
const PLAY_STATUS_LABEL: Record<PlayStatus, string> = {
  backlog: "Backlog", testing: "Testing", playing: "Playing", completed: "Completed", dropped: "Dropped",
};

interface JournalPopoverProps {
  titleNormalized: string;
  console_: string;
  entry: PlayEntry | null;
  onSave: (patch: Partial<PlayEntry>) => void;
  onDelete: () => void;
}

function JournalPopover({ entry, onSave, onDelete }: JournalPopoverProps) {
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [compatNotes, setCompatNotes] = useState(entry?.compat_notes ?? "");

  const currentStatus = entry?.status ?? "backlog";

  const communityDisplay = entry?.community_score != null ? (entry.community_score / 10).toFixed(1) : null;
  const criticDisplay    = entry?.critic_score    != null ? (entry.critic_score    / 10).toFixed(1)    : null;

  return (
    <div className="space-y-3">
      {/* Status */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_PLAY_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onSave({ status: s })}
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-medium border transition-colors",
              currentStatus === s
                ? {
                    backlog:   "bg-purple-500/20 text-purple-400 border-purple-500/40",
                    testing:   "bg-amber-500/20  text-amber-400  border-amber-500/40",
                    playing:   "bg-blue-500/20   text-blue-400   border-blue-500/40",
                    completed: "bg-green-500/20  text-green-400  border-green-500/40",
                    dropped:   "bg-muted/60      text-muted-foreground border-border",
                  }[s]
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {PLAY_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Rating */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-14 shrink-0">Rating</span>
        <StarRating
          value={entry?.rating ?? null}
          onChange={(v) => onSave({ rating: v })}
          size="md"
        />
      </div>

      {/* External scores */}
      {(communityDisplay || criticDisplay) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {communityDisplay && <span>Crowd <span className="text-foreground font-medium">{communityDisplay}/10</span></span>}
          {criticDisplay    && <span>Critics <span className="text-foreground font-medium">{criticDisplay}/10</span></span>}
        </div>
      )}

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (entry?.notes ?? "")) onSave({ notes: notes || null }); }}
        rows={2}
        placeholder="Notes…"
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
      />

      {/* Technical notes */}
      <textarea
        value={compatNotes}
        onChange={(e) => setCompatNotes(e.target.value)}
        onBlur={() => { if (compatNotes !== (entry?.compat_notes ?? "")) onSave({ compat_notes: compatNotes || null }); }}
        rows={1}
        placeholder="Technical notes…"
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
      />

      {entry && (
        <div className="flex justify-end pt-1">
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ── Verification badge ────────────────────────────────────────────────────────
function VerificationBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "verified") return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" aria-label="Verified" />;
  if (status === "modified") return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Modified" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" aria-label="Unverified" />;
}

// Load all groups for client-side sort/filter. Must exceed the largest realistic
// collection — 100k covers any local library; SQLite returns this quickly.
const ALL_GROUPS = 100_000;

export default function Roms() {
  const { selectedConsoles, cacheVersion, setConsoles, setStatus, bumpCacheVersion } = useScanStore();
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);
  const { region: knownRegions, status: knownStatus, language: knownLanguages, category: knownCategories } = useTagStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const allCategoryTags = useMemo(() => {
    const all = [...new Set([...knownStatus, ...knownCategories])].sort();
    if (groups.length === 0) return all; // don't hide chips while loading
    const present = new Set(
      groups.flatMap((g) => g.variants.flatMap((v) => v.status_flags)),
    );
    return all.filter((tag) => present.has(tag));
  }, [knownStatus, knownCategories, groups]);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<RomSortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [activeStatus, setActiveStatus] = useState<string[]>([]);
  const [activeLangs, setActiveLangs] = useState<string[]>([]);
  const [activePreferred, setActivePreferred] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const debouncedRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Journal state ─────────────────────────────────────────────────────────────
  const [journalMap, setJournalMap] = useState<Map<string, PlayEntry>>(new Map());

  const refreshJournal = useCallback(() => {
    getPlayEntries().then((entries) => {
      const map = new Map(entries.map((e) => [`${e.title_normalized}::${e.console}`, e]));
      setJournalMap(map);
    }).catch(console.error);
  }, []);

  useEffect(() => { refreshJournal(); }, [refreshJournal]);

  async function handleJournalSave(
    title_normalized: string,
    console_: string,
    patch: Partial<PlayEntry>,
    displayTitle: string,
  ) {
    const existing = journalMap.get(`${title_normalized}::${console_}`);
    const merged = {
      status: "backlog" as PlayStatus,
      rating: null,
      notes: null,
      compat_notes: null,
      ...existing,
      ...patch,
    };
    const saved = await setPlayEntry(
      title_normalized, console_, merged.status, merged.rating,
      merged.notes, merged.compat_notes, displayTitle,
    ).catch(console.error);
    if (!saved) return;
    setJournalMap((prev) => new Map(prev).set(`${title_normalized}::${console_}`, saved));
  }

  async function handleJournalDelete(title_normalized: string, console_: string) {
    await deletePlayEntry(title_normalized, console_).catch(console.error);
    setJournalMap((prev) => {
      const next = new Map(prev);
      next.delete(`${title_normalized}::${console_}`);
      return next;
    });
  }

  // ── Prune state ──────────────────────────────────────────────────────────────
  const [pruneLoading, setPruneLoading] = useState(false);
  const [prunePlan, setPrunePlan] = useState<DeletionPlan | null>(null);
  const [pruneExecuting, setPruneExecuting] = useState(false);
  const [pruneScanState, setPruneScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [pruneResult, setPruneResult] = useState<{ deleted: number; bytes: number } | null>(null);

  // Tracks the cacheVersion at which the current prune plan was loaded.
  // null = no plan loaded yet.
  const [prunePlanVersion, setPrunePlanVersion] = useState<number | null>(null);

  async function handlePrune() {
    setPruneLoading(true);
    setPruneResult(null);
    try {
      const plan = await applyFilters(selectedConsoles ?? undefined);
      setPrunePlan(plan);
      setPrunePlanVersion(cacheVersion);
    } finally {
      setPruneLoading(false);
    }
  }

  // Auto-refresh when the scan cache is newer than the loaded plan
  // (e.g. after changing Format Variant Preferences triggers a rescan).
  useEffect(() => {
    if (prunePlanVersion === null || prunePlanVersion === cacheVersion) return;
    applyFilters(selectedConsoles ?? undefined)
      .then((plan) => { setPrunePlan(plan); setPrunePlanVersion(cacheVersion); })
      .catch(() => { /* silently keep stale plan on error */ });
  // selectedConsoles intentionally excluded — the plan scope matches its load-time console filter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, prunePlanVersion]);

  async function handleExecutePrune(toDelete: RomFile[], bytesFreed: number) {
    setPruneExecuting(true);
    setPruneScanState("idle");
    let settings = null;
    try {
      const res = await executePrune(toDelete);
      setPruneResult({ deleted: res.success_count, bytes: bytesFreed });
      setPrunePlan(null);
      setPrunePlanVersion(null);
      settings = await getSettings().catch(() => null);
    } finally {
      setPruneExecuting(false);
    }
    if (!settings?.rom_roots.length) return;
    setPruneScanState("scanning");
    try {
      const scanResult = await scanRoots(settings.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
      setPruneScanState("done");
      setTimeout(() => { setPruneResult(null); setPruneScanState("idle"); }, 4000);
    } catch {
      setPruneScanState("idle");
    }
  }

  // ── Archive (extract/compress) — dialog owns its own filtering/preview/execution ──
  const [archiveDialogMode, setArchiveDialogMode] = useState<"extract" | "compress" | null>(null);
  const [archiveSingleFocus, setArchiveSingleFocus] = useState<string | null>(null);

  // Refresh the library after any file-converting action so new/removed files show up.
  async function refreshAfterArchiveAction() {
    const settings = await getSettings().catch(() => null);
    if (!settings?.rom_roots.length) return;
    try {
      const scanResult = await scanRoots(settings.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
    } catch {
      // silent — user can rescan manually from the Dashboard if needed
    }
  }

  function handleExtractSingle(path: string) {
    setArchiveSingleFocus(path);
    setArchiveDialogMode("extract");
  }

  function handleCompressSingle(path: string) {
    setArchiveSingleFocus(path);
    setArchiveDialogMode("compress");
  }

  useEffect(() => {
    clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      getRoms({ consoles: selectedConsoles ?? undefined, search, page: 1, perPage: ALL_GROUPS })
        .then((r) => setGroups(r.groups))
        .catch(console.error);
    }, 200);
  }, [selectedConsoles, search, cacheVersion]);

  function toggleChip<T extends string>(active: T[], value: T, set: (v: T[]) => void) {
    set(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  }

  // ── Faceted chip availability ─────────────────────────────────────────────────
  // Each facet-group memo applies all filters EXCEPT its own dimension so that the
  // available chips for dimension D reflect what is reachable given every OTHER
  // active filter. Active chips are always kept visible (user can deselect them).

  const categoryFacetGroups = useMemo(
    () => groups
      .filter((g) => activeLangs.length   === 0 || matchesLang(g, activeLangs))
      .filter((g) => activeRegions.length === 0 || matchesRegion(g, activeRegions))
      .filter((g) => matchesPreferred(g, activePreferred)),
    [groups, activeLangs, activeRegions, activePreferred],
  );
  const langFacetGroups = useMemo(
    () => groups
      .filter((g) => activeStatus.length  === 0 || matchesStatus(g, activeStatus))
      .filter((g) => activeRegions.length === 0 || matchesRegion(g, activeRegions))
      .filter((g) => matchesPreferred(g, activePreferred)),
    [groups, activeStatus, activeRegions, activePreferred],
  );
  const regionFacetGroups = useMemo(
    () => groups
      .filter((g) => activeStatus.length === 0 || matchesStatus(g, activeStatus))
      .filter((g) => activeLangs.length  === 0 || matchesLang(g, activeLangs))
      .filter((g) => matchesPreferred(g, activePreferred)),
    [groups, activeStatus, activeLangs, activePreferred],
  );

  const availableCategoryTags = useMemo(() => {
    if (groups.length === 0) return allCategoryTags;
    const present = new Set(
      categoryFacetGroups.flatMap((g) => g.variants.flatMap((v) => v.status_flags)),
    );
    return allCategoryTags.filter((t) => present.has(t) || activeStatus.includes(t));
  }, [groups, allCategoryTags, categoryFacetGroups, activeStatus]);

  const availableLangs = useMemo(() => {
    if (groups.length === 0) return knownLanguages;
    const present = new Set<string>();
    for (const g of langFacetGroups) {
      for (const v of g.variants) {
        v.languages.forEach((l) => present.add(l));
        if (v.languages.length === 0 && v.regions.length > 0) {
          getRegionDefaultLanguages(v.regions[0]).forEach((l) => present.add(l));
        }
      }
    }
    return knownLanguages.filter((l) => present.has(l) || activeLangs.includes(l));
  }, [groups, knownLanguages, langFacetGroups, activeLangs]);

  const availableRegions = useMemo(() => {
    if (groups.length === 0) return knownRegions;
    const present = new Set<string>();
    for (const g of regionFacetGroups) {
      for (const v of g.variants) {
        v.regions.forEach((r) => present.add(r));
        if (v.regions.length === 0 && v.languages.length > 0) {
          // Reverse inference: find which region chips match a language-only variant
          for (const r of knownRegions) {
            if (getRegionDefaultLanguages(r).some((l) => v.languages.includes(l))) {
              present.add(r);
            }
          }
        }
      }
    }
    return knownRegions.filter((r) => present.has(r) || activeRegions.includes(r));
  }, [groups, knownRegions, regionFacetGroups, activeRegions]);

  // Client-side sort + filter
  const displayGroups = useMemo(() => {
    const result = groups
      .filter((g) => activeLangs.length   === 0 || matchesLang(g, activeLangs))
      .filter((g) => activeRegions.length === 0 || matchesRegion(g, activeRegions))
      .filter((g) => activeStatus.length  === 0 || matchesStatus(g, activeStatus))
      .filter((g) => matchesPreferred(g, activePreferred));

    return [...result].sort((a, b) =>
      sortField === "variants"
        ? sortDir === "desc"
          ? b.variants.length - a.variants.length
          : a.variants.length - b.variants.length
        : sortDir === "asc"
          ? a.title_normalized.localeCompare(b.title_normalized)
          : b.title_normalized.localeCompare(a.title_normalized),
    );
  }, [groups, sortField, sortDir, activeRegions, activeStatus, activeLangs, activePreferred]);

  // Button enabled state only — the dialog itself does its own filtering over `groups`.
  const hasAnyZip = useMemo(() => groups.some((g) => g.variants.some((v) => v.file_format === "zip")), [groups]);
  const hasAnyRaw = useMemo(() => groups.some((g) => g.variants.some((v) => v.file_format !== "zip")), [groups]);

  function toggleExpand(key: string) {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const expandedSet = new Set(expanded);
  const allExpanded = displayGroups.length > 0 && displayGroups.every(g => expandedSet.has(`${g.console}::${g.title_normalized}`));

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="ROMs" />
        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs"
            onClick={() => { setArchiveSingleFocus(null); setArchiveDialogMode("extract"); }}
            disabled={!hasAnyZip}
          >
            <PackageOpen className="w-3 h-3" />
            Extract
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs"
            onClick={() => { setArchiveSingleFocus(null); setArchiveDialogMode("compress"); }}
            disabled={!hasAnyRaw}
          >
            <PackagePlus className="w-3 h-3" />
            Compress
          </Button>
          {pruneResult ? (
            <span className="text-xs text-green-400 flex items-center gap-1.5">
              ✓ Deleted {pruneResult.deleted.toLocaleString()} files · {formatBytes(pruneResult.bytes)} freed
              {pruneScanState === "scanning" && <Loader2 className="w-3 h-3 animate-spin" />}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={handlePrune}
              disabled={pruneLoading || groups.length === 0}
            >
              <Trash2 className="w-3 h-3" />
              {pruneLoading ? "Computing…" : "Prune"}
            </Button>
          )}
        </div>
      </div>

      <FilterBar
        groups={[
          {
            key: "status",
            label: "Category",
            items: availableCategoryTags,
            active: activeStatus,
            onToggle: (v) => toggleChip(activeStatus, v, setActiveStatus),
            onClear: () => setActiveStatus([]),
          },
          {
            key: "language",
            label: "Language",
            items: availableLangs,
            active: activeLangs,
            onToggle: (v) => toggleChip(activeLangs, v, setActiveLangs),
            onClear: () => setActiveLangs([]),
          },
          {
            key: "region",
            label: "Region",
            items: availableRegions,
            active: activeRegions,
            onToggle: (v) => toggleChip(activeRegions, v, setActiveRegions),
            onClear: () => setActiveRegions([]),
          },
          {
            key: "preferred",
            label: "Preferred",
            items: ["Has preferred", "No preferred"],
            active: activePreferred,
            onToggle: (v) => toggleChip(activePreferred, v, setActivePreferred),
            onClear: () => setActivePreferred([]),
          },
        ]}
        leading={
          <>
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-8 text-sm"
            />
            <SortControl
              fields={ROM_SORT_FIELDS}
              field={sortField}
              dir={sortDir}
              onField={setSortField}
              onDir={setSortDir}
            />
          </>
        }
        trailing={
          displayGroups.length > 0 ? (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground/60">
                {displayGroups.length.toLocaleString()} titles
              </span>
              <button
                onClick={() => setExpanded(allExpanded ? [] : displayGroups.map(g => `${g.console}::${g.title_normalized}`))}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            </div>
          ) : undefined
        }
      />

      {displayGroups.length === 0 && (
        <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="ROMs">
          <div className="text-center py-16 text-muted-foreground text-sm">No ROMs found. Run a scan from the Dashboard.</div>
        </ConsoleEmptyState>
      )}
      <VirtualRomList items={displayGroups} expanded={expanded} onToggle={toggleExpand} selectedConsoles={selectedConsoles} useShort={useShort} showScrubber={sortField === "name" && search === "" && displayGroups.length > 50} reverseStrip={sortField === "name" && sortDir === "desc"} showCountScrubber={sortField === "variants" && search === "" && displayGroups.length > 50} sortDir={sortDir} journalMap={journalMap} onJournalSave={handleJournalSave} onJournalDelete={handleJournalDelete} onExtractSingle={handleExtractSingle} onCompressSingle={handleCompressSingle} />

      {/* Prune confirmation dialog */}
      {prunePlan && (
        <PrunePreviewDialog
          plan={prunePlan}
          executing={pruneExecuting}
          selectedConsoles={selectedConsoles}
          onConfirm={handleExecutePrune}
          onCancel={() => setPrunePlan(null)}
        />
      )}

      {/* Extract / Compress dialog — self-contained: own filters, preview, execution */}
      {archiveDialogMode && (
        <ArchiveActionDialog
          mode={archiveDialogMode}
          groups={groups}
          singleFocusPath={archiveSingleFocus}
          knownRegions={knownRegions}
          knownLanguages={knownLanguages}
          knownCategories={allCategoryTags}
          onActionComplete={refreshAfterArchiveAction}
          onClose={() => { setArchiveDialogMode(null); setArchiveSingleFocus(null); }}
        />
      )}
    </div>
  );
}


// ── Variant row ───────────────────────────────────────────────────────────────

function VariantRow({ rom, isPreferred, verificationStatus, onExtractSingle, onCompressSingle }: {
  rom: RomFile;
  isPreferred: boolean;
  verificationStatus?: string;
  onExtractSingle: (path: string) => void;
  onCompressSingle: (path: string) => void;
}) {
  const statusColor = rom.is_bios ? "border-l-orange-400" : isPreferred ? "border-l-green-500" : "border-l-transparent";
  const baseClass = `flex items-center gap-3 pl-12 pr-6 py-2 border-b border-border/20 border-l-2 ${statusColor} text-xs bg-muted/10`;
  const archive = isArchive(rom.path);
  const menuProps = {
    onExtract: archive ? () => onExtractSingle(rom.path) : undefined,
    onCompress: !archive ? () => onCompressSingle(rom.path) : undefined,
  };

  if (rom.file_category === "unofficial") {
    return (
      <FileContextMenu path={rom.path} {...menuProps}>
        <div className={baseClass}>
          <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
          <TagList regions={rom.regions} languages={rom.languages} max={3} />
          <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
          {isPreferred && <span className="text-green-400 shrink-0">★</span>}
        </div>
      </FileContextMenu>
    );
  }

  return (
    <FileContextMenu path={rom.path} {...menuProps}>
      <div className={baseClass}>
        <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
        <TagList regions={rom.regions} languages={rom.languages} statusFlags={rom.status_flags} max={3} />
        <VerificationBadge status={verificationStatus} />
        <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
        {isPreferred && <span className="text-green-400 shrink-0">★</span>}
      </div>
    </FileContextMenu>
  );
}

interface VirtualRomListProps {
  items: RomGroup[];
  expanded: string[];
  onToggle: (key: string) => void;
  selectedConsoles: string[] | null;
  useShort: boolean;
  showScrubber: boolean;
  reverseStrip: boolean;
  showCountScrubber: boolean;
  sortDir: "asc" | "desc";
  journalMap: Map<string, PlayEntry>;
  onJournalSave: (titleNormalized: string, console_: string, patch: Partial<PlayEntry>, displayTitle: string) => void;
  onJournalDelete: (titleNormalized: string, console_: string) => void;
  onExtractSingle: (path: string) => void;
  onCompressSingle: (path: string) => void;
}

function VirtualRomList({ items, expanded, onToggle, selectedConsoles, useShort, showScrubber, reverseStrip, showCountScrubber, sortDir, journalMap, onJournalSave, onJournalDelete, onExtractSingle, onCompressSingle }: VirtualRomListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [firstVisibleIndex, setFirstVisibleIndex] = useState(0);
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer returns non-memoizable functions; known React Compiler v7 limitation, isolated here
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 52,
    overscan: 10,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 52,
    onChange: (instance) => {
      // getVirtualItems() includes overscan items rendered above the viewport.
      // Use scrollOffset to find the first item whose bottom edge clears the
      // scroll position — that is the actual first *visible* item.
      const offset = instance.scrollOffset ?? 0;
      const items = instance.getVirtualItems();
      const first = items.find((v) => v.end > offset) ?? items[0];
      if (first !== undefined) setFirstVisibleIndex(first.index);
    },
  });
  return (
    <div className="flex-1 overflow-hidden flex flex-row min-h-0">
    {showScrubber && (
      <AlphabetScrubber
        items={items}
        firstVisibleIndex={firstVisibleIndex}
        onJump={(idx) => virtualizer.scrollToIndex(idx, { align: "start" })}
        reverseStrip={reverseStrip}
      />
    )}
    {showCountScrubber && (
      <VariantCountScrubber
        items={items}
        firstVisibleIndex={firstVisibleIndex}
        onJump={(idx) => virtualizer.scrollToIndex(idx, { align: "start" })}
        sortDir={sortDir}
      />
    )}
    <div ref={containerRef} className="flex-1 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const g = items[vItem.index];
          const key = `${g.console}::${g.title_normalized}`;
          const isOpen = expanded.includes(key);
          const preferred = g.preferred_idx != null ? g.variants[g.preferred_idx] : null;
          const displayTitle = preferred?.title ?? g.variants[0]?.title ?? g.title_normalized;

          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
            >
              <div
                className="group/row flex items-center gap-2 px-6 py-3 hover:bg-muted/30 cursor-pointer border-b border-border/40 text-sm"
                onClick={() => onToggle(key)}
              >
                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                {isOpen && preferred && (
                  <RomThumbnail title={preferred.title} consoleName={g.console} />
                )}
                <span className="flex-1 font-medium text-foreground truncate" title={displayTitle}>{displayTitle}</span>
                {selectedConsoles === null && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 font-mono">
                    {getConsoleDisplayName(g.console, useShort)}
                  </span>
                )}
                {preferred && (
                  <TagList regions={preferred.regions} statusFlags={preferred.status_flags} max={2} />
                )}
                <DiscBadge count={g.disc_count} />
                {!g.has_preferred_version && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">no preferred</span>
                )}
                {g.variants.length > 1 && (
                  <span className="text-xs text-muted-foreground shrink-0">{g.variants.length} variants</span>
                )}
                {/* Journal indicator */}
                {(() => {
                  const jKey = `${g.title_normalized}::${g.console}`;
                  const jEntry = journalMap.get(jKey);
                  return (
                    <Popover>
                      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                        {jEntry ? (
                          <button
                            className="flex items-center gap-1.5 shrink-0"
                            aria-label="Edit journal entry"
                          >
                            <PlayStatusBadge status={jEntry.status} />
                            {jEntry.rating && <StarRating value={jEntry.rating} size="sm" readOnly />}
                          </button>
                        ) : (
                          <button
                            className="shrink-0 text-muted-foreground/30 opacity-0 group-hover/row:opacity-100 transition-opacity text-sm leading-none"
                            aria-label="Add to journal"
                          >
                            ✦
                          </button>
                        )}
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                        <JournalPopover
                          key={jEntry?.id ?? "new"}
                          titleNormalized={g.title_normalized}
                          console_={g.console}
                          entry={jEntry ?? null}
                          onSave={(patch) => onJournalSave(g.title_normalized, g.console, patch, displayTitle)}
                          onDelete={() => onJournalDelete(g.title_normalized, g.console)}
                        />
                      </PopoverContent>
                    </Popover>
                  );
                })()}
              </div>
              {isOpen && (() => {
                const uniqueConsoles = [...new Set(g.variants.map((v) => v.console))];
                if (uniqueConsoles.length > 1) {
                  return uniqueConsoles.map((console_) => {
                    const consoleVariants = g.variants.filter((v) => v.console === console_);
                    const short = getShortConsoleName(console_);
                    const canonical = getCanonicalConsoleName(short);
                    const suffix = short.slice(canonical.length).trim();
                    const label = [...suffix.matchAll(/\(([^)]+)\)/g)].map(m => m[1]).join(' · ') || short;
                    return (
                      <div key={console_}>
                        <div className="px-6 py-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider bg-muted/5 border-b border-border/20">{label}</div>
                        {consoleVariants.map((v, vi) => (
                          <VariantRow key={vi} rom={v} isPreferred={g.preferred_idx === g.variants.indexOf(v)} onExtractSingle={onExtractSingle} onCompressSingle={onCompressSingle} />
                        ))}
                      </div>
                    );
                  });
                }
                return g.variants.map((v, vi) => (
                  <VariantRow key={vi} rom={v} isPreferred={g.preferred_idx === vi} onExtractSingle={onExtractSingle} onCompressSingle={onCompressSingle} />
                ));
              })()}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
