"use client";

import { useCallback, useState } from "react";

import type { PeerId, SignalPayload } from "@/lib/cliplink/types";

type PresenceOptions = {
  sendSignal: (payload: SignalPayload, to?: PeerId) => boolean;
};

/**
 * How many other devices are in the room, derived from the signaling traffic
 * that already exists — no new route, no Redis key, and nothing stored.
 *
 * `hello` is broadcast when a socket opens, but a peer that joined earlier and
 * has no open file offers had no reason to answer it. `hello-ack` is that
 * missing reply, and is the only addition to the protocol.
 */
export function usePresence({ sendSignal }: PresenceOptions) {
  const [peers, setPeers] = useState<Set<PeerId>>(new Set());

  const handleSignal = useCallback(
    (from: PeerId, payload: SignalPayload) => {
      if (payload.type === "peer-left") {
        setPeers((current) => {
          if (!current.has(from)) {
            return current;
          }
          const next = new Set(current);
          next.delete(from);
          return next;
        });
        return;
      }

      if (payload.type === "hello") {
        sendSignal({ type: "hello-ack" }, from);
      }

      // Any signal at all proves the peer is there.
      setPeers((current) =>
        current.has(from) ? current : new Set(current).add(from),
      );
    },
    [sendSignal],
  );

  const reset = useCallback(() => setPeers(new Set()), []);

  // The count includes this device.
  return { deviceCount: peers.size + 1, handleSignal, reset };
}
