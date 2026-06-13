import { useState, useEffect, useMemo, useRef } from "react";
import { FolderOpen, Plus, X, GripVertical, Languages, AlertTriangle, Database, Image, Sparkles, Monitor, ShieldCheck, Zap, Info, Layers, Search, Loader2, Wifi } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckSquare, Square } from "lucide-react";
import {
  getSettings, saveSettings, reapplyPreferences, isCloudPath,
  setIgdbCredentials, hasIgdbCredentials, clearIgdbCredentials,
  setSteamGridDbKey, hasSteamGridDbKey, clearSteamGridDbKey,
  getDatFiles, importDat, readDatHeader, removeDat, verifyRoms, enrichAllGames,
  scanRoots,
  getFormatPairs,
  getConsoles,
  generateDownloadList, exportDownloadList,
  onVerifyComplete,
  getQbtSettings, saveQbtSettings, testQbtConnection,
} from "@/lib/tauri";
import type { QbtSettings } from "@/lib/bindings/QbtSettings";
import type { VerificationStatus } from "@/lib/bindings/VerificationStatus";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { DatFile } from "@/lib/bindings/DatFile";
import type { FormatPair } from "@/lib/bindings/FormatPair";

import type { DownloadList } from "@/lib/bindings/DownloadList";
import type { DownloadEntry } from "@/lib/bindings/DownloadEntry";
import { useUIStore } from "@/store/ui";
import { usePreferencesStore } from "@/store/preferences";
import { useScanStore } from "@/store/scan";
import { getRegionsForLanguage } from "@/lib/regionUtils";
import { getFormatVariantLabel } from "@/lib/consoleUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { refreshTagStore } from "@/components/Layout";


// ── Download list status chip ─────────────────────────────────────────────────

