import { useState, useEffect } from "react";
import { Clock, Trash2, Check, SkipForward, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHistory } from "@/lib/tauri";
import type { ActionLogEntry } from "@/lib/bindings/ActionLogEntry";
import type { ActionType } from "@/lib/bindings/ActionType";

const ACTION_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  moved_to_trash: { icon: Trash2, color: "text-red-400", label: "Trashed" },
  deleted: { icon: Trash2, color: "text-red-500", label: "Deleted" },
  kept: { icon: Check, color: "text-green-400", label: "Kept" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", label: "Skipped" },
  deferred: { icon: Clock, color: "text-yellow-400", label: "Deferred" },
  pending: { icon: AlertTriangle, color: "text-amber-400", label: "Pending" },
};

function getActionMeta(action: ActionType) {
  const key = String(action).replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, "");
  return ACTION_ICONS[key] ?? ACTION_ICONS.kept;
}

const PER_PAGE = 50;

export default function History() {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    getHistory(page, PER_PAGE)
      .then((h) => { setEntries(h.entries); setTotal(h.total); })
      .catch(console.error);
  }, [page]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">History</h1>
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} total actions</span>
      </div>

      <div className="flex-1 overflow-auto">
        {entries.length === 0 && (
          <div className="px-6 pt-16 text-center text-sm text-muted-foreground">No actions recorded yet.</div>
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
                  <div className="text-xs text-muted-foreground">{entry.console.split(" - ")[1] ?? entry.console}</div>
                  <div className="text-xs text-muted-foreground/60">{entry.timestamp.slice(0, 16).replace("T", " ")}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-border">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</Button>
        </div>
      )}
    </div>
  );
}
