"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getDeviceName, subscribeToDeviceName } from "@/lib/cliplink/device";
import type { PeerId, SignalPayload } from "@/lib/cliplink/types";

type PresenceOptions = {
  /** This page load's own id, which a name is announced under. */
  peerId: PeerId;
  sendSignal: (payload: SignalPayload, to?: PeerId) => boolean;
};

export type PresentDevice = {
  id: PeerId;
  /** Null for a peer that has not said, as a client older than names never will. */
  name: string | null;
};

/**
 * Which other devices are in the room, derived from the signaling traffic
 * that already exists — no new route, no Redis key, and nothing stored.
 *
 * `hello` is broadcast when a socket opens, but a peer that joined earlier and
 * has no open file offers had no reason to answer it. `hello-ack` is that
 * missing reply. `presence` carries a name the same two ways — broadcast on
 * joining, and sent back to whoever says hello — and is sealed like every
 * other signal, so the server relays names it cannot read.
 */
export function usePresence({ peerId, sendSignal }: PresenceOptions) {
  const [peers, setPeers] = useState<Map<PeerId, string | null>>(new Map());

  const announce = useCallback(
    (to?: PeerId) => {
      sendSignal({ type: "presence", name: getDeviceName(), peer: peerId }, to);
    },
    [peerId, sendSignal],
  );

  // A rename reaches the room at once rather than on the next reconnect.
  useEffect(() => subscribeToDeviceName(() => announce()), [announce]);

  const handleSignal = useCallback(
    (from: PeerId, payload: SignalPayload) => {
      if (payload.type === "peer-left") {
        setPeers((current) => {
          if (!current.has(from)) {
            return current;
          }
          const next = new Map(current);
          next.delete(from);
          return next;
        });
        return;
      }

      if (payload.type === "hello") {
        sendSignal({ type: "hello-ack" }, from);
        announce(from);
      }

      if (payload.type === "presence") {
        setPeers((current) =>
          current.get(from) === payload.name
            ? current
            : new Map(current).set(from, payload.name),
        );
        return;
      }

      // Any signal at all proves the peer is there.
      setPeers((current) =>
        current.has(from) ? current : new Map(current).set(from, null),
      );
    },
    [announce, sendSignal],
  );

  const reset = useCallback(() => setPeers(new Map()), []);

  const devices = useMemo<PresentDevice[]>(
    () => [...peers].map(([id, name]) => ({ id, name })),
    [peers],
  );

  // The count includes this device.
  return { deviceCount: peers.size + 1, devices, announce, handleSignal, reset };
}