const DL_STATUS: Record<string, { label: string; cls: string }> = {
  preferred:       { label: "Preferred",   cls: "bg-green-500/15  text-green-400  border-green-500/30" },
  prerelease_only: { label: "Pre-release", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  fallback_only:   { label: "Fallback",    cls: "bg-blue-500/15   text-blue-400   border-blue-500/30"  },
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
  // qBt
  const [qbtSettings, setQbtSettings] = useState<QbtSettings>({ host: "localhost:8080", user: "admin", has_password: false, no_auth: false });
  const [qbtPassword, setQbtPassword] = useState("");
  const [qbtTesting, setQbtTesting] = useState(false);
  const [qbtTestResult, setQbtTestResult] = useState<boolean | null>(null);
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
  const [importDialog, setImportDialog] = useState<{ path: string; name: string } | null>(null);
  const [importName, setImportName] = useState("");
  const [verifyingDats,  setVerifyingDats]  = useState<Set<string>>(new Set());
  const [verifyResult,   setVerifyResult]   = useState<VerificationStatus | null>(null);
  const verifyPendingRef = useRef(0);

  // ── Format pair state ────────────────────────────────────────────────────────
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    hasIgdbCredentials().then(setHasIgdb).catch(console.error);
    hasSteamGridDbKey().then(setHasSgdb).catch(console.error);
    getDatFiles().then(setDatFiles).catch(console.error);
    getQbtSettings().then(setQbtSettings).catch(console.error);
    getVersion().then(setAppVersion).catch(() => {});

    const unlisten = onVerifyComplete((status) => {
      verifyPendingRef.current = Math.max(0, verifyPendingRef.current - 1);
      if (verifyPendingRef.current === 0) {
        setVerifyingDats(new Set());
        setVerifyResult(status);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    getFormatPairs().then(setFormatPairs).catch(console.error);
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

  const formatPrefs = useMemo(() => settings?.format_preferences ?? {}, [settings]);

  // Collapse pairwise FormatPair list into one entry per console group.
  // Each entry lists every unique folder sorted by title count descending (superset first).
  const formatGroups = useMemo(() => {
    const byGroup = new Map<string, Map<string, number>>();
    for (const pair of formatPairs) {
      if (!byGroup.has(pair.console_group)) byGroup.set(pair.console_group, new Map());
      const m = byGroup.get(pair.console_group)!;
      m.set(pair.folder_a, Math.max(m.get(pair.folder_a) ?? 0, pair.folder_a_count));
      m.set(pair.folder_b, Math.max(m.get(pair.folder_b) ?? 0, pair.folder_b_count));
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([consoleGroup, folderCounts]) => ({
        consoleGroup,
        folders: [...folderCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      }));
  }, [formatPairs]);

  async function selectFormatFolder(consoleGroup: string, folder: string) {
    if (!settings) return;
    const next: AppSettings = {
      ...settings,
      format_preferences: { ...settings.format_preferences, [consoleGroup]: folder },
    };
    setSettings(next);
    await saveSettings(next).catch(console.error);
    // Rescan so the new preference is reflected immediately in the ROMs tab.
    if (next.rom_roots.length) {
      const scanResult = await scanRoots(next.rom_roots);
      setStatus(scanResult);
      setConsoles(await getConsoles());
      refreshTagStore();
      bumpCacheVersion();
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

  async function handleExportList() {
    if (!dlList) return;
    const safeName = (dlConsole ?? "download-list").replace(/[/\\:*?"<>|]/g, "_");
    const filePath = await saveFileDialog({
      filters: [{ name: "Download list", extensions: ["csv"] }],
      defaultPath: `${safeName}.csv`,
    });
    if (typeof filePath === "string") {
      await exportDownloadList(dlList.to_download, filePath);
    }
  }

  async function handleBatchVerify() {
    if (selectedDats.length === 0) return;
    setVerifyResult(null);
    setVerifyingDats(new Set(selectedDats));
    verifyPendingRef.current = selectedDats.length;
    for (const consoleName of selectedDats) {
      await verifyRoms(consoleName);
    }
  }

  async function handleBatchRemove() {
    for (const consoleName of selectedDats) {
      await removeDat(consoleName);
    }
    setDatFiles((prev) => prev.filter((d) => !selectedDats.includes(d.console)));
    if (dlConsole && selectedDats.includes(dlConsole)) { setDlList(null); setDlConsole(null); }
    setSelectedDats([]);
  }

  async function handleBatchExport() {
    if (selectedDats.length === 0) return;
    const dir = await open({ directory: true, title: "Choose export folder" });
    if (typeof dir !== "string") return;
    setBatchExporting(true);
    try {
      for (const consoleName of selectedDats) {
        const list = await generateDownloadList(consoleName);
        if (list.to_download.length === 0) continue;
        const safeName = consoleName.replace(/[/\\:*?"<>|]/g, "_");
        await exportDownloadList(list.to_download, `${dir}/${safeName}.csv`);
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

      {/* Format Variant Preferences */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Format Variant Preferences</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          When your collection has multiple format variants of the same console, choose which format the pruner should prefer. Changes trigger an immediate rescan.
        </p>

        {formatGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No format variant pairs detected in your collection.</p>
        ) : (
          formatGroups.map(({ consoleGroup, folders }) => {
            const pref = formatPrefs[consoleGroup] ?? folders[0]?.[0];
            return (
              <div key={consoleGroup} className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
                  {getFormatVariantLabel(consoleGroup)} · {folders.length} formats
                </div>
                <div className="divide-y divide-border">
                  {folders.map(([folder, count]) => {
                    const isSelected = pref === folder;
                    return (
                      <button
                        key={folder}
                        onClick={() => selectFormatFolder(consoleGroup, folder)}
                        className={["w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors", isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/30"].join(" ")}
                      >
                        <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${isSelected ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                        <span className={isSelected ? "text-foreground font-medium" : "text-muted-foreground"}>{getFormatVariantLabel(folder)}</span>
                        <span className="text-xs text-muted-foreground/50 ml-1">{count} titles</span>
                        {isSelected && <span className="text-xs text-primary ml-auto">preferred</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </section>
      <Separator />

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

      {/* qBittorrent */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">qBittorrent</h2>
          {qbtSettings.no_auth && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">No Auth</span>}
        </div>
        <p className="text-sm text-muted-foreground">
          Connect to the qBittorrent Web UI to set per-file download priorities from the Downloads tab.
          Enable "Bypass authentication for clients on localhost" in qBittorrent preferences to use No Auth mode.
        </p>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Host</Label>
              <Input
                placeholder="localhost:8080"
                value={qbtSettings.host}
                onChange={(e) => setQbtSettings((s) => ({ ...s, host: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Username</Label>
              <Input
                placeholder="admin"
                value={qbtSettings.user}
                onChange={(e) => setQbtSettings((s) => ({ ...s, user: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          </div>
          {!qbtSettings.no_auth && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Password {qbtSettings.has_password ? "(saved — enter new value to change)" : ""}
              </Label>
              <Input
                type="password"
                placeholder={qbtSettings.has_password ? "••••••••" : "Password"}
                value={qbtPassword}
                onChange={(e) => setQbtPassword(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="qbt-no-auth"
              checked={qbtSettings.no_auth}
              onCheckedChange={(v) => setQbtSettings((s) => ({ ...s, no_auth: v }))}
            />
            <Label htmlFor="qbt-no-auth" className="text-sm cursor-pointer">No authentication (localhost bypass)</Label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={async () => {
              await saveQbtSettings(qbtSettings.host, qbtSettings.user, qbtPassword || null, qbtSettings.no_auth);
              if (qbtPassword) { setQbtPassword(""); setQbtSettings((s) => ({ ...s, has_password: true })); }
            }}
          >
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={qbtTesting}
            onClick={async () => {
              setQbtTesting(true);
              setQbtTestResult(null);
              try {
                await saveQbtSettings(qbtSettings.host, qbtSettings.user, qbtPassword || null, qbtSettings.no_auth);
                const ok = await testQbtConnection();
                setQbtTestResult(ok);
              } catch {
                setQbtTestResult(false);
              } finally {
                setQbtTesting(false);
              }
            }}
          >
            {qbtTesting ? "Testing…" : "Test Connection"}
          </Button>
          {qbtTestResult === true && <span className="text-xs text-green-400">Connected</span>}
          {qbtTestResult === false && <span className="text-xs text-destructive">Failed</span>}
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
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        disabled={verifyingDats.has(dat.console)}
                        onClick={async () => {
                          setVerifyResult(null);
                          setVerifyingDats(new Set([dat.console]));
                          verifyPendingRef.current = 1;
                          await verifyRoms(dat.console);
                        }}>
                        {verifyingDats.has(dat.console) ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={async () => { await removeDat(dat.console); setDatFiles((prev) => prev.filter((d) => d.console !== dat.console)); if (dlConsole === dat.console) { setDlList(null); setDlConsole(null); } setSelectedDats((prev) => prev.filter((c) => c !== dat.console)); }}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Batch action bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted/20 text-xs">
              <span className="text-muted-foreground flex-1">
                {selectedDats.length > 0 ? `${selectedDats.length} of ${datFiles.length} selected` : "Select DATs to batch-act"}
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
                disabled={batchExporting || selectedDats.length === 0}
                onClick={handleBatchExport}>
                {batchExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Export Lists"}
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7"
                disabled={selectedDats.length === 0 || verifyingDats.size > 0}
                onClick={handleBatchVerify}>
                {verifyingDats.size > 0 ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive"
                    disabled={selectedDats.length === 0}>
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {selectedDats.length} DAT{selectedDats.length !== 1 ? "s" : ""}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the DAT files and all their entries from the database. Your ROM files are not affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBatchRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}

        {verifyResult && (
          <p className="text-xs text-muted-foreground">
            Verification complete — {verifyResult.verified.toLocaleString()} verified
            {verifyResult.modified > 0 && <>, <span className="text-destructive">{verifyResult.modified.toLocaleString()} modified</span></>}
            {verifyResult.unknown > 0 && <>, {verifyResult.unknown.toLocaleString()} unknown</>}
            {" "}of {verifyResult.total.toLocaleString()} checked
          </p>
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
                    {dlList.fallback_count > 0 && ` · ${dlList.fallback_count} best-available`}
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
                    onClick={handleExportList}>
                    Export Download List
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <Button variant="outline" size="sm" onClick={async () => {
          const result = await open({ filters: [{ name: "DAT", extensions: ["dat", "xml"] }], multiple: true });
          if (Array.isArray(result)) {
            // Multi-select: import all using auto-detected names (No-Intro headers are reliable)
            const imported: DatFile[] = [];
            for (const path of result) {
              const [detectedName] = await readDatHeader(path);
              if (detectedName) {
                const dat = await importDat(path, detectedName);
                imported.push(dat);
              }
            }
            if (imported.length > 0) {
              setDatFiles((prev) => {
                const importedNames = new Set(imported.map((d) => d.console));
                return [...prev.filter((d) => !importedNames.has(d.console)), ...imported];
              });
            }
          } else if (typeof result === "string") {
            // Single file: show confirmation dialog so user can correct the name if needed
            const [detectedName] = await readDatHeader(result);
            setImportName(detectedName);
            setImportDialog({ path: result, name: detectedName });
          }
        }}>
          <Plus className="w-4 h-4 mr-2" /> Import DAT file
        </Button>

        {/* Import name confirmation dialog — replaces window.prompt() (unsupported in WKWebView) */}
        <Dialog open={importDialog !== null} onOpenChange={(open) => { if (!open) setImportDialog(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Import DAT file</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Console name (auto-detected — edit if wrong):</p>
            <Input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && importName.trim() && importDialog) {
                  const dat = await importDat(importDialog.path, importName.trim());
                  setDatFiles((prev) => [...prev.filter((d) => d.console !== dat.console), dat]);
                  setImportDialog(null);
                }
              }}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setImportDialog(null)}>Cancel</Button>
              <Button
                disabled={!importName.trim()}
                onClick={async () => {
                  if (!importDialog) return;
                  const dat = await importDat(importDialog.path, importName.trim());
                  setDatFiles((prev) => [...prev.filter((d) => d.console !== dat.console), dat]);
                  setImportDialog(null);
                }}
              >
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
