"use client";

import { formatHistoryTime, truncatePreview } from "@/lib/cliplink/format";
import type { SessionClip } from "@/lib/cliplink/types";
import { cn } from "@/lib/utils";

import { panelSurfaceStyle, rowClass } from "./ui";

type HistoryListProps = {
  history: SessionClip[];
  arrivalId: number | null;
  enteringIds: Set<number>;
  onCopy: (text: string) => void;
};

export function HistoryList({
  history,
  arrivalId,
  enteringIds,
  onCopy,
}: HistoryListProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-2xs tracking-label-wide text-muted uppercase">
        <span>History</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex flex-col gap-1.5">
        {history.length === 0 ? (
          <div className="rounded-surface border border-dashed border-line-strong px-8 py-8 text-center text-xs tracking-label text-muted">
            No clips yet. Send something.
          </div>
        ) : (
          history.map((clip) => (
            // The grid wrapper lets a new row open the list rather than
            // teleporting every row beneath it down.
            <div
              key={clip.id}
              className={cn(
                "grid grid-rows-[1fr]",
                enteringIds.has(clip.id) &&
                  "animate-[row-enter_260ms_var(--ease-out-quint)_both]",
              )}
            >
              <div className="overflow-hidden">
                <div
                  className={cn(
                    rowClass,
                    clip.direction === "incoming"
                      ? "border-l-2 border-l-incoming-line"
                      : "border-l-2 border-l-muted",
                    arrivalId === clip.id && "arrival-cue",
                  )}
                  style={panelSurfaceStyle}
                >
                  <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
                    <span
                      className={cn(
                        "text-2xs tracking-label uppercase",
                        clip.direction === "incoming"
                          ? "text-incoming"
                          : "text-muted",
                      )}
                    >
                      {clip.direction === "incoming" ? "↓ IN" : "↑ OUT"}
                    </span>
                    <span className="text-2xs tracking-label text-muted uppercase tabular-nums">
                      {formatHistoryTime(clip.ts)}
                    </span>
                  </div>
                  <div className="min-w-0 truncate text-2xs text-dim md:text-xs">
                    {truncatePreview(clip.text)}
                  </div>
                  <button
                    className="col-start-2 mt-1 inline-flex min-h-11 items-center justify-self-start rounded-control border border-transparent px-2 text-2xs text-muted transition-[color,border-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] md:mt-0 md:min-h-10 md:shrink-0"
                    type="button"
                    aria-label="Copy this clip"
                    onClick={() => onCopy(clip.text)}
                  >
                    copy
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
