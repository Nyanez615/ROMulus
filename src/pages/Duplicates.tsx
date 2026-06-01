import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDuplicates } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";

const COLLECTION_TAGS = ["Virtual Console","Switch Online","Evercade","NP","Classic Mini","GameCube","LodgeNet"];

function variantType(rom: RomFile): string {
  const tag = rom.extra_tags.find((t) => COLLECTION_TAGS.includes(t));
  if (tag) return tag;
  if (rom.bad_dump) return "Bad dump";
  return "Original dump";
}

function SkeletonRow() {
  return (
    <div className="border rounded-xl overflow-hidden animate-pulse">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
        <div className="w-4 h-4 rounded bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="ml-auto h-3 w-16 rounded bg-muted" />
      </div>
    </div>
  );
}

export default function Duplicates() {
  const { selectedConsoles } = useScanStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // Derive loading: "loaded for which selection key" vs current key.
  // All setState calls stay inside async callbacks to satisfy react-hooks/set-state-in-effect.
  const [loadedKey, setLoadedKey] = useState("");
  const currentKey = selectedConsoles ? selectedConsoles.join("\0") : "\0all";
  const isLoading = loadedKey !== currentKey;

  useEffect(() => {
    const key = selectedConsoles ? selectedConsoles.join("\0") : "\0all";
    getDuplicates(selectedConsoles ?? undefined)
      .then((data) => { setGroups(data); setLoadedKey(key); })
      .catch(() => setLoadedKey(key));
  }, [selectedConsoles]);

  type SortKey = "az" | "count";
  const [sort, setSort] = useState<SortKey>("az");

  const sortedGroups = useMemo(() => {
    const copy = [...groups];
    if (sort === "count") copy.sort((a, b) => b.variants.length - a.variants.length);
    else                  copy.sort((a, b) => a.console.localeCompare(b.console));
    return copy;
  }, [groups, sort]);

  const pending = sortedGroups.filter((g) => !resolved.has(`${g.console}::${g.title_normalized}`));

  function markResolved(key: string) {
    setResolved((prev) => new Set([...prev, key]));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="Duplicates" />
        <span className="text-xs text-muted-foreground ml-auto">
          {!isLoading && `${pending.length} of ${groups.length} to resolve`}
        </span>
      </div>

      {/* Sort toolbar */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-8 px-2 rounded border border-border bg-card text-xs text-foreground"
        >
          <option value="az">Console A–Z</option>
          <option value="count">Duplicate count ↓</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="p-6 space-y-4 max-w-4xl mx-auto">
            {[1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Empty state — only after load completes */}
        {!isLoading && groups.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="duplicates">
            <div className="flex flex-col items-center gap-3 px-6 pt-16 pb-6 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 text-green-500/40" />
              <p className="text-sm text-center">No duplicates found — your collection is clean.</p>
            </div>
          </ConsoleEmptyState>
        )}

        {!isLoading && (
          <div className="p-6 space-y-4 max-w-4xl mx-auto">
          {sortedGroups.map((g) => {
            const key = `${g.console}::${g.title_normalized}`;
            const isResolved = resolved.has(key);
            const preferred = g.preferred_idx != null ? g.variants[g.preferred_idx] : null;

            return (
              <div key={key} className={`border rounded-xl overflow-hidden transition-opacity ${isResolved ? "opacity-40" : ""}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
                  {isResolved ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-foreground">{preferred?.title ?? g.variants[0]?.title ?? g.title_normalized}</span>
                  {g.is_format_pair && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">format pair</span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">{g.console.split(" - ")[1] ?? g.console}</span>
                </div>

                <div className="divide-y divide-border">
                  {g.variants.map((v, vi) => (
                    <div key={vi} className="flex items-center gap-3 px-4 py-3 bg-card text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-foreground truncate">{v.filename}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <TagList regions={v.regions} languages={v.languages} statusFlags={v.status_flags} max={4} />
                          <span className="text-xs text-muted-foreground/60 ml-1">{variantType(v)}</span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{formatBytes(v.filesize)}</span>
                      {g.preferred_idx === vi && <span className="text-xs text-green-400 shrink-0">★ preferred</span>}
                    </div>
                  ))}
                </div>

                {!isResolved && (
                  <div className="flex gap-2 px-4 py-3 bg-muted/10 border-t border-border">
                    <Button size="sm" variant="outline" onClick={() => markResolved(key)} className="text-xs">
                      Keep preferred, mark others for deletion
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => markResolved(key)} className="text-xs text-muted-foreground">
                      Keep both / skip
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
