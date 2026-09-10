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
};

export type CreateRoomResponse = {
  code: RoomCode;
  ttlSeconds: number;
};

export type GetRoomResponse = {
  room: {
    code: RoomCode;
    createdAt: number;
  };
  clips: Clip[];
};

export type CreateClipRequest = {
  text: string;
  senderId: string;
};

export type CreateClipResponse = {
  clip: Clip;
};

export type PollClipsResponse = {
  clips: Clip[];
};

export type StreamDisconnectReason = "error" | "closed";

export type PeerId = string;

export type FileOffer = {
  offerId: string;
  name: string;
  size: number;
  mime: string;
};

export type RtcDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type RtcCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/**
 * Ephemeral signaling messages relayed between peers over the room socket.
 * They are fanned out through Redis pub/sub and never persisted; file bytes
 * themselves travel peer-to-peer over WebRTC data channels.
 */
export type SignalPayload =
  | { type: "hello" }
  | ({ type: "file-offer" } & FileOffer)
  | { type: "file-revoke"; offerId: string }
  | { type: "peer-left" }
  | { type: "file-request"; offerId: string; transferId: string }
  | { type: "rtc-description"; transferId: string; description: RtcDescription }
  | { type: "rtc-candidate"; transferId: string; candidate: RtcCandidate }
  | { type: "transfer-cancel"; transferId: string; reason: string };

export type SignalEnvelope = {
  from: PeerId;
  to?: PeerId;
  payload: SignalPayload;
};

export type WsClientMessage = {
  type: "signal";
  to?: PeerId;
  payload: SignalPayload;
};

export type WsServerMessage =
  | { type: "ready" }
  | { type: "clip"; clip: Clip }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "error"; reason: string };

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
