import { Disc3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiscBadgeProps {
  count: number;
  className?: string;
}

export function DiscBadge({ count, className }: DiscBadgeProps) {
  if (count <= 1) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs",
        "bg-indigo-600/20 text-indigo-300 border border-indigo-600/40",
        className,
      )}
    >
      <Disc3 className="w-3 h-3" />
      {count}
    </span>
  );
}
