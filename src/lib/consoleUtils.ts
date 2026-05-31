/**
 * Console grouping utilities.
 *
 * No-Intro folder names follow the pattern "Platform - Console Name (Variant)".
 * These helpers extract the semantic parts and strip known format-variant
 * suffixes so variant consoles can be grouped under one canonical name.
 */

const VARIANT_SUFFIXES = [
  " (FDS)",
  " (QD)",
  " (Multiboot)",
  " (Video)",
  " (e-Reader)",
  " (BigEndian)",
  " (ByteSwapped)",
  " (Headered)",
  " (Headerless)",
] as const;

/**
 * Returns the canonical console name with known format-variant suffixes removed.
 *
 * @example
 * getCanonicalConsoleName("Nintendo - Game Boy Advance (Multiboot)")
 * // → "Nintendo - Game Boy Advance"
 *
 * getCanonicalConsoleName("Nintendo - Game Boy")
 * // → "Nintendo - Game Boy"  (no change)
 */
export function getCanonicalConsoleName(name: string): string {
  for (const suffix of VARIANT_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length);
    }
  }
  return name;
}

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
