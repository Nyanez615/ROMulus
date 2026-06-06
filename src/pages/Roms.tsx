import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, ChevronDown, CheckCircle2, AlertCircle, HelpCircle, Trash2, Loader2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getRoms, applyFilters, executePrune, scanRoots, getSettings, getConsoles, formatBytes } from "@/lib/tauri";
import { getRegionDefaultLanguages } from "@/lib/regionUtils";
import { ROM_SORT_FIELDS, type RomSortField, type SortDir } from "@/lib/romUtils";
import { SortControl } from "@/components/SortControl";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import { PrunePreviewDialog } from "@/components/PrunePreviewDialog";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { usePreferencesStore } from "@/store/preferences";
import { getShortConsoleName, getConsoleDisplayName, stripFormatSuffix } from "@/lib/consoleUtils";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { FilterBar } from "@/components/FilterBar";
import { RomThumbnail } from "@/components/RomThumbnail";
import { AlphabetScrubber } from "@/components/AlphabetScrubber";
import { VariantCountScrubber } from "@/components/VariantCountScrubber";
import { refreshTagStore } from "@/components/Layout";

// ── Verification badge ────────────────────────────────────────────────────────
function VerificationBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "verified") return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" aria-label="Verified" />;
  if (status === "modified") return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Modified" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" aria-label="Unverified" />;
}

// ── Unofficial category colours (mirrors former HacksUnofficial.tsx) ──────────
const CATEGORY_FLAGS = ["Pirate", "Unl", "Aftermarket", "Hack"] as const;
type CategoryFlag = (typeof CATEGORY_FLAGS)[number];

const CATEGORY_COLORS: Record<string, string> = {
  Pirate:      "bg-red-600/20 text-red-300 border-red-600/40",
  Unl:         "bg-orange-600/20 text-orange-300 border-orange-600/40",
  Aftermarket: "bg-yellow-600/20 text-yellow-300 border-yellow-600/40",
  Hack:        "bg-purple-600/20 text-purple-300 border-purple-600/40",
};
const CATEGORY_PRIORITY: CategoryFlag[] = ["Aftermarket", "Pirate", "Hack", "Unl"];

function getCategoryFlag(statusFlags: string[]): string {
  return statusFlags.find((f) => (CATEGORY_FLAGS as readonly string[]).includes(f)) ?? "Unl";
}

// Load all groups for client-side sort/filter. Must exceed the largest realistic
// collection — 100k covers any local library; SQLite returns this quickly.
const ALL_GROUPS = 100_000;

// ── Pure filter predicates (reused by displayGroups and facet memos) ─────────

function matchesLang(g: RomGroup, langs: string[]): boolean {
  return g.variants.some((v) => {
    if (v.languages.some((l) => langs.includes(l))) return true;
    if (v.languages.length === 0) {
      return getRegionDefaultLanguages(v.regions[0] ?? "").some((l) => langs.includes(l));
    }
    return false;
  });
}

function matchesRegion(g: RomGroup, regions: string[]): boolean {
  return g.variants.some((v) => {
    if (v.regions.some((r) => regions.includes(r))) return true;
    if (v.regions.length === 0) {
      return regions.some((r) =>
        getRegionDefaultLanguages(r).some((l) => v.languages.includes(l)),
      );
    }
    return false;
  });
}

function matchesStatus(g: RomGroup, statuses: string[]): boolean {
  return g.variants.some((v) => v.status_flags.some((s) => statuses.includes(s)));
}

