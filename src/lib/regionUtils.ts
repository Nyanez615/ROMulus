/**
 * Region → default language mapping. Mirrors parser.rs::region_default_languages.
 * Keep both files in sync when adding new regions.
 */
export const REGION_DEFAULT_LANGUAGES: Record<string, string[]> = {
  // English
  "USA": ["En"], "Australia": ["En"], "United Kingdom": ["En"],
  "New Zealand": ["En"], "South Africa": ["En"], "India": ["En"],
  "World": ["En"], "Europe": ["En"],
  "Canada": ["En", "Fr"],
  // East Asian
  "Japan": ["Ja"],
  "Korea": ["Ko"],
  "China": ["Zh"], "Taiwan": ["Zh"], "Hong Kong": ["Zh"],
  // Western European
  "Germany": ["De"], "Austria": ["De"],
  "Switzerland": ["De", "Fr", "It"],
  "France": ["Fr"], "Belgium": ["Fr", "Nl"],
  "Spain": ["Es"],
  "Italy": ["It"],
  "Netherlands": ["Nl"],
  "Sweden": ["Sv"],
  "Norway": ["No"],
  "Denmark": ["Da"],
  "Scandinavia": ["Sv", "No", "Da"],
  "Finland": ["Fi"],
  "Portugal": ["Pt"],
  // Eastern European / Other
  "Brazil": ["Pt"],
  "Russia": ["Ru"],
  "Mexico": ["Es"], "Latin America": ["Es"], "Argentina": ["Es"],
  "South America": ["Es", "Pt"],
  "Greece": ["El"],
  "Poland": ["Pl"],
  "Czech Republic": ["Cs"],
  "Hungary": ["Hu"],
  "Romania": ["Ro"],
  "Turkey": ["Tr"],
  // Multi-language / ambiguous
  "Asia": ["Zh", "Ja", "Ko"],
};

/** Returns the default languages for a region, or [] if unknown. */
export function getRegionDefaultLanguages(region: string): string[] {
  return REGION_DEFAULT_LANGUAGES[region] ?? [];
}

/**
 * Returns the regions that default to a given language code.
 * Used for the inferred-regions note in Settings and for bidirectional filter chips.
 */
export function getRegionsForLanguage(lang: string): string[] {
  return Object.entries(REGION_DEFAULT_LANGUAGES)
    .filter(([, langs]) => langs.includes(lang))
    .map(([region]) => region);
}
