"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";

import { Kbd } from "./kbd";
import { Sheet, useSheetClose } from "./sheet";
import type { RoomAction } from "./room-actions";

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
      className="max-w-lg gap-2 p-2! sm:p-2!"
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
      <Input
        className="h-11 rounded-xl border-0 bg-transparent px-3 text-base focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0 pointer-coarse:h-11 md:text-base"
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
        className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto border-t border-border pt-2"
      >
        {results.length === 0 ? (
          <p className="m-0 px-2 py-6 text-center text-sm text-muted-foreground">
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
                // The highlight follows the pointer and the arrows alike, so it
                // is the only hover state: selection in the macOS manner.
                "group/option flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm",
                index === highlight
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground",
              )}
              onPointerMove={() => setHighlight(index)}
              onClick={() => run(action)}
            >
              <span className="min-w-0 truncate">{action.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "text-xs",
                    index === highlight
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {action.group}
                </span>
                {action.chord ? (
                  <Kbd
                    chord={action.chord}
                    className={cn(
                      index === highlight &&
                        "*:bg-primary-foreground/20 *:text-primary-foreground *:shadow-none",
                    )}
                  />
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
