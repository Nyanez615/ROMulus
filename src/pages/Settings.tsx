import { useState, useEffect, useMemo, useRef } from "react";
import { FolderOpen, Plus, X, GripVertical, Languages, AlertTriangle, Database, Image, Sparkles, Monitor, ShieldCheck, Zap, Info, Layers, Trash2, Search, Loader2 } from "lucide-react";
import { open, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { CheckSquare, Square } from "lucide-react";
import {
  getSettings, saveSettings, reapplyPreferences, isCloudPath,
  setIgdbCredentials, hasIgdbCredentials, clearIgdbCredentials,
  setSteamGridDbKey, hasSteamGridDbKey, clearSteamGridDbKey,
  getDatFiles, importDat, readDatHeader, removeDat, verifyRoms, enrichAllGames,
  scanRoots,
  getFormatPairs, applyFormatPairs, executeFormatPairs, formatBytes,
  getConsoles,
  generateDownloadList, exportDownloadList,
} from "@/lib/tauri";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { DatFile } from "@/lib/bindings/DatFile";
import type { FormatPair } from "@/lib/bindings/FormatPair";
import type { DeletionItem } from "@/lib/bindings/DeletionItem";
import type { DeletionPlan } from "@/lib/bindings/DeletionPlan";
import type { DownloadList } from "@/lib/bindings/DownloadList";
import type { DownloadEntry } from "@/lib/bindings/DownloadEntry";
import type { ExportFormat } from "@/lib/bindings/ExportFormat";
import { useUIStore } from "@/store/ui";
import { usePreferencesStore } from "@/store/preferences";
import { useScanStore } from "@/store/scan";
import { getRegionsForLanguage } from "@/lib/regionUtils";
import { getFormatVariantLabel } from "@/lib/consoleUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { refreshTagStore } from "@/components/Layout";

function reasonKey(r: DeletionItem["reason"]): string {
  return typeof r === "string" ? r : Object.keys(r)[0] ?? "unknown";
}

const FP_REASON_COLORS: Record<string, string> = {
  format_pair_non_preferred:  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  format_pair_no_counterpart: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};
const FP_REASON_LABELS: Record<string, string> = {
  format_pair_non_preferred:  "Format variant",
  format_pair_no_counterpart: "No counterpart",
};

// ── Download list status chip ─────────────────────────────────────────────────

const DL_STATUS: Record<string, { label: string; cls: string }> = {
  preferred:       { label: "Preferred",   cls: "bg-green-500/15  text-green-400  border-green-500/30" },
  prerelease_only: { label: "Pre-release", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
};

function DlStatusChip({ status }: { status: DownloadEntry["status"] }) {
  const key = typeof status === "string" ? status : Object.keys(status)[0] ?? "";
  const info = DL_STATUS[key] ?? { label: key, cls: "bg-muted/30 text-muted-foreground border-border" };
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${info.cls}`}>
      {info.label}
    </span>
  );
}

const COMMON_LANGUAGES = ["En", "Ja", "Fr", "De", "Es", "It", "Pt", "Zh", "Ko", "Ru", "Nl", "Sv"];
const COMMON_REGIONS = ["USA", "World", "Europe", "Japan", "Australia", "United Kingdom",
  "Germany", "France", "Spain", "Italy", "Korea", "Brazil", "Taiwan", "China"];

// ── Sortable region row ───────────────────────────────────────────────────────

function SortableRegion({ region, index, onRemove }: { region: string; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: region });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
        isDragging ? "opacity-50 bg-muted border-border" : "bg-card border-border hover:bg-muted/40",
      ].join(" ")}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <span className="flex-1 text-foreground">{region}</span>
      <span className="text-xs text-muted-foreground">#{index + 1}</span>
      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const { theme, setTheme, setActiveTab } = useUIStore();
  const { setPreferences } = usePreferencesStore();
  const { setConsoles, setStatus, bumpCacheVersion, cacheVersion } = useScanStore();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [showScanPrompt, setShowScanPrompt] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [hasIgdb, setHasIgdb] = useState(false);
  const [hasSgdb, setHasSgdb] = useState(false);
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbSecret, setIgdbSecret] = useState("");
  const [sgdbKey, setSgdbKey] = useState("");
  const [datFiles, setDatFiles] = useState<DatFile[]>([]);
  const [enriching, setEnriching] = useState(false);

  // ── Download list state ──────────────────────────────────────────────────────
  const [dlList,         setDlList]         = useState<DownloadList | null>(null);
  const [dlConsole,      setDlConsole]      = useState<string | null>(null);
  const [dlLoading,      setDlLoading]      = useState<string | null>(null);
  const [dlSearch,       setDlSearch]       = useState("");
  const [selectedDats,   setSelectedDats]   = useState<string[]>([]);
  const [batchExporting, setBatchExporting] = useState(false);

  // ── Format pair state ────────────────────────────────────────────────────────
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);
  const [selectedPairGroups, setSelectedPairGroups] = useState<Record<string, true>>({});
  const prevPairGroupsRef = useRef<Set<string>>(new Set());
  const [fpPlan, setFpPlan] = useState<DeletionPlan | null>(null);
  const [fpPreviewSearch, setFpPreviewSearch] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpExecuting, setFpExecuting] = useState(false);
  const [fpScanState, setFpScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [fpResult, setFpResult] = useState<{ success: number; failed: number; foldersRemoved: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    hasIgdbCredentials().then(setHasIgdb).catch(console.error);
    hasSteamGridDbKey().then(setHasSgdb).catch(console.error);
    getDatFiles().then(setDatFiles).catch(console.error);
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Re-fetch format pairs whenever a scan completes (cacheVersion bump) so the
  // Format Variant Cleanup section appears/updates without requiring a full re-mount.
  useEffect(() => {
    getFormatPairs().then((pairs) => {
      setFormatPairs(pairs);
      const incomingGroups = new Set(pairs.map((p) => p.console_group));
      setSelectedPairGroups((prev) => {
        const next: Record<string, true> = {};
        for (const g of incomingGroups) {
          if (prevPairGroupsRef.current.has(g)) {
            if (prev[g]) next[g] = true;
          } else {
            next[g] = true;
          }
        }
        return next;
      });
      prevPairGroupsRef.current = incomingGroups;
    }).catch(console.error);
  }, [cacheVersion]);

  async function save(next: AppSettings) {
    setSaved(false);
    await saveSettings(next);
    setSettings(next);
    setPreferences(next.preferences);
    reapplyPreferences().catch(console.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setCloudError(null);
      if (isCloudPath(selected)) {
        setCloudError("Cloud storage paths cannot be used as ROM roots. Files are permanently deleted during cleanup.");
        return;
      }
      if (settings && !settings.rom_roots.includes(selected)) {
        await save({ ...settings, rom_roots: [...settings.rom_roots, selected] });
        setShowScanPrompt(true);
      }
    }
  }

  function removeRoot(path: string) {
    if (!settings) return;
    save({ ...settings, rom_roots: settings.rom_roots.filter((r) => r !== path) });
  }

  function toggleLang(lang: string) {
    if (!settings) return;
    const langs = settings.preferences.preferred_languages;
    const next = langs.includes(lang) ? langs.filter((l) => l !== lang) : [...langs, lang];
    if (next.length === 0) return;
    save({ ...settings, preferences: { ...settings.preferences, preferred_languages: next } });
  }

  function moveRegion(from: number, to: number) {
    if (!settings) return;
    const next = [...settings.preferences.preferred_regions];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    save({ ...settings, preferences: { ...settings.preferences, preferred_regions: next } });
  }

  function handleRegionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !settings) return;
    const regions = settings.preferences.preferred_regions;
    const oldIdx = regions.indexOf(active.id as string);
    const newIdx = regions.indexOf(over.id as string);
    if (oldIdx !== -1 && newIdx !== -1) moveRegion(oldIdx, newIdx);
  }

  function addRegion(region: string) {
    if (!settings || settings.preferences.preferred_regions.includes(region)) return;
    save({ ...settings, preferences: { ...settings.preferences, preferred_regions: [...settings.preferences.preferred_regions, region] } });
  }

  function removeRegion(region: string) {
    if (!settings) return;
    save({ ...settings, preferences: { ...settings.preferences, preferred_regions: settings.preferences.preferred_regions.filter((r) => r !== region) } });
  }

  function selectFormatFolder(consoleGroup: string, folder: string) {
    if (!settings) return;
    const next: AppSettings = {
      ...settings,
      format_preferences: { ...settings.format_preferences, [consoleGroup]: folder },
    };
    setSettings(next);
    saveSettings(next).catch(console.error);
  }

  function togglePairGroup(group: string) {
    setSelectedPairGroups((prev) => {
      if (prev[group]) { const next = { ...prev }; delete next[group]; return next; }
      return { ...prev, [group]: true };
    });
  }

  const formatPrefs = useMemo(() => settings?.format_preferences ?? {}, [settings]);

  const anySelectedPrefSet = useMemo(
    () => formatPairs.some((p) => selectedPairGroups[p.console_group] && formatPrefs[p.console_group] !== undefined),
    [formatPairs, selectedPairGroups, formatPrefs],
  );

  const activeFpItems = (fpPlan?.to_delete ?? []).filter((d) =>
    formatPairs.some(
      (p) => (p.folder_a === d.rom.console || p.folder_b === d.rom.console) && !!selectedPairGroups[p.console_group],
    )
  );

  const filteredFpItems = useMemo(() => {
    const q = fpPreviewSearch.toLowerCase();
    const items = activeFpItems.filter(
      (d) => !q || d.rom.filename.toLowerCase().includes(q) || d.rom.title.toLowerCase().includes(q),
    );
    return items.sort((a, b) => {
      const aNC = reasonKey(a.reason) === "format_pair_no_counterpart" ? 0 : 1;
      const bNC = reasonKey(b.reason) === "format_pair_no_counterpart" ? 0 : 1;
      return aNC - bNC;
    });
  }, [activeFpItems, fpPreviewSearch]);

  const fpNoCounterpartCount = useMemo(
    () => activeFpItems.filter((d) => reasonKey(d.reason) === "format_pair_no_counterpart").length,
    [activeFpItems],
  );

  async function previewFormatPairs() {
    setFpLoading(true);
    setFpPlan(null);
    try {
      const p = await applyFormatPairs();
      setFpPlan(p);
    } finally {
      setFpLoading(false);
    }
  }

  async function executeFormatPairsAction() {
    if (!fpPlan || activeFpItems.length === 0) return;
    setFpScanState("idle");
    setFpExecuting(true);
    let currentSettings = settings;
    try {
      const toDelete = activeFpItems.map((d) => d.rom);
      const res = await executeFormatPairs(toDelete);
      setFpResult({ success: res.success_count, failed: res.failed.length, foldersRemoved: res.folders_removed.length });
      setFpPlan(null);
      setFpPreviewSearch("");
      currentSettings = await getSettings().catch(() => settings);
      setSettings(currentSettings);
      await reapplyPreferences().catch(console.error);
    } finally {
      setFpExecuting(false);
    }
    if (!currentSettings?.rom_roots.length) return;
    setFpScanState("scanning");
    try {
      const scanResult = await scanRoots(currentSettings.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
      setFpScanState("done");
    } catch {
      setFpScanState("idle");
    }
  }

  // ── Download list handlers ───────────────────────────────────────────────────

  async function handleGenerate(consoleName: string) {
    setDlLoading(consoleName);
    setDlList(null);
    setDlSearch("");
    setDlConsole(consoleName);
    try {
      const list = await generateDownloadList(consoleName);
      setDlList(list);
    } finally {
      setDlLoading(null);
    }
  }

  async function handleExportList(format: ExportFormat) {
    if (!dlList) return;
    const ext = format === "text" ? "txt" : "csv";
    const safeName = (dlConsole ?? "download-list").replace(/[/\\:*?"<>|]/g, "_");
    const filePath = await saveFileDialog({
      filters: [{ name: "Download list", extensions: [ext] }],
      defaultPath: `${safeName}.${ext}`,
    });
    if (typeof filePath === "string") {
      await exportDownloadList(dlList.to_download, filePath, format);
    }
  }

  async function handleBatchExport(format: ExportFormat) {
    if (selectedDats.length === 0) return;
    const dir = await open({ directory: true, title: "Choose export folder" });
    if (typeof dir !== "string") return;
    const ext = format === "text" ? "txt" : "csv";
    setBatchExporting(true);
    try {
      for (const consoleName of selectedDats) {
        const list = await generateDownloadList(consoleName);
        if (list.to_download.length === 0) continue;
        const safeName = consoleName.replace(/[/\\:*?"<>|]/g, "_");
        await exportDownloadList(list.to_download, `${dir}/${safeName}.${ext}`, format);
      }
    } finally {
      setBatchExporting(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-14 flex items-center px-6 border-b border-border">
          <h1 className="text-base font-semibold text-foreground">Settings</h1>
        </div>
        <div className="p-8 text-muted-foreground text-sm">Loading settings…</div>
      </div>
    );
  }

  const unaddedRegions = COMMON_REGIONS.filter(
    (r) => !settings.preferences.preferred_regions.includes(r),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-6 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
        {saved && <span className="text-xs text-green-400 ml-auto">Saved ✓</span>}
      </div>
      <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-8 space-y-8">

      {/* ROM Libraries — first section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">ROM Libraries</h2>
        </div>

        {/* Section-level error for existing cloud roots — these are unsupported */}
        {settings.rom_roots.filter(isCloudPath).length > 0 && (
          <Alert className="border-red-500/40 bg-red-500/10">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <AlertDescription className="text-red-300 text-sm space-y-2">
              <p className="font-medium">Cloud storage paths are not supported.</p>
              <p>ROMulus cannot safely delete files from cloud-synced folders — deletions may fail or force files to download first. Remove these roots and point ROMulus at a local copy of your library instead.</p>
              <ul className="list-disc list-inside space-y-0.5 pt-0.5">
                {settings.rom_roots.filter(isCloudPath).map((r) => (
                  <li key={r} className="font-mono text-xs break-all text-red-300/70">{r}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {settings.rom_roots.map((root) => (
            <div key={root} className="border border-border rounded-lg p-3">
              <div className="flex items-start gap-2">
                <FolderOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <span className="flex-1 text-xs text-foreground font-mono break-all">{root}</span>
                <button onClick={() => removeRoot(root)} className="text-muted-foreground hover:text-destructive shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={pickFolder} className="w-full">
          <Plus className="w-4 h-4 mr-2" /> Add folder
        </Button>

        {cloudError && (
          <Alert className="border-red-500/40 bg-red-500/10">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <AlertDescription className="text-red-300 text-sm">
              {cloudError}
            </AlertDescription>
          </Alert>
        )}

        {showScanPrompt && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/10">
            <span className="text-sm flex-1">Library added. Scan now to index your ROMs.</span>
            <Button
              size="sm"
              onClick={async () => {
                setShowScanPrompt(false);
                const s = await getSettings();
                setActiveTab("dashboard");
                await scanRoots(s.rom_roots);
              }}
              className="gap-1.5 shrink-0"
            >
              <Zap className="w-3.5 h-3.5" /> Scan now
            </Button>
            <button
              onClick={() => setShowScanPrompt(false)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      <Separator />

      {/* Language & Region */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Languages className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Language &amp; Region</h2>
        </div>

        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">Preferred languages</Label>
          <div className="flex flex-wrap gap-2">
            {COMMON_LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => toggleLang(lang)}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                  settings.preferences.preferred_languages.includes(lang)
                    ? "bg-primary/20 border-primary/60 text-primary"
                    : "bg-muted border-border text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {lang}
              </button>
            ))}
          </div>
          {/* Inferred-regions note — show which regions map to each selected language */}
          {settings.preferences.preferred_languages.length > 0 && (
            <div className="mt-3 space-y-1">
              {settings.preferences.preferred_languages.map((lang) => {
                const regions = getRegionsForLanguage(lang);
                if (regions.length === 0) return null;
                return (
                  <div key={lang} className="flex items-start gap-1.5 text-xs text-muted-foreground/70">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 mt-0.5 shrink-0 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-xs">
                          ROMs from these regions with no explicit language tag will be treated as {lang}.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span>{`${lang} → inferred for: ${regions.join(", ")}`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <Label className="text-sm text-muted-foreground mb-1 block">Region priority (drag to reorder)</Label>
          <DndContext sensors={sensors} onDragEnd={handleRegionDragEnd}>
            <SortableContext items={settings.preferences.preferred_regions} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {settings.preferences.preferred_regions.map((region, i) => (
                  <SortableRegion
                    key={region}
                    region={region}
                    index={i}
                    onRemove={() => removeRegion(region)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {unaddedRegions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {unaddedRegions.map((r) => (
                <button
                  key={r}
                  onClick={() => addRegion(r)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground border border-dashed border-border hover:text-foreground"
                >
                  <Plus className="w-3 h-3" /> {r}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* Appearance */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Appearance</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Dark mode</Label>
            <p className="text-xs text-muted-foreground">Gaming aesthetic (recommended)</p>
          </div>
          <Switch
            checked={theme === "dark"}
            onCheckedChange={(v) => {
              const t = v ? "dark" : "light";
              setTheme(t);
              if (settings) save({ ...settings, theme: t });
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Short console names</Label>
            <p className="text-xs text-muted-foreground">Show abbreviations (GBA, NES) instead of full names</p>
          </div>
          <Switch
            checked={settings.preferences.short_console_names}
            onCheckedChange={(v) =>
              save({ ...settings, preferences: { ...settings.preferences, short_console_names: v } })
            }
          />
        </div>
      </section>

      <Separator />

      {/* Format Pair Cleanup */}
      {formatPairs.length > 0 && (
        <>
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Format Variant Cleanup</h2>
            <div className="flex gap-1 ml-auto">
              <button onClick={() => { const all: Record<string, true> = {}; for (const p of formatPairs) all[p.console_group] = true; setSelectedPairGroups(all); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                <CheckSquare className="w-3 h-3" /> All
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button onClick={() => setSelectedPairGroups({})} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                <Square className="w-3 h-3" /> None
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Select your preferred format for each paired console folder. Click "Analyze" to preview which files will be removed, then execute to delete the non-preferred copies.
          </p>

          {[...formatPairs].sort((a, b) => a.console_group.localeCompare(b.console_group)).map((pair) => {
            const pref = formatPrefs[pair.console_group];
            const isSelected = !!selectedPairGroups[pair.console_group];
            const isProperSubset = pair.folder_a_count < pair.folder_b_count;
            const isIdentical = pair.folder_a_count === pair.folder_b_count && pair.overlap_percent >= 0.999;
            const shortA = getFormatVariantLabel(pair.folder_a);
            const shortB = getFormatVariantLabel(pair.folder_b);
            const headerLabel = isProperSubset
              ? `${shortA} ⊂ ${shortB} · ${pair.folder_a_count} of ${pair.folder_b_count} titles`
              : isIdentical
              ? `${pair.folder_a_count} titles each · 100% overlap`
              : `${Math.round(pair.overlap_percent * 100)}% overlap · ${pair.folder_a_count} / ${pair.folder_b_count} titles`;
            return (
              <div key={pair.console_group} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => togglePairGroup(pair.console_group)}
                  className="w-full px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-2 hover:bg-muted/50 transition-colors"
                >
                  <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${isSelected ? "bg-primary/20 border-primary/60" : "border-border"}`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                  </div>
                  {headerLabel}
                </button>
                <div className={`divide-y divide-border${!isSelected ? " opacity-50 pointer-events-none" : ""}`}>
                  {[pair.folder_a, pair.folder_b].map((folder) => {
                    const count = folder === pair.folder_a ? pair.folder_a_count : pair.folder_b_count;
                    const isSubsetFolder = isProperSubset && folder === pair.folder_a;
                    return (
                      <button
                        key={folder}
                        onClick={() => selectFormatFolder(pair.console_group, folder)}
                        className={["w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors", pref === folder ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/30"].join(" ")}
                      >
                        <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${pref === folder ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                        <span className={pref === folder ? "text-foreground font-medium" : "text-muted-foreground"}>{getFormatVariantLabel(folder)}</span>
                        <span className="text-xs text-muted-foreground/50 ml-1">{count} titles</span>
                        {isSubsetFolder && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">subset</span>}
                        {pref === folder && <span className="text-xs text-primary ml-auto">preferred</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {fpResult && (
            <Alert className="border-green-500/40 bg-green-500/10">
              <AlertDescription className="text-green-300 text-sm flex items-center justify-between gap-3 flex-wrap">
                <span>
                  ✓ Removed {fpResult.success} file{fpResult.success !== 1 ? "s" : ""}.
                  {fpResult.foldersRemoved > 0 && ` ${fpResult.foldersRemoved} empty folder${fpResult.foldersRemoved !== 1 ? "s" : ""} deleted from scan roots.`}
                  {fpResult.failed > 0 && ` ${fpResult.failed} failed.`}
                </span>
                {fpScanState === "scanning" && (
                  <span className="flex items-center gap-1.5 text-green-400/70 text-xs shrink-0">
                    <Loader2 className="w-3 h-3 animate-spin" /> Rescanning…
                  </span>
                )}
                {fpScanState === "done" && <span className="text-green-400/70 text-xs shrink-0">Collection updated.</span>}
              </AlertDescription>
            </Alert>
          )}

          {fpNoCounterpartCount > 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <AlertDescription className="text-amber-300 text-sm">
                {fpNoCounterpartCount} file{fpNoCounterpartCount !== 1 ? "s have" : " has"} no counterpart in the preferred folder and will also be deleted.
              </AlertDescription>
            </Alert>
          )}

          {fpPlan && activeFpItems.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {activeFpItems.length.toLocaleString()} files · {formatBytes(activeFpItems.reduce((s, d) => s + d.rom.filesize, 0))} to remove
                </span>
                <button onClick={() => { setFpPlan(null); setFpPreviewSearch(""); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Search files…"
                  value={fpPreviewSearch}
                  onChange={(e) => setFpPreviewSearch(e.target.value)}
                  className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0"
                />
              </div>
              <div className="h-64 overflow-y-auto overflow-x-hidden">
                {filteredFpItems.map((item, i) => {
                  const rk = reasonKey(item.reason);
                  const isNoCounterpart = rk === "format_pair_no_counterpart";
                  const colorClass = FP_REASON_COLORS[rk] ?? "bg-muted/40 text-muted-foreground border-border/60";
                  return (
                    <div key={i} className={`flex items-center gap-2 px-4 py-1.5 border-b text-xs ${isNoCounterpart ? "border-l-2 border-l-amber-500/50 border-b-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10" : "border-b-border/40 hover:bg-muted/20"}`}>
                      <span className={`min-w-0 flex-1 truncate font-mono ${isNoCounterpart ? "text-amber-300/80" : "text-muted-foreground"}`}>{item.rom.filename}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colorClass}`}>{FP_REASON_LABELS[rk] ?? rk}</span>
                      <span className="text-muted-foreground/60 shrink-0">{getFormatVariantLabel(item.rom.console)}</span>
                    </div>
                  );
                })}
                {filteredFpItems.length === 0 && fpPreviewSearch && (
                  <div className="px-4 py-4 text-xs text-muted-foreground text-center">No matches for "{fpPreviewSearch}"</div>
                )}
              </div>
            </div>
          )}

          {fpPlan && activeFpItems.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {fpPlan.to_delete.length === 0 ? "Nothing to remove — all files are already in the preferred format." : "No items match the selected pairs."}
            </p>
          )}

          <div className="flex gap-3">
            <Button size="sm" variant="outline" disabled={fpLoading || !anySelectedPrefSet} onClick={previewFormatPairs} className="gap-2">
              {fpLoading ? "Analyzing…" : fpPlan ? "Re-analyze" : "Analyze Removals"}
            </Button>
            {fpPlan && activeFpItems.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={fpExecuting} className="gap-2">
                    <Trash2 className="w-3.5 h-3.5" />
                    {fpExecuting ? "Removing…" : `Remove ${activeFpItems.length.toLocaleString()} files`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove format-pair files?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {activeFpItems.length.toLocaleString()} files from non-preferred format folders ({formatBytes(activeFpItems.reduce((s, d) => s + d.rom.filesize, 0))}) will be permanently deleted.
                      {fpNoCounterpartCount > 0 && (
                        <span className="block mt-1 text-amber-400">
                          {fpNoCounterpartCount} file{fpNoCounterpartCount !== 1 ? "s have" : " has"} no counterpart in the preferred folder.
                        </span>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={executeFormatPairsAction} className="bg-destructive hover:bg-destructive/90">
                      Delete permanently
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </section>
        <Separator />
        </>
      )}

      {/* Privacy */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Privacy</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Crash reporting</Label>
            <p className="text-xs text-muted-foreground">Send anonymous stack traces only — no file paths or ROM titles</p>
          </div>
          <Switch
            checked={settings.crash_reporting_enabled}
            onCheckedChange={(v) => save({ ...settings, crash_reporting_enabled: v })}
          />
        </div>
      </section>

      <Separator />

      {/* IGDB Metadata */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">IGDB Metadata</h2>
          {hasIgdb && <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">Connected</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          IGDB provides game metadata (genre, release year, description, ratings). Requires a free Twitch developer API key.
          Register at <span className="text-primary">dev.twitch.tv/console</span>.
        </p>
        {hasIgdb ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => { setEnriching(true); await enrichAllGames().finally(() => setEnriching(false)); }} disabled={enriching} className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />{enriching ? "Enriching…" : "Enrich all games"}
            </Button>
            <Button size="sm" variant="outline" onClick={async () => { await clearIgdbCredentials(); setHasIgdb(false); }} className="text-destructive border-destructive/40">Remove credentials</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input placeholder="Client ID" value={igdbClientId} onChange={(e) => setIgdbClientId(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="Client Secret" type="password" value={igdbSecret} onChange={(e) => setIgdbSecret(e.target.value)} className="h-8 text-sm" />
            <Button size="sm" disabled={!igdbClientId || !igdbSecret} onClick={async () => { await setIgdbCredentials(igdbClientId, igdbSecret); setHasIgdb(true); setIgdbClientId(""); setIgdbSecret(""); }}>
              Connect IGDB
            </Button>
          </div>
        )}
      </section>

      <Separator />

      {/* SteamGridDB */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">SteamGridDB Cover Art</h2>
          {hasSgdb && <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">Connected</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          SteamGridDB provides game cover art thumbnails. Requires a free API key from <span className="text-primary">steamgriddb.com</span>.
        </p>
        {hasSgdb ? (
          <Button size="sm" variant="outline" onClick={async () => { await clearSteamGridDbKey(); setHasSgdb(false); }} className="text-destructive border-destructive/40">Remove API key</Button>
        ) : (
          <div className="flex gap-2">
            <Input placeholder="API key" type="password" value={sgdbKey} onChange={(e) => setSgdbKey(e.target.value)} className="h-8 text-sm flex-1" />
            <Button size="sm" disabled={!sgdbKey} onClick={async () => { await setSteamGridDbKey(sgdbKey); setHasSgdb(true); setSgdbKey(""); }}>Connect</Button>
          </div>
        )}
      </section>

      <Separator />

      {/* DAT Management */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">DAT File Management</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Import No-Intro DAT files to verify ROM checksums and track collection completeness.
          Download DATs from <span className="text-primary">no-intro.org</span>.
        </p>
        {datFiles.length > 0 && (
          <>
            <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
              {datFiles.map((dat) => {
                const checked = selectedDats.includes(dat.console);
                return (
                  <div key={dat.console} className="flex items-center gap-3 px-4 py-3 bg-card text-sm">
                    <button
                      onClick={() => setSelectedDats((prev) =>
                        checked ? prev.filter((c) => c !== dat.console) : [...prev, dat.console]
                      )}
                      className="shrink-0 text-muted-foreground hover:text-foreground motion-safe:transition-colors"
                      aria-label={checked ? "Deselect" : "Select"}
                    >
                      {checked ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground truncate">{getFormatVariantLabel(dat.console)}</div>
                      <div className="text-xs text-muted-foreground">{dat.entry_count.toLocaleString()} entries {dat.version ? `· ${dat.version}` : ""}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        disabled={dlLoading === dat.console}
                        onClick={() => handleGenerate(dat.console)}>
                        {dlLoading === dat.console
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : "Generate"}
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => { await verifyRoms(dat.console); }}>Verify</Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={async () => { await removeDat(dat.console); setDatFiles((prev) => prev.filter((d) => d.console !== dat.console)); if (dlConsole === dat.console) { setDlList(null); setDlConsole(null); } setSelectedDats((prev) => prev.filter((c) => c !== dat.console)); }}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Batch export bar — shown when ≥1 DAT is selected */}
            {selectedDats.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5 text-xs">
                <span className="text-muted-foreground flex-1">
                  {selectedDats.length} of {datFiles.length} selected
                </span>
                <button
                  onClick={() => setSelectedDats(
                    selectedDats.length === datFiles.length ? [] : datFiles.map((d) => d.console)
                  )}
                  className="text-primary hover:underline"
                >
                  {selectedDats.length === datFiles.length ? "Deselect all" : "Select all"}
                </button>
                <Button size="sm" variant="outline" className="text-xs h-7"
                  disabled={batchExporting}
                  onClick={() => handleBatchExport("text")}>
                  {batchExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Export .txt"}
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-7"
                  disabled={batchExporting}
                  onClick={() => handleBatchExport("csv")}>
                  {batchExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Export .csv"}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Download list preview — outside divide-y container so divider styling doesn't apply */}
        {dlList && (
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground truncate">
                Download list — {getFormatVariantLabel(dlConsole ?? "")}
                {dlList.total_in_dat > 0 && (
                  <>
                    {" · "}{dlList.to_download.length.toLocaleString()} to download
                    {" · "}{dlList.preferred_count.toLocaleString()} preferred
                    {dlList.prerelease_only_count > 0 && ` · ${dlList.prerelease_only_count} pre-release only`}
                    {dlList.excluded_count > 0 && ` · ${dlList.excluded_count} excluded`}
                  </>
                )}
              </span>
              <button
                onClick={() => { setDlList(null); setDlConsole(null); setDlSearch(""); }}
                className="shrink-0 text-muted-foreground hover:text-foreground motion-safe:transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {dlList.total_in_dat === 0 ? (
              /* Re-import prompt — shown when all existing entries pre-date migration 010 */
              <div className="px-4 py-4 text-xs text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                Re-import this DAT to populate ROM filenames and enable download list generation.
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="Search filenames…"
                    value={dlSearch}
                    onChange={(e) => setDlSearch(e.target.value)}
                    className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 p-0"
                  />
                </div>
                {/* File list */}
                <div className="h-56 overflow-y-auto [scrollbar-gutter:stable]">
                  {dlList.to_download
                    .filter((e) =>
                      !dlSearch ||
                      e.rom_name.toLowerCase().includes(dlSearch.toLowerCase())
                    )
                    .map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-4 py-1.5 border-b border-b-border/40 text-xs hover:bg-muted/20"
                      >
                        <span className="flex-1 truncate font-mono text-muted-foreground">
                          {entry.rom_name}
                        </span>
                        <DlStatusChip status={entry.status} />
                      </div>
                    ))}
                </div>
                {/* Export row */}
                <div className="px-4 py-3 border-t border-border flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs"
                    onClick={() => handleExportList("text")}>
                    Export .txt (torrent filter)
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs"
                    onClick={() => handleExportList("csv")}>
                    Export .csv (full metadata)
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <Button variant="outline" size="sm" onClick={async () => {
          const path = await open({ filters: [{ name: "DAT", extensions: ["dat", "xml"] }] });
          if (typeof path === "string") {
            const [detectedName] = await readDatHeader(path);
            const consoleName = prompt(
              "Console name for this DAT (auto-detected — edit if wrong):",
              detectedName,
            ) ?? "";
            if (consoleName.trim()) {
              const dat = await importDat(path, consoleName.trim());
              setDatFiles((prev) => [...prev.filter((d) => d.console !== dat.console), dat]);
            }
          }
        }}>
          <Plus className="w-4 h-4 mr-2" /> Import DAT file
        </Button>
      </section>

      <footer className="mt-10 pt-6 border-t border-border/40 text-center text-xs text-muted-foreground/50 space-y-0.5">
        <p>ROMulus v{appVersion}</p>
        <p>Developed by Nicolas Yanez · <a href="https://github.com/Nyanez615/ROMulus" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-muted-foreground transition-colors">GitHub</a></p>
        <p>© 2026 Nicolas Yanez · Business Source License 1.1</p>
      </footer>
      </div>
      </div>
    </div>
  );
}
