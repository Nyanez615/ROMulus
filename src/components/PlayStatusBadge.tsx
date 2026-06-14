import { cn } from "@/lib/utils";
import type { PlayStatus } from "@/lib/tauri";

const STATUS_STYLES: Record<PlayStatus, string> = {
  backlog:   "bg-purple-500/15 text-purple-400 border-purple-500/30",
  testing:   "bg-amber-500/15  text-amber-400  border-amber-500/30",
  playing:   "bg-blue-500/15   text-blue-400   border-blue-500/30",
  completed: "bg-green-500/15  text-green-400  border-green-500/30",
  dropped:   "bg-muted/30      text-muted-foreground border-border",
};

const STATUS_LABEL: Record<PlayStatus, string> = {
  backlog:   "Backlog",
  testing:   "Testing",
  playing:   "Playing",
  completed: "Completed",
  dropped:   "Dropped",
};

interface PlayStatusBadgeProps {
  status: PlayStatus;
  className?: string;
}

export function PlayStatusBadge({ status, className }: PlayStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
