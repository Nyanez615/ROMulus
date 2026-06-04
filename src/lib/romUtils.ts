export const ROM_SORT_FIELDS = [
  { value: "name",      label: "Name" },
  { value: "variants",  label: "Variants" },
  { value: "preferred", label: "Preferred" },
] as const;

export type RomSortField = (typeof ROM_SORT_FIELDS)[number]["value"];
export type SortDir = "asc" | "desc";
