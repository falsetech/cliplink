"use client";

import { useSyncExternalStore } from "react";

import {
  formatChord,
  isApplePlatform,
  type Chord,
} from "@/lib/cliplink/shortcuts";
import { cn } from "@/lib/utils";

const subscribeToNothing = () => () => {};

/**
 * Platform detection is client-only, so it renders as non-Apple on the server
 * and on the first client pass. Hydration then swaps `Ctrl` for `⌘` in place.
 */
export function useApplePlatform() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => isApplePlatform(),
    () => false,
  );
}

const keyClass =
  "inline-flex min-w-5 items-center justify-center rounded-[4px] border border-line-strong px-1 py-px font-mono text-2xs text-dim";

export function Kbd({ chord, className }: { chord: Chord; className?: string }) {
  const apple = useApplePlatform();

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {formatChord(chord, apple).map((token, index) => (
        <kbd key={index} className={keyClass}>
          {token}
        </kbd>
      ))}
    </span>
  );
}

/** For literal keys that are not registry actions, e.g. the editor's Enter hint. */
export function KbdKey({ children }: { children: React.ReactNode }) {
  return <kbd className={keyClass}>{children}</kbd>;
}
