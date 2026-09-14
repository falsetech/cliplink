/** Opaque id of a peer, as known to your signaling layer. */
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
 * Protocol v1: the messages a manager exchanges through your signaling
 * channel. They are small JSON-safe objects; file bytes never travel here,
 * only over the WebRTC data channel the handshake sets up.
 *
 * `peer-left` is the one message a peer never sends. Your signaling layer
 * produces it when it notices a peer disconnect, and should drop it if it
 * arrives from a peer — `parseFileSignal` does.
 */
export type FileSignal =
  | { type: "hello" }
  | ({ type: "file-offer" } & FileOffer)
  | { type: "file-revoke"; offerId: string }
  | { type: "peer-left" }
  | { type: "file-request"; offerId: string; transferId: string }
  | { type: "rtc-description"; transferId: string; description: RtcDescription }
  | { type: "rtc-candidate"; transferId: string; candidate: RtcCandidate }
  | { type: "transfer-cancel"; transferId: string; reason: string };
