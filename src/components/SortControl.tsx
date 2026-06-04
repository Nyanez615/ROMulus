import { ArrowUp, ArrowDown } from "lucide-react";
import type { SortDir } from "@/lib/romUtils";

interface SortControlProps<T extends string> {
  fields: readonly { value: T; label: string }[];
  field: T;
  dir: SortDir;
  onField: (f: T) => void;
  onDir: (d: SortDir) => void;
}

export function SortControl<T extends string>({ fields, field, dir, onField, onDir }: SortControlProps<T>) {
  return (
    <div className="flex items-center">
      <select
        value={field}
        onChange={(e) => onField(e.target.value as T)}
        className="h-8 px-2 rounded-l border border-border bg-card text-xs text-foreground border-r-0"
      >
        {fields.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <button
        onClick={() => onDir(dir === "asc" ? "desc" : "asc")}
        aria-label="Sort direction"
        className="h-8 px-1.5 rounded-r border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {dir === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
