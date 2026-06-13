import { useState, useMemo } from "react";
import { Trash2, AlertTriangle, Search, Download, CheckSquare, Square, ChevronDown, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { exportCsv, formatBytes } from "@/lib/tauri";
import { getAbbrev, getFormatVariantLabel } from "@/lib/consoleUtils";
import { FileContextMenu } from "@/components/FileContextMenu";
import type { DeletionItem } from "@/lib/bindings/DeletionItem";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { RomFile } from "@/lib/bindings/RomFile";

export const PRUNE_REASON_LABELS: Record<string, string> = {
  non_preferred:        "Lower-scored",
  no_preferred_version: "No preferred ver.",
  non_playable:         "Non-playable file",
};

export const PRUNE_REASON_COLORS: Record<string, string> = {
  non_preferred:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
  no_preferred_version: "bg-red-500/15 text-red-400 border-red-500/30",
  non_playable:         "bg-muted/30 text-muted-foreground border-border",
};

export function pruneReasonKey(r: DeletionPlan["to_delete"][number]["reason"]): string {
  return typeof r === "string" ? r : Object.keys(r)[0] ?? "unknown";
}

export function matchesCat(fc: RomFile["file_category"], cat: "all" | "game" | "system"): boolean {
  if (cat === "all") return true;
  if (cat === "game") return fc === "game" || fc === "unofficial" || fc === "demo" || fc === "utility";
  return fc === "bios" || fc === "video" || fc === "e_reader" || fc === "accessory";
}

type PruneGroup = {
  key: string;
  title: string;
  keep: RomFile[];
  deleteItems: DeletionItem[];
  hasNoPreferred: boolean;
};

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
  const [viewTab, setViewTab] = useState<"groups" | "files">("groups");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Build groups: pair each deleted title with its kept counterpart(s)
  const pruneGroups = useMemo<PruneGroup[]>(() => {
    const byTitle = new Map<string, { keep: RomFile[]; deleteItems: DeletionItem[] }>();
    for (const item of plan.to_delete) {
      const key = item.rom.title_normalized;
      if (!byTitle.has(key)) byTitle.set(key, { keep: [], deleteItems: [] });
      byTitle.get(key)!.deleteItems.push(item);
    }
    for (const rom of plan.to_keep) {
      const key = rom.title_normalized;
      if (byTitle.has(key)) byTitle.get(key)!.keep.push(rom);
    }
    return [...byTitle.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, { keep, deleteItems }]) => ({
        key,
        title: deleteItems[0]?.rom.title ?? keep[0]?.title ?? key,
        keep,
        deleteItems,
        hasNoPreferred: deleteItems.some(
          (i) => pruneReasonKey(i.reason) === "no_preferred_version",
        ),
      }));
  }, [plan]);

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return pruneGroups;
    return pruneGroups.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.keep.some((r) => r.filename.toLowerCase().includes(q)) ||
        g.deleteItems.some((i) => i.rom.filename.toLowerCase().includes(q)),
    );
  }, [pruneGroups, search]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return plan.to_delete.filter(
      (i) => !q || i.rom.filename.toLowerCase().includes(q) || i.rom.title.toLowerCase().includes(q),
    );
  }, [plan.to_delete, search]);

  // checkedItems counts checked deletions across all items (used for Delete button + bytes)
  const checkedItems = useMemo(
    () => plan.to_delete.filter((i) => !uncheckedPaths.has(i.rom.path)),
    [plan.to_delete, uncheckedPaths],
  );
  const allCheckedItems = checkedItems; // no category split, so these are identical

  const noPreferredCount = plan.no_preferred_version_count;

  function toggleCheck(path: string) {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function selectAll() {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      plan.to_delete.forEach((i) => next.delete(i.rom.path));
      return next;
    });
  }
  function deselectAll() {
    setUncheckedPaths((prev) => {
      const next = new Set(prev);
      plan.to_delete.forEach((i) => next.add(i.rom.path));
      return next;
    });
  }
  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function expandAll() {
    setExpandedGroups(new Set(filteredGroups.map((g) => g.key)));
  }
  function collapseAll() {
    setExpandedGroups(new Set());
  }

  async function doExportCsv() {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const abbrev = selectedConsoles ? getAbbrev(selectedConsoles[0]).toLowerCase() : null;
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
            <StatCell value={plan.to_keep.length.toLocaleString()} label="to keep" color="text-green-400" />
            <StatCell value={formatBytes(bytesFreed)} label="to reclaim" />
          </div>
        </div>

        {/* Toolbar: view tabs + warning + search */}
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center gap-1 px-4 pt-2 pb-1">
            {(["groups", "files"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setViewTab(tab); setSearch(""); }}
                className={`text-xs px-2 py-0.5 rounded transition-colors capitalize ${viewTab === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tab === "groups"
                  ? `Groups (${pruneGroups.length.toLocaleString()})`
                  : `Files (${plan.to_delete.length.toLocaleString()})`}
              </button>
            ))}
          </div>
          {noPreferredCount > 0 && (
            <div className="mx-4 my-1.5 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {noPreferredCount} title{noPreferredCount !== 1 ? "s" : ""} deleted — no preferred-language version exists
            </div>
          )}
          <div className="px-4 py-2 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Input
              placeholder={viewTab === "groups" ? "Search titles…" : "Search files…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0 flex-1"
            />
            {viewTab === "groups" ? (
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => {
                    const allExpanded = filteredGroups.length > 0 && filteredGroups.every((g) => expandedGroups.has(g.key));
                    if (allExpanded) { collapseAll(); } else { expandAll(); }
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {filteredGroups.length > 0 && filteredGroups.every((g) => expandedGroups.has(g.key))
                    ? "Collapse all"
                    : "Expand all"}
                </button>
              </div>
            ) : (
              <div className="flex gap-1 shrink-0">
                <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  <CheckSquare className="w-3 h-3" /> All
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button onClick={deselectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  <Square className="w-3 h-3" /> None
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {viewTab === "groups" ? (
            /* ── Groups accordion ── */
            filteredGroups.length === 0 ? (
              <div className="px-4 py-8 text-xs text-muted-foreground text-center">
                {search ? `No matches for "${search}"` : "Nothing to delete."}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {filteredGroups.map((g) => {
                  const isExpanded = expandedGroups.has(g.key);
                  const rk = g.deleteItems[0] ? pruneReasonKey(g.deleteItems[0].reason) : "";
                  const reasonColor = PRUNE_REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
                  const reasonLabel = PRUNE_REASON_LABELS[rk] ?? rk;
                  return (
                    <div key={g.key}>
                      <button
                        onClick={() => toggleGroup(g.key)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/20 transition-colors"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <span className="text-xs text-foreground flex-1 truncate">{g.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${reasonColor}`}>
                          {reasonLabel}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="px-9 pb-2 pt-0.5 space-y-1.5">
                          {/* Kept files */}
                          {g.keep.length > 0 ? (
                            g.keep.map((rom) => (
                              <div key={rom.path} className="flex items-start gap-2">
                                <Check className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                                <span className="text-xs text-foreground/70 font-mono break-all flex-1">{rom.filename}</span>
                                <span className="text-muted-foreground/50 shrink-0 text-[10px] ml-1">{getFormatVariantLabel(rom.console)}</span>
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-amber-400/70">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>No preferred version — all variants deleted</span>
                            </div>
                          )}
                          {/* Deleted files */}
                          {g.deleteItems.map((item) => {
                            const checked = !uncheckedPaths.has(item.rom.path);
                            return (
                              <FileContextMenu key={item.rom.path} path={item.rom.path}>
                                <div
                                  className={`flex items-center gap-2 cursor-pointer ${!checked ? "opacity-40" : ""}`}
                                  onClick={() => toggleCheck(item.rom.path)}
                                >
                                  <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                                    {checked && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                                  </div>
                                  <span className="text-xs text-muted-foreground font-mono break-all flex-1">{item.rom.filename}</span>
                                  <span className="text-muted-foreground/50 shrink-0 text-[10px] ml-1">{getFormatVariantLabel(item.rom.console)}</span>
                                </div>
                              </FileContextMenu>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* ── Flat file list ── */
            filteredItems.length === 0 ? (
              <div className="px-4 py-8 text-xs text-muted-foreground text-center">
                {search ? `No matches for "${search}"` : "Nothing to delete."}
              </div>
            ) : (
              filteredItems.map((item, i) => {
                const checked = !uncheckedPaths.has(item.rom.path);
                const rk = pruneReasonKey(item.reason);
                const colorClass = PRUNE_REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
                return (
                  <FileContextMenu key={i} path={item.rom.path}>
                    <div
                      className={`flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20 cursor-pointer ${!checked ? "opacity-40" : ""}`}
                      onClick={() => toggleCheck(item.rom.path)}
                    >
                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                        {checked && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                      </div>
                      <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground" title={item.rom.filename}>{item.rom.filename}</span>
                      <span className="text-muted-foreground/50 shrink-0 text-[10px]">{getFormatVariantLabel(item.rom.console)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>
                        {PRUNE_REASON_LABELS[rk] ?? rk}
                      </span>
                    </div>
                  </FileContextMenu>
                );
              })
            )
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
