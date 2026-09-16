import type { FileTransferManager } from "./manager.ts";
import { parseFileSignal, type ParseLimits } from "./parse.ts";
import type { FileSignal, PeerId } from "./protocol.ts";

/**
 * Signaling adapters: the glue between a manager and a transport you already
 * have. Each one returns the `sendSignal` to create the manager with, and a
 * `connect` that feeds the transport's messages into it.
 *
 * ```ts
 * const signaling = trysteroSignaling(room, selfId);
 * const files = createFileTransferManager({ peerId: selfId, sendSignal: signaling.sendSignal, ... });
 * const detach = signaling.connect(files);
 * ```
 *
 * `connect` validates every inbound signal with `parseFileSignal`, drops
 * signals addressed to someone else, tells the manager when a peer leaves
 * (where the transport knows), and announces once the transport is ready.
 *
 * The types below describe only the parts of each library an adapter uses, so
 * this module imports none of them.
 */

export type SignalingAdapter = {
  sendSignal: (payload: FileSignal, to?: PeerId) => boolean;
  /** Starts delivering signals to `manager`. Returns a function that stops. */
  connect: (manager: Pick<FileTransferManager, "handleSignal" | "announce">) => () => void;
};

export type AdapterOptions = {
  /** Passed to `parseFileSignal` for every inbound signal. */
  parseLimits?: Partial<ParseLimits>;
};

type Manager = Parameters<SignalingAdapter["connect"]>[0];

/** How signals travel on transports that carry other traffic too. */
const NAMESPACE = "rtc-file-transfer";

type Envelope = { [NAMESPACE]: { from: PeerId; to?: PeerId; payload?: unknown; left?: true } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The envelope's body, or null when the message isn't one of ours. */
function openEnvelope(value: unknown) {
  if (!isRecord(value) || !isRecord(value[NAMESPACE])) {
    return null;
  }
  const body = value[NAMESPACE];
  if (typeof body.from !== "string" || (body.to !== undefined && typeof body.to !== "string")) {
    return null;
  }
  return { from: body.from, to: body.to as PeerId | undefined, payload: body.payload, left: body.left === true };
}

function deliver(manager: Manager, from: PeerId, payload: unknown, options: AdapterOptions) {
  const signal = parseFileSignal(payload, options.parseLimits);
  if (signal) {
    manager.handleSignal(from, signal);
  }
}

/**
 * The shared shape of broadcast-style transports: every peer hears every
 * envelope and keeps the ones addressed to it or to everyone.
 */
function envelopeSignaling(
  peerId: PeerId,
  post: (envelope: Envelope) => boolean,
  subscribe: (onMessage: (message: unknown) => void) => () => void,
  options: AdapterOptions,
  ready: (announce: () => void) => () => void = (announce) => {
    announce();
    return () => {};
  },
): SignalingAdapter & { post: typeof post } {
  return {
    post,
    sendSignal: (payload, to) => post({ [NAMESPACE]: { from: peerId, to, payload } }),
    connect(manager) {
      const unsubscribe = subscribe((message) => {
        const envelope = openEnvelope(message);
        if (!envelope || envelope.from === peerId) {
          return;
        }
        if (envelope.to !== undefined && envelope.to !== peerId) {
          return;
        }
        if (envelope.left) {
          manager.handleSignal(envelope.from, { type: "peer-left" });
          return;
        }
        deliver(manager, envelope.from, envelope.payload, options);
      });
      const stopReady = ready(() => manager.announce());
      return () => {
        stopReady();
        unsubscribe();
      };
    },
  };
}

// -----------------------------------------------------------------------------
// WebSocket

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  addEventListener(type: "open" | "message", listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: "open" | "message", listener: (event: { data?: unknown }) => void): void;
};

/**
 * Over a WebSocket whose server relays each JSON message to the other peers in
 * the room. Messages are `{"rtc-file-transfer":{from,to,payload}}`, so they can
 * share the socket with your own traffic.
 *
 * The server knows when a peer disconnects and this adapter doesn't: call
 * `manager.handleSignal(peerId, { type: "peer-left" })` when it tells you.
 */
export function webSocketSignaling(
  socket: WebSocketLike,
  peerId: PeerId,
  options: AdapterOptions = {},
): SignalingAdapter {
  const OPEN = 1;
  return envelopeSignaling(
    peerId,
    (envelope) => {
      if (socket.readyState !== OPEN) {
        return false;
      }
      socket.send(JSON.stringify(envelope));
      return true;
    },
    (onMessage) => {
      const listener = (event: { data?: unknown }) => {
        if (typeof event.data !== "string") {
          return;
        }
        try {
          onMessage(JSON.parse(event.data));
        } catch {
          // not JSON, not ours
        }
      };
      socket.addEventListener("message", listener);
      return () => socket.removeEventListener("message", listener);
    },
    options,
    (announce) => {
      if (socket.readyState === OPEN) {
        announce();
        return () => {};
      }
      socket.addEventListener("open", announce);
      return () => socket.removeEventListener("open", announce);
    },
  );
}

