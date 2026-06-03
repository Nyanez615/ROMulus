import { useState, useEffect } from "react";
import { FolderOpen, Plus, X, GripVertical, Languages, AlertTriangle, Database, Image, Sparkles, Monitor, ShieldCheck, Zap, Info } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
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
import { Input } from "@/components/ui/input";
import {
  getSettings, saveSettings, reapplyPreferences, isCloudPath,
  setIgdbCredentials, hasIgdbCredentials, clearIgdbCredentials,
  setSteamGridDbKey, hasSteamGridDbKey, clearSteamGridDbKey,
  getDatFiles, importDat, removeDat, verifyRoms, enrichAllGames,
  scanRoots,
} from "@/lib/tauri";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { DatFile } from "@/lib/bindings/DatFile";
import { useUIStore } from "@/store/ui";
import { usePreferencesStore } from "@/store/preferences";
import { getRegionsForLanguage } from "@/lib/regionUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    hasIgdbCredentials().then(setHasIgdb).catch(console.error);
    hasSteamGridDbKey().then(setHasSgdb).catch(console.error);
    getDatFiles().then(setDatFiles).catch(console.error);
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

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

        {/* Section-level warning for existing cloud roots */}
        {settings.rom_roots.filter(isCloudPath).length > 0 && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm space-y-1">
              <p>These paths are in cloud storage — permanent deletion will sync changes to the cloud:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {settings.rom_roots.filter(isCloudPath).map((r) => (
                  <li key={r} className="font-mono text-xs break-all">{r}</li>
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
          <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
            {datFiles.map((dat) => (
              <div key={dat.console} className="flex items-center gap-3 px-4 py-3 bg-card text-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-foreground truncate">{dat.console.split(" - ")[1] ?? dat.console}</div>
                  <div className="text-xs text-muted-foreground">{dat.entry_count.toLocaleString()} entries {dat.version ? `· ${dat.version}` : ""}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => { await verifyRoms(dat.console); }}>Verify</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={async () => { await removeDat(dat.console); setDatFiles((prev) => prev.filter((d) => d.console !== dat.console)); }}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" onClick={async () => {
          const path = await open({ filters: [{ name: "DAT", extensions: ["dat", "xml"] }] });
          if (typeof path === "string") {
            const consoleName = prompt("Which console is this DAT for? (e.g. 'Nintendo - Game Boy Advance')") ?? "";
            if (consoleName) {
              const dat = await importDat(path, consoleName);
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
