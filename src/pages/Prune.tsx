import { useState, useEffect } from "react";
import { AlertTriangle, Download, Trash2, Eye, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { applyFilters, executePrune, exportCsv, formatBytes, isOneDrivePath, getSettings, getFormatPairs } from "@/lib/tauri";
import type { FilterSettings } from "@/lib/bindings/FilterSettings";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { FormatPair } from "@/lib/bindings/FormatPair";
import { usePreferencesStore } from "@/store/preferences";
import { useUIStore } from "@/store/ui";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";

const DEFAULT_FILTERS: FilterSettings = {
  keep_preferred_only: true,
  remove_if_no_preferred_version: true,
  remove_prerelease: true,
  remove_unofficial: false,
  remove_older_revisions: true,
  keep_unofficial_as_fallback: true,
};

export default function Prune() {
  const { filterSettings, setFilterSettings } = usePreferencesStore();
  const { setOnedriveAcknowledged, onedriveAcknowledged } = useUIStore();
  const { selectedConsoles, cacheVersion } = useScanStore();
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);
  const [formatPrefs, setFormatPrefs] = useState<Record<string, string>>({});

  useEffect(() => {
    getFormatPairs().then(setFormatPairs).catch(console.error);
    getSettings().then((s) => setFormatPrefs(s.format_preferences as Record<string, string>)).catch(console.error);
  }, [cacheVersion]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [hasOneDrive, setHasOneDrive] = useState(false);
  const [allowPermanentDelete, setAllowPermanentDelete] = useState(false);

  async function preview() {
    setLoading(true);
    setPlan(null);
    try {
      const p = await applyFilters(filterSettings, selectedConsoles ?? undefined);
      setPlan(p);
      const settings = await getSettings();
      setHasOneDrive(settings.rom_roots.some(isOneDrivePath));
      setAllowPermanentDelete(settings.allow_permanent_delete ?? false);
    } finally {
      setLoading(false);
    }
  }

  async function doExportCsv() {
    if (!plan) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const now = new Date().toISOString().slice(0, 10);
    const filePath = await save({ defaultPath: `romulus-prune-${now}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!filePath) return;
    await exportCsv(plan.to_delete, filePath);
  }

  async function doExecute() {
    if (!plan) return;
    setExecuting(true);
    try {
      const mode = allowPermanentDelete ? "permanent" : "trash";
      const res = await executePrune(plan.to_delete, mode, onedriveAcknowledged);
      setResult({ success: res.success_count, failed: res.failed.length });
      setPlan(null);
    } finally {
      setExecuting(false);
    }
  }

  function toggle(key: keyof FilterSettings) {
    setFilterSettings({ ...filterSettings, [key]: !filterSettings[key] });
  }

  const filters = filterSettings ?? DEFAULT_FILTERS;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="Prune" />
      </div>

      <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {!plan && !result && !loading && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="pending deletions">
            <div className="text-sm text-muted-foreground text-center py-4">Nothing to prune — click Preview to check for deletions.</div>
          </ConsoleEmptyState>
        )}

        {result && (
          <Alert className="border-green-500/40 bg-green-500/10">
            <AlertDescription className="text-green-300 text-sm">
              ✓ Moved {result.success} files to Trash. {result.failed > 0 && `${result.failed} failed.`}
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Official ROMs</h2>
          <FilterRow label="Keep only preferred language" sub="Delete variants not matching your language settings" checked={filters.keep_preferred_only} onToggle={() => toggle("keep_preferred_only")} />
          <FilterRow label="Delete if no preferred version exists" sub="Remove all variants of a game if none match your preferences" checked={filters.remove_if_no_preferred_version} onToggle={() => toggle("remove_if_no_preferred_version")} />
          <FilterRow label="Remove pre-release (Beta, Proto, Demo, Sample, Kiosk, Promo)" checked={filters.remove_prerelease} onToggle={() => toggle("remove_prerelease")} />
          <FilterRow label="Remove older revisions when newer exists" checked={filters.remove_older_revisions} onToggle={() => toggle("remove_older_revisions")} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Unofficial ROMs</h2>
          <FilterRow label="Keep unofficial as fallback" sub="If the only preferred-language version is unofficial, keep it" checked={filters.keep_unofficial_as_fallback} onToggle={() => toggle("keep_unofficial_as_fallback")} />
          <FilterRow label="Delete ALL unofficial regardless of language" checked={filters.remove_unofficial} onToggle={() => toggle("remove_unofficial")} destructive />
        </section>

        {/* Format pair preferences (informational — configured in Settings) */}
        {Object.keys(formatPrefs).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Format Pair Preferences</h2>
            <p className="text-xs text-muted-foreground">Configured in Settings. Format pair integration with Prune is coming in a future update.</p>
            {Object.entries(formatPrefs).map(([group, folder]) => {
              const pair = formatPairs.find((p) => p.console_group === group);
              const alt = pair
                ? [pair.folder_a, pair.folder_b].find((f) => f !== folder) ?? folder
                : folder;
              return (
                <div key={group} className="text-xs flex items-center gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{group}</span>
                  <span>→ prefer</span>
                  <span className="text-primary">{folder}</span>
                  <span>(over {alt})</span>
                </div>
              );
            })}
          </section>
        )}

        {/* OneDrive warning */}
        {hasOneDrive && !onedriveAcknowledged && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm space-y-2">
              <p>OneDrive path detected. Deletions will sync to the cloud.</p>
              <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300" onClick={() => setOnedriveAcknowledged(true)}>
                I understand — proceed
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Plan summary */}
        {plan && (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Preview</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={doExportCsv} className="text-xs gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPlan(null)} className="text-xs gap-1 text-muted-foreground">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="px-4 py-3 grid grid-cols-3 gap-4 text-center border-b border-border">
              <div><div className="text-xl font-bold text-red-400">{plan.to_delete.length.toLocaleString()}</div><div className="text-xs text-muted-foreground">to delete</div></div>
              <div><div className="text-xl font-bold text-green-400">{plan.to_keep.length.toLocaleString()}</div><div className="text-xs text-muted-foreground">to keep</div></div>
              <div><div className="text-xl font-bold text-foreground">{formatBytes(plan.total_bytes_freed)}</div><div className="text-xs text-muted-foreground">to reclaim</div></div>
            </div>
            {plan.no_preferred_version_count > 0 && (
              <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/10 border-b border-border">
                {plan.no_preferred_version_count} game{plan.no_preferred_version_count !== 1 ? "s" : ""} deleted — no preferred-language version exists
              </div>
            )}
            <ScrollArea className="h-48">
              {plan.to_delete.slice(0, 100).map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 text-xs hover:bg-muted/20">
                  <span className="flex-1 truncate font-mono text-muted-foreground">{r.filename}</span>
                  <span className="text-muted-foreground/60 shrink-0">{r.console.split(" - ")[1] ?? r.console}</span>
                </div>
              ))}
              {plan.to_delete.length > 100 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">…and {(plan.to_delete.length - 100).toLocaleString()} more</div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={plan ? () => setPlan(null) : preview}
            disabled={loading}
            variant="outline"
            className="gap-2"
          >
            {plan ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {loading ? "Computing…" : plan ? "Hide preview" : "Preview"}
          </Button>
          {plan && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={executing || (hasOneDrive && !onedriveAcknowledged)} variant="destructive" className="gap-2">
                  <Trash2 className="w-4 h-4" />{executing ? (allowPermanentDelete ? "Deleting…" : "Moving to Trash…") : `${allowPermanentDelete ? "Delete" : "Move"} ${plan.to_delete.length.toLocaleString()} files ${allowPermanentDelete ? "permanently" : "to Trash"}`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                  <AlertDialogDescription>
                    {allowPermanentDelete
                      ? `${plan.to_delete.length.toLocaleString()} files will be permanently deleted (${formatBytes(plan.total_bytes_freed)} freed). This cannot be undone.`
                      : `${plan.to_delete.length.toLocaleString()} files will be moved to the Trash (${formatBytes(plan.total_bytes_freed)} freed). This action can be undone from the Trash.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={doExecute} className="bg-destructive hover:bg-destructive/90">
                    {allowPermanentDelete ? "Delete permanently" : "Move to Trash"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function FilterRow({ label, sub, checked, onToggle, destructive }: {
  label: string; sub?: string; checked: boolean; onToggle: () => void; destructive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-card/50">
      <div>
        <Label className={`text-sm ${destructive ? "text-red-400" : "text-foreground"}`}>{label}</Label>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        className={`shrink-0 mt-0.5${destructive ? " data-[state=checked]:bg-destructive" : ""}`}
      />
    </div>
  );
}