// -----------------------------------------------------------------------------
// BroadcastChannel

export type BroadcastChannelLike = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
};

/**
 * Between tabs of the same origin, for demos and same-device sync. A tab says
 * goodbye when it detaches or the page is hidden for good, so the others drop
 * its offers.
 */
export function broadcastChannelSignaling(
  channel: BroadcastChannelLike,
  peerId: PeerId,
  options: AdapterOptions = {},
): SignalingAdapter {
  const adapter = envelopeSignaling(
    peerId,
    (envelope) => {
      try {
        channel.postMessage(envelope);
        return true;
      } catch {
        return false;
      }
    },
    (onMessage) => {
      const listener = (event: { data: unknown }) => onMessage(event.data);
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    options,
    (announce) => {
      announce();
      const leave = () => adapter.post({ [NAMESPACE]: { from: peerId, left: true } });
      const onPageHide = (event: Event) => {
        if (!(event as PageTransitionEvent).persisted) {
          leave();
        }
      };
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", onPageHide);
      }
      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("pagehide", onPageHide);
        }
        leave();
      };
    },
  );
  return adapter;
}

// -----------------------------------------------------------------------------
// Supabase Realtime

export type SupabaseChannelLike = {
  send(message: { type: "broadcast"; event: string; payload: unknown }): unknown;
  on(
    type: "broadcast",
    filter: { event: string },
    callback: (message: { payload?: unknown }) => void,
  ): unknown;
};

/**
 * Over a subscribed Supabase Realtime channel, as broadcast events named
 * `rtc-file-transfer`. Connect once the channel's `subscribe` callback reports
 * `SUBSCRIBED`.
 *
 * Supabase channels can't remove a single listener, so detaching mutes this
 * one instead. For departures, track presence and call
 * `manager.handleSignal(peerId, { type: "peer-left" })` on `leave`.
 */
export function supabaseSignaling(
  channel: SupabaseChannelLike,
  peerId: PeerId,
  options: AdapterOptions = {},
): SignalingAdapter {
  let listener: ((message: unknown) => void) | null = null;
  let registered = false;
  return envelopeSignaling(
    peerId,
    (envelope) => {
      void Promise.resolve(
        channel.send({ type: "broadcast", event: NAMESPACE, payload: envelope }),
      ).catch(() => {});
      return true;
    },
    (onMessage) => {
      listener = onMessage;
      if (!registered) {
        registered = true;
        channel.on("broadcast", { event: NAMESPACE }, (message) => listener?.(message.payload));
      }
      return () => {
        listener = null;
      };
    },
    options,
  );
}

// -----------------------------------------------------------------------------
// Trystero

export type TrysteroRoomLike = {
  makeAction<T>(
    name: string,
  ): [
    (data: T, targetPeers?: string | string[] | null) => unknown,
    (receiver: (data: T, peerId: string) => void) => void,
    ...unknown[],
  ];
  onPeerJoin(callback: (peerId: string) => void): void;
  onPeerLeave(callback: (peerId: string) => void): void;
};

export type TrysteroOptions = AdapterOptions & {
  /** Action name, at most 12 bytes. Defaults to `rtcft`. */
  action?: string;
  /**
   * Register `onPeerJoin`/`onPeerLeave`. Trystero keeps one callback per room,
   * so pass false if your app sets its own, and call `peerJoined` and
   * `peerLeft` from them.
   */
  presence?: boolean;
};

/**
 * Over a Trystero room, as its own action. Trystero already routes to peers
 * and reports joins and leaves, so no envelope is needed.
 */
export function trysteroSignaling(
  room: TrysteroRoomLike,
  peerId: PeerId,
  options: TrysteroOptions = {},
): SignalingAdapter & { peerJoined(id: PeerId): void; peerLeft(id: PeerId): void } {
  const [send, receive] = room.makeAction<unknown>(options.action ?? "rtcft");
  let manager: Manager | null = null;

  receive((data, from) => {
    if (manager && from !== peerId) {
      deliver(manager, from, data, options);
    }
  });

  const peerJoined = () => manager?.announce();
  const peerLeft = (id: PeerId) => manager?.handleSignal(id, { type: "peer-left" });
  if (options.presence !== false) {
    room.onPeerJoin(peerJoined);
    room.onPeerLeave(peerLeft);
  }

  return {
    sendSignal(payload, to) {
      void Promise.resolve(send(payload, to ?? null)).catch(() => {});
      return true;
    },
    connect(next) {
      manager = next;
      next.announce();
      return () => {
        if (manager === next) {
          manager = null;
        }
      };
    },
    peerJoined,
    peerLeft,
  };
}

// -----------------------------------------------------------------------------
// PeerJS

export type PeerJsConnectionLike = {
  readonly peer: string;
  readonly open: boolean;
  send(data: unknown): unknown;
  on(event: "open" | "close" | "data", listener: (data?: unknown) => void): unknown;
  off(event: "open" | "close" | "data", listener: (data?: unknown) => void): unknown;
};

