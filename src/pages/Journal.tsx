import { useState, useEffect, useMemo, useCallback } from "react";
import { BookOpen, Search, Upload, Download as DownloadIcon, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/FilterBar";
import { SortControl } from "@/components/SortControl";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/pluralize";
import { useToast } from "@/hooks/use-toast";
import { getPlayEntries, getPlayStats, setPlayEntry, deletePlayEntry, exportJournalToFile, importJournalFromFile } from "@/lib/tauri";
import type { PlayEntry, PlayStats, PlayStatus } from "@/lib/tauri";
import { PlayStatusBadge } from "@/components/PlayStatusBadge";
import { StarRating } from "@/components/StarRating";
import { isTauri } from "@/lib/env";
import type { SortDir } from "@/lib/romUtils";

const ALL_STATUSES: PlayStatus[] = ["backlog", "testing", "playing", "completed", "dropped"];

const STATUS_LABEL: Record<PlayStatus, string> = {
  backlog: "Backlog", testing: "Testing", playing: "Playing",
  completed: "Completed", dropped: "Dropped",
};

const STATUS_ACTIVE: Record<PlayStatus, string> = {
  backlog:   "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  testing:   "bg-amber-500/15  text-amber-400  border border-amber-500/30",
  playing:   "bg-blue-500/15   text-blue-400   border border-blue-500/30",
  completed: "bg-green-500/15  text-green-400  border border-green-500/30",
  dropped:   "bg-muted/60      text-muted-foreground border border-border",
};

const STATUS_BY_LABEL = new Map<string, PlayStatus>(ALL_STATUSES.map((s) => [STATUS_LABEL[s], s]));

const JOURNAL_SORT_FIELDS = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title" },
  { value: "rating", label: "Rating" },
] as const;
type SortKey = typeof JOURNAL_SORT_FIELDS[number]["value"];

// ── Inline edit panel ─────────────────────────────────────────────────────────

interface EditPanelProps {
  entry: PlayEntry;
  onSave: (patch: Partial<PlayEntry>) => void;
  onDelete: () => void;
}

function EditPanel({ entry, onSave, onDelete }: EditPanelProps) {
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [compatNotes, setCompatNotes] = useState(entry.compat_notes ?? "");

  function handleBlurNotes() {
    if (notes !== (entry.notes ?? "")) onSave({ notes: notes || null });
  }
  function handleBlurCompat() {
    if (compatNotes !== (entry.compat_notes ?? "")) onSave({ compat_notes: compatNotes || null });
  }

  const communityDisplay = entry.community_score != null ? (entry.community_score / 10).toFixed(1) : null;
  const criticDisplay    = entry.critic_score    != null ? (entry.critic_score    / 10).toFixed(1) : null;

  return (
    <div className="px-6 py-4 border-b border-border/40 bg-muted/5 space-y-4">
      {/* Status picker */}
      <div className="flex flex-wrap gap-2">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => onSave({ status: s })}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors",
              entry.status === s
                ? STATUS_ACTIVE[s]
                : "bg-muted/30 text-muted-foreground hover:text-foreground border border-transparent",
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Rating */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground w-20 shrink-0">Your rating</span>
        <StarRating
          value={entry.rating ?? null}
          onChange={(v) => onSave({ rating: v })}
          size="md"
        />
        {entry.rating && (
          <span className="text-xs text-muted-foreground">{entry.rating}/5</span>
        )}
      </div>

      {/* External scores */}
      {(communityDisplay || criticDisplay) && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {communityDisplay && <span>Community <span className="text-foreground font-medium">{communityDisplay}/10</span></span>}
          {criticDisplay    && <span>Critics <span className="text-foreground font-medium">{criticDisplay}/10</span></span>}
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleBlurNotes}
          rows={3}
          placeholder="Impressions, story thoughts…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Technical notes */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Technical notes</label>
        <textarea
          value={compatNotes}
          onChange={(e) => setCompatNotes(e.target.value)}
          onBlur={handleBlurCompat}
          rows={2}
          placeholder="Runs at full speed · Needs patch v1.2 · Glitchy audio…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove from journal
        </button>
      </div>
    </div>
  );
}

// ── Journal page ──────────────────────────────────────────────────────────────

