/**
 * Console grouping utilities — single source of truth for all console data/logic.
 *
 * No-Intro folder names follow "Platform - Console Name (Variant)".
 * These helpers extract semantic parts, strip variant suffixes, resolve aliases,
 * and provide display-name formatting used across all tabs.
 */

import { siSega, siSony, siAtari, siPlaystation } from "simple-icons";
import type { ConsoleStats } from "@/lib/bindings/ConsoleStats";

// ── Variant suffix list ───────────────────────────────────────────────────────

const VARIANT_SUFFIXES = [
  // Famicom Disk System media formats
  " (FDS)",
  " (QD)",
  // Game Boy Advance special cart types
  " (Multiboot)",
  " (Video)",
  " (e-Reader)",
  // Nintendo 64 byte-order variants
  " (BigEndian)",
  " (ByteSwapped)",
  // NES ROM header variants
  " (Headered)",
  " (Headerless)",
  // Nintendo DS / 3DS / DSi encryption + distribution variants
  " (Encrypted)",
  " (Decrypted)",
  " (Download Play)",
  " (Digital)",
  " (CDN)",
  // PlayStation distribution variants (PSP / PS3 / Vita)
  " (PSN)",
  " (NoNpDrm)",
  " (PSVgameSD)",
  " (Minis)",
  " (UMD Video)",
  " (UMD Music)",
  // Xbox 360 digital storefronts
  " (Games on Demand)",
  " (XBLA)",
] as const;

// ── Alias map: separate products grouped under one canonical console ──────────
// Distinct from VARIANT_SUFFIXES: aliases are separate hardware (N64DD has
// different games) but we group them for browsing.

const CONSOLE_ALIASES: Record<string, string> = {
  "Nintendo 64DD": "Nintendo 64",
};

// ── Platform metadata ─────────────────────────────────────────────────────────

export interface PlatformInfo {
  name: string;
  color: string;
  siIcon?: { path: string; hex: string };
}

export const PLATFORMS: Record<string, PlatformInfo> = {
  nintendo:    { name: "Nintendo",    color: "#E4000F" },
  sega:        { name: "Sega",        color: "#0066B3", siIcon: siSega },
  sony:        { name: "Sony",        color: "#003087", siIcon: siSony },
  playstation: { name: "PlayStation", color: "#003791", siIcon: siPlaystation },
  atari:       { name: "Atari",       color: "#FF6600", siIcon: siAtari },
  snk:         { name: "SNK",         color: "#C8102E" },
  microsoft:   { name: "Microsoft",   color: "#00A4EF" },
  other:       { name: "Other",       color: "#6B7280" },
};

export function detectPlatform(folder: string): keyof typeof PLATFORMS {
  const l = folder.toLowerCase();
  if (l.startsWith("nintendo"))  return "nintendo";
  if (l.startsWith("sega"))      return "sega";
  if (l.startsWith("sony"))      return l.includes("playstation") ? "playstation" : "sony";
  if (l.startsWith("atari"))     return "atari";
  if (l.startsWith("snk"))       return "snk";
  if (l.startsWith("microsoft")) return "microsoft";
  return "other";
}

// ── Console abbreviation map ──────────────────────────────────────────────────

