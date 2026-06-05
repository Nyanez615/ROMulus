import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RomGroup } from "@/lib/bindings/RomGroup";

interface VariantCountScrubberProps {
  /** The sorted displayGroups array — used to build the count → index map. */
  items: RomGroup[];
  /** Index of the first visible group; updated by VirtualRomList via onChange. */
  firstVisibleIndex: number;
  /** Called with the first group index for the chosen count. */
  onJump: (index: number) => void;
  /** Controls display order: desc = highest count at top (matches "most variants first"). */
  sortDir: "asc" | "desc";
}

export function VariantCountScrubber({ items, firstVisibleIndex, onJump, sortDir }: VariantCountScrubberProps) {
  // Map each distinct variant count to the first matching group index and how many titles share it.
  const countMap = useMemo(() => {
    const map = new Map<number, { firstIndex: number; titleCount: number }>();
    items.forEach((g, i) => {
      const n = g.variants.length;
      const entry = map.get(n);
      if (!entry) map.set(n, { firstIndex: i, titleCount: 1 });
      else entry.titleCount++;
    });
    return map;
  }, [items]);

  // Counts ordered to match the list — desc = highest first, asc = lowest first.
  const displayCounts = useMemo(() => {
    const counts = [...countMap.keys()];
    return sortDir === "desc"
      ? counts.sort((a, b) => b - a)
      : counts.sort((a, b) => a - b);
  }, [countMap, sortDir]);

  const activeCount = items[firstVisibleIndex]?.variants.length ?? null;

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Variant count navigation"
        className="flex flex-col items-center justify-center w-6 py-1 gap-[1px] select-none shrink-0 border-r border-border/30"
      >
        {displayCounts.map((count) => {
          const entry = countMap.get(count)!;
          const isActive = activeCount === count;

          return (
            <Tooltip key={count}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onJump(entry.firstIndex)}
                  aria-label={`Jump to ${count} ${count === 1 ? "variant" : "variants"} — ${entry.titleCount} ${entry.titleCount === 1 ? "title" : "titles"}`}
                  className={cn(
                    "w-3.5 h-3 flex items-center justify-center rounded text-[8px] font-medium leading-none motion-safe:transition-colors",
                    isActive
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer",
                  )}
                >
                  {count}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="text-xs">
                {count} {count === 1 ? "variant" : "variants"} — {entry.titleCount.toLocaleString()} {entry.titleCount === 1 ? "title" : "titles"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