export type PeerJsPeerLike = {
  on(event: "connection", listener: (connection: PeerJsConnectionLike) => void): unknown;
  off(event: "connection", listener: (connection: PeerJsConnectionLike) => void): unknown;
  connect(peerId: string): PeerJsConnectionLike;
};

/**
 * Over PeerJS data connections, next to your own messages on them. Incoming
 * connections are picked up automatically; open outgoing ones with
 * `connectTo(id)`, or hand ones you opened yourself to `addConnection`.
 *
 * Create the manager with the id from PeerJS's `open` event.
 */
export function peerJsSignaling(
  peer: PeerJsPeerLike,
  options: AdapterOptions = {},
): SignalingAdapter & {
  connectTo(id: PeerId): PeerJsConnectionLike;
  addConnection(connection: PeerJsConnectionLike): void;
} {
  const connections = new Map<PeerId, PeerJsConnectionLike>();
  const cleanups = new Map<PeerJsConnectionLike, () => void>();
  let manager: Manager | null = null;

  function addConnection(connection: PeerJsConnectionLike) {
    if (cleanups.has(connection)) {
      return;
    }
    const remote = connection.peer;
    const onOpen = () => {
      connections.set(remote, connection);
      manager?.announce();
    };
    const onData = (data?: unknown) => {
      const envelope = openEnvelope(data);
      if (manager && envelope && !envelope.left) {
        // PeerJS already knows who sent it; the envelope's `from` is not trusted.
        deliver(manager, remote, envelope.payload, options);
      }
    };
    const onClose = () => {
      cleanup();
      if (connections.get(remote) === connection) {
        connections.delete(remote);
        manager?.handleSignal(remote, { type: "peer-left" });
      }
    };
    const cleanup = () => {
      connection.off("open", onOpen);
      connection.off("data", onData);
      connection.off("close", onClose);
      cleanups.delete(connection);
    };
    connection.on("open", onOpen);
    connection.on("data", onData);
    connection.on("close", onClose);
    cleanups.set(connection, cleanup);
    if (connection.open) {
      onOpen();
    }
  }

  peer.on("connection", addConnection);

  function sendTo(connection: PeerJsConnectionLike, payload: FileSignal) {
    try {
      connection.send({ [NAMESPACE]: { from: "", payload } });
      return true;
    } catch {
      return false;
    }
  }

  return {
    sendSignal(payload, to) {
      if (to !== undefined) {
        const connection = connections.get(to);
        return connection?.open ? sendTo(connection, payload) : false;
      }
      let sent = false;
      for (const connection of connections.values()) {
        if (connection.open) {
          sent = sendTo(connection, payload) || sent;
        }
      }
      return sent;
    },
    connect(next) {
      manager = next;
      next.announce();
      return () => {
        manager = null;
        peer.off("connection", addConnection);
        for (const cleanup of [...cleanups.values()]) {
          cleanup();
        }
        connections.clear();
      };
    },
    connectTo(id) {
      const connection = peer.connect(id);
      addConnection(connection);
      return connection;
    },
    addConnection,
  };
}

// -----------------------------------------------------------------------------
// simple-peer

export type SimplePeerLike = {
  readonly connected: boolean;
  send(data: string): void;
  on(event: "connect" | "close" | "data", listener: (data?: unknown) => void): unknown;
  removeListener(event: "connect" | "close" | "data", listener: (data?: unknown) => void): unknown;
};

/**
 * Over one simple-peer connection to `remoteId`, next to your own messages on
 * it. simple-peer is one-to-one, so make one adapter per connection and one
 * manager per adapter, or route several adapters into a manager of your own.
 */
export function simplePeerSignaling(
  peer: SimplePeerLike,
  remoteId: PeerId,
  options: AdapterOptions = {},
): SignalingAdapter {
  const decoder = new TextDecoder();
  return {
    sendSignal(payload, to) {
      if (!peer.connected || (to !== undefined && to !== remoteId)) {
        return false;
      }
      try {
        peer.send(JSON.stringify({ [NAMESPACE]: { from: "", payload } }));
        return true;
      } catch {
        return false;
      }
    },
    connect(manager) {
      const onData = (data?: unknown) => {
        const text =
          typeof data === "string"
            ? data
            : data instanceof Uint8Array
              ? decoder.decode(data)
              : null;
        if (text === null || !text.startsWith(`{"${NAMESPACE}"`)) {
          return;
        }
        try {
          const envelope = openEnvelope(JSON.parse(text));
          if (envelope && !envelope.left) {
            deliver(manager, remoteId, envelope.payload, options);
          }
        } catch {
          // not ours
        }
      };
      const onConnect = () => manager.announce();
      const onClose = () => manager.handleSignal(remoteId, { type: "peer-left" });
      peer.on("data", onData);
      peer.on("connect", onConnect);
      peer.on("close", onClose);
      if (peer.connected) {
        onConnect();
      }
      return () => {
        peer.removeListener("data", onData);
        peer.removeListener("connect", onConnect);
        peer.removeListener("close", onClose);
      };
    },
  };
}
