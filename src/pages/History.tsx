import { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, Check, SkipForward, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { getHistory, clearHistory } from "@/lib/tauri";
import type { ActionLogEntry } from "@/lib/bindings/ActionLogEntry";
import type { ActionType } from "@/lib/bindings/ActionType";
import type { HistoryFilter } from "@/lib/bindings/HistoryFilter";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { cn } from "@/lib/utils";
import { getAbbrev } from "@/lib/consoleUtils";

const ACTION_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  moved_to_trash: { icon: Trash2,        color: "text-red-400",          label: "Trashed" },
  deleted:        { icon: Trash2,        color: "text-red-500",          label: "Deleted" },
  kept:           { icon: Check,         color: "text-green-400",        label: "Kept" },
  skipped:        { icon: SkipForward,   color: "text-muted-foreground", label: "Skipped" },
  deferred:       { icon: Clock,         color: "text-yellow-400",       label: "Deferred" },
  pending:        { icon: AlertTriangle, color: "text-amber-400",        label: "Pending" },
};

function getActionMeta(action: ActionType) {
  const key = String(action).replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, "");
  return ACTION_ICONS[key] ?? ACTION_ICONS.kept;
}

const ACTION_CHIP_GROUPS = [
  { label: "Deleted",   actions: ["moved_to_trash", "deleted"] },
  { label: "Kept",      actions: ["kept"] },
  { label: "Skipped",   actions: ["skipped"] },
  { label: "Deferred",  actions: ["deferred", "pending"] },
];

const DATE_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: "All time",    days: undefined },
  { label: "Today",       days: 1 },
  { label: "Last 7 days", days: 7 },
];

const PER_PAGE = 50;

interface HistoryState {
  page: number;
  activeGroups: string[];
  dateDays: number | undefined;
}

export default function History() {
  const { selectedConsoles } = useScanStore();
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hs, setHs] = useState<HistoryState>({ page: 1, activeGroups: [], dateDays: undefined });
  const [clearing, setClearing] = useState(false);

  const loadHistory = useCallback(() => {
    const actions =
      hs.activeGroups.length > 0
        ? hs.activeGroups.flatMap((label) => ACTION_CHIP_GROUPS.find((g) => g.label === label)?.actions ?? [])
        : null;
    const filter: HistoryFilter | null =
      actions || hs.dateDays !== undefined
        ? { actions, since_days: hs.dateDays ?? null }
        : null;
    getHistory(selectedConsoles, filter, hs.page, PER_PAGE)
      .then((h) => { setEntries(h.entries); setTotal(h.total); })
      .catch(console.error);
  }, [selectedConsoles, hs]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function doClearHistory() {
    setClearing(true);
    try {
      await clearHistory();
      setHs({ page: 1, activeGroups: [], dateDays: undefined });
    } finally {
      setClearing(false);
    }
  }

  // Derive filter for display-state only (chips active indicator)
  const activeGroups = hs.activeGroups;

  const totalPages = Math.ceil(total / PER_PAGE);

  function toggleActionGroup(label: string) {
    setHs((prev) => ({
      page: 1,
      activeGroups: prev.activeGroups.includes(label)
        ? prev.activeGroups.filter((l) => l !== label)
        : [...prev.activeGroups, label],
      dateDays: prev.dateDays,
    }));
  }

  function changeDateDays(days: number | undefined) {
    setHs((prev) => ({ ...prev, dateDays: days, page: 1 }));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border gap-3">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="History" />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} total actions</span>
        {total > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive gap-1.5 shrink-0" disabled={clearing}>
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear history?</AlertDialogTitle>
                <AlertDialogDescription>
                  All {total.toLocaleString()} history entries will be permanently removed. Any in-progress operations (pending rows) are preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={doClearHistory} className="bg-destructive hover:bg-destructive/90">
                  Clear history
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Secondary toolbar: action chips + date filter */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-2 flex-wrap">
        {ACTION_CHIP_GROUPS.map(({ label }) => (
          <button
            key={label}
            onClick={() => toggleActionGroup(label)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs border transition-colors",
              activeGroups.includes(label)
                ? "bg-primary/20 border-primary/60 text-primary"
                : "bg-muted border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}

        <div className="ml-2 flex gap-1">
          {DATE_OPTIONS.map(({ label, days }) => (
            <button
              key={label}
              onClick={() => changeDateDays(days)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs border transition-colors",
                hs.dateDays === days
                  ? "bg-primary/20 border-primary/60 text-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {entries.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="history entries">
            <div className="px-6 pt-16 text-center text-sm text-muted-foreground">No actions recorded yet.</div>
          </ConsoleEmptyState>
        )}
        <div className="divide-y divide-border/60">
          {entries.map((entry) => {
            const meta = getActionMeta(entry.action);
            const Icon = meta.icon;
            return (
              <div key={entry.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/20 text-sm">
                <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-foreground truncate">{entry.title}</div>
                  <div className="text-xs text-muted-foreground truncate font-mono">{entry.path}</div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="text-xs text-muted-foreground">{getAbbrev(entry.console)}</div>
                  <div className="text-xs text-muted-foreground/60">{entry.timestamp.slice(0, 16).replace("T", " ")}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-border">
          <Button size="sm" variant="outline" disabled={hs.page <= 1}
            onClick={() => setHs((prev) => ({ ...prev, page: prev.page - 1 }))}>←</Button>
          <span className="text-xs text-muted-foreground">Page {hs.page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={hs.page >= totalPages}
            onClick={() => setHs((prev) => ({ ...prev, page: prev.page + 1 }))}>→</Button>
        </div>
      )}
    </div>
  );
}
