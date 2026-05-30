import { useState } from "react";
import { FolderOpen, Plus, X, AlertTriangle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { completeOnboardingStep, getSettings, saveSettings, isOneDrivePath } from "@/lib/tauri";
import { useOnboardingStore } from "@/store/onboarding";

export function AddRootStep() {
  const { setState, setStep } = useOnboardingStore();
  const [roots, setRoots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && !roots.includes(selected)) {
      setRoots((prev) => [...prev, selected]);
    }
  }

  async function handleContinue() {
    if (roots.length === 0) return;
    setLoading(true);
    try {
      const settings = await getSettings();
      await saveSettings({ ...settings, rom_roots: roots });
      const updated = await completeOnboardingStep(3);
      setState(updated);
      setStep(4);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <FolderOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold text-foreground">Add your ROM library</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Add one or more folders. Each sub-folder is treated as a separate console.
          </p>
        </div>
      </div>

      {roots.map((root) => {
        const onCloud = isOneDrivePath(root);
        return (
          <div key={root} className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2">
              <FolderOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <span className="flex-1 text-sm text-foreground break-all font-mono text-xs">{root}</span>
              <button
                onClick={() => setRoots((prev) => prev.filter((r) => r !== root))}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {onCloud && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                OneDrive path detected — deletions will sync to the cloud.
              </div>
            )}
          </div>
        );
      })}

      <Button variant="outline" className="w-full" onClick={pickFolder}>
        <Plus className="w-4 h-4 mr-2" />
        Choose folder
      </Button>

      <Button
        className="w-full"
        disabled={roots.length === 0 || loading}
        onClick={handleContinue}
      >
        {loading ? "Saving…" : `Continue with ${roots.length} folder${roots.length !== 1 ? "s" : ""}`}
      </Button>

      <button
        onClick={() => setStep(4)}
        className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
      >
        I'll add folders later in Settings
      </button>
    </div>
  );
}
