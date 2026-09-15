/** Opaque id of a peer, as known to your signaling layer. */
export type PeerId = string;

/**
 * Optional protocol features a peer supports. v1 peers send none and ignore
 * the fields that carry them, so a feature is used only when both sides
 * advertise it.
 *
 * - `blocks`: the sender follows every `BLOCK_BYTES` of data with a SHA-256
 *   digest of it, and the receiver verifies each block before keeping it.
 * - `resume`: the sender honors `offset` on `file-request`. Requires `blocks`,
 *   since only verified blocks are safe to resume after.
 */
export type Capability = "blocks" | "resume";

export const CAPABILITIES: readonly Capability[] = ["blocks", "resume"];

/** Size of a verified block. Resume offsets fall on these boundaries. */
export const BLOCK_BYTES = 1024 * 1024;

export type FileOffer = {
  offerId: string;
  name: string;
  size: number;
  mime: string;
  /** What the sender supports. Absent from v1 senders. */
  caps?: Capability[];
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
 * Fields marked optional were added after v1 shipped and carry
 * {@link Capability} negotiation; v1 peers never send them and drop them on
 * receipt.
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
  | {
      type: "file-request";
      offerId: string;
      transferId: string;
      /** What the receiver supports. Absent from v1 receivers. */
      caps?: Capability[];
      /** Resume from this byte. Only sent to senders that advertise `resume`. */
      offset?: number;
    }
  | { type: "rtc-description"; transferId: string; description: RtcDescription }
  | { type: "rtc-candidate"; transferId: string; candidate: RtcCandidate }
  | { type: "transfer-cancel"; transferId: string; reason: string };
