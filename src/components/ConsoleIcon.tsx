import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConsoleMeta {
  label: string;
  color: string;
  manufacturer: "nintendo" | "sega" | "sony" | "atari" | "snk" | "other";
}

const CONSOLE_MAP: Record<string, ConsoleMeta> = {
  "Nintendo - Game Boy Advance": { label: "GBA", color: "#8B1A1A", manufacturer: "nintendo" },
  "Nintendo - Game Boy Advance (e-Reader)": { label: "GBA e-Reader", color: "#8B1A1A", manufacturer: "nintendo" },
  "Nintendo - Game Boy Advance (Multiboot)": { label: "GBA MB", color: "#8B1A1A", manufacturer: "nintendo" },
  "Nintendo - Game Boy Advance (Video)": { label: "GBA Video", color: "#8B1A1A", manufacturer: "nintendo" },
  "Nintendo - Game Boy": { label: "GB", color: "#555", manufacturer: "nintendo" },
  "Nintendo - Game Boy Color": { label: "GBC", color: "#6A0DAD", manufacturer: "nintendo" },
  "Nintendo - Super Nintendo Entertainment System": { label: "SNES", color: "#E4000F", manufacturer: "nintendo" },
  "Nintendo - Nintendo Entertainment System (Headered)": { label: "NES", color: "#CC0000", manufacturer: "nintendo" },
  "Nintendo - Nintendo Entertainment System (Headerless)": { label: "NES HL", color: "#CC0000", manufacturer: "nintendo" },
  "Nintendo - Nintendo 64 (BigEndian)": { label: "N64 BE", color: "#009AC7", manufacturer: "nintendo" },
  "Nintendo - Nintendo 64 (ByteSwapped)": { label: "N64 BS", color: "#009AC7", manufacturer: "nintendo" },
  "Nintendo - Nintendo 64DD": { label: "64DD", color: "#009AC7", manufacturer: "nintendo" },
  "Nintendo - Family Computer Disk System (FDS)": { label: "FDS", color: "#CC0000", manufacturer: "nintendo" },
  "Nintendo - Family Computer Disk System (QD)": { label: "FDS QD", color: "#CC0000", manufacturer: "nintendo" },
  "Nintendo - Virtual Boy": { label: "VB", color: "#CC0000", manufacturer: "nintendo" },
  "Nintendo - Pokemon Mini": { label: "PKM Mini", color: "#FFCB05", manufacturer: "nintendo" },
};

const MANUFACTURER_COLORS: Record<string, string> = {
  nintendo: "#E4000F",
  sega: "#0066B3",
  sony: "#003087",
  atari: "#FF6600",
  snk: "#C8102E",
  other: "#6B7280",
};

function getConsoleMeta(consoleName: string): ConsoleMeta {
  if (CONSOLE_MAP[consoleName]) return CONSOLE_MAP[consoleName];

  // Auto-detect manufacturer from folder name prefix
  const lower = consoleName.toLowerCase();
  if (lower.startsWith("nintendo")) return { label: consoleName.split(" - ")[1] ?? "Nintendo", color: "#E4000F", manufacturer: "nintendo" };
  if (lower.startsWith("sega")) return { label: consoleName.split(" - ")[1] ?? "Sega", color: "#0066B3", manufacturer: "sega" };
  if (lower.startsWith("sony")) return { label: consoleName.split(" - ")[1] ?? "Sony", color: "#003087", manufacturer: "sony" };
  if (lower.startsWith("atari")) return { label: consoleName.split(" - ")[1] ?? "Atari", color: "#FF6600", manufacturer: "atari" };
  if (lower.startsWith("snk")) return { label: consoleName.split(" - ")[1] ?? "SNK", color: "#C8102E", manufacturer: "snk" };

  return { label: consoleName, color: "#6B7280", manufacturer: "other" };
}

interface ConsoleIconProps {
  consoleName: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ConsoleIcon({ consoleName, size = "md", showLabel = false, className }: ConsoleIconProps) {
  const meta = getConsoleMeta(consoleName);
  const color = meta.color;

  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-xs",
    lg: "w-10 h-10 text-sm",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded font-bold shrink-0 border",
          sizeClasses[size],
        )}
        style={{
          backgroundColor: `${color}22`,
          borderColor: `${color}44`,
          color,
        }}
      >
        <Gamepad2 className="w-3.5 h-3.5" />
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-foreground truncate">{meta.label}</span>
      )}
    </div>
  );
}

interface ManufacturerBadgeProps {
  consoleName: string;
  className?: string;
}

export function ManufacturerBadge({ consoleName, className }: ManufacturerBadgeProps) {
  const meta = getConsoleMeta(consoleName);
  const color = MANUFACTURER_COLORS[meta.manufacturer];
  return (
    <span
      className={cn("text-xs font-semibold uppercase tracking-wider", className)}
      style={{ color }}
    >
      {meta.manufacturer === "other" ? consoleName.split(" - ")[0] : meta.manufacturer}
    </span>
  );
}
