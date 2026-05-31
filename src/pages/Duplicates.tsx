import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDuplicates } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";

const COLLECTION_TAGS = ["Virtual Console","Switch Online","Evercade","NP","Classic Mini","GameCube","LodgeNet"];

function variantType(rom: RomFile): string {
  const tag = rom.extra_tags.find((t) => COLLECTION_TAGS.includes(t));
  if (tag) return tag;
  if (rom.bad_dump) return "Bad dump";
  return "Original dump";
}

export default function Duplicates() {
  const { selectedConsole } = useScanStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDuplicates(selectedConsole ?? undefined).then(setGroups).catch(console.error);
  }, [selectedConsole]);

  const pending = groups.filter((g) => !resolved.has(`${g.console}::${g.title_normalized}`));

  function markResolved(key: string) {
    setResolved((prev) => new Set([...prev, key]));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <h1 className="text-base font-semibold text-foreground">Duplicates</h1>
        <span className="text-xs text-muted-foreground ml-auto">
          {pending.length} of {groups.length} to resolve
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 pt-16 pb-6 text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 text-green-500/40" />
            <p className="text-sm text-center">No duplicates found — your collection is clean.</p>
          </div>
        )}

        <div className="p-6 space-y-4 max-w-4xl mx-auto">
        {groups.map((g) => {
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
                <span className="text-sm font-medium text-foreground">{preferred?.title ?? g.title_normalized}</span>
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
      </div>
    </div>
  );
}