export const ABBREV: Record<string, string> = {
  // Nintendo
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
  "Pokemon Mini":                                "PM",
  // Sega
  "Master System - Mark III":                    "SMS",
  "Master System":                               "SMS",
  "Game Gear":                                   "GG",
  "Mega Drive - Genesis":                        "MD",
  "Mega Drive":                                  "MD",
  "Mega-CD":                                     "MCD",
  "Mega-CD 32X":                                 "MCD32",
  "32X":                                         "32X",
  "Saturn":                                      "SAT",
  "Dreamcast":                                   "DC",
  // Sony
  "PlayStation":                                 "PSX",
  "PlayStation 2":                               "PS2",
  "PlayStation 3":                               "PS3",
  "PlayStation 4":                               "PS4",
  "PlayStation Portable":                        "PSP",
  "PlayStation Vita":                            "PSV",
  // Nintendo — DS / 3DS / Switch family
  "Nintendo DS":                                 "NDS",
  "Nintendo DSi":                                "DSi",
  "Nintendo 3DS":                                "3DS",
  "New Nintendo 3DS":                            "N3DS",
  "Nintendo Switch":                             "NSW",
  // Nintendo — additional home / handheld
  "Family Computer":                             "FC",
  "Satellaview":                                 "BSX",
  "Sufami Turbo":                                "SFT",
  "Game & Watch":                                "GW",
  "Wii":                                         "Wii",
  "Wii U":                                       "WiiU",
  "GameCube":                                    "GCN",
  // Sega — additional
  "SG-1000":                                     "SG1K",
  "PICO":                                        "PICO",
  // Atari
  "2600":                                        "2600",
  "5200":                                        "5200",
  "7800":                                        "7800",
  "8-bit Family":                                "A8",
  "Jaguar":                                      "JAG",
  "Lynx":                                        "LYNX",
  "ST":                                          "AST",
  // SNK
  "Neo Geo Pocket":                              "NGP",
  "Neo Geo Pocket Color":                        "NGPC",
  "Neo Geo CD":                                  "NGCD",
  // NEC
  "PC Engine":                                   "PCE",
  "PC Engine CD":                                "PCECD",
  "SuperGrafx":                                  "SGX",
  "PC-FX":                                       "PCFX",
  // Bandai
  "WonderSwan":                                  "WS",
  "WonderSwan Color":                            "WSC",
  // Microsoft
  "Xbox":                                        "XBX",
  "Xbox 360":                                    "X360",
  "XBOX 360":                                    "X360",
  // Panasonic
  "3DO Interactive Multiplayer":                 "3DO",
  // Philips
  "CD-i":                                        "CDi",
  // Commodore
  "64":                                          "C64",
  "Amiga":                                       "AMI",
  // Microsoft — PC
  "MSX":                                         "MSX",
  "MSX 2":                                       "MSX2",
  // Other home consoles
  "Intellivision":                               "INTV",
  "ColecoVision":                                "CV",
  "Vectrex":                                     "VEC",
  "Odyssey 2":                                   "O2",
  "Channel F":                                   "CHF",
  "Studio II":                                   "RCA2",
  "Supervision":                                 "SVN",
  "Game.com":                                    "GCO",
  "V.Smile":                                     "VSM",
  "Super Cassette Vision":                       "SCV",
  "GP32":                                        "GP32",
};

export function getAbbrev(consoleName: string): string {
  const short = consoleName.split(" - ")[1] ?? consoleName;
  const canonical = getCanonicalConsoleName(short);
  return ABBREV[short] ?? ABBREV[canonical] ?? short.slice(0, 4).toUpperCase();
}

/**
 * Like getAbbrev, but preserves the parenthetical format suffix so paired
 * folders are always distinguishable in the UI:
 *   "Nintendo - Family Computer Disk System"       → "FDS"
 *   "Nintendo - Family Computer Disk System (QD)"  → "FDS (QD)"
 *   "Nintendo - Nintendo 64 (ByteSwapped)"         → "N64 (ByteSwapped)"
 */
export function getFormatVariantLabel(folder: string): string {
  const short = folder.split(" - ")[1] ?? folder;
  const base = stripFormatSuffix(short);
  const suffix = short.slice(base.length).trim(); // e.g. "(QD)" or ""
  const canonical = getCanonicalConsoleName(base);
  const abbrev = ABBREV[base] ?? ABBREV[canonical] ?? base.slice(0, 4).toUpperCase();
  return suffix ? `${abbrev} ${suffix}` : abbrev;
}

export function getShortLabel(folder: string): string {
  return folder.split(" - ")[1] ?? folder;
}

/** Returns the accent hex color for a console folder name. */
export function getConsoleColor(consoleName: string): string {
  return PLATFORMS[detectPlatform(consoleName)].color;
}

// ── Name extraction helpers ───────────────────────────────────────────────────

/**
 * Returns the platform name — the part before " - " in a console folder name.
 *
 * @example
 * getPlatform("Nintendo - Game Boy")  // → "Nintendo"
 * getPlatform("Sega")                 // → "Sega"  (fallback to full name)
 */
export function getPlatform(name: string): string {
  return name.split(" - ")[0] ?? name;
}

/**
 * Returns the short console name — the part after " - " in a console folder name.
 * Falls back to the full name if no separator is present.
 *
 * @example
 * getShortConsoleName("Nintendo - Game Boy Advance")  // → "Game Boy Advance"
 */
export function getShortConsoleName(name: string): string {
  return name.split(" - ")[1] ?? name;
}

/**
 * Returns the canonical console name with known variant suffixes stripped and
 * console aliases resolved (works on both short names and full folder names).
 *
 * When called via getConsoleParts the input is the short name (after " - ").
 * When called directly with a full folder name, suffixes are still stripped.
 *
 * @example
 * getCanonicalConsoleName("Game Boy Advance (Multiboot)")  // → "Game Boy Advance"
 * getCanonicalConsoleName("Nintendo 64DD")                 // → "Nintendo 64"  (alias)
 * getCanonicalConsoleName("Nintendo - Game Boy Advance (Multiboot)")  // → "Nintendo - Game Boy Advance"
 */
