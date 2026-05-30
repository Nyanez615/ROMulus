import { useState, useEffect } from "react";
import { Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  getSettings, scanRoots, getConsoles,
  completeOnboardingStep, onScanProgress,
} from "@/lib/tauri";
import { useOnboardingStore } from "@/store/onboarding";
import { useScanStore } from "@/store/scan";

export function ScanStep() {
  const { setState } = useOnboardingStore();
  const { setConsoles, setStatus, setProgress } = useScanStore();
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [currentConsole, setCurrentConsole] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onScanProgress((p) => {
      setCurrentConsole(p.console);
      setCount(p.scanned);
      setProgress(p);
      setStatus({ scanning: true, scanned: p.scanned, total_estimate: p.total, current_console: p.console, cached: false });
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [setProgress, setStatus]);

  async function startScan() {
    setScanning(true);
    try {
      const settings = await getSettings();
      const finalStatus = await scanRoots(settings.rom_roots);
      const consoles = await getConsoles();
      setConsoles(consoles);
      setStatus(finalStatus);
      setScanning(false);
      setDone(true);
      const updated = await completeOnboardingStep(4);
      setState(updated);
    } catch (e) {
      console.error(e);
      setScanning(false);
    }
  }

  if (done) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 space-y-5 text-center">
        <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
        <div>
          <h2 className="font-semibold text-foreground text-lg">Collection scanned</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Found {count.toLocaleString()} ROMs. You're all set.
          </p>
        </div>
        <Button className="w-full" onClick={() => setState({ terms_accepted: true, crash_reporting_opted_in: false, preferences_configured: true, roots_added: true, first_scan_complete: true, is_complete: true })}>
          Open ROMulus
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold text-foreground">Scan your collection</h2>
          <p className="text-sm text-muted-foreground mt-1">
            ROMulus will scan all configured folders and parse every ROM filename.
            This takes a few seconds for most collections.
          </p>
        </div>
      </div>

      {scanning && (
        <div className="space-y-2">
          <Progress value={undefined} className="h-1.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate">{currentConsole ?? "Starting…"}</span>
            <span>{count.toLocaleString()} found</span>
          </div>
        </div>
      )}

      <Button
        className="w-full"
        disabled={scanning}
        onClick={startScan}
      >
        {scanning ? "Scanning…" : "Start scan"}
      </Button>

      {!scanning && (
        <button
          onClick={() => setState({ terms_accepted: true, crash_reporting_opted_in: false, preferences_configured: true, roots_added: true, first_scan_complete: true, is_complete: true })}
          className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
        >
          Skip — I'll scan later in Settings
        </button>
      )}
    </div>
  );
}
