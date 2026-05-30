import { useEffect } from "react";
import { getConsoles } from "@/lib/tauri";
import { ConsoleIcon, ManufacturerBadge } from "@/components/ConsoleIcon";
import { useScanStore } from "@/store/scan";
import { useUIStore } from "@/store/ui";
import { formatBytes } from "@/lib/tauri";

export default function Consoles() {
  const { consoles, setConsoles, setSelectedConsole } = useScanStore();
  const { setActiveTab } = useUIStore();

  useEffect(() => {
    getConsoles().then(setConsoles).catch(console.error);
  }, [setConsoles]);

  const grouped = consoles.reduce<Record<string, typeof consoles>>((acc, c) => {
    const mfr = c.name.split(" - ")[0] ?? "Other";
    (acc[mfr] = acc[mfr] ?? []).push(c);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <h1 className="text-xl font-bold text-foreground">Consoles</h1>

      {Object.entries(grouped).map(([mfr, list]) => (
        <div key={mfr}>
          <div className="flex items-center gap-2 mb-3">
            <ManufacturerBadge consoleName={list[0].name} />
            <span className="text-xs text-muted-foreground">({list.length} systems)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((c) => {
              const healthPct = c.total_files > 0 ? Math.round((c.preferred_count / c.total_files) * 100) : 0;
              const shortName = c.name.split(" - ")[1] ?? c.name;
              return (
                <button
                  key={c.name}
                  onClick={() => {
                    setSelectedConsole(c.name);
                    setActiveTab("games");
                  }}
                  className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors text-left w-full"
                >
                  <ConsoleIcon consoleName={c.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{shortName}</div>
                    <div className="text-xs text-muted-foreground">{c.total_files.toLocaleString()} ROMs</div>
                    {c.bytes_to_free > 0 && (
                      <div className="text-xs text-muted-foreground/60">{formatBytes(c.bytes_to_free)}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-bold ${healthPct >= 80 ? "text-green-400" : healthPct >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {healthPct}%
                    </div>
                    <div className="text-xs text-muted-foreground/60">preferred</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {consoles.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">No consoles scanned. Run a scan from the Dashboard.</div>
      )}
    </div>
  );
}
