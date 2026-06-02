import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getUnofficial } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { getShortConsoleName, getConsoleDisplayName } from "@/lib/consoleUtils";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { FilterBar } from "@/components/FilterBar";
import { RomThumbnail } from "@/components/RomThumbnail";

// ── Category colours ──────────────────────────────────────────────────────────
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

// ── Variant row ───────────────────────────────────────────────────────────────
function HackVariantRow({ rom, isPreferred }: { rom: RomFile; isPreferred: boolean }) {
  const flag = getCategoryFlag(rom.status_flags);
  const colorClass = CATEGORY_COLORS[flag] ?? CATEGORY_COLORS.Unl;
  const borderColor = isPreferred ? "border-l-green-500" : "border-l-transparent";
  return (
    <div className={`flex items-center gap-3 pl-12 pr-6 py-2 border-b border-border/20 border-l-2 ${borderColor} text-xs bg-muted/10`}>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass} shrink-0`}>{flag}</span>
      <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
      <TagList regions={rom.regions} languages={rom.languages} max={3} />
      {rom.is_unofficial_preferred_fallback && (
        <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-400 shrink-0">fallback</Badge>
      )}
      <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
      {isPreferred && <span className="text-green-400 shrink-0">★</span>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
type SortKey = "az" | "za" | "variants";

const ALL_GROUPS = 100_000;

export default function HacksUnofficial() {
  const { selectedConsoles } = useScanStore();
  const { category: knownCategories, region: knownRegions, language: knownLanguages } = useTagStore();

  const sortedCategories = [
    ...CATEGORY_PRIORITY.filter((t) => knownCategories.includes(t)),
    ...knownCategories.filter((t) => !(CATEGORY_PRIORITY as string[]).includes(t)).sort(),
  ];

  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeRegions, setActiveRegions]       = useState<string[]>([]);
  const [activeLangs, setActiveLangs]           = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      getUnofficial({ consoles: selectedConsoles ?? undefined, search, page: 1, perPage: ALL_GROUPS })
        .then((r) => setGroups(r.groups))
        .catch(console.error);
    }, 200);
  }, [selectedConsoles, search]);

  function toggleChip<T extends string>(active: T[], value: T, set: (v: T[]) => void) {
    set(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  }

  const displayGroups = useMemo(() => {
    let result = groups;

    if (activeCategories.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.status_flags.some((f) => activeCategories.includes(f))),
      );
    }
    if (activeRegions.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.regions.some((r) => activeRegions.includes(r))),
      );
    }
    if (activeLangs.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.languages.some((l) => activeLangs.includes(l))),
      );
    }

    const sorted = [...result];
    if (sort === "za")       sorted.sort((a, b) => b.title_normalized.localeCompare(a.title_normalized));
    else if (sort === "variants") sorted.sort((a, b) => b.variants.length - a.variants.length);
    else                     sorted.sort((a, b) => a.title_normalized.localeCompare(b.title_normalized));
    return sorted;
  }, [groups, sort, activeCategories, activeRegions, activeLangs]);

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer from @tanstack/react-virtual is intentional
  const virtualizer = useVirtualizer({
    count: displayGroups.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 52,
    overscan: 10,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 52,
  });

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="Hacks & Unofficial" />
      </div>

      <FilterBar
        groups={[
          {
            key: "category",
            label: "Category",
            items: sortedCategories,
            active: activeCategories,
            onToggle: (v) => toggleChip(activeCategories, v, setActiveCategories),
            onClear: () => setActiveCategories([]),
          },
          {
            key: "region",
            label: "Region",
            items: knownRegions,
            active: activeRegions,
            onToggle: (v) => toggleChip(activeRegions, v, setActiveRegions),
            onClear: () => setActiveRegions([]),
          },
          {
            key: "language",
            label: "Language",
            items: knownLanguages,
            active: activeLangs,
            onToggle: (v) => toggleChip(activeLangs, v, setActiveLangs),
            onClear: () => setActiveLangs([]),
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
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded border border-border bg-card text-xs text-foreground"
            >
              <option value="az">Name A–Z</option>
              <option value="za">Name Z–A</option>
              <option value="variants">Most variants</option>
            </select>
          </>
        }
        trailing={<span className="text-xs text-muted-foreground">{displayGroups.length.toLocaleString()} titles</span>}
      />

      <div ref={containerRef} className="flex-1 overflow-auto">
        {displayGroups.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="hacks or unofficial ROMs">
            <div className="text-center py-16 text-muted-foreground text-sm">No unofficial ROMs found.</div>
          </ConsoleEmptyState>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const g = displayGroups[vItem.index];
            const key = `${g.console}::${g.title_normalized}`;
            const isOpen = expanded.has(key);
            const preferred = g.preferred_idx != null ? g.variants[g.preferred_idx] : null;
            const displayTitle = preferred?.title ?? g.variants[0]?.title ?? g.title_normalized;
            const catFlag = getCategoryFlag((preferred ?? g.variants[0])?.status_flags ?? []);
            const colorClass = CATEGORY_COLORS[catFlag] ?? CATEGORY_COLORS.Unl;

            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
              >
                {/* Group header row */}
                <div
                  className="flex items-center gap-2 px-6 py-3 hover:bg-muted/30 cursor-pointer border-b border-border/40 text-sm"
                  onClick={() => toggleExpand(key)}
                >
                  {isOpen
                    ? <ChevronDown  className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass} shrink-0`}>
                    {catFlag}
                  </span>
                  {isOpen && preferred && (
                    <RomThumbnail title={preferred.title} consoleName={g.console} />
                  )}
                  <span className="flex-1 font-medium text-foreground truncate" title={displayTitle}>
                    {displayTitle}
                  </span>
                  {selectedConsoles === null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 font-mono">
                      {getConsoleDisplayName(g.console, true)}
                    </span>
                  )}
                  {preferred && (
                    <TagList regions={preferred.regions} languages={preferred.languages} max={2} />
                  )}
                  <DiscBadge count={g.disc_count} />
                  {!g.has_preferred_version && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">no preferred</span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">
                    {g.variants.length} variant{g.variants.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Expanded variant rows */}
                {isOpen && (() => {
                  const uniqueConsoles = [...new Set(g.variants.map((v) => v.console))];
                  if (g.is_format_pair && uniqueConsoles.length > 1) {
                    return uniqueConsoles.map((console_) => {
                      const consoleVariants = g.variants.filter((v) => v.console === console_);
                      const short = getShortConsoleName(console_);
                      const label = short.match(/\(([^)]+)\)$/)?.[1] ?? short;
                      return (
                        <div key={console_}>
                          <div className="px-6 py-1 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider bg-muted/5 border-b border-border/20">
                            {label}
                          </div>
                          {consoleVariants.map((v, vi) => (
                            <HackVariantRow key={vi} rom={v} isPreferred={g.preferred_idx === g.variants.indexOf(v)} />
                          ))}
                        </div>
                      );
                    });
                  }
                  return g.variants.map((v, vi) => (
                    <HackVariantRow key={vi} rom={v} isPreferred={g.preferred_idx === vi} />
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
