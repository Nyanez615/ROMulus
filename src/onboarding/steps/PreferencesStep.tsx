import { useState } from "react";
import { Languages, GripVertical, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboardingStep, getSettings, saveSettings } from "@/lib/tauri";
import { useOnboardingStore } from "@/store/onboarding";
import { usePreferencesStore } from "@/store/preferences";

const COMMON_LANGUAGES = ["En", "Ja", "Fr", "De", "Es", "It", "Pt", "Zh", "Ko", "Ru", "Nl", "Sv"];
const DEFAULT_REGIONS = ["USA", "World", "Europe", "Japan", "Australia", "United Kingdom"];

export function PreferencesStep() {
  const { setState, setStep } = useOnboardingStore();
  const { setPreferences, setConfigured } = usePreferencesStore();

  const [langs, setLangs] = useState<string[]>(["En"]);
  const [regions, setRegions] = useState<string[]>(["USA", "World", "Europe"]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  function toggleLang(lang: string) {
    setLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  function moveRegion(from: number, to: number) {
    const next = [...regions];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setRegions(next);
  }

  async function handleContinue() {
    if (langs.length === 0) return;
    setLoading(true);
    try {
      const settings = await getSettings();
      await saveSettings({
        ...settings,
        preferences: { preferred_languages: langs, preferred_regions: regions, short_console_names: settings.preferences.short_console_names },
      });
      setPreferences({ preferred_languages: langs, preferred_regions: regions, short_console_names: settings.preferences.short_console_names });
      setConfigured(true);
      const updated = await completeOnboardingStep(2);
      setState(updated);
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-6">
      <div className="flex items-start gap-3">
        <Languages className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold text-foreground">Language &amp; Region</h2>
          <p className="text-sm text-muted-foreground mt-1">
            ROMulus will keep the best ROM in your preferred language for each game.
          </p>
        </div>
      </div>

      {/* Language selection */}
      <div>
        <p className="text-sm font-medium text-foreground mb-2">Preferred languages</p>
        <div className="flex flex-wrap gap-2">
          {COMMON_LANGUAGES.map((lang) => (
            <button
              key={lang}
              onClick={() => toggleLang(lang)}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                langs.includes(lang)
                  ? "bg-primary/20 border-primary/60 text-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {lang}
            </button>
          ))}
        </div>
        {langs.length === 0 && (
          <p className="text-xs text-destructive mt-1">Select at least one language.</p>
        )}
      </div>

      {/* Region priority */}
      <div>
        <p className="text-sm font-medium text-foreground mb-1">Region priority</p>
        <p className="text-xs text-muted-foreground mb-2">Drag to reorder — top = highest priority</p>
        <div className="space-y-1.5">
          {regions.map((region, i) => (
            <div
              key={region}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) moveRegion(dragging, i); setDragging(i); }}
              onDragEnd={() => setDragging(null)}
              className={[
                "flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-grab active:cursor-grabbing transition-colors",
                dragging === i
                  ? "opacity-50 bg-muted border-border"
                  : "bg-card border-border hover:bg-muted/40",
              ].join(" ")}
            >
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 text-foreground">{region}</span>
              <span className="text-xs text-muted-foreground">#{i + 1}</span>
              <button
                onClick={() => setRegions((prev) => prev.filter((r) => r !== region))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {DEFAULT_REGIONS.filter((r) => !regions.includes(r)).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEFAULT_REGIONS.filter((r) => !regions.includes(r)).map((r) => (
                <button
                  key={r}
                  onClick={() => setRegions((prev) => [...prev, r])}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground border border-dashed border-border hover:text-foreground hover:border-border/80"
                >
                  <Plus className="w-3 h-3" /> {r}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Button
        className="w-full"
        disabled={langs.length === 0 || regions.length === 0 || loading}
        onClick={handleContinue}
      >
        {loading ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
