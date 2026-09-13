"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Coarse ticking is enough until the end is close enough to watch. */
const SLOW_TICK_MS = 30_000;
const FAST_TICK_MS = 1_000;
const FAST_TICK_BELOW_MS = 60_000;

function tickFor(msRemaining: number) {
  return msRemaining <= FAST_TICK_BELOW_MS ? FAST_TICK_MS : SLOW_TICK_MS;
}

/**
 * Milliseconds until a room expires, or null when there is no known expiry —
 * an older server, or a storage backend that could not answer — so the caller
 * renders nothing rather than a wrong number.
 *
 * `expiresAt` is refreshed by the server on every write, so the value jumps
 * forward whenever anyone in the room sends a clip.
 *
 * The clock is read on every render rather than held in state. Held, it had to
 * be seeded once at mount — and this hook runs from the landing view onward, so
 * that seed was the moment the *page* opened, not the moment the room was
 * joined. A room entered after an hour on the landing page read an hour too
 * long until the first tick corrected it.
 */
export function useRoomExpiry(expiresAt: number | null) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (expiresAt === null) {
        return () => {};
      }

      // Captured so the nested scheduler keeps the non-null narrowing.
      const deadline = expiresAt;
      let timer: number | null = null;

      function schedule() {
        const left = Math.max(0, deadline - Date.now());
        if (left === 0) {
          return;
        }
        timer = window.setTimeout(() => {
          onChange();
          schedule();
        }, tickFor(left));
      }

      schedule();
      return () => {
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    },
    [expiresAt],
  );

  // Quantised to the tick it is displayed at, for two reasons. React compares
  // snapshots by identity on every render, so a raw `Date.now()` would never
  // settle. And rounding down means the countdown can lag the truth by up to
  // one tick but never claims more time than the room actually has.
  const getSnapshot = useCallback(() => {
    if (expiresAt === null) {
      return null;
    }
    const left = Math.max(0, expiresAt - Date.now());
    const tick = tickFor(left);
    return Math.floor(left / tick) * tick;
  }, [expiresAt]);

  // Nothing ticks during SSR, and a countdown rendered from server time would
  // be wrong by however long the document took to reach the browser.
  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
