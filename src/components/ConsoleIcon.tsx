import { cn } from "@/lib/utils";
import {
  PLATFORMS,
  ABBREV,
  detectPlatform,
  getAbbrev,
  getShortLabel,
} from "@/lib/consoleUtils";

export type { PlatformInfo } from "@/lib/consoleUtils";
export { getConsoleColor } from "@/lib/consoleUtils";

// ── Components ────────────────────────────────────────────────────────────────

interface ConsoleIconProps {
  consoleName: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const SIZE_BOX  = { sm: "w-6 h-6",  md: "w-8 h-8",  lg: "w-10 h-10" };
const SIZE_TEXT = { sm: "text-[8px]", md: "text-[9px]", lg: "text-xs" };

export function ConsoleIcon({ consoleName, size = "md", showLabel = false, className }: ConsoleIconProps) {
  const platform = detectPlatform(consoleName);
  const { color } = PLATFORMS[platform];
  const abbrev = getAbbrev(consoleName);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded border shrink-0 font-mono font-bold leading-none",
          SIZE_BOX[size],
          SIZE_TEXT[size],
        )}
        style={{ backgroundColor: `${color}22`, borderColor: `${color}44`, color }}
        aria-label={consoleName}
      >
        {abbrev}
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-foreground truncate">{getShortLabel(consoleName)}</span>
      )}
    </div>
  );
}

/** Renders the platform's Simple Icons SVG, or a coloured initial as fallback. */
export function PlatformIcon({ consoleName, size = 16, className }: { consoleName: string; size?: number; className?: string }) {
  const platform = detectPlatform(consoleName);
  const { color, siIcon } = PLATFORMS[platform];

  if (siIcon) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={`#${siIcon.hex}`}
        className={cn("shrink-0", className)}
        aria-label={PLATFORMS[platform].name}
      >
        <path d={siIcon.path} />
      </svg>
    );
  }

  return (
    <span
      className={cn("text-xs font-bold uppercase shrink-0", className)}
      style={{ color }}
      aria-label={PLATFORMS[platform].name}
    >
      {PLATFORMS[platform].name[0]}
    </span>
  );
}

/** Platform badge for sidebar/header labels. */
export function PlatformBadge({ consoleName, className }: { consoleName: string; className?: string }) {
  const platform = detectPlatform(consoleName);
  const { name, color } = PLATFORMS[platform];
  const display = platform === "other" ? (consoleName.split(" - ")[0] ?? consoleName) : name;
  return (
    <span className={cn("text-xs font-semibold uppercase tracking-wider", className)} style={{ color }}>
      {display}
    </span>
  );
}

// ── Backwards-compatibility aliases ──────────────────────────────────────────
/** @deprecated Use PlatformIcon */
export const ManufacturerIcon = PlatformIcon;
/** @deprecated Use PlatformBadge */
export const ManufacturerBadge = PlatformBadge;

// Re-export ABBREV for any legacy consumers
export { ABBREV };
