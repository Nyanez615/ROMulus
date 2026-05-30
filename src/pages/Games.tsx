import { useState, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { getGames } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";

const PER_PAGE = 200;

export default function Games() {
  const { selectedConsole } = useScanStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      getGames({ console: selectedConsole ?? undefined, search, page, perPage: PER_PAGE })
        .then((r) => { setGroups(r.groups); setTotal(r.total_groups); })
        .catch(console.error);
    }, 200);
  }, [selectedConsole, search, page]);

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer is a valid hook from @tanstack/react-virtual
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 52,
    overscan: 10,
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
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <h1 className="text-base font-semibold text-foreground shrink-0">
          Games{selectedConsole ? ` — ${selectedConsole.split(" - ")[1] ?? selectedConsole}` : ""}
        </h1>
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} titles</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const g = groups[vItem.index];
            const key = `${g.console}::${g.title_normalized}`;
            const isOpen = expanded.has(key);
            const preferred = g.preferred_idx != null ? g.variants[g.preferred_idx] : null;

            return (
              <div
                key={vItem.key}
                style={{ position: "absolute", top: vItem.start, left: 0, right: 0 }}
              >
                <div
                  className="flex items-center gap-2 px-6 py-3 hover:bg-muted/30 cursor-pointer border-b border-border/40 text-sm"
                  onClick={() => toggleExpand(key)}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <span className="flex-1 font-medium text-foreground truncate">
                    {preferred?.title ?? g.title_normalized}
                  </span>
                  <DiscBadge count={g.disc_count} />
                  {!g.has_preferred_version && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">no preferred</span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">{g.variants.length} variant{g.variants.length !== 1 ? "s" : ""}</span>
                </div>
                {isOpen && g.variants.map((v, vi) => (
                  <VariantRow key={vi} rom={v} isPreferred={g.preferred_idx === vi} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VariantRow({ rom, isPreferred }: { rom: RomFile; isPreferred: boolean }) {
  const statusColor = rom.is_bios
    ? "border-l-orange-400"
    : isPreferred
    ? "border-l-green-500"
    : "border-l-transparent";

  return (
    <div className={`flex items-center gap-3 pl-12 pr-6 py-2 border-b border-border/20 border-l-2 ${statusColor} text-xs bg-muted/10`}>
      <span className="flex-1 truncate text-muted-foreground font-mono">{rom.filename}</span>
      <TagList regions={rom.regions} languages={rom.languages} statusFlags={rom.status_flags} max={3} />
      <span className="text-muted-foreground/60 shrink-0">{formatBytes(rom.filesize)}</span>
      {isPreferred && <span className="text-green-400 shrink-0">★</span>}
    </div>
  );
}
