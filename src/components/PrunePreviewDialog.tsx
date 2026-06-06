import { useState, useMemo } from "react";
import { Trash2, AlertTriangle, Search, Download, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { exportCsv, formatBytes } from "@/lib/tauri";
import { getAbbrev } from "@/lib/consoleUtils";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { RomFile } from "@/lib/bindings/RomFile";

export const PRUNE_REASON_LABELS: Record<string, string> = {
  non_preferred:              "Lower-scored",
  no_preferred_version:       "No preferred ver.",
  format_pair_non_preferred:  "Format variant",
  format_pair_no_counterpart: "No counterpart",
};

export const PRUNE_REASON_COLORS: Record<string, string> = {
  non_preferred:              "bg-blue-500/15 text-blue-400 border-blue-500/30",
  no_preferred_version:       "bg-red-500/15 text-red-400 border-red-500/30",
  format_pair_non_preferred:  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  format_pair_no_counterpart: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export function pruneReasonKey(r: DeletionPlan["to_delete"][number]["reason"]): string {
  return typeof r === "string" ? r : Object.keys(r)[0] ?? "unknown";
}

export function matchesCat(fc: RomFile["file_category"], cat: "all" | "game" | "system"): boolean {
  if (cat === "all") return true;
  // "game" bucket mirrors get_roms: Game | Unofficial | Demo | Utility
  if (cat === "game") return fc === "game" || fc === "unofficial" || fc === "demo" || fc === "utility";
  // "system" bucket mirrors get_system_files: Bios | Video | EReader
  return fc === "bios" || fc === "video" || fc === "e_reader";
}

function StatCell({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-lg font-bold ${color ?? "text-foreground"}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function PrunePreviewDialog({ plan, executing, selectedConsoles, onConfirm, onCancel }: {
  plan: DeletionPlan;
  executing: boolean;
  selectedConsoles: string[] | null;
  onConfirm: (toDelete: RomFile[], bytesFreed: number) => void;
  onCancel: () => void;
}) {
  const [uncheckedPaths, setUncheckedPaths] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "game" | "system">("all");
  const [showAll, setShowAll] = useState(false);

  const catDeleteItems = useMemo(
    () => plan.to_delete.filter((i) => matchesCat(i.rom.file_category, category)),
    [plan.to_delete, category],
  );
  const catKeepItems = useMemo(
    () => plan.to_keep.filter((r) => matchesCat(r.file_category, category)),
    [plan.to_keep, category],
  );
  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return catDeleteItems.filter(
      (i) => !q || i.rom.filename.toLowerCase().includes(q) || i.rom.title.toLowerCase().includes(q),
    );
  }, [catDeleteItems, search]);
  // checkedItems = visible tab only — used for the Delete button count and action.
  const checkedItems = useMemo(
    () => catDeleteItems.filter((i) => !uncheckedPaths.has(i.rom.path)),
    [catDeleteItems, uncheckedPaths],
  );
  // allCheckedItems = every checked item across ALL tabs — used for Export CSV so
  // the audit file is always complete regardless of which tab is active.
  const allCheckedItems = useMemo(
    () => plan.to_delete.filter((i) => !uncheckedPaths.has(i.rom.path)),
    [plan.to_delete, uncheckedPaths],
  );
  const noPreferredCount = useMemo(() => {
    if (category === "all") return plan.no_preferred_version_count;
    return new Set(
      catDeleteItems.filter((i) => pruneReasonKey(i.reason) === "no_preferred_version").map((i) => i.rom.title_normalized),
    ).size;
  }, [plan, category, catDeleteItems]);

  const tabs = [
    { key: "all" as const,    label: "All",          count: plan.to_delete.length },
    { key: "game" as const,   label: "ROMs",         count: plan.to_delete.filter((i) => matchesCat(i.rom.file_category, "game")).length },
    { key: "system" as const, label: "System Files", count: plan.to_delete.filter((i) => matchesCat(i.rom.file_category, "system")).length },
  ].filter((t) => t.key === "all" || t.count > 0 || catKeepItems.length > 0);

  function toggleCheck(path: string) {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function selectAll() {
    setUncheckedPaths((prev) => { const next = new Set(prev); catDeleteItems.forEach((i) => next.delete(i.rom.path)); return next; });
  }
  function deselectAll() {
    setUncheckedPaths((prev) => { const next = new Set(prev); catDeleteItems.forEach((i) => next.add(i.rom.path)); return next; });
  }

  async function doExportCsv() {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    // selectedConsoles is always either null (All ROMs) or all format variants of a
    // single console family — they share one abbreviation (NES Headered/less → "nes").
    const abbrev = selectedConsoles
      ? getAbbrev(selectedConsoles[0]).toLowerCase()
      : null;
    const consoleSlug = abbrev ? `-${abbrev}` : "";
    const defaultPath = `romulus-prune${consoleSlug}-${date}-${time}.csv`;
    const filePath = await save({ defaultPath, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!filePath) return;
    await exportCsv(allCheckedItems, filePath);
  }

  const bytesFreed = checkedItems.reduce((s, i) => s + i.rom.filesize, 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-3xl w-full flex flex-col max-h-[90vh] gap-0 p-0 overflow-hidden">

        {/* Fixed header — stats */}
        <div className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold mb-3">Prune Preview</DialogTitle>
          <div className="grid grid-cols-3 gap-3 text-center">
            <StatCell value={checkedItems.length.toLocaleString()} label="approved to delete" color="text-red-400" />
            <StatCell value={catKeepItems.length.toLocaleString()} label="to keep" color="text-green-400" />
            <StatCell value={formatBytes(bytesFreed)} label="to reclaim" />
          </div>
        </div>

        {/* Category tabs + warning + search toolbar */}
        <div className="shrink-0 border-b border-border">
          {tabs.length > 1 && (
            <div className="flex gap-1 px-4 pt-2 pb-1">
              {tabs.map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => { setCategory(key); setSearch(""); setShowAll(false); }}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${category === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}{key !== "all" && <span className="ml-1 opacity-60">({count})</span>}
                </button>
              ))}
            </div>
          )}
          {noPreferredCount > 0 && (
            <div className="mx-4 my-1.5 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {noPreferredCount} title{noPreferredCount !== 1 ? "s" : ""} deleted — no preferred-language version exists
            </div>
          )}
          <div className="px-4 py-2 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0 flex-1"
            />
            <div className="flex gap-1 shrink-0">
              <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                <CheckSquare className="w-3 h-3" /> All
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={deselectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                <Square className="w-3 h-3" /> None
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable file list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {(showAll ? filteredItems : filteredItems.slice(0, 200)).map((item, i) => {
            const checked = !uncheckedPaths.has(item.rom.path);
            const rk = pruneReasonKey(item.reason);
            const colorClass = PRUNE_REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
            return (
              <div
                key={i}
                className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20 cursor-pointer ${!checked ? "opacity-40" : ""}`}
                onClick={() => toggleCheck(item.rom.path)}
              >
                <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                  {checked && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                </div>
                <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground" title={item.rom.filename}>{item.rom.filename}</span>
                {selectedConsoles === null && (
                  <span className="text-muted-foreground/50 shrink-0 text-[10px]">{getAbbrev(item.rom.console)}</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>
                  {PRUNE_REASON_LABELS[rk] ?? rk}
                </span>
              </div>
            );
          })}
          {!showAll && filteredItems.length > 200 && (
            <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <span>…and {(filteredItems.length - 200).toLocaleString()} more</span>
              <button onClick={() => setShowAll(true)} className="text-primary hover:underline">Show all</button>
            </div>
          )}
          {filteredItems.length === 0 && search && (
            <div className="px-4 py-8 text-xs text-muted-foreground text-center">No matches for "{search}"</div>
          )}
          {catDeleteItems.length === 0 && !search && (
            <div className="px-4 py-8 text-xs text-muted-foreground text-center">Nothing to delete in this category.</div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={doExportCsv} disabled={allCheckedItems.length === 0} className="gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onCancel} disabled={executing}>Cancel</Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={executing || checkedItems.length === 0}
            onClick={() => onConfirm(checkedItems.map((i) => i.rom), bytesFreed)}
            className="gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {executing ? "Deleting…" : `Delete ${checkedItems.length.toLocaleString()} files permanently`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
