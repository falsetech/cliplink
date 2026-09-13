"use client";

import { useEffect, useState } from "react";

/** Coarse ticking is enough until the end is close enough to watch. */
const SLOW_TICK_MS = 30_000;
const FAST_TICK_MS = 1_000;
const FAST_TICK_BELOW_MS = 60_000;

/**
 * Milliseconds until a room expires, or null when there is no known expiry —
 * an older server, or a storage backend that could not answer — so the caller
 * renders nothing rather than a wrong number.
 *
 * `expiresAt` is refreshed by the server on every write, so the value jumps
 * forward whenever anyone in the room sends a clip.
 */
export function useRoomExpiry(expiresAt: number | null) {
  // The clock is the state; the remainder is derived. Storing the remainder
  // instead would mean seeding it from an effect on every change of room.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === null) {
      return;
    }

    let timer: number | null = null;

    function schedule() {
      const left = Math.max(0, expiresAt! - Date.now());
      if (left === 0) {
        return;
      }
      timer = window.setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        left <= FAST_TICK_BELOW_MS ? FAST_TICK_MS : SLOW_TICK_MS,
      );
    }

    schedule();
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [expiresAt]);

  return expiresAt === null ? null : Math.max(0, expiresAt - now);
}
