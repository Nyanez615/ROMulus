import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, ChevronDown, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { getRoms } from "@/lib/tauri";
import { getRegionDefaultLanguages } from "@/lib/regionUtils";
import { ROM_SORT_FIELDS, type RomSortField, type SortDir } from "@/lib/romUtils";
import { SortControl } from "@/components/SortControl";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { usePreferencesStore } from "@/store/preferences";
import { getShortConsoleName, getConsoleDisplayName, stripFormatSuffix } from "@/lib/consoleUtils";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { FilterBar } from "@/components/FilterBar";
import { RomThumbnail } from "@/components/RomThumbnail";

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

// Status flags that belong in the ROMs tab Category filter (Unl excluded — those live in Hacks).
const STATUS_PRIORITY = ["Beta", "Proto", "Demo", "Sample", "Kiosk", "Promo", "Alt"];

export default function Roms() {
  const { selectedConsoles, cacheVersion } = useScanStore();
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);
  const { region: knownRegions, status: knownStatus, language: knownLanguages } = useTagStore();
  const sortedStatus = [
    ...STATUS_PRIORITY.filter((t) => knownStatus.includes(t)),
    ...knownStatus.filter((t) => !STATUS_PRIORITY.includes(t)),
  ];
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<RomSortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [activeStatus, setActiveStatus] = useState<string[]>([]);
  const [activeLangs, setActiveLangs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const debouncedRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // Client-side sort + filter (bidirectional: Language chip also matches region-inferred, Region chip also matches explicit lang)
  const displayGroups = useMemo(() => {
    let result = groups;

    if (activeLangs.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => {
          // Explicit language tag match
          if (v.languages.some((l) => activeLangs.includes(l))) return true;
          // Region-inference match: ROM has no explicit language but its primary region infers one of the active langs
          if (v.languages.length === 0) {
            const inferred = getRegionDefaultLanguages(v.regions[0] ?? "");
            return inferred.some((l) => activeLangs.includes(l));
          }
          return false;
        }),
      );
    }
    if (activeRegions.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => {
          // Explicit region match
          if (v.regions.some((r) => activeRegions.includes(r))) return true;
          // Reverse inference: ROM has no region tag but has an explicit language that is the default for an active region
          if (v.regions.length === 0) {
            return activeRegions.some((r) => {
              const defaults = getRegionDefaultLanguages(r);
              return v.languages.some((l) => defaults.includes(l));
            });
          }
          return false;
        }),
      );
    }
    if (activeStatus.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.status_flags.some((s) => activeStatus.includes(s))),
      );
    }

    const sorted = [...result];
    if (sortField === "variants") {
      sorted.sort((a, b) => sortDir === "desc"
        ? b.variants.length - a.variants.length
        : a.variants.length - b.variants.length);
    } else if (sortField === "preferred") {
      sorted.sort((a, b) => {
        const aHas = a.preferred_idx != null ? 1 : 0;
        const bHas = b.preferred_idx != null ? 1 : 0;
        const primary = sortDir === "desc" ? bHas - aHas : aHas - bHas;
        return primary !== 0 ? primary : a.title_normalized.localeCompare(b.title_normalized);
      });
    } else {
      sorted.sort((a, b) => sortDir === "asc"
        ? a.title_normalized.localeCompare(b.title_normalized)
        : b.title_normalized.localeCompare(a.title_normalized));
    }
    return sorted;
  }, [groups, sortField, sortDir, activeRegions, activeStatus, activeLangs]);

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
  const gameFileCount = useMemo(
    () => displayGroups.reduce((s, g) => s + g.variants.filter(v => v.file_category === "game").length, 0),
    [displayGroups]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="ROMs" />
      </div>

      <FilterBar
        groups={[
          {
            key: "status",
            label: "Category",
            items: sortedStatus,
            active: activeStatus,
            onToggle: (v) => toggleChip(activeStatus, v, setActiveStatus),
            onClear: () => setActiveStatus([]),
          },
          {
            key: "language",
            label: "Language",
            items: knownLanguages,
            active: activeLangs,
            onToggle: (v) => toggleChip(activeLangs, v, setActiveLangs),
            onClear: () => setActiveLangs([]),
          },
          {
            key: "region",
            label: "Region",
            items: knownRegions,
            active: activeRegions,
            onToggle: (v) => toggleChip(activeRegions, v, setActiveRegions),
            onClear: () => setActiveRegions([]),
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
              {uniqueTitleCount.toLocaleString()} titles · {gameFileCount.toLocaleString()} ROMs
            </span>
          </div>
        }
      />

      {displayGroups.length === 0 && (
        <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="ROMs">
          <div className="text-center py-16 text-muted-foreground text-sm">No ROMs found. Run a scan from the Dashboard.</div>
        </ConsoleEmptyState>
      )}
      <VirtualRomList items={displayGroups} expanded={expanded} onToggle={toggleExpand} selectedConsoles={selectedConsoles} useShort={useShort} />
    </div>
  );
}

function VariantRow({ rom, isPreferred, verificationStatus }: { rom: RomFile; isPreferred: boolean; verificationStatus?: string }) {
  const statusColor = rom.is_bios ? "border-l-orange-400" : isPreferred ? "border-l-green-500" : "border-l-transparent";
  return (
    <div className={`flex items-center gap-3 pl-12 pr-6 py-2 border-b border-border/20 border-l-2 ${statusColor} text-xs bg-muted/10`}>
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
}

function VirtualRomList({ items, expanded, onToggle, selectedConsoles, useShort }: VirtualRomListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer returns non-memoizable functions; known React Compiler v7 limitation, isolated here
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 52,
    overscan: 10,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 52,
  });
  return (
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
  );
}
