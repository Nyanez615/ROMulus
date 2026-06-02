export const ROM_SORT_OPTIONS = [
  { value: "az",       label: "Name A–Z" },
  { value: "za",       label: "Name Z–A" },
  { value: "variants", label: "Most variants" },
] as const;

export type RomSortKey = (typeof ROM_SORT_OPTIONS)[number]["value"];
