import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RomGroup } from "@/lib/bindings/RomGroup";

// ── Constants ─────────────────────────────────────────────────────────────────

// # first: title_normalized strips articles so numeric titles (007, 1942) sort
// before alphabetical ones, matching their position in the sorted list.
const LETTERS = ["#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
                 "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W",
                 "X", "Y", "Z"] as const;

type ScrubLetter = (typeof LETTERS)[number];

// ── Props ─────────────────────────────────────────────────────────────────────

interface AlphabetScrubberProps {
  /** The sorted displayGroups array — used to build the letter → index map. */
  items: RomGroup[];
  /** Index of the first visible group; updated by VirtualRomList via onChange. */
  firstVisibleIndex: number;
  /** Called with the first group index for the chosen letter. */
  onJump: (index: number) => void;
  /** When true the strip is rendered Z→#→A so it mirrors a descending list. */
  reverseStrip: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AlphabetScrubber({ items, firstVisibleIndex, onJump, reverseStrip }: AlphabetScrubberProps) {
  const displayLetters = reverseStrip ? [...LETTERS].reverse() : LETTERS;
  // Map each letter to the index of the first matching group and its count.
  const letterMap = useMemo(() => {
    const map = new Map<ScrubLetter, { firstIndex: number; count: number }>();
    items.forEach((g, i) => {
      const ch = g.title_normalized[0] ?? "";
      const key: ScrubLetter = ch >= "a" && ch <= "z" ? (ch.toUpperCase() as ScrubLetter) : "#";
      const entry = map.get(key);
      if (!entry) map.set(key, { firstIndex: i, count: 1 });
      else entry.count++;
    });
    return map;
  }, [items]);

  // Derive the active letter from the first currently-visible group.
  const activeLetter = useMemo((): ScrubLetter => {
    const ch = items[firstVisibleIndex]?.title_normalized[0] ?? "";
    return ch >= "a" && ch <= "z" ? (ch.toUpperCase() as ScrubLetter) : "#";
  }, [items, firstVisibleIndex]);

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Alphabet navigation"
        className="flex flex-col items-center justify-center w-6 py-1 gap-[1px] select-none shrink-0 border-r border-border/30"
      >
        {displayLetters.map((letter) => {
          const entry = letterMap.get(letter);
          const hasEntries = entry !== undefined;
          const isActive = activeLetter === letter && hasEntries;

          return (
            <Tooltip key={letter}>
              <TooltipTrigger asChild>
                <button
                  disabled={!hasEntries}
                  onClick={() => entry && onJump(entry.firstIndex)}
                  aria-label={
                    hasEntries
                      ? `Jump to ${letter} — ${entry.count} ${entry.count === 1 ? "title" : "titles"}`
                      : `${letter} — no titles`
                  }
                  className={cn(
                    "w-3.5 h-3 flex items-center justify-center rounded text-[8px] font-medium leading-none motion-safe:transition-colors",
                    isActive
                      ? "bg-primary/20 text-primary"
                      : hasEntries
                        ? "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                        : "text-muted-foreground/25 cursor-default pointer-events-none",
                  )}
                >
                  {letter}
                </button>
              </TooltipTrigger>
              {hasEntries && (
                <TooltipContent side="right" sideOffset={8} className="text-xs">
                  {letter} — {entry.count.toLocaleString()} {entry.count === 1 ? "title" : "titles"}
                </TooltipContent>
              )}
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
