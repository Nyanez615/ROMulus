import { getRegionDefaultLanguages } from "@/lib/regionUtils";
import type { RomGroup } from "@/lib/bindings/RomGroup";

// Pure filter predicates — shared between the ROMs tab's own FilterBar and
// any other UI (e.g. ArchiveActionDialog) that needs the same chip-filter
// semantics applied to a RomGroup[].

export function matchesLang(g: RomGroup, langs: string[]): boolean {
  return g.variants.some((v) => {
    if (v.languages.some((l) => langs.includes(l))) return true;
    if (v.languages.length === 0) {
      return getRegionDefaultLanguages(v.regions[0] ?? "").some((l) => langs.includes(l));
    }
    return false;
  });
}

export function matchesRegion(g: RomGroup, regions: string[]): boolean {
  return g.variants.some((v) => {
    if (v.regions.some((r) => regions.includes(r))) return true;
    if (v.regions.length === 0) {
      return regions.some((r) =>
        getRegionDefaultLanguages(r).some((l) => v.languages.includes(l)),
      );
    }
    return false;
  });
}

export function matchesStatus(g: RomGroup, statuses: string[]): boolean {
  return g.variants.some((v) => v.status_flags.some((s) => statuses.includes(s)));
}

export function matchesPreferred(g: RomGroup, preferred: string[]): boolean {
  if (preferred.includes("Has preferred") && !g.has_preferred_version) return false;
  if (preferred.includes("No preferred") &&  g.has_preferred_version) return false;
  return true;
}

// # first: title_normalized strips articles so numeric titles (007, 1942) sort
// before alphabetical ones.
export const STARTING_LETTERS = ["#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
                                  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W",
                                  "X", "Y", "Z"] as const;

export function startingLetter(title: string): string {
  const ch = title[0] ?? "";
  return ch >= "a" && ch <= "z" ? ch.toUpperCase() : "#";
}

export function matchesStartingLetter(g: RomGroup, letters: string[]): boolean {
  return letters.includes(startingLetter(g.title_normalized));
}
