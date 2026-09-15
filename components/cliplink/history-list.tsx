"use client";

import { useState } from "react";

import {
  detectClipKind,
  formatHistoryTime,
  truncatePreview,
} from "@/lib/cliplink/format";
import type { SessionClip } from "@/lib/cliplink/types";
import { cn } from "@/lib/utils";

import { IconChevron } from "./icons";
import { panelSurfaceStyle, rowClass } from "./ui";

const rowActionClass =
  "inline-flex min-h-11 items-center rounded-lg border border-transparent px-2 text-2xs text-muted-foreground transition-[color,border-color,background-color,scale] duration-150 ease-out hover:border-input hover:text-foreground focus-visible:border-input focus-visible:text-foreground active:scale-[0.96] active:bg-accent md:min-h-10 md:shrink-0";

/**
 * A clip only earns a disclosure control if there is something behind it.
 * `truncatePreview` cuts at 120 characters, and a newline is hidden by the
 * single-line clamp even when the text is short.
 */
function isExpandable(text: string) {
  return text.length > 120 || text.includes("\n");
}

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
      <div className="flex items-center gap-2 text-2xs text-muted-foreground uppercase">
        <span>History</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-1.5">
        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-input px-8 py-8 text-center text-xs text-muted-foreground">
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
  const expandable = isExpandable(clip.text);
  const open = expandable && expanded;

  return (
    <div
      className={cn(
        rowClass,
        incoming ? "border-l-2 border-l-primary" : "border-l-2 border-l-muted-foreground",
        arriving && "arrival-cue",
      )}
      style={panelSurfaceStyle}
    >
      <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
        <span
          className={cn(
            "text-2xs uppercase",
            incoming ? "text-link" : "text-muted-foreground",
          )}
        >
          {incoming ? "↓ IN" : "↑ OUT"}
        </span>
        <span className="text-2xs text-muted-foreground uppercase tabular-nums">
          {formatHistoryTime(clip.ts)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {expandable ? (
          // The whole content column is the target, not just the glyph. The
          // negative inset lets a 40px-tall hit area sit inside a tighter row
          // without pushing the row open.
          <button
            className="group -my-2 -ml-1.5 flex min-h-10 min-w-0 cursor-pointer items-start gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-2 text-left transition-colors duration-100 ease-out hover:bg-muted focus-visible:bg-muted active:bg-accent"
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <span
              className={cn(
                "mt-px shrink-0 text-muted-foreground transition-[rotate,color] duration-200 ease-out group-hover:text-foreground",
                // Hints the direction the content will open (down), rather
                // than only reporting the state after the fact.
                expanded && "rotate-90",
              )}
            >
              <IconChevron size={12} />
            </span>
            <span
              className={cn(
                "min-w-0 text-2xs text-muted-foreground md:text-xs",
                open ? "break-words whitespace-pre-wrap" : "truncate",
              )}
            >
              {open ? clip.text : truncatePreview(clip.text)}
            </span>
          </button>
        ) : (
          // No affordance where there is nothing to reveal. The 12px chevron
          // gutter is still reserved so every row's text starts on one line.
          <span className="min-w-0 truncate pl-[18px] text-2xs text-muted-foreground md:text-xs">
            {clip.text}
          </span>
        )}

        {detected.kind === "url" ? (
          // Collapses to zero height rather than unmounting, so the reveal has
          // something to animate between.
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out-quint)",
              open || !expandable
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <a
                className={cn(rowActionClass, "ml-[15px] mt-1")}
                href={detected.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                open link ↗
              </a>
            </div>
          </div>
        ) : null}
      </div>

      <button
        // The row aligns to the top, so a 40px box centring its label would
        // drop "copy" below the clip's first line. Same inset as the
        // disclosure control, so the two labels share a baseline.
        className={cn(
          rowActionClass,
          "col-start-2 mt-1 justify-self-start md:-my-2 md:mt-0 md:items-start md:py-2.5",
        )}
        type="button"
        aria-label="Copy this clip"
        onClick={onCopy}
      >
        copy
      </button>
    </div>
  );
}
