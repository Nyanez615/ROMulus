import { getConsoleParts, getConsoleDisplayName } from "@/lib/consoleUtils";
import { usePreferencesStore } from "@/store/preferences";

interface ConsoleEmptyStateProps {
  selectedConsoles: string[] | null;
  noun: string;
  children?: React.ReactNode;
}

/**
 * Shared empty-state component for all console-filtered tabs.
 * When a console is selected: "No {noun} for {canonical display name}"
 * When no console is selected: renders {children} (the generic fallback message)
 * Respects the short_console_names preference (G4).
 */
export function ConsoleEmptyState({ selectedConsoles, noun, children }: ConsoleEmptyStateProps) {
  const useShort = usePreferencesStore((s) => s.preferences.short_console_names);

  if (!selectedConsoles || selectedConsoles.length === 0) {
    return <>{children}</>;
  }
  const { platform, canonical } = getConsoleParts(selectedConsoles[0]);
  // Apply abbreviation to the canonical name (without variant suffixes)
  const displayName = getConsoleDisplayName(`${platform} - ${canonical}`, useShort);
  return (
    <div className="text-center py-16 text-muted-foreground text-sm">
      No {noun} for {displayName}
    </div>
  );
}
