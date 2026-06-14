import { useState } from "react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number | null;
  onChange?: (v: number | null) => void;
  size?: "sm" | "md";
  readOnly?: boolean;
}

export function StarRating({ value, onChange, size = "md", readOnly = false }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-4.5 h-4.5";
  const active = hovered ?? value;

  function handleClick(star: number) {
    if (readOnly || !onChange) return;
    // Click the current star → clear
    onChange(value === star ? null : star);
  }

  return (
    <div
      role={readOnly ? undefined : "radiogroup"}
      aria-label="Rating"
      className="flex items-center gap-0.5"
      onMouseLeave={() => !readOnly && setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role={readOnly ? undefined : "radio"}
          aria-checked={value === star}
          aria-label={`${star} star${star !== 1 ? "s" : ""}`}
          disabled={readOnly}
          onClick={(e) => { e.stopPropagation(); handleClick(star); }}
          onMouseEnter={() => !readOnly && setHovered(star)}
          className={cn(
            "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
            readOnly ? "cursor-default" : "cursor-pointer hover:scale-110 transition-transform",
            dim,
            (active !== null && star <= active) ? "text-amber-400" : "text-muted-foreground/30",
          )}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      ))}
    </div>
  );
}
