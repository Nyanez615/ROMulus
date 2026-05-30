import { useEffect, useState } from "react";
import { Gamepad2, Server, HardDrive, Zap, AlertTriangle, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getConsoles, getInterruptedSession, getHistory,
  scanRoots, getSettings, formatBytes,
} from "@/lib/tauri";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";
import type { ActionLogEntry } from "@/lib/bindings/ActionLogEntry";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";

export default function Dashboard() {
  const { consoles, setConsoles, status, setStatus } = useScanStore();
  const { setActiveTab } = useUIStore();
  const [interrupted, setInterrupted] = useState(false);
  const [recentActions, setRecentActions] = useState<ActionLogEntry[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    getConsoles().then(setConsoles).catch(console.error);
    getInterruptedSession().then(setInterrupted).catch(console.error);
    getHistory(1, 5).then((h) => setRecentActions(h.entries)).catch(console.error);
  }, [setConsoles]);

  const totalRoms = consoles.reduce((s, c) => s + c.total_files, 0);
  const totalBytes = consoles.reduce((s, c) => s + c.bytes_to_free, 0);
  const preferredCount = consoles.reduce((s, c) => s + c.preferred_count, 0);
  const healthPct = totalRoms > 0 ? Math.round((preferredCount / totalRoms) * 100) : 0;

  async function handleScan() {
    setScanning(true);
    try {
      const settings = await getSettings();
      if (settings.rom_roots.length === 0) { setActiveTab("settings"); return; }
      const s = await scanRoots(settings.rom_roots);
      setStatus(s);
      const updated = await getConsoles();
      setConsoles(updated);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <Button onClick={handleScan} disabled={scanning || status.scanning} size="sm">
          <Zap className="w-4 h-4 mr-2" />
          {scanning || status.scanning ? "Scanning…" : "Rescan collection"}
        </Button>
      </div>

      {interrupted && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <AlertDescription className="text-amber-300 text-sm">
            Last session was interrupted mid-deletion.{" "}
            <button className="underline" onClick={() => setActiveTab("history")}>Review in History →</button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Gamepad2} label="Total ROMs" value={totalRoms.toLocaleString()} />
        <StatCard icon={Server} label="Consoles" value={consoles.length.toString()} />
        <StatCard icon={HardDrive} label="Collection size" value={totalBytes > 0 ? formatBytes(totalBytes) : "—"} />
        <StatCard icon={Zap} label="Collection health" value={totalRoms > 0 ? `${healthPct}%` : "—"}
          sub={totalRoms > 0 ? "preferred language" : "Scan to see"}
          accent={healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-red-400"} />
      </div>

      {consoles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Consoles</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {consoles.map((c) => (
              <ConsoleRow key={c.name} console={c} onClick={() => setActiveTab("consoles")} />
            ))}
          </div>
        </div>
      )}

      {consoles.length === 0 && !status.scanning && (
        <div className="text-center py-16 space-y-3">
          <Gamepad2 className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground">No ROMs scanned yet.</p>
          <Button onClick={handleScan} disabled={scanning}>Start scan</Button>
        </div>
      )}

      {recentActions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent activity</h2>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setActiveTab("history")}>View all →</button>
          </div>
          <div className="space-y-1">
            {recentActions.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-card border border-border text-sm">
                <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-foreground">{a.title}</span>
                <span className="text-xs text-muted-foreground capitalize shrink-0">{String(a.action).replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ElementType; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />{label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ConsoleRow({ console: c, onClick }: { console: ConsoleStats; onClick: () => void }) {
  const healthPct = c.total_files > 0 ? Math.round((c.preferred_count / c.total_files) * 100) : 0;
  const shortName = c.name.split(" - ")[1] ?? c.name;
  return (
    <button onClick={onClick} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors text-left w-full">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{shortName}</div>
        <div className="text-xs text-muted-foreground">{c.total_files.toLocaleString()} ROMs</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-sm font-semibold ${healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>{healthPct}%</div>
        <div className="text-xs text-muted-foreground/60">preferred</div>
      </div>
    </button>
  );
}
