import { useState, useEffect } from "react";
import { FolderOpen, Plus, X, GripVertical, Languages, AlertTriangle, Layers } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSettings, saveSettings, isOneDrivePath, getFormatPairs } from "@/lib/tauri";
import type { AppSettings } from "@/lib/bindings/AppSettings";
import type { FormatPair } from "@/lib/bindings/FormatPair";
import { useUIStore } from "@/store/ui";
import { usePreferencesStore } from "@/store/preferences";

const COMMON_LANGUAGES = ["En", "Ja", "Fr", "De", "Es", "It", "Pt", "Zh", "Ko", "Ru", "Nl", "Sv"];
const COMMON_REGIONS = ["USA", "World", "Europe", "Japan", "Australia", "United Kingdom",
  "Germany", "France", "Spain", "Italy", "Korea", "Brazil", "Taiwan", "China"];

export default function Settings() {
  const { theme, setTheme } = useUIStore();
  const { setPreferences } = usePreferencesStore();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [formatPairs, setFormatPairs] = useState<FormatPair[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    getFormatPairs().then(setFormatPairs).catch(console.error);
  }, []);

  async function save(next: AppSettings) {
    setSaved(false);
    await saveSettings(next);
    setSettings(next);
    setPreferences(next.preferences);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && settings && !settings.rom_roots.includes(selected)) {
      save({ ...settings, rom_roots: [...settings.rom_roots, selected] });
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

  function addRegion(region: string) {
    if (!settings || settings.preferences.preferred_regions.includes(region)) return;
    save({ ...settings, preferences: { ...settings.preferences, preferred_regions: [...settings.preferences.preferred_regions, region] } });
  }

  function removeRegion(region: string) {
    if (!settings) return;
    save({ ...settings, preferences: { ...settings.preferences, preferred_regions: settings.preferences.preferred_regions.filter((r) => r !== region) } });
  }

  if (!settings) {
    return <div className="p-8 text-muted-foreground text-sm">Loading settings…</div>;
  }

  const unaddedRegions = COMMON_REGIONS.filter(
    (r) => !settings.preferences.preferred_regions.includes(r),
  );

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        {saved && <span className="text-xs text-green-400">Saved ✓</span>}
      </div>

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
        </div>

        <div>
          <Label className="text-sm text-muted-foreground mb-1 block">Region priority (drag to reorder)</Label>
          <div className="space-y-1.5">
            {settings.preferences.preferred_regions.map((region, i) => (
              <div
                key={region}
                draggable
                onDragStart={() => setDraggingIdx(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggingIdx !== null && draggingIdx !== i) {
                    moveRegion(draggingIdx, i);
                    setDraggingIdx(i);
                  }
                }}
                onDragEnd={() => setDraggingIdx(null)}
                className={[
                  "flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-grab active:cursor-grabbing",
                  draggingIdx === i
                    ? "opacity-50 bg-muted border-border"
                    : "bg-card border-border hover:bg-muted/40",
                ].join(" ")}
              >
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="flex-1 text-foreground">{region}</span>
                <span className="text-xs text-muted-foreground">#{i + 1}</span>
                <button onClick={() => removeRegion(region)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {unaddedRegions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
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
        </div>
      </section>

      <Separator />

      {/* ROM Roots */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">ROM Libraries</h2>
        </div>

        <div className="space-y-2">
          {settings.rom_roots.map((root) => (
            <div key={root} className="border border-border rounded-lg p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <FolderOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <span className="flex-1 text-xs text-foreground font-mono break-all">{root}</span>
                <button onClick={() => removeRoot(root)} className="text-muted-foreground hover:text-destructive shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {isOneDrivePath(root) && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="w-3 h-3" /> OneDrive — deletions sync to cloud
                </div>
              )}
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={pickFolder} className="w-full">
          <Plus className="w-4 h-4 mr-2" /> Add folder
        </Button>
      </section>

      <Separator />

      {/* Appearance */}
      <section className="space-y-4">
        <h2 className="font-semibold text-foreground">Appearance</h2>
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
      </section>

      <Separator />

      {/* Crash reporting */}
      <section className="space-y-4">
        <h2 className="font-semibold text-foreground">Privacy</h2>
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

      {/* Format Wizard */}
      {formatPairs.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Format Pairs</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            These console folders contain the same games in different formats.
            Select your preferred format — the entire non-preferred folder will be queued for deletion in the Prune tab.
          </p>
          {formatPairs.map((pair) => {
            const pref = settings?.format_preferences[pair.console_group];
            return (
              <div key={pair.console_group} className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
                  {Math.round(pair.overlap_percent * 100)}% title overlap
                </div>
                <div className="divide-y divide-border">
                  {[pair.folder_a, pair.folder_b].map((folder) => (
                    <button
                      key={folder}
                      onClick={() => {
                        if (!settings) return;
                        const next: AppSettings = {
                          ...settings,
                          format_preferences: { ...settings.format_preferences, [pair.console_group]: folder },
                        };
                        save(next);
                      }}
                      className={[
                        "w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors",
                        pref === folder
                          ? "bg-primary/10 border-l-2 border-l-primary"
                          : "hover:bg-muted/30",
                      ].join(" ")}
                    >
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${pref === folder ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                      <span className={pref === folder ? "text-foreground font-medium" : "text-muted-foreground"}>
                        {folder.split(" - ")[1] ?? folder}
                      </span>
                      {pref === folder && <span className="text-xs text-primary ml-auto">preferred</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <Separator />

      {/* Danger zone */}
      <section className="space-y-4">
        <h2 className="font-semibold text-destructive">Danger Zone</h2>
        <Alert className="border-destructive/40 bg-destructive/10">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <AlertDescription className="text-sm text-destructive/80">
            Permanent delete bypasses the Trash and cannot be undone. Disabled by default.
          </AlertDescription>
        </Alert>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Allow permanent delete</Label>
            <p className="text-xs text-muted-foreground">Files will be deleted immediately, not moved to Trash</p>
          </div>
          <Switch
            checked={false}
            disabled
            onCheckedChange={() => {}}
          />
        </div>
      </section>
    </div>
  );
}