export default function Journal() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<PlayEntry[]>([]);
  const [stats, setStats] = useState<PlayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStatuses, setActiveStatuses] = useState<PlayStatus[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([getPlayEntries(), getPlayStats()])
      .then(([e, s]) => { setEntries(e); setStats(s); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave(entry: PlayEntry, patch: Partial<PlayEntry>) {
    const updated = { ...entry, ...patch };
    const saved = await setPlayEntry(
      updated.title_normalized,
      updated.console,
      updated.status,
      updated.rating ?? null,
      updated.notes ?? null,
      updated.compat_notes ?? null,
      updated.display_title,
    ).catch((e) => { console.error(e); return null; });
    if (!saved) return;
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, ...saved } : e));
    getPlayStats().then(setStats).catch(console.error);
  }

  async function handleDelete(entry: PlayEntry) {
    await deletePlayEntry(entry.title_normalized, entry.console).catch(console.error);
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    if (expandedId === entry.id) setExpandedId(null);
    getPlayStats().then(setStats).catch(console.error);
  }

  async function handleExport() {
    if (!isTauri()) return;
    const path = await saveFileDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "play-journal.json",
    });
    if (typeof path !== "string") return;
    await exportJournalToFile(path).catch(console.error);
    toast({ description: "Journal exported." });
  }

  async function handleImport() {
    if (!isTauri()) return;
    const path = await openFileDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    const filePath = Array.isArray(path) ? path[0] : path;
    if (typeof filePath !== "string") return;
    const count = await importJournalFromFile(filePath).catch(console.error);
    if (count != null) {
      toast({ description: `Imported ${count} journal entries.` });
      refresh();
    }
  }

  const filtered = useMemo(() => {
    let result = entries;
    if (activeStatuses.length > 0) result = result.filter((e) => activeStatuses.includes(e.status));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        (e.display_title ?? e.title_normalized).toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      if (sortKey === "title") {
        const at = a.display_title ?? a.title_normalized, bt = b.display_title ?? b.title_normalized;
        return sortDir === "asc" ? at.localeCompare(bt) : bt.localeCompare(at);
      }
      if (sortKey === "rating") {
        const diff = (a.rating ?? 0) - (b.rating ?? 0);
        return sortDir === "asc" ? diff : -diff;
      }
      const diff = a.updated_at.localeCompare(b.updated_at);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [entries, activeStatuses, search, sortKey, sortDir]);

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">Journal</h1>
      </div>

      {/* Toolbar */}
      <FilterBar
        groups={[
          {
            key: "status",
            label: "Status",
            items: ALL_STATUSES.map((s) => STATUS_LABEL[s]),
            active: activeStatuses.map((s) => STATUS_LABEL[s]),
            onToggle: (label) => {
              const status = STATUS_BY_LABEL.get(label);
              if (!status) return;
              setActiveStatuses((prev) => prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]);
            },
            onClear: () => setActiveStatuses([]),
          },
        ]}
        leading={
          <>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles…"
                className="pl-7 h-8 text-sm w-44"
              />
            </div>
            <SortControl
              fields={JOURNAL_SORT_FIELDS}
              field={sortKey}
              dir={sortDir}
              onField={setSortKey}
              onDir={setSortDir}
            />
          </>
        }
        trailing={
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground">
              {filtered.length} {pluralize(filtered.length, "entry", "entries")}
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={handleExport}>
              <DownloadIcon className="w-3.5 h-3.5" />
              Export
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={handleImport}>
              <Upload className="w-3.5 h-3.5" />
              Import
            </Button>
          </div>
        }
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Loading…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <BookOpen className="w-10 h-10 opacity-20" />
            {entries.length === 0 ? (
              <p className="text-sm text-center">
                No games journaled yet — open the ROMs tab, hover a title, and click ✦ to start.
              </p>
            ) : (
              <p className="text-sm">No entries match your filter.</p>
            )}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-border/40">
            {filtered.map((entry) => {
              const title = entry.display_title ?? entry.title_normalized;
              const isOpen = expandedId === entry.id;
              const communityDisplay = entry.community_score != null ? (entry.community_score / 10).toFixed(1) : null;
              const criticDisplay    = entry.critic_score    != null ? (entry.critic_score    / 10).toFixed(1) : null;

              return (
                <div key={entry.id}>
                  {/* Row */}
                  <div
                    className="flex items-center gap-3 px-6 py-3 hover:bg-muted/20 cursor-pointer text-sm"
                    onClick={() => setExpandedId(isOpen ? null : entry.id)}
                  >
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    }
                    <PlayStatusBadge status={entry.status} />
                    <span className="flex-1 font-medium text-foreground truncate" title={title}>{title}</span>
                    <span className="text-xs text-muted-foreground/60 shrink-0">{entry.console.replace(/^.*?-\s*/, "").trim()}</span>
                    <StarRating value={entry.rating ?? null} size="sm" readOnly />
                    <div className="text-xs text-muted-foreground/60 text-right shrink-0 min-w-[80px]">
                      {communityDisplay && <div>Crowd {communityDisplay}</div>}
                      {criticDisplay    && <div>Critics {criticDisplay}</div>}
                      <div>{entry.updated_at.slice(0, 10)}</div>
                    </div>
                  </div>

                  {/* Inline edit panel */}
                  {isOpen && (
                    <EditPanel
                      key={entry.id}
                      entry={entry}
                      onSave={(patch) => handleSave(entry, patch)}
                      onDelete={() => handleDelete(entry)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary footer */}
      {stats && (stats.backlog + stats.testing + stats.playing + stats.completed + stats.dropped) > 0 && (
        <div className="px-6 py-2 border-t border-border/50 flex items-center gap-6 text-xs text-muted-foreground bg-muted/5">
          {([["Backlog", stats.backlog], ["Testing", stats.testing], ["Playing", stats.playing], ["Completed", stats.completed], ["Dropped", stats.dropped]] as [string, number][]).map(([label, count]) => (
            count > 0 && (
              <span key={label}>{label} <span className="text-foreground font-medium">{count}</span></span>
            )
          ))}
          {stats.avg_rating != null && (
            <span className="ml-auto">Avg rating <span className="text-foreground font-medium">{stats.avg_rating.toFixed(1)}/5</span></span>
          )}
        </div>
      )}
    </div>
  );
}
