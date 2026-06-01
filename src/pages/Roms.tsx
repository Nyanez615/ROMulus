import { useState, useEffect, useRef, useMemo } from "react";
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
import { useTagStore } from "@/store/tag";
import { getShortConsoleName, getConsoleDisplayName } from "@/lib/consoleUtils";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { cn } from "@/lib/utils";

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

type SortKey = "az" | "za" | "variants";

// Load all groups for client-side sort/filter
const ALL_GROUPS = 9999;

export default function Roms() {
  const { selectedConsoles } = useScanStore();
  const { region: knownRegions, status: knownStatus, language: knownLanguages } = useTagStore();
  const STATUS_PRIORITY = ["Beta", "Proto", "Demo", "Sample", "Kiosk", "Promo", "Alt", "Unl"];
  const sortedStatus = [
    ...STATUS_PRIORITY.filter((t) => knownStatus.includes(t)),
    ...knownStatus.filter((t) => !STATUS_PRIORITY.includes(t)),
  ];
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [activeStatus, setActiveStatus] = useState<string[]>([]);
  const [activeLangs, setActiveLangs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      getRoms({ consoles: selectedConsoles ?? undefined, search, page: 1, perPage: ALL_GROUPS })
        .then((r) => setGroups(r.groups))
        .catch(console.error);
    }, 200);
  }, [selectedConsoles, search]);

  function toggleChip<T extends string>(active: T[], value: T, set: (v: T[]) => void) {
    set(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  }

  // Client-side sort + filter
  const displayGroups = useMemo(() => {
    let result = groups;

    if (activeRegions.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.regions.some((r) => activeRegions.includes(r))),
      );
    }
    if (activeStatus.length > 0) {
      result = result.filter((g) =>
        g.variants.some((v) => v.status_flags.some((s) => activeStatus.includes(s))),
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
  }, [groups, sort, activeRegions, activeStatus, activeLangs]);

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
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="ROMs" />
      </div>

      {/* Secondary toolbar */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        {/* Sort select */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-8 px-2 rounded border border-border bg-card text-xs text-foreground"
        >
          <option value="az">Name A–Z</option>
          <option value="za">Name Z–A</option>
          <option value="variants">Most variants</option>
        </select>

        {/* Region chips */}
        {knownRegions.map((r) => (
          <button key={r} onClick={() => toggleChip(activeRegions, r, setActiveRegions)}
            className={cn("px-2 py-0.5 rounded-full text-xs border transition-colors", activeRegions.includes(r) ? "bg-primary/20 border-primary/60 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}>
            {r}
          </button>
        ))}
        {/* Status chips — priority order: Beta/Proto/Demo/Sample/Kiosk/Promo/Alt/Unl first */}
        {sortedStatus.map((s) => (
          <button key={s} onClick={() => toggleChip(activeStatus, s, setActiveStatus)}
            className={cn("px-2 py-0.5 rounded-full text-xs border transition-colors", activeStatus.includes(s) ? "bg-primary/20 border-primary/60 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}>
            {s}
          </button>
        ))}
        {/* Language chips */}
        {knownLanguages.map((l) => (
          <button key={l} onClick={() => toggleChip(activeLangs, l, setActiveLangs)}
            className={cn("px-2 py-0.5 rounded-full text-xs border transition-colors", activeLangs.includes(l) ? "bg-primary/20 border-primary/60 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}

        <span className="text-xs text-muted-foreground ml-auto">{displayGroups.length.toLocaleString()} titles</span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto">
        {displayGroups.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="ROMs">
            <div className="text-center py-16 text-muted-foreground text-sm">No ROMs found. Run a scan from the Dashboard.</div>
          </ConsoleEmptyState>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const g = displayGroups[vItem.index];
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
                  <span className="flex-1 font-medium text-foreground truncate" title={displayTitle}>{displayTitle}</span>
                  {selectedConsoles === null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 font-mono">
                      {getConsoleDisplayName(g.console, true)}
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
