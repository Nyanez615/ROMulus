import { getConsoleParts, getConsoleColor, getConsoleDisplayName } from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";

interface ConsolePageTitleProps {
  selectedConsoles: string[] | null;
  tabName: string;
}

/**
 * Shared title component for all console-filtered tabs.
 * Renders "{Platform} — {Canonical} — {tabName}" with platform accent color
 * when a console is selected; renders plain "{tabName}" otherwise.
 * Respects the short_console_names preference (G4).
 */
export function ConsolePageTitle({ selectedConsoles, tabName }: ConsolePageTitleProps) {
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);

  if (!selectedConsoles || selectedConsoles.length === 0) {
    return <h1 className="text-base font-semibold text-foreground">{tabName}</h1>;
  }
  const { platform, canonical } = getConsoleParts(selectedConsoles[0]);
  const color = getConsoleColor(selectedConsoles[0]);
  // Apply abbreviation to the canonical name (without variant suffixes)
  const displayName = getConsoleDisplayName(`${platform} - ${canonical}`, useShort);
  return (
    <h1 className="text-base font-semibold text-foreground">
      <span style={{ color }}>{platform} — {displayName}</span>
      {" — "}
      {tabName}
    </h1>
  );
}