function matchesPreferred(g: RomGroup, preferred: string[]): boolean {
  if (preferred.includes("Has preferred") && !g.has_preferred_version) return false;
  if (preferred.includes("No preferred") &&  g.has_preferred_version) return false;
  return true;
}

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

  // ── Prune state ──────────────────────────────────────────────────────────────
  const [pruneLoading, setPruneLoading] = useState(false);
  const [prunePlan, setPrunePlan] = useState<DeletionPlan | null>(null);
  const [pruneExecuting, setPruneExecuting] = useState(false);
  const [pruneScanState, setPruneScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [pruneResult, setPruneResult] = useState<{ deleted: number; bytes: number } | null>(null);

  async function handlePrune() {
    setPruneLoading(true);
    setPruneResult(null);
    try {
      const plan = await applyFilters(selectedConsoles ?? undefined);
      setPrunePlan(plan);
    } finally {
      setPruneLoading(false);
    }
  }

  async function handleExecutePrune(toDelete: RomFile[], bytesFreed: number) {
    setPruneExecuting(true);
    setPruneScanState("idle");
    let settings = null;
    try {
      const res = await executePrune(toDelete);
      setPruneResult({ deleted: res.success_count, bytes: bytesFreed });
      setPrunePlan(null);
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

  function toggleExpand(key: string) {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const expandedSet = new Set(expanded);
  const allExpanded = displayGroups.length > 0 && displayGroups.every(g => expandedSet.has(`${g.console}::${g.title_normalized}`));

  const uniqueTitleCount = useMemo(
    () => new Set(displayGroups.map(g => `${stripFormatSuffix(g.console)}::${g.title_normalized}`)).size,
    [displayGroups]
  );
  const playableFileCount = useMemo(
    () => displayGroups.reduce((s, g) =>
      s + g.variants.filter(v => v.file_category === "game" || v.file_category === "unofficial").length, 0),
    [displayGroups],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="ROMs" />
        <div className="ml-auto flex items-center gap-3">
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
          <div className="flex items-center gap-3">
            {displayGroups.length > 0 && (
              <button
                onClick={() => setExpanded(allExpanded ? [] : displayGroups.map(g => `${g.console}::${g.title_normalized}`))}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              {uniqueTitleCount.toLocaleString()} titles · {playableFileCount.toLocaleString()} ROMs
            </span>
          </div>
        }
      />

      {displayGroups.length === 0 && (
        <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="ROMs">
          <div className="text-center py-16 text-muted-foreground text-sm">No ROMs found. Run a scan from the Dashboard.</div>
        </ConsoleEmptyState>
      )}
      <VirtualRomList items={displayGroups} expanded={expanded} onToggle={toggleExpand} selectedConsoles={selectedConsoles} useShort={useShort} showScrubber={sortField === "name" && search === "" && displayGroups.length > 50} reverseStrip={sortField === "name" && sortDir === "desc"} showCountScrubber={sortField === "variants" && search === "" && displayGroups.length > 50} sortDir={sortDir} />

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
    </div>
  );
}


// ── Variant row ───────────────────────────────────────────────────────────────

function VariantRow({ rom, isPreferred, verificationStatus }: { rom: RomFile; isPreferred: boolean; verificationStatus?: string }) {
  const statusColor = rom.is_bios ? "border-l-orange-400" : isPreferred ? "border-l-green-500" : "border-l-transparent";
  const baseClass = `flex items-center gap-3 pl-12 pr-6 py-2 border-b border-border/20 border-l-2 ${statusColor} text-xs bg-muted/10`;

  if (rom.file_category === "unofficial") {
    const flag = getCategoryFlag(rom.status_flags);
    const colorClass = CATEGORY_COLORS[flag] ?? CATEGORY_COLORS.Unl;
    return (
      <div className={baseClass}>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass} shrink-0`}>{flag}</span>
        <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
        <TagList regions={rom.regions} languages={rom.languages} max={3} />
        <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
        {isPreferred && <span className="text-green-400 shrink-0">★</span>}
      </div>
    );
  }

  return (
    <div className={baseClass}>
      <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
      <TagList regions={rom.regions} languages={rom.languages} statusFlags={rom.status_flags} max={3} />
      <VerificationBadge status={verificationStatus} />
      <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
      {isPreferred && <span className="text-green-400 shrink-0">★</span>}
    </div>
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
}

function VirtualRomList({ items, expanded, onToggle, selectedConsoles, useShort, showScrubber, reverseStrip, showCountScrubber, sortDir }: VirtualRomListProps) {
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
      const first = instance.getVirtualItems()[0];
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
                className="flex items-center gap-2 px-6 py-3 hover:bg-muted/30 cursor-pointer border-b border-border/40 text-sm"
                onClick={() => onToggle(key)}
              >
                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                {(() => {
                  const flags = (preferred ?? g.variants[0])?.status_flags ?? [];
                  const catFlag = CATEGORY_PRIORITY.find(f => flags.includes(f));
                  if (!catFlag) return null;
                  const colorClass = CATEGORY_COLORS[catFlag];
                  return (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass} shrink-0`}>
                      {catFlag}
                    </span>
                  );
                })()}
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
                <span className="text-xs text-muted-foreground shrink-0">{g.variants.length} variant{g.variants.length !== 1 ? "s" : ""}</span>
              </div>
              {isOpen && (() => {
                const uniqueConsoles = [...new Set(g.variants.map((v) => v.console))];
                if (g.is_format_pair && uniqueConsoles.length > 1) {
                  return uniqueConsoles.map((console_) => {
                    const consoleVariants = g.variants.filter((v) => v.console === console_);
                    const short = getShortConsoleName(console_);
                    const label = short.match(/\(([^)]+)\)$/)?.[1] ?? short;
                    return (
                      <div key={console_}>
                        <div className="px-6 py-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider bg-muted/5 border-b border-border/20">{label}</div>
                        {consoleVariants.map((v, vi) => (
                          <VariantRow key={vi} rom={v} isPreferred={g.preferred_idx === g.variants.indexOf(v)} />
                        ))}
                      </div>
                    );
                  });
                }
                return g.variants.map((v, vi) => (
                  <VariantRow key={vi} rom={v} isPreferred={g.preferred_idx === vi} />
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
