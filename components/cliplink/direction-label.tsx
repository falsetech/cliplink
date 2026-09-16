import { formatHistoryTime } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconArrowDown, IconArrowUp } from "./icons";

/**
 * Which way a row travelled, and when. The arrow sits in a tinted circle —
 * blue for what arrived, grey for what this device sent — so direction reads
 * from shape and colour together rather than from a coloured stripe alone.
 */
export function DirectionLabel({
  incoming,
  label,
  ts,
}: {
  incoming: boolean;
  label: string;
  ts: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 md:w-28 md:shrink-0">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          incoming
            ? "bg-tint text-link"
            : "bg-secondary text-muted-foreground",
        )}
      >
        {incoming ? (
          <IconArrowDown size={14} weight="bold" />
        ) : (
          <IconArrowUp size={14} weight="bold" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatHistoryTime(ts)}
        </span>
      </span>
    </div>
  );
}