export function getCanonicalConsoleName(name: string): string {
  if (CONSOLE_ALIASES[name]) return CONSOLE_ALIASES[name]!;
  for (const suffix of VARIANT_SUFFIXES) {
    if (name.endsWith(suffix)) {
      // recurse so multi-suffix names like "3DS (Digital) (Decrypted)" collapse fully
      return getCanonicalConsoleName(name.slice(0, name.length - suffix.length));
    }
  }
  return name;
}

/**
 * Splits a full No-Intro folder name into platform + canonical console name.
 *
 * @example
 * getConsoleParts("Nintendo - Game Boy Advance (Multiboot)")
 * // → { platform: "Nintendo", canonical: "Game Boy Advance" }
 *
 * getConsoleParts("Nintendo - Nintendo 64DD")
 * // → { platform: "Nintendo", canonical: "Nintendo 64" }  (via CONSOLE_ALIASES)
 */
export function getConsoleParts(fullName: string): { platform: string; canonical: string } {
  const idx = fullName.indexOf(" - ");
  if (idx === -1) {
    return { platform: fullName, canonical: getCanonicalConsoleName(fullName) };
  }
  const platformPart = fullName.slice(0, idx);
  const consolePart  = fullName.slice(idx + 3);
  return {
    platform: platformPart,
    canonical: getCanonicalConsoleName(consolePart),
  };
}

/**
 * Returns all raw variant names for a given canonical console name.
 * e.g. "Game Boy Advance" → ["Nintendo - Game Boy Advance",
 *                            "Nintendo - Game Boy Advance (Multiboot)", …]
 * Used by Sidebar, Dashboard, and Consoles tab click handlers.
 */
export function resolveConsoleVariants(canonical: string, allConsoles: ConsoleStats[]): string[] {
  return allConsoles
    .filter((c) => getConsoleParts(c.name).canonical === canonical)
    .map((c) => c.name);
}

/**
 * Strip the last parenthetical format-variant suffix from a full No-Intro
 * folder name.  Mirrors the Rust `strip_format_suffix` used in ConsoleStats
 * game_groups computation.
 *
 * @example
 * stripFormatSuffix("Nintendo - Nintendo 64 (BigEndian)") // → "Nintendo - Nintendo 64"
 * stripFormatSuffix("Nintendo - Nintendo 64DD")           // → "Nintendo - Nintendo 64DD"
 */
export function stripFormatSuffix(name: string): string {
  const idx = name.lastIndexOf("(");
  return idx >= 0 ? name.slice(0, idx).trim() : name;
}

/**
 * Compute the total game-title count for a canonical console's sub-folder
 * variants, correctly handling cases where some sub-folders use a non-paren
 * naming convention (e.g. "Nintendo 64DD") and are therefore tracked under a
 * separate Rust canonical key.
 *
 * Within each `stripFormatSuffix` base-group (e.g. all "NES (Headered/less)"
 * sub-folders share the same deduplicated `game_groups`) we take one count.
 * Across base-groups (e.g. N64 BigEndian/ByteSwapped vs. N64DD) we sum.
 *
 * @example
 * // variants = [N64_BigEndian(game_groups=510), N64_ByteSwapped(510), N64DD(12)]
 * canonicalTitleCount(variants) // → 522
 */
export function canonicalTitleCount(variants: ConsoleStats[]): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v.game_groups);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/** Like canonicalTitleCount but reads all_groups (game + unofficial titles). */
export function canonicalAllTitleCount(variants: ConsoleStats[]): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v.all_groups);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/** Canonical-dedup sum for preferred_groups or all_groups. */
export function canonicalFieldSum(
  variants: ConsoleStats[],
  field: "preferred_groups" | "all_groups",
): number {
  const seen = new Map<string, number>();
  for (const v of variants) {
    const base = stripFormatSuffix(v.name);
    if (!seen.has(base)) seen.set(base, v[field]);
  }
  let total = 0;
  for (const n of seen.values()) total += n;
  return total;
}

/**
 * Returns the display name for a console — full short name or abbreviation
 * depending on the toggle.  fullName is a raw No-Intro folder name.
 *
 * @example
 * getConsoleDisplayName("Nintendo - Game Boy Advance", false)  // → "Game Boy Advance"
 * getConsoleDisplayName("Nintendo - Game Boy Advance", true)   // → "GBA"
 */
export function getConsoleDisplayName(fullName: string, useShort: boolean): string {
  const shortName = getShortConsoleName(fullName);
  if (!useShort) return shortName;
  // Preserve the variant suffix so "GBA (Multiboot)" stays distinguishable from "GBA"
  return getFormatVariantLabel(fullName);
}
