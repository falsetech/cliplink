"use client";

import { useSyncExternalStore } from "react";

import { Kbd as UiKbd, KbdGroup } from "@/components/ui/kbd";
import {
  formatChord,
  isApplePlatform,
  type Chord,
} from "@/lib/cliplink/shortcuts";

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

export function Kbd({ chord, className }: { chord: Chord; className?: string }) {
  const apple = useApplePlatform();

  return (
    <KbdGroup className={className}>
      {formatChord(chord, apple).map((token, index) => (
        <UiKbd key={index}>{token}</UiKbd>
      ))}
    </KbdGroup>
  );
}
