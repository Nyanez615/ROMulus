import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getUnofficial } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import { TagList } from "@/components/TagBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";
import { useTagStore } from "@/store/tag";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { FilterBar } from "@/components/FilterBar";

const CATEGORY_COLORS: Record<string, string> = {
  pirate:      "bg-red-600/20 text-red-300 border-red-600/40",
  unl:         "bg-orange-600/20 text-orange-300 border-orange-600/40",
  aftermarket: "bg-yellow-600/20 text-yellow-300 border-yellow-600/40",
  hack:        "bg-purple-600/20 text-purple-300 border-purple-600/40",
};

type SortKey = "az" | "za";

export default function HacksUnofficial() {
  const { selectedConsoles } = useScanStore();
  const { category: knownCategories, region: knownRegions, language: knownLanguages } = useTagStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [activeLangs, setActiveLangs] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      getUnofficial({ consoles: selectedConsoles ?? undefined, search, page: 1, perPage: 9999 })
        .then((r) => setGroups(r.groups))
        .catch(console.error);
    }, 200);
    return () => clearTimeout(t);
  }, [selectedConsoles, search]);

  function toggleChip<T extends string>(active: T[], value: T, set: (v: T[]) => void) {
    set(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  }

  const displayGroups = useMemo(() => {
    let result = groups;

    if (activeCategories.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) =>
          v.status_flags.some((f) => activeCategories.map((c) => c.toLowerCase()).includes(f.toLowerCase())),
        ),
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
    if (sort === "za") sorted.sort((a, b) => b.title_normalized.localeCompare(a.title_normalized));
    else               sorted.sort((a, b) => a.title_normalized.localeCompare(b.title_normalized));
    return sorted;
  }, [groups, sort, activeCategories, activeRegions, activeLangs]);

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
            items: knownCategories,
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
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-8 text-sm" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded border border-border bg-card text-xs text-foreground"
            >
              <option value="az">Name A–Z</option>
              <option value="za">Name Z–A</option>
            </select>
          </>
        }
        trailing={<span className="text-xs text-muted-foreground">{displayGroups.length.toLocaleString()} titles</span>}
      />

      <div className="flex-1 overflow-auto">
        {displayGroups.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="hacks or unofficial ROMs">
            <div className="text-center py-16 text-muted-foreground text-sm">No unofficial ROMs found.</div>
          </ConsoleEmptyState>
        )}
        {displayGroups.map((g) => (
          <div key={`${g.console}::${g.title_normalized}`} className="border-b border-border/40">
            {g.variants.map((v, vi) => {
              const flag = v.status_flags.find((f) => ["Pirate", "Unl", "Aftermarket", "Hack"].includes(f))?.toLowerCase() ?? "unl";
              const colorClass = CATEGORY_COLORS[flag] ?? CATEGORY_COLORS.unl;
              return (
                <div key={vi} className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/20 text-sm">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colorClass} shrink-0 capitalize`}>{flag}</span>
                  <span className="flex-1 truncate text-foreground font-mono text-xs">{v.filename}</span>
                  <TagList regions={v.regions} languages={v.languages} max={3} />
                  {v.is_unofficial_preferred_fallback && (
                    <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-400 shrink-0">fallback</Badge>
                  )}
                  <span className="text-xs text-muted-foreground/60 shrink-0">{formatBytes(v.filesize)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
