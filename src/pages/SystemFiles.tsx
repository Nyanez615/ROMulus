import { useState, useEffect, useMemo } from "react";
import { Shield, Film, CreditCard, Trash2, Loader2 } from "lucide-react";
import { getSystemFiles, applyFilters, executePrune, scanRoots, getSettings, getConsoles, formatBytes } from "@/lib/tauri";
import type { RomGroup } from "@/lib/bindings/RomGroup";
import type { RomFile } from "@/lib/bindings/RomFile";
import type { FileCategory } from "@/lib/bindings/FileCategory";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { PrunePreviewDialog } from "@/components/PrunePreviewDialog";
import { refreshTagStore } from "@/components/Layout";
import { cn } from "@/lib/utils";
import { getAbbrev } from "@/lib/consoleUtils";
import { FileContextMenu } from "@/components/FileContextMenu";

const ALL_CATEGORIES: { key: FileCategory; label: string; icon: React.ElementType }[] = [
  { key: "bios",     label: "BIOS",      icon: Shield },
  { key: "video",    label: "Video",     icon: Film },
  { key: "e_reader", label: "e-Reader",  icon: CreditCard },
];

export default function SystemFiles() {
  const { selectedConsoles, cacheVersion, setConsoles, setStatus, bumpCacheVersion } = useScanStore();
  const [groups, setGroups] = useState<RomGroup[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<FileCategory[]>([]);
  const [showAllCategories, setShowAllCategories] = useState<FileCategory[]>([]);

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
    getSystemFiles({ consoles: selectedConsoles ?? undefined, page: 1, perPage: 9999 })
      .then((r) => setGroups(r.groups))
      .catch(console.error);
  }, [selectedConsoles, cacheVersion]);

  // Build a set of paths that are the preferred variant in their group
  const preferredPaths = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (g.preferred_idx != null) {
        const rom = g.variants[g.preferred_idx];
        if (rom) set.add(rom.path);
      }
    }
    return set;
  }, [groups]);

  const files = useMemo(() => groups.flatMap((g) => g.variants), [groups]);

  function toggleShowAll(key: FileCategory) {
    setShowAllCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function toggleCategory(key: FileCategory) {
    setActiveCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const searchLower = search.toLowerCase();

  const byCategory = ALL_CATEGORIES.map(({ key, label, icon }) => ({
    key, label, icon,
    items: files.filter(
      (f) =>
        f.file_category === key &&
        (searchLower === "" || f.filename.toLowerCase().includes(searchLower)),
    ),
  })).filter((c) => {
    if (c.items.length === 0) return false;
    if (activeCategories.length > 0) return activeCategories.includes(c.key);
    return true;
  });

  const availableCategories = ALL_CATEGORIES.filter((cat) =>
    files.some((f) => f.file_category === cat.key),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="System Files" />
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
              disabled={pruneLoading || files.length === 0}
            >
              <Trash2 className="w-3 h-3" />
              {pruneLoading ? "Computing…" : "Prune"}
            </Button>
          )}
        </div>
      </div>

      {/* Secondary toolbar: search + category chips */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        {availableCategories.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleCategory(key)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs border transition-colors",
              activeCategories.includes(key)
                ? "bg-primary/20 border-primary/60 text-primary"
                : "bg-muted border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {byCategory.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="system files">
            <div className="text-center py-16 text-muted-foreground text-sm">
              {files.length === 0
                ? "No system files found in current collection."
                : "No system files match your search or filters."}
            </div>
          </ConsoleEmptyState>
        )}

        {byCategory.map(({ key, label, icon: Icon, items }) => (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{label}</h2>
              <span className="text-xs text-muted-foreground">({items.length})</span>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              {(showAllCategories.includes(key) ? items : items.slice(0, 50)).map((f, i) => {
                const isPreferred = preferredPaths.has(f.path);
                return (
                <FileContextMenu key={i} path={f.path}>
                  <div className={`flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/30 text-sm border-b border-border border-l-2 ${isPreferred ? "border-l-green-500" : "border-l-transparent"}`}>
                    <span className="flex-1 truncate text-foreground font-mono text-xs">{f.filename}</span>
                    <span className="text-xs text-muted-foreground/60 shrink-0">{getAbbrev(f.console)}</span>
                    <span className="text-xs text-muted-foreground/60 shrink-0">{formatBytes(f.filesize)}</span>
                    {isPreferred && <span className="text-green-400 shrink-0 text-xs">★</span>}
                  </div>
                </FileContextMenu>
                );
              })}
              {items.length > 50 && (
                <button
                  onClick={() => toggleShowAll(key)}
                  className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground bg-muted/20 hover:bg-muted/40 transition-colors text-left border-t border-border"
                >
                  {showAllCategories.includes(key)
                    ? "Show fewer"
                    : `Show all ${items.length.toLocaleString()}`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

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
