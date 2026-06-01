import { useState, useEffect } from "react";
import { Shield, Wrench, MonitorPlay, Film, CreditCard } from "lucide-react";
import { getSystemFiles } from "@/lib/tauri";
import type { RomFile } from "@/lib/bindings/RomFile";
import type { FileCategory } from "@/lib/bindings/FileCategory";
import { formatBytes } from "@/lib/tauri";
import { Input } from "@/components/ui/input";
import { useScanStore } from "@/store/scan";
import { ConsolePageTitle } from "@/components/ConsolePageTitle";
import { ConsoleEmptyState } from "@/components/ConsoleEmptyState";
import { cn } from "@/lib/utils";

const ALL_CATEGORIES: { key: FileCategory; label: string; icon: React.ElementType; protected?: boolean }[] = [
  { key: "bios",     label: "BIOS",      icon: Shield,       protected: true },
  { key: "utility",  label: "Utilities", icon: Wrench },
  { key: "demo",     label: "Demos",     icon: MonitorPlay },
  { key: "video",    label: "Video",     icon: Film },
  { key: "e_reader", label: "e-Reader",  icon: CreditCard },
];

export default function SystemFiles() {
  const { selectedConsoles } = useScanStore();
  const [files, setFiles] = useState<RomFile[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<FileCategory>>(new Set());

  useEffect(() => {
    getSystemFiles({ consoles: selectedConsoles ?? undefined, page: 1, perPage: 500 })
      .then((r) => setFiles(r.groups.flatMap((g) => g.variants)))
      .catch(console.error);
  }, [selectedConsoles]);

  function toggleCategory(key: FileCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const searchLower = search.toLowerCase();

  const byCategory = ALL_CATEGORIES.map(({ key, label, icon, protected: prot }) => ({
    key, label, icon, protected: prot,
    items: files.filter(
      (f) =>
        f.file_category === key &&
        (searchLower === "" || f.filename.toLowerCase().includes(searchLower)),
    ),
  })).filter((c) => {
    if (c.items.length === 0) return false;
    // If category chips are active, only show the active ones
    if (activeCategories.size > 0) return activeCategories.has(c.key);
    return true;
  });

  const availableCategories = ALL_CATEGORIES.filter((cat) =>
    files.some((f) => f.file_category === cat.key),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border">
        <ConsolePageTitle selectedConsoles={selectedConsoles} tabName="System Files" />
      </div>

      {/* Secondary toolbar: search + category chips */}
      <div className="px-6 py-2 border-b border-border/50 flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        {availableCategories.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleCategory(key)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs border transition-colors",
              activeCategories.has(key)
                ? "bg-primary/20 border-primary/60 text-primary"
                : "bg-muted border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {byCategory.length === 0 && (
          <ConsoleEmptyState selectedConsoles={selectedConsoles} noun="system files">
            <div className="text-center py-16 text-muted-foreground text-sm">
              {files.length === 0
                ? "No system files found in current collection."
                : "No system files match your search or filters."}
            </div>
          </ConsoleEmptyState>
        )}

        {byCategory.map(({ key, label, icon: Icon, protected: prot, items }) => (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{label}</h2>
              <span className="text-xs text-muted-foreground">({items.length})</span>
              {prot && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">protected</span>}
            </div>
            <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
              {items.slice(0, 50).map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/30 text-sm">
                  <span className="flex-1 truncate text-foreground font-mono text-xs">{f.filename}</span>
                  <span className="text-xs text-muted-foreground/60 shrink-0">{f.console.split(" - ")[1] ?? f.console}</span>
                  <span className="text-xs text-muted-foreground/60 shrink-0">{formatBytes(f.filesize)}</span>
                </div>
              ))}
              {items.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/20">
                  …and {(items.length - 50).toLocaleString()} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
