"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Kbd } from "./kbd";
import { Sheet, useSheetClose } from "./sheet";
import type { RoomAction } from "./room-actions";
import { panelSurfaceStyle } from "./ui";

type CommandPaletteProps = {
  open: boolean;
  actions: RoomAction[];
  onClose: () => void;
};

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Command palette"
      className="max-w-125 gap-3 p-3! sm:p-3!"
      style={panelSurfaceStyle}
    >
      <PaletteBody actions={actions} />
    </Sheet>
  );
}

function PaletteBody({ actions }: { actions: RoomAction[] }) {
  const close = useSheetClose();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Only runnable actions are offered. A palette that lists things it will
  // refuse to do is a worse answer than a shorter list.
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const runnable = actions.filter((action) => action.enabled);
    if (!needle) {
      return runnable;
    }
    return runnable.filter((action) =>
      [action.label, ...(action.keywords ?? [])].some((term) =>
        term.toLowerCase().includes(needle),
      ),
    );
  }, [actions, query]);

  const active = results[Math.min(highlight, results.length - 1)];

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, results.length]);

  function run(action: RoomAction | undefined) {
    if (!action) {
      return;
    }
    // Handed to the sheet rather than called here. `close()` only starts the
    // exit animation, so running the action on the next line opened its dialog
    // while the palette still held the focus trap — two dialogs at once, and
    // then the palette's own focus restore fired a frame later and dropped the
    // keyboard behind the new one.
    close(action.perform);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) {
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(
        (current) => (current + step + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  }

  return (
    <>
      <input
        className="min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition-colors duration-150 placeholder:text-muted focus:border-accent"
        type="text"
        data-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
        aria-label="Search actions"
        placeholder="Search actions…"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Actions"
        className="-mr-1 flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto pr-1"
      >
        {results.length === 0 ? (
          <p className="m-0 px-2 py-6 text-center text-xs text-muted">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          results.map((action, index) => (
            <div
              key={action.id}
              id={`${listId}-${action.id}`}
              role="option"
              aria-selected={index === highlight}
              data-active={index === highlight}
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-control px-2.5 text-xs transition-colors duration-100",
                index === highlight
                  ? "bg-accent-dim text-fg"
                  : "text-dim hover:bg-raised",
              )}
              onPointerMove={() => setHighlight(index)}
              onClick={() => run(action)}
            >
              <span className="min-w-0 truncate">{action.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-2xs tracking-label text-muted uppercase">
                  {action.group}
                </span>
                {action.chord ? <Kbd chord={action.chord} /> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
