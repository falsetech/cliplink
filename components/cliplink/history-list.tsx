"use client";

import { useState } from "react";
import { ClipboardIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { detectClipKind, truncatePreview } from "@/lib/cliplink/format";
import type { SessionClip } from "@/lib/cliplink/types";
import { cn } from "@/lib/utils";

import { IconChevron } from "./icons";
import { DirectionLabel } from "./direction-label";
import { rowClass } from "./ui";

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
    <section className="flex flex-col gap-2">
      {/* Inset to the rows' own content edge, as grouped-list headers are. */}
      <h2 className="m-0 px-4 text-lg font-semibold text-foreground">History</h2>
      <div className="flex flex-col gap-2">
        {history.length === 0 ? (
          // No container: an empty state is a message, not a drop target.
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardIcon />
              </EmptyMedia>
              <EmptyTitle>No clips yet</EmptyTitle>
              <EmptyDescription>
                Anything sent from a device in this room shows up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
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
    </section>
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
    <div className={cn(rowClass, arriving && "arrival-cue")}>
      <DirectionLabel
        incoming={incoming}
        label={incoming ? "Received" : "Sent"}
        ts={clip.ts}
      />

      <div className="col-span-2 flex min-w-0 flex-1 flex-col md:col-span-1">
        {expandable ? (
          // The whole content column is the target, not just the glyph. The
          // negative inset lets a 40px-tall hit area sit inside a tighter row
          // without pushing the row open.
          <button
            className="group -my-1.5 -ml-2 flex min-h-10 min-w-0 cursor-pointer items-start gap-1.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left transition-colors duration-100 ease-out hover:bg-muted focus-visible:bg-muted active:bg-accent"
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <span
              className={cn(
                "mt-0.5 shrink-0 text-muted-foreground transition-[rotate,color] duration-200 ease-out group-hover:text-foreground",
                // Hints the direction the content will open (down), rather
                // than only reporting the state after the fact.
                expanded && "rotate-90",
              )}
            >
              <IconChevron size={14} />
            </span>
            <span
              className={cn(
                "min-w-0 text-sm text-foreground",
                open ? "wrap-break-word whitespace-pre-wrap" : "truncate",
              )}
            >
              {open ? clip.text : truncatePreview(clip.text)}
            </span>
          </button>
        ) : (
          // No affordance where there is nothing to reveal. The chevron
          // gutter is still reserved so every row's text starts on one line.
          <span className="min-w-0 truncate py-0.5 pl-5.5 text-sm text-foreground">
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
                className={cn(
                  buttonVariants({ variant: "link", size: "xs" }),
                  "ml-3.5 px-2",
                )}
                href={detected.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Link ↗
              </a>
            </div>
          </div>
        ) : null}
      </div>

      <Button
        className="col-start-2 row-start-1 justify-self-end text-link md:self-center"
        variant="ghost"
        size="sm"
        aria-label="Copy this clip"
        onClick={onCopy}
      >
        Copy
      </Button>
    </div>
  );
}
