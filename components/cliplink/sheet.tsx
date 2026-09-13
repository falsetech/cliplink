"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/** Must match the sheet-out animation in globals.css. */
const EXIT_MS = 220;
/** Below this the sheet is presented as a bottom sheet and can be dragged. */
const SHEET_QUERY = "(max-width: 639px)";
const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Apple's momentum projection (Designing Fluid Interfaces). Note this is the
 * exponential-decay form, not the v^2/2a from a physics textbook — the latter
 * does not match how scroll deceleration actually feels.
 */
function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a bound, so the edge reads as soft, not frozen. */
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}

const SheetCloseContext = createContext<() => void>(() => {});

/**
 * Dismisses the enclosing sheet, playing its exit animation first. Content
 * reaches it through context rather than a render prop so that closing over it
 * never happens during render.
 */
export function useSheetClose() {
  return useContext(SheetCloseContext);
}

type SheetProps = {
  open: boolean;
  /** Announced as the dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** Extra classes for the sheet surface, e.g. a wider `max-w-`. */
  className?: string;
  style?: React.CSSProperties;
  /** Content calls `useSheetClose()` to dismiss with the exit animation. */
  children: ReactNode;
};

/**
 * The app's one dialog primitive: scrim, enter/exit animation, Escape, a Tab
 * focus trap, focus restore, and drag-to-dismiss on phones.
 *
 * It deliberately handles only Escape and Tab. Arrow keys and printable
 * characters pass straight through, because the command palette lives inside a
 * sheet and needs both.
 */
export function Sheet({
  open,
  label,
  onClose,
  className,
  style,
  children,
}: SheetProps) {
  // `closing` keeps the sheet mounted through its exit animation. Deriving
  // visibility from `open || closing` avoids mirroring a prop into state, which
  // would mean a setState cascade on every open.
  const [closing, setClosing] = useState(false);
  const visible = open || closing;

  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<number | null>(null);

  // Drag state lives in refs: a pointermove that re-renders cannot stay glued
  // to the finger.
  const dragging = useRef(false);
  const grabOffset = useRef(0);
  const samples = useRef<Array<{ y: number; t: number }>>([]);

  const beginExit = useCallback(() => {
    if (exitTimer.current !== null) {
      return;
    }
    setClosing(true);
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setClosing(false);
      onClose();
    }, EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
      }
    };
  }, []);

  // Focus moves in on open and returns to the trigger on close, so a keyboard
  // user is never stranded behind the sheet.
  useEffect(() => {
    if (!visible) {
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        beginExit();
        return;
      }

      if (event.key !== "Tab" || !sheet) {
        return;
      }

      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [visible, beginExit]);

  function setSheetTransform(y: number) {
    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }
    sheet.style.transform = y === 0 ? "" : `translateY(${y}px)`;
    if (scrimRef.current) {
      const height = sheet.offsetHeight || 1;
      const fade = Math.max(0, 1 - Math.max(0, y) / height);
      scrimRef.current.style.opacity = y === 0 ? "" : String(fade);
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (!window.matchMedia(SHEET_QUERY).matches) {
      return;
    }

    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }

    dragging.current = true;
    // Respect where the sheet was grabbed; snapping to a fixed point would
    // break the illusion on the first frame.
    grabOffset.current = event.clientY;
    samples.current = [{ y: event.clientY, t: event.timeStamp }];
    sheet.dataset.dragging = "true";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) {
      return;
    }

    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }

    const delta = event.clientY - grabOffset.current;
    samples.current.push({ y: event.clientY, t: event.timeStamp });
    if (samples.current.length > 6) {
      samples.current.shift();
    }

    // Downward tracks the finger 1:1; upward resists, because there is nothing
    // above the sheet to reveal.
    const height = sheet.offsetHeight || 1;
    setSheetTransform(delta >= 0 ? delta : rubberband(delta, height));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;

    const sheet = sheetRef.current;
    if (sheet) {
      delete sheet.dataset.dragging;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);

    const history = samples.current;
    const last = history[history.length - 1];
    const first = history[0];
    const elapsed = last && first ? last.t - first.t : 0;
    const velocity = elapsed > 0 ? ((last.y - first.y) / elapsed) * 1000 : 0;

    const delta = (last?.y ?? grabOffset.current) - grabOffset.current;
    const height = sheet?.offsetHeight ?? 1;
    const projected = delta + project(velocity);

    // Velocity sign decides the outcome, not position — a fast flick from near
    // the top should still dismiss.
    if (velocity > 250 || projected > height / 2) {
      setSheetTransform(0);
      beginExit();
      return;
    }

    setSheetTransform(0);
  }

  if (!visible) {
    return null;
  }

  const state = closing ? "exiting" : "entering";

  return (
    <div
      className="fixed inset-0 z-80 flex items-end justify-center p-3 sm:items-center sm:p-6"
      role="presentation"
      onClick={beginExit}
    >
      <div
        ref={scrimRef}
        data-state={state}
        className={cn(
          "absolute inset-0 bg-(--scrim-bg) backdrop-blur-(--scrim-blur)",
          "data-[state=entering]:animate-[scrim-in_220ms_var(--ease-out-quint)_both]",
          "data-[state=exiting]:animate-[scrim-out_220ms_var(--ease-out-quint)_both]",
        )}
      />
      <div
        ref={sheetRef}
        data-state={state}
        data-motion="transform"
        className={cn(
          "relative flex w-full max-w-105 flex-col gap-4.5 rounded-t-sheet rounded-b-surface border border-line-strong p-4.5 shadow-modal",
          "sm:rounded-sheet sm:p-5",
          "origin-bottom sm:origin-center",
          "data-[state=entering]:animate-[sheet-in_280ms_var(--ease-out-quint)_both]",
          "data-[state=exiting]:animate-[sheet-out_220ms_var(--ease-out-quint)_both]",
          // A sheet under the finger must never lag behind it.
          "data-[dragging=true]:animate-none! data-[dragging=true]:transition-none!",
          className,
        )}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grabber: the affordance that promises the drag, on the surface that
            actually handles it. */}
        <div
          className="-mt-1 flex cursor-grab touch-none justify-center py-1 active:cursor-grabbing sm:hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        <SheetCloseContext value={beginExit}>{children}</SheetCloseContext>
      </div>
    </div>
  );
}
