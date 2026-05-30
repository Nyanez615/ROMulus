import { cn } from "@/lib/utils";

type TagKind = "region" | "language" | "status" | "unofficial" | "prerelease" | "extra";

const REGION_COLORS: Record<string, string> = {
  USA: "bg-blue-600/20 text-blue-300 border-blue-600/40",
  Japan: "bg-red-600/20 text-red-300 border-red-600/40",
  Europe: "bg-green-600/20 text-green-300 border-green-600/40",
  World: "bg-yellow-600/20 text-yellow-300 border-yellow-600/40",
  Australia: "bg-sky-600/20 text-sky-300 border-sky-600/40",
  "United Kingdom": "bg-sky-600/20 text-sky-300 border-sky-600/40",
};

const DEFAULT_REGION = "bg-slate-600/20 text-slate-300 border-slate-600/40";

function getTagStyle(tag: string, kind: TagKind): string {
  if (kind === "region") return REGION_COLORS[tag] ?? DEFAULT_REGION;
  if (kind === "language") return "bg-slate-700/40 text-slate-300 border-slate-600/40";
  if (kind === "prerelease") return "bg-purple-600/20 text-purple-300 border-purple-600/40";
  if (kind === "unofficial") return "bg-orange-600/20 text-orange-300 border-orange-600/40";
  if (kind === "status") return "bg-amber-600/20 text-amber-300 border-amber-600/40";
  return "bg-slate-700/20 text-slate-400 border-slate-700/40";
}

function detectKind(tag: string): TagKind {
  const regions = ["USA", "Japan", "Europe", "World", "Australia", "United Kingdom",
    "Germany", "France", "Spain", "Italy", "Korea", "Brazil", "Taiwan", "China",
    "Russia", "Asia", "Hong Kong", "Unknown"];
  if (regions.includes(tag)) return "region";
  if (/^[A-Z][a-z]?(,[A-Z][a-z]?)*$/.test(tag)) return "language";
  if (["Beta", "Proto", "Demo", "Sample", "Promo", "Kiosk"].includes(tag)) return "prerelease";
  if (["Pirate", "Unl", "Aftermarket", "Hack"].includes(tag)) return "unofficial";
  return "extra";
}

interface TagBadgeProps {
  tag: string;
  kind?: TagKind;
  className?: string;
}

export function TagBadge({ tag, kind, className }: TagBadgeProps) {
  const resolvedKind = kind ?? detectKind(tag);
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border",
        getTagStyle(tag, resolvedKind),
        className,
      )}
    >
      {tag}
    </span>
  );
}

interface TagListProps {
  regions?: string[];
  languages?: string[];
  statusFlags?: string[];
  extraTags?: string[];
  max?: number;
}

export function TagList({ regions = [], languages = [], statusFlags = [], extraTags = [], max = 4 }: TagListProps) {
  const all = [
    ...regions.map((t) => ({ tag: t, kind: "region" as TagKind })),
    ...languages.map((t) => ({ tag: t, kind: "language" as TagKind })),
    ...statusFlags.map((t) => ({ tag: t, kind: detectKind(t) })),
    ...extraTags.slice(0, 1).map((t) => ({ tag: t, kind: "extra" as TagKind })),
  ].slice(0, max);

  const overflow = (regions.length + languages.length + statusFlags.length + extraTags.length) - all.length;

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {all.map(({ tag, kind }, i) => (
        <TagBadge key={i} tag={tag} kind={kind} />
      ))}
      {overflow > 0 && (
        <span className="text-xs text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}
