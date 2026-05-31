import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getUnofficial } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import { TagList } from "@/components/TagBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";

const CATEGORY_COLORS: Record<string, string> = {
  pirate: "bg-red-600/20 text-red-300 border-red-600/40",
  unl: "bg-orange-600/20 text-orange-300 border-orange-600/40",
  aftermarket: "bg-yellow-600/20 text-yellow-300 border-yellow-600/40",
  hack: "bg-purple-600/20 text-purple-300 border-purple-600/40",
};

export default function HacksUnofficial() {
  const { selectedConsole } = useScanStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      getUnofficial({ console: selectedConsole ?? undefined, search, page: 1, perPage: 200 })
        .then((r) => { setGroups(r.groups); setTotal(r.total_groups); })
        .catch(console.error);
    }, 200);
    return () => clearTimeout(t);
  }, [selectedConsole, search]);

  const [platform, consolePart] = (selectedConsole ?? "").split(" - ");
  const pageTitle = selectedConsole
    ? `${platform} — ${consolePart} — Hacks & Unofficial`
    : "Hacks & Unofficial";

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      </div>
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3">
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-8 text-sm" />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} titles</span>
      </div>

      <div className="flex-1 overflow-auto">
        {groups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">No unofficial ROMs found.</div>
        )}
        {groups.map((g) => (
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
