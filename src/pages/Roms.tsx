import { useState, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { getRoms, getThumbnail } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import { TagList } from "@/components/TagBadge";
import { DiscBadge } from "@/components/DiscBadge";
import { formatBytes } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";

// ── Verification badge ────────────────────────────────────────────────────────
function VerificationBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "verified") return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" aria-label="Verified" />;
  if (status === "modified") return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Modified" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" aria-label="Unverified" />;
}

// ── Lazy thumbnail ────────────────────────────────────────────────────────────
function RomThumbnail({ title, consoleName }: { title: string; consoleName: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    getThumbnail(title, consoleName).then((path) => {
      if (path) setSrc(convertFileSrc(path));
    }).catch(() => {});
  }, [title, consoleName]);

  if (!src) return <div className="w-10 h-10 rounded bg-muted/40 shrink-0" />;
  return <img src={src} alt={title} className="w-10 h-10 rounded object-cover shrink-0" />;
}

const PER_PAGE = 200;

export default function Roms() {
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
      getRoms({ console: selectedConsole ?? undefined, search, page, perPage: PER_PAGE })
        .then((r) => { setGroups(r.groups); setTotal(r.total_groups); })
        .catch(console.error);
    }, 200);
  }, [selectedConsole, search, page]);

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer from @tanstack/react-virtual is intentional
  const virtualizer = useVirtualizer({
    count: groups.length,
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

  // Build page title: "Platform — Console Name — ROMs" or plain "ROMs"
  const [platform, consolePart] = (selectedConsole ?? "").split(" - ");
  const pageTitle = selectedConsole ? `${platform} — ${consolePart} — ROMs` : "ROMs";

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      </div>
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} titles</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto">
        {groups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">No ROMs found. Run a scan from the Dashboard.</div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const g = groups[vItem.index];
            const key = `${g.console}::${g.title_normalized}`;
            const isOpen = expanded.has(key);
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
                  onClick={() => toggleExpand(key)}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  {isOpen && preferred && (
                    <RomThumbnail title={preferred.title} consoleName={g.console} />
                  )}
                  <span
                    className="flex-1 font-medium text-foreground truncate"
                    title={displayTitle}
                  >
                    {displayTitle}
                  </span>
                  {preferred && (
                    <TagList regions={preferred.regions} statusFlags={preferred.status_flags} max={2} />
                  )}
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

function VariantRow({ rom, isPreferred, verificationStatus }: { rom: RomFile; isPreferred: boolean; verificationStatus?: string }) {
  const statusColor = rom.is_bios
    ? "border-l-orange-400"
    : isPreferred
    ? "border-l-green-500"
    : "border-l-transparent";

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
