import type { FileSignal, PeerId } from "@thebkht/rtc-file-transfer";

export type RoomCode = string;

export type Clip = {
  id: number;
  text: string;
  senderId: string;
  ts: number;
};

export type Room = {
  code: RoomCode;
  createdAt: number;
  /** The room's configured lifetime. Every write resets the clock to this. */
  ttlSeconds: number;
  /**
   * Fingerprint of the room key, or null for a room created before one was
   * set. One-way, so holding it lets the server tell a joiner their key is
   * wrong without being any closer to holding the key.
   */
  keyCheck: string | null;
  clips: Clip[];
};

export type SessionClipDirection = "incoming" | "outgoing";

export type SessionClip = Clip & {
  direction: SessionClipDirection;
};

export type RoomStatus = "offline" | "live" | "syncing" | "error";

export type ApiError = {
  error: string;
  code: string;
  details?: string;
};

export type CreateRoomRequest = {
  ttlSeconds?: number;
  /** Fingerprint of the key the creator generated. Never the key itself. */
  keyCheck?: string;
};

export type CreateRoomResponse = {
  code: RoomCode;
  ttlSeconds: number;
};

export type GetRoomResponse = {
  room: {
    code: RoomCode;
    createdAt: number;
    /**
     * The room's configured lifetime. Writes reset the expiry to this many
     * seconds out, which lets a client that sees someone else's clip arrive
     * recompute the new deadline without asking the server for it again.
     */
    ttlSeconds: number;
    /** Lets a joiner be told their key is wrong before any clip arrives. */
    keyCheck?: string;
    /**
     * When the room expires, in epoch ms. Optional so that a backend which
     * cannot answer degrades to hiding the countdown rather than failing.
     */
    expiresAt?: number;
  };
  clips: Clip[];
};

export type CreateClipRequest = {
  text: string;
  senderId: string;
};

export type CreateClipResponse = {
  clip: Clip;
  /** The refreshed expiry, since writing extends the room's TTL. */
  expiresAt?: number;
};

export type PollClipsResponse = {
  clips: Clip[];
};

export type StreamDisconnectReason = "error" | "closed";

export type {
  FileOffer,
  PeerId,
  RtcCandidate,
  RtcDescription,
} from "@thebkht/rtc-file-transfer";

/**
 * Ephemeral signaling messages relayed between peers over the room socket.
 * They are fanned out through Redis pub/sub and never persisted; file bytes
 * themselves travel peer-to-peer over WebRTC data channels.
 */
export type SignalPayload =
  | FileSignal
  /** Reply to `hello`, so a peer with no open offers still announces itself. */
  | { type: "hello-ack" };

/**
 * What the server relays. Sealed envelopes carry an encrypted `SignalPayload`
 * the server cannot read; `peer-left` is the one signal the server originates
 * itself, which is exactly why it cannot be sealed — the server has no key.
 * Keeping it a separate kind is honest about that, rather than letting one
 * message type sometimes be readable and sometimes not.
 */
export type SignalEnvelope =
  | { kind: "sealed"; from: PeerId; to?: PeerId; sealed: string }
  | { kind: "peer-left"; from: PeerId };

export type WsClientMessage = {
  type: "signal";
  to?: PeerId;
  sealed: string;
};

export type WsServerMessage =
  | { type: "ready" }
  | { type: "clip"; clip: Clip }
  | { type: "signal"; from: PeerId; sealed: string }
  | { type: "peer-left"; from: PeerId }
  | { type: "error"; reason: string };

/**
 * The wire side of the transport, which deals only in ciphertext: clip `text`
 * is sealed, and signals are opaque strings. `encrypted-transport.ts` adapts
 * one of these into the plaintext `TransportClient` the UI consumes, so the
 * UI's retry and backoff state machine never learns that encryption happened.
 */
export type SealedTransport = {
  connect: (roomCode: RoomCode) => Promise<GetRoomResponse>;
  sendClip: (
    roomCode: RoomCode,
    payload: CreateClipRequest,
  ) => Promise<CreateClipResponse>;
  pollClips: (roomCode: RoomCode, afterId: number) => Promise<PollClipsResponse>;
  streamClips: (
    roomCode: RoomCode,
    afterId: number,
    peerId: PeerId,
    handlers: {
      onOpen?: () => void;
      onClips: (clips: Clip[]) => void;
      onSealedSignal?: (from: PeerId, sealed: string) => void;
      /** Server-originated, and so the one signal that arrives unsealed. */
      onPeerLeft?: (from: PeerId) => void;
      onDisconnect: (reason: StreamDisconnectReason) => void;
    },
  ) => (() => void) | null;
  /** Synchronous, so a caller can know there is a socket before it seals. */
  canSend: () => boolean;
  sendSealedSignal: (sealed: string, to?: PeerId) => boolean;
  disconnect: () => void;
};

export type TransportClient = {
  connect: (roomCode: RoomCode) => Promise<GetRoomResponse>;
  sendClip: (
    roomCode: RoomCode,
    payload: CreateClipRequest,
  ) => Promise<CreateClipResponse>;
  pollClips: (roomCode: RoomCode, afterId: number) => Promise<PollClipsResponse>;
  streamClips: (
    roomCode: RoomCode,
    afterId: number,
    peerId: PeerId,
    handlers: {
      onOpen?: () => void;
      onClips: (clips: Clip[]) => void;
      onSignal?: (from: PeerId, payload: SignalPayload) => void;
      onDisconnect: (reason: StreamDisconnectReason) => void;
    },
  ) => (() => void) | null;
  /** Returns false when there is no open realtime socket to carry the signal. */
  sendSignal: (payload: SignalPayload, to?: PeerId) => boolean;
  disconnect: () => void;
};
