import { useEffect, useState } from "react";
import {
  LayoutDashboard, Server, Gamepad2, Skull, Cpu,
  CopyX, Scissors, History, Settings, Zap,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useUIStore, type TabId } from "@/store/ui";
import { scanRoots, getSettings, enrichAllGames } from "@/lib/tauri";
import { useScanStore } from "@/store/scan";

const NAV_COMMANDS = [
  { label: "Dashboard",           tab: "dashboard"  as TabId, icon: LayoutDashboard },
  { label: "Consoles",            tab: "consoles"   as TabId, icon: Server          },
  { label: "ROMs",                 tab: "roms"       as TabId, icon: Gamepad2        },
  { label: "Hacks & Unofficial",  tab: "hacks"      as TabId, icon: Skull           },
  { label: "System Files",        tab: "system"     as TabId, icon: Cpu             },
  { label: "Duplicates",          tab: "duplicates" as TabId, icon: CopyX           },
  { label: "Prune",               tab: "prune"      as TabId, icon: Scissors        },
  { label: "History",             tab: "history"    as TabId, icon: History         },
  { label: "Settings",            tab: "settings"   as TabId, icon: Settings        },
];

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setActiveTab } = useUIStore();
  const { setConsoles, setStatus } = useScanStore();
  const [scanning, setScanning] = useState(false);

  // Allow external open via keyboard shortcut (⌘K)
  useEffect(() => {
    const handler = () => setCommandPaletteOpen(true);
    window.addEventListener("romulus:open-palette", handler);
    return () => window.removeEventListener("romulus:open-palette", handler);
  }, [setCommandPaletteOpen]);

  function run(fn: () => void) {
    setCommandPaletteOpen(false);
    fn();
  }

  async function doScan() {
    setScanning(true);
    try {
      const settings = await getSettings();
      const s = await scanRoots(settings.rom_roots);
      setStatus(s);
      const { getConsoles } = await import("@/lib/tauri");
      getConsoles().then(setConsoles);
    } finally {
      setScanning(false);
    }
  }

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {NAV_COMMANDS.map(({ label, tab, icon: Icon }) => (
            <CommandItem key={tab} onSelect={() => run(() => setActiveTab(tab))}>
              <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(doScan)} disabled={scanning}>
            <Zap className="w-4 h-4 mr-2 text-primary" />
            {scanning ? "Scanning…" : "Rescan collection"}
          </CommandItem>
          <CommandItem onSelect={() => run(() => enrichAllGames())}>
            <Zap className="w-4 h-4 mr-2 text-primary" />
            Enrich metadata (IGDB)
          </CommandItem>
          <CommandItem onSelect={() => run(() => setActiveTab("prune"))}>
            <Scissors className="w-4 h-4 mr-2 text-muted-foreground" />
            Open Prune tab
          </CommandItem>
          <CommandItem onSelect={() => run(() => setActiveTab("settings"))}>
            <Settings className="w-4 h-4 mr-2 text-muted-foreground" />
            Open Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
