import { siSega, siSony, siAtari, siPlaystation } from "simple-icons";
import { cn } from "@/lib/utils";

// ── Platform metadata ─────────────────────────────────────────────────────────

interface PlatformInfo {
  name: string;
  color: string;
  /** Simple Icons data, when available. Nintendo/Microsoft not in simple-icons. */
  siIcon?: { path: string; hex: string };
}

const PLATFORMS: Record<string, PlatformInfo> = {
  nintendo:    { name: "Nintendo",    color: "#E4000F" },
  sega:        { name: "Sega",        color: "#0066B3", siIcon: siSega },
  sony:        { name: "Sony",        color: "#003087", siIcon: siSony },
  // PlayStation-branded systems use the PS icon
  playstation: { name: "PlayStation", color: "#003791", siIcon: siPlaystation },
  atari:       { name: "Atari",       color: "#FF6600", siIcon: siAtari },
  snk:         { name: "SNK",         color: "#C8102E" },
  microsoft:   { name: "Microsoft",   color: "#00A4EF" },
  other:       { name: "Other",       color: "#6B7280" },
};

function detectPlatform(folder: string): keyof typeof PLATFORMS {
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

// ── Console abbreviation map ──────────────────────────────────────────────────

const ABBREV: Record<string, string> = {
  "Game Boy":                                    "GB",
  "Game Boy Color":                              "GBC",
  "Game Boy Advance":                            "GBA",
  "Game Boy Advance (Multiboot)":                "GBA",
  "Game Boy Advance (Video)":                    "GBA",
  "Game Boy Advance (e-Reader)":                 "GBA",
  "Nintendo Entertainment System":               "NES",
  "Nintendo Entertainment System (Headered)":    "NES",
  "Nintendo Entertainment System (Headerless)":  "NES",
  "Super Nintendo Entertainment System":         "SNES",
  "Nintendo 64":                                 "N64",
  "Nintendo 64 (BigEndian)":                     "N64",
  "Nintendo 64 (ByteSwapped)":                   "N64",
  "Nintendo 64DD":                               "64DD",
  "Family Computer Disk System":                 "FDS",
  "Family Computer Disk System (FDS)":           "FDS",
  "Family Computer Disk System (QD)":            "FDS",
  "Virtual Boy":                                 "VB",
  "Pokémon Mini":                                "PM",
};

function getAbbrev(consoleName: string): string {
  const short = consoleName.split(" - ")[1] ?? consoleName;
  return ABBREV[short] ?? short.slice(0, 4).toUpperCase();
}

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

/** Returns the accent hex color for a console folder name. */
export function getConsoleColor(consoleName: string): string {
  return PLATFORMS[detectPlatform(consoleName)].color;
}

// ── Backwards-compatibility aliases (remove after all callsites updated) ──────
/** @deprecated Use PlatformIcon */
export const ManufacturerIcon = PlatformIcon;
/** @deprecated Use PlatformBadge */
export const ManufacturerBadge = PlatformBadge;
