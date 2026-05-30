import { Gamepad2 } from "lucide-react";
import { siSega, siSony, siAtari, siPlaystation } from "simple-icons";
import { cn } from "@/lib/utils";

// ── Manufacturer metadata ─────────────────────────────────────────────────────

interface ManufacturerInfo {
  name: string;
  color: string;
  /** Simple Icons data, when available. Nintendo/Microsoft not in simple-icons. */
  siIcon?: { path: string; hex: string };
}

const MANUFACTURERS: Record<string, ManufacturerInfo> = {
  nintendo:  { name: "Nintendo",  color: "#E4000F" },
  sega:      { name: "Sega",      color: "#0066B3", siIcon: siSega },
  sony:      { name: "Sony",      color: "#003087", siIcon: siSony },
  // PlayStation-branded systems use the PS icon
  playstation: { name: "PlayStation", color: "#003791", siIcon: siPlaystation },
  atari:     { name: "Atari",     color: "#FF6600", siIcon: siAtari },
  snk:       { name: "SNK",       color: "#C8102E" },
  microsoft: { name: "Microsoft", color: "#00A4EF" },
  other:     { name: "Other",     color: "#6B7280" },
};

function detectManufacturer(folder: string): keyof typeof MANUFACTURERS {
  const l = folder.toLowerCase();
  if (l.startsWith("nintendo"))  return "nintendo";
  if (l.startsWith("sega"))      return "sega";
  if (l.startsWith("sony"))      return l.includes("playstation") ? "playstation" : "sony";
  if (l.startsWith("atari"))     return "atari";
  if (l.startsWith("snk"))       return "snk";
  if (l.startsWith("microsoft")) return "microsoft";
  return "other";
}

function getShortLabel(folder: string): string {
  return folder.split(" - ")[1] ?? folder;
}

// ── Components ────────────────────────────────────────────────────────────────

interface ConsoleIconProps {
  consoleName: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ConsoleIcon({ consoleName, size = "md", showLabel = false, className }: ConsoleIconProps) {
  const mfr = detectManufacturer(consoleName);
  const { color } = MANUFACTURERS[mfr];
  const sizeMap = { sm: "w-6 h-6", md: "w-8 h-8", lg: "w-10 h-10" };
  const iconMap = { sm: "w-3 h-3", md: "w-4 h-4", lg: "w-5 h-5" };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn("flex items-center justify-center rounded border shrink-0", sizeMap[size])}
        style={{ backgroundColor: `${color}22`, borderColor: `${color}44` }}
      >
        <Gamepad2 className={iconMap[size]} style={{ color }} aria-hidden="true" />
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-foreground truncate">{getShortLabel(consoleName)}</span>
      )}
    </div>
  );
}

/** Renders the manufacturer's Simple Icons SVG, or a coloured initial as fallback. */
export function ManufacturerIcon({ consoleName, size = 16, className }: { consoleName: string; size?: number; className?: string }) {
  const mfr = detectManufacturer(consoleName);
  const { color, siIcon } = MANUFACTURERS[mfr];

  if (siIcon) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={`#${siIcon.hex}`}
        className={cn("shrink-0", className)}
        aria-label={MANUFACTURERS[mfr].name}
      >
        <path d={siIcon.path} />
      </svg>
    );
  }

  return (
    <span
      className={cn("text-xs font-bold uppercase shrink-0", className)}
      style={{ color }}
      aria-label={MANUFACTURERS[mfr].name}
    >
      {MANUFACTURERS[mfr].name[0]}
    </span>
  );
}

/** Manufacturer badge for sidebar/header labels. */
export function ManufacturerBadge({ consoleName, className }: { consoleName: string; className?: string }) {
  const mfr = detectManufacturer(consoleName);
  const { name, color } = MANUFACTURERS[mfr];
  const display = mfr === "other" ? (consoleName.split(" - ")[0] ?? consoleName) : name;
  return (
    <span className={cn("text-xs font-semibold uppercase tracking-wider", className)} style={{ color }}>
      {display}
    </span>
  );
}

/** Returns the accent hex color for a console folder name. */
export function getConsoleColor(consoleName: string): string {
  return MANUFACTURERS[detectManufacturer(consoleName)].color;
}
