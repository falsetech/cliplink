"use client";

import { useState } from "react";

import {
  detectClipKind,
  formatHistoryTime,
  truncatePreview,
} from "@/lib/cliplink/format";
import type { SessionClip } from "@/lib/cliplink/types";
import { cn } from "@/lib/utils";

import { panelSurfaceStyle, rowClass } from "./ui";

const rowActionClass =
  "inline-flex min-h-11 items-center rounded-control border border-transparent px-2 text-2xs text-muted transition-[color,border-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] md:min-h-10 md:shrink-0";

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
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
                <HistoryRow
                  clip={clip}
                  expanded={expandedId === clip.id}
                  arriving={arrivalId === clip.id}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === clip.id ? null : clip.id,
                    )
                  }
                  onCopy={() => onCopy(clip.text)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  clip,
  expanded,
  arriving,
  onToggle,
  onCopy,
}: {
  clip: SessionClip;
  expanded: boolean;
  arriving: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const incoming = clip.direction === "incoming";
  const detected = detectClipKind(clip.text);

  return (
    <div
      className={cn(
        rowClass,
        incoming ? "border-l-2 border-l-incoming-line" : "border-l-2 border-l-muted",
        arriving && "arrival-cue",
        // The expanded body spans the full width, so the row stops being a
        // single line and becomes a block on every breakpoint.
        expanded && "md:grid md:grid-cols-[64px_1fr]",
      )}
      style={panelSurfaceStyle}
    >
      <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
        <span
          className={cn(
            "text-2xs tracking-label uppercase",
            incoming ? "text-incoming" : "text-muted",
          )}
        >
          {incoming ? "↓ IN" : "↑ OUT"}
        </span>
        <span className="text-2xs tracking-label text-muted uppercase tabular-nums">
          {formatHistoryTime(clip.ts)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button
          className={cn(
            "min-w-0 cursor-pointer rounded-control border-0 bg-transparent p-0 text-left text-2xs text-dim transition-colors duration-150 hover:text-fg focus-visible:text-fg md:text-xs",
            !expanded && "truncate",
          )}
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse this clip" : "Expand this clip"}
          onClick={onToggle}
        >
          {expanded ? (
            <span className="block break-words whitespace-pre-wrap">
              {clip.text}
            </span>
          ) : (
            truncatePreview(clip.text)
          )}
        </button>

        {expanded && detected.kind === "url" ? (
          <a
            className={cn(rowActionClass, "self-start")}
            href={detected.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            open link ↗
          </a>
        ) : null}
      </div>

      <button
        className={cn(rowActionClass, "col-start-2 mt-1 justify-self-start md:mt-0")}
        type="button"
        aria-label="Copy this clip"
        onClick={onCopy}
      >
        copy
      </button>
    </div>
  );
}
