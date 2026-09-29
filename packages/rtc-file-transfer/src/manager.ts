import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_LIMITS,
  createRandomId,
  type TransferLimits,
} from "./defaults.ts";
import { sanitizeFileName, sanitizeRelativePath } from "./names.ts";
import {
  BLOCK_BYTES,
  CAPABILITIES,
  type Capability,
  type FileOffer,
  type FileSignal,
  type PeerId,
  type RtcCandidate,
} from "./protocol.ts";

export type FileItemStatus =
  | "offered"
  | "connecting"
  | "transferring"
  | "done"
  | "failed"
  | "paused"
  | "revoked";

export type FailureCode =
  /** No bytes moved for `limits.stallMs`. */
  | "stalled"
  /** ICE failed; usually a network that blocks peer-to-peer without TURN. */
  | "nat"
  /** The sender could not read its own file. */
  | "read-error"
  /** Offer/answer exchange failed. */
  | "negotiation"
  /** "done" arrived before the announced size. */
  | "incomplete"
  /** More bytes arrived than were announced. */
  | "overflow"
  /** This peer canceled its download. */
  | "canceled"
  /** The sender stopped sharing the file. */
  | "revoked"
  /** The sender disconnected before the download started. */
  | "sender-left"
  /** The data channel closed before the file finished. */
  | "closed"
  /** The receiver's `FileSink` threw while writing or closing. */
  | "write-error"
  /** A block failed its SHA-256 check. */
  | "corrupt"
  /** The file is over `limits.maxMemoryBytes` and `request` was given no sink. */
  | "needs-sink"
  /** Every block passed, but the file as a whole didn't match the offer's `digest`. */
  | "digest-mismatch"
  /** `pause` was called; the download keeps what it has verified. */
  | "paused"
  /** The other peer canceled; `message` is the reason it sent. */
  | "remote-canceled";

/**
 * One device's progress pulling an outgoing file. An offer can be pulled by
 * several receivers at once, each at its own pace, so a single number on the
 * item would have to pick one of them and be wrong about the rest.
 */
export type OutgoingTransfer = {
  /** The device pulling the file. */
  peerId: PeerId;
  /**
   * Bytes this receiver has taken. Where both peers negotiated `flow` this is
   * what the receiver has committed, which is what it actually has; otherwise
   * it is what the sender has handed to the data channel, which may still be
   * buffered locally.
   */
  bytes: number;
  /** Whether `bytes` is the receiver's committed count or the sender's sent count. */
  committed: boolean;
  /** Smoothed send rate, while transferring. */
  bytesPerSecond?: number;
  /** Estimated time left at `bytesPerSecond`, while transferring. */
  etaMs?: number;
};

/**
 * One peer offering an item's exact content, as told apart by its `digest`.
 *
 * Several devices in a room can hold the same file, and each announces it
 * under its own offer id. They are one row to the person looking at them, so
 * they are one item here, with the peers behind it listed.
 */
export type ItemSource = {
  peerId: PeerId;
  offerId: string;
  /**
   * Verified bytes this peer can serve, which is `size` for a complete file.
   * A peer that holds only a prefix says so in its offer.
   */
  have: number;
  /** What that peer supports; `item.caps` mirrors the active source's. */
  caps?: Capability[];
};

export type FileItem = FileOffer & {
  /** Unique per sender: `${peerId}:${offerId}`. */
  id: string;
  direction: "incoming" | "outgoing";
  /** The sending peer (this peer for outgoing items). */
  peerId: PeerId;
  ts: number;
  status: FileItemStatus;
  /** Bytes received so far (incoming only). */
  bytes: number;
  /**
   * Assembled file once an incoming transfer completes into the default
   * in-memory sink, or into a custom sink whose `close` returned a Blob.
   */
  blob?: Blob;
  /** The download completed into a custom sink that kept the bytes itself. */
  savedToSink?: boolean;
  /**
   * Verified bytes a failed download kept (incoming only). `request` picks up
   * from here instead of starting over, into the same sink.
   */
  resumableBytes?: number;
  error?: string;
  errorCode?: FailureCode;
  /** Smoothed receive rate (incoming, while transferring). */
  bytesPerSecond?: number;
  /** Estimated time left at `bytesPerSecond` (incoming, while transferring). */
  etaMs?: number;
  /**
   * Bytes hashed so far while preparing an offer's `digest` (outgoing only).
   * Reaches `size` when the digest is ready and the offer is re-announced.
   */
  hashedBytes?: number;
  /** Devices currently pulling / that finished pulling this file (outgoing only). */
  activeTransfers: number;
  completedTransfers: number;
  /**
   * Per-device progress for an outgoing file, one entry per device currently
   * pulling it, newest transfer last. Empty while nobody is pulling, and
   * absent on incoming items — those report their own progress in `bytes`.
   */
  outgoingTransfers?: OutgoingTransfer[];
  /**
   * This device is passing on a file it received rather than one it chose to
   * share (outgoing only), as created by `seed`.
   */
  seeded?: boolean;
  /**
   * Every peer offering this exact content (incoming only), in the order they
   * were heard from. `peerId`, `offerId` and `caps` mirror the first one: the
   * source a download uses. Absent on outgoing items.
   */
  sources?: ItemSource[];
};

/**
 * Where an incoming file's bytes go. `request` takes ownership: the manager
 * calls `close` once every byte has been written, or `abort` if the download
 * fails or never starts. Writes are serialized, and a sink that throws fails
 * the transfer with `write-error`.
 *
 * The receiver cannot slow the sender down, so bytes that arrive faster than
 * the sink writes them queue in memory.
 *
 * `@thebkht/rtc-file-transfer/sinks` has ready-made sinks for a file the user
 * picks, a folder, and the Origin Private File System.
 */
export type FileSink = {
  write(chunk: Uint8Array<ArrayBuffer>): void | Promise<void>;
  /** Return a Blob to expose it as `item.blob`. */
  close(): void | Blob | Promise<void | Blob>;
  abort(): void | Promise<void>;
};

export type OfferEntry = {
  file: File;
  /** Folder the file sits in, relative and `/`-separated. */
  path?: string;
};

export type OfferOptions = {
  /** Give every file in this call one `batchId`. */
  batch?: boolean;
  /**
   * Hash each file up front and re-announce the offer with a `digest`, so
   * receivers can check the whole file once it has arrived. Hashing runs in the
   * background and reports progress as `hashedBytes`; the file is offered
   * straight away either way.
   */
  digest?: boolean;
};

/**
 * What a paused or dropped download kept, enough to carry on after a reload:
 * how much is safely on disk, and the hash of every block behind it.
 */
export type ResumeState = {
  verifiedBytes: number;
  blockHashes: string[];
};

/** Identifies a file across page loads: its digest, plus what it is. */
export type ResumeKey = {
  /** The offer's `digest`; a file with the same content always has the same one. */
  digest: string;
  size: number;
  name: string;
  /**
   * The offer's `mime` and `path`. Absent from a key a caller built by hand;
   * the manager always fills them, so a store that keeps finished files has
   * everything an offer needs to be rebuilt after a reload.
   */
  mime?: string;
  path?: string;
};

/**
 * What a store records beside the bytes, so a file it still holds can be
 * offered again on the next page load without being hashed or named again.
 *
 * `tag` is opaque to this library: a store sets it, and the application reads
 * it to decide what a file still belongs to — a room, an account, a session.
 */
export type StoredMeta = {
  name: string;
  mime: string;
  path?: string;
  tag?: string;
  /** When it was last written, as `Date.now()`. */
  ts: number;
};

/** One file a store is holding: enough to re-offer it and to serve it. */
export type StoredFile = {
  key: ResumeKey;
  state: ResumeState;
  meta: StoredMeta;
};

/**
 * Storage for partial downloads, so they survive a reload rather than only a
 * dropped connection. `opfsResume()` in `@thebkht/rtc-file-transfer/sinks` is a
 * ready-made one.
 *
 * Only offers that carry a `digest` can be resumed this way, since that is what
 * identifies the file across page loads. `checkpoint` must report only what is
 * durably written: whatever it records is what the next load resumes from.
 */
export type ResumeProvider = {
  /** What is on disk for this file, or null. */
  load(key: ResumeKey): Promise<ResumeState | null>;
  /** Reopen the file at `state.verifiedBytes` to append to it. Null if it can't be. */
  open(key: ResumeKey, state: ResumeState): Promise<FileSink | null>;
  /** Record progress. Called as blocks are committed, and may be throttled. */
  checkpoint(key: ResumeKey, state: ResumeState): void | Promise<void>;
  /** Drop everything kept for this file. */
  forget(key: ResumeKey): void | Promise<void>;
  /**
   * Everything kept for this origin, for a seeder to re-offer. Optional: a
   * store written before seeding existed simply never seeds.
   */
  list?(): Promise<StoredFile[]>;
  /**
   * The bytes on disk, up to `state.verifiedBytes`, as a Blob. Null when the
   * file is gone — evicted, or never stored.
   */
  read?(key: ResumeKey): Promise<Blob | null>;
  /**
   * Record that the whole file is on disk, under `keepReceived`. Called after
   * the sink has closed, which is why — unlike `checkpoint` — it is not
   * clamped to what the store considers durable: by then it all is.
   *
   * Without it a completed download is forgotten as before, so a store that
   * doesn't implement it simply never seeds.
   */
  keep?(key: ResumeKey, state: ResumeState): void | Promise<void>;
};

export type RequestOptions = {
  /**
   * Defaults to an in-memory sink that assembles a Blob, which is refused for
   * files over `limits.maxMemoryBytes`.
   */
  sink?: FileSink;
};

export type TransferNotice =
  | { type: "incoming-offer"; item: FileItem }
  | { type: "received"; item: FileItem }
  | { type: "failed"; item: FileItem; code: FailureCode; message: string };

export type OfferRejection = {
  file: File;
  code: "empty" | "too-large";
  /** The limit that was exceeded, in bytes (0 for `empty`). */
  limit: number;
};

export type FileTransferOptions = {
  peerId: PeerId;
  /**
   * Deliver a signal to one peer (`to`) or to every peer. Return false when
   * there is no channel to carry it; the manager then treats it as not sent.
   */
  sendSignal: (payload: FileSignal, to?: PeerId) => boolean;
  onItemsChange: (items: FileItem[]) => void;
  onNotice?: (notice: TransferNotice) => void;
  /**
   * ICE servers, or a function returning them. TURN credentials are usually
   * short-lived, and a fixed array is read once when the manager is created —
   * so a transfer started an hour later would dial TURN with credentials that
   * expired. A function is called for each peer connection instead, letting
   * the application hand over whatever is current.
   *
   * Synchronous on purpose: `request` returns a boolean, so there is nothing
   * to await here without making it async, which would be a breaking change.
   * Refresh credentials on your own schedule and return the latest.
   */
  iceServers?: RTCIceServer[] | (() => RTCIceServer[]);
  limits?: Partial<TransferLimits>;
  createId?: () => string;
  /** Override for environments without a global `RTCPeerConnection`. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  /**
   * Protocol features to advertise. Defaults to all of them where
   * `crypto.subtle` exists (secure contexts), and none otherwise. Pass `[]` to
   * behave exactly like a v1 peer.
   */
  capabilities?: Capability[];
  /**
   * Keeps partial downloads across page loads. Used only for offers that carry
   * a `digest` and peers that support `resume`.
   */
  resume?: ResumeProvider;
  /**
   * Keep a download in the `resume` store once it finishes, instead of
   * deleting it at the finish line, so `seed` can offer it to other peers.
   * Needs a store that implements `keep`, `list` and `read`.
   *
   * The store then grows without bound unless the application sweeps it: what
   * is worth keeping, and for how long, is not something this library can
   * decide.
   */
  keepReceived?: boolean;
  /**
   * Offer a download's verified prefix to the rest of the room while it is
   * still arriving, so the second device to get a file starts serving the
   * third before it has finished. On by default where `partial` is
   * advertised; turn it off to keep this device's uplink to itself.
   */
  seedWhileDownloading?: boolean;
};

type Timer = ReturnType<typeof setTimeout>;

/**
 * A download's sink and what has been written to it. It outlives a failed
 * transfer when the download can resume, so the next transfer appends to the
 * same sink.
 */
type Download = {
  sink: FileSink;
  /** Serialized sink work; never rejects, since failures fail the transfer. */
  writes: Promise<void>;
  /** Bytes written after passing their block check (blocks mode). */
  verifiedBytes: number;
  /** Hash of every block kept so far, in order; checked against the offer's digest. */
  blockHashes: string[];
  /** Set when this download is being kept across page loads. */
  key: ResumeKey | null;
  /** Queued sink work that hasn't finished yet. */
  pending: number;
  /** `close` has been called and hasn't resolved yet. */
  closing: boolean;
  /** `close` or `abort` has been called. */
  settled: boolean;
};

class CorruptBlockError extends Error {}

type Transfer = {
  id: string;
  role: "send" | "receive";
  remotePeer: PeerId;
  itemId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  stallTimer: Timer | null;
  /** One ICE restart is attempted per transfer; this records that it was spent. */
  iceRestarted: boolean;
  /** Running while a restart is in flight, and the deadline for giving up on it. */
  restartTimer: Timer | null;
  /** Receive side only: where this transfer's bytes are written. */
  download: Download | null;
  /** Both peers negotiated `blocks` for this transfer. */
  blocks: boolean;
  /** First byte this transfer carries; non-zero when resuming. */
  offset: number;
  /** Receive side, blocks mode: the block being assembled. */
  blockParts: Uint8Array<ArrayBuffer>[];
  blockReceived: number;
  blockStart: number;
  /** A write failed or a block was corrupt: skip everything queued after it. */
  discard: boolean;
  /** "done" arrived and the sink is closing. */
  finishing: boolean;
  received: number;
  /** Last rate sample: when it was taken and how many bytes had arrived. */
  rateAt: number;
  rateBytes: number;
  /** Exponential moving average of the receive rate, in bytes per second. */
  rate: number;
  doneSent: boolean;
  closed: boolean;
  /** Send side, flow mode: bytes handed to the channel, and bytes the receiver has committed. */
  sentBytes: number;
  creditedBytes: number;
  /** Both peers negotiated `flow` for this transfer. */
  flow: boolean;
  /** Resolves when a credit arrives, while the sender is waiting for room. */
  onCredit: (() => void) | null;
};

const DONE_MESSAGE = "done";
/** Receiver → sender, in blocks+flow mode: how many bytes are safely committed. */
const CREDIT_PREFIX = '{"t":"credit"';
/**
 * Sender → receiver, in `partial` mode: this is everything I hold. Not a
 * failure — the receiver keeps what arrived and continues at another peer.
 */
const PART_PREFIX = '{"t":"part"';
/**
 * How many times a download may change source before it gives up. A room of
 * peers that all claim to have the file and none of which can serve it would
 * otherwise spin; the count is cleared whenever bytes actually arrive, so a
 * long download that switches often is not punished for it.
 */
const MAX_HANDOFF_ATTEMPTS = 8;
/**
 * How often a download that is also being offered re-announces how much it
 * has: whichever of these comes first. Every announce is a signal to every
 * capable peer, so this trades how current `have` is against signaling load.
 */
const REANNOUNCE_BYTES = 8 * 1024 * 1024;
const REANNOUNCE_MS = 5_000;
const ACK_MESSAGE = "ack";
const PROGRESS_EMIT_MS = 100;
const RECEIVER_CLOSE_GRACE_MS = 5_000;
/**
 * How long a sender that has sent "done" waits for the receiver's "ack". Longer
 * than a stall, because the receiver may be committing a large file to disk.
 */
const ACK_TIMEOUT_MS = 2 * 60_000;
const RATE_SAMPLE_MS = 500;
/** Weight of the newest sample; low enough that one slow chunk doesn't swing the ETA. */
const RATE_SMOOTHING = 0.3;

const MESSAGES: Record<Exclude<FailureCode, "remote-canceled">, string> = {
  stalled: "The transfer stalled. Try again.",
  nat: "Couldn't connect directly to the other device. This network blocks peer-to-peer.",
  "read-error": "Couldn't read the file on the sending device.",
  negotiation: "Couldn't negotiate a connection.",
  incomplete: "The file arrived incomplete. Try again.",
  overflow: "The sender sent more data than announced.",
  canceled: "Download canceled.",
  revoked: "The sender stopped sharing this file.",
  "sender-left": "The sender left.",
  closed: "The connection closed before the file finished.",
  "write-error": "Couldn't save the file on this device.",
  corrupt: "Part of the file arrived damaged. Try again.",
  "needs-sink": "This file is too large to download into memory.",
  "digest-mismatch": "The file that arrived isn't the one that was offered.",
  paused: "Download paused.",
};

/** Failures worth resuming after: the data so far is good, the link wasn't. */
const RESUMABLE = new Set<FailureCode>([
  "paused",
  "stalled",
  "nat",
  "negotiation",
  "closed",
  "corrupt",
  "sender-left",
  "remote-canceled",
]);

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function hasSubtleCrypto() {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function";
}

function toHex(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

/**
 * The file's digest: SHA-256 over its block digests, joined as raw bytes. It
 * covers the whole file without the receiver having to hold it, since the
 * block hashes are all it keeps.
 */
async function digestOfBlocks(blockHashes: string[]) {
  const joined = new Uint8Array(blockHashes.length * 32);
  for (const [index, hash] of blockHashes.entries()) {
    joined.set(fromHex(hash), index * 32);
  }
  return sha256Hex(joined);
}

function joinParts(parts: Uint8Array<ArrayBuffer>[], length: number) {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/** The in-band credit from a receiver: `{"t":"credit","b":1048576}`. */
function parseCreditMessage(raw: string) {
  try {
    const message: unknown = JSON.parse(raw);
    if (
      typeof message === "object" &&
      message !== null &&
      "t" in message &&
      message.t === "credit" &&
      "b" in message &&
      Number.isSafeInteger(message.b) &&
      (message.b as number) >= 0
    ) {
      return message.b as number;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** The in-band end of a partial send: `{"t":"part","b":2097152}`. */
function parsePartMessage(raw: string) {
  try {
    const message: unknown = JSON.parse(raw);
    if (
      typeof message === "object" &&
      message !== null &&
      "t" in message &&
      message.t === "part" &&
      "b" in message &&
      Number.isSafeInteger(message.b) &&
      (message.b as number) >= 0
    ) {
      return message.b as number;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** The in-band message that follows each block: `{"t":"block","i":0,"h":"…"}`. */
function parseBlockMessage(raw: string) {
  try {
    const message: unknown = JSON.parse(raw);
    if (
      typeof message === "object" &&
      message !== null &&
      "t" in message &&
      message.t === "block" &&
      "i" in message &&
      Number.isSafeInteger(message.i) &&
      "h" in message &&
      typeof message.h === "string" &&
      HASH_PATTERN.test(message.h)
    ) {
      return { index: message.i as number, hash: message.h };
    }
  } catch {
    // not JSON
  }
  return null;
}

/**
 * What `createFileTransferManager` returns.
 *
 * Declared rather than inferred from the implementation, so that this is the
 * public surface: it can be implemented or stubbed, it carries its own
 * documentation, and widening it is a deliberate edit here rather than a
 * side effect of adding a property to an object literal.
 */
export type FileTransferManager = {
  /** Feed in a signal from another peer, as delivered by your signaling channel. */
  handleSignal(from: PeerId, payload: FileSignal): void;
  /** Call once signaling is ready: asks peers for their offers and re-announces ours. */
  announce(): void;
  /** Announce files to every peer. */
  offerFiles(
    entries: Array<File | OfferEntry>,
    options?: OfferOptions,
  ): { offered: number; rejected: OfferRejection[] };
  /**
   * Re-offer files this device already holds in its `resume` store, as
   * returned by that store's `list`. Returns the items created.
   *
   * Nothing is hashed: the digest came with the offer and was checked against
   * every block on arrival, so it is already known and already trusted. Files
   * this device is offering under the same digest are skipped, and so — for
   * now — is anything less than complete.
   */
  seed(entries: StoredFile[]): FileItem[];
  /** Stop sharing an outgoing file, cutting off any download in flight. */
  revoke(id: string): void;
  /** Ask the sender for an incoming file. False if it can't be downloaded. */
  request(id: string, options?: RequestOptions): boolean;
  /** Pause an incoming download, keeping every verified block. */
  pause(id: string): boolean;
  /** Continue a paused or failed download. The same as calling `request` again. */
  resume(id: string, options?: RequestOptions): boolean;
  /** Abort an in-progress incoming download. */
  cancel(id: string): void;
  /** Remove a finished, failed, or revoked incoming item from the list. */
  dismiss(id: string): void;
  /**
   * Every item, newest first — the same snapshot `onItemsChange` receives, for
   * a caller that needs to read the current state rather than mirror it.
   */
  getItems(): FileItem[];
  /** One item by id, or undefined. A copy, like `getItems`. */
  getItem(id: string): FileItem | undefined;
  /** Tear everything down: close transfers, abort sinks, stop emitting. */
  dispose(): void;
};

function createMemorySink(mime: string): FileSink {
  let parts: Uint8Array<ArrayBuffer>[] = [];
  return {
    write(chunk) {
      parts.push(chunk);
    },
    close() {
      const blob = new Blob(parts, { type: mime || "application/octet-stream" });
      parts = [];
      return blob;
    },
    abort() {
      parts = [];
    },
  };
}

function abortSink(sink: FileSink) {
  void Promise.resolve()
    .then(() => sink.abort())
    .catch(() => {
      // nothing more to release
    });
}

function itemKey(peerId: PeerId, offerId: string) {
  return `${peerId}:${offerId}`;
}


/**
 * Peer-to-peer file transfer over WebRTC data channels.
 *
 * Senders announce file metadata over the signaling channel and keep only a
 * `File` reference in memory. A receiver that asks for a file gets its own
 * RTCPeerConnection; bytes flow peer-to-peer and never pass through the
 * signaling server.
 */
export function createFileTransferManager(
  options: FileTransferOptions,
): FileTransferManager {
  const { peerId: selfId, sendSignal, onItemsChange } = options;
  const onNotice = options.onNotice ?? (() => {});
  const iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
  const limits: TransferLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const createId = options.createId ?? createRandomId;
  const newPeerConnection =
    options.createPeerConnection ?? ((config) => new RTCPeerConnection(config));
  const resumeStore = options.resume;
  const keepReceived = options.keepReceived === true;
  const seedWhileDownloading = options.seedWhileDownloading !== false;
  const advertised = new Set(
    options.capabilities ?? (hasSubtleCrypto() ? CAPABILITIES : []),
  );
  const selfCaps: Capability[] = advertised.has("blocks")
    ? CAPABILITIES.filter((cap) => advertised.has(cap))
    : [];

  const items = new Map<string, FileItem>();
  const outgoingFiles = new Map<string, File>();
  /**
   * Offer id → the store key of a file this device holds but did not pick:
   * `seed` registers it here and `startSend` reads the bytes back when a peer
   * asks, so seeding costs a map entry rather than a file in memory.
   */
  const outgoingSources = new Map<string, ResumeKey>();
  /** Offer id → its file's block hashes, once hashed for a `digest`. */
  const offerBlockHashes = new Map<string, string[]>();
  const transfers = new Map<string, Transfer>();
  /** Incoming item id → its download, while one is running or can resume. */
  const downloads = new Map<string, Download>();
  /** Incoming item id → what a previous page load left on disk. */
  const stored = new Map<string, ResumeState>();
  /**
   * What each peer said it supports in its `hello`. Offers are broadcast, so
   * this is the only place a sender learns who can understand a partial one
   * before it has anything to send them.
   */
  const peerCaps = new Map<PeerId, Capability[]>();
  /**
   * Per download: how many times it has changed source, and which peers let it
   * down. Reset whenever bytes actually arrive, so only a run of sources that
   * all fail without progress can exhaust it.
   */
  const handoffs = new Map<string, { attempts: number; bytes: number; tried: Set<PeerId> }>();
  /**
   * Incoming item id → the outgoing offer passing its verified prefix on,
   * while it downloads, and when that offer last said how much it had.
   */
  const partialSeeds = new Map<
    string,
    { offerId: string; announced: number; timer: Timer | null }
  >();
  let emitTimer: Timer | null = null;
  let disposed = false;

  // ---------------------------------------------------------------------------
  // State emission

  function emit() {
    if (emitTimer !== null) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (disposed) {
      return;
    }
    onItemsChange(snapshot());
  }

  /** Newest first, each item copied so a consumer cannot mutate our state. */
  function snapshot() {
    return [...items.values()]
      .sort((left, right) => right.ts - left.ts)
      .map((item) => ({ ...item }));
  }

  /** Coalesces high-frequency progress updates. */
  function emitSoon() {
    if (emitTimer === null && !disposed) {
      emitTimer = setTimeout(emit, PROGRESS_EMIT_MS);
    }
  }

  function hasActiveTransfer(id: string) {
    for (const transfer of transfers.values()) {
      if (transfer.itemId === id && !transfer.closed) {
        return true;
      }
    }
    return false;
  }

  function addItem(item: FileItem) {
    items.set(item.id, item);

    // Evict the oldest idle items beyond the cap.
    if (items.size > limits.maxItems) {
      const oldestFirst = [...items.values()].sort((a, b) => a.ts - b.ts);
      for (const candidate of oldestFirst) {
        if (items.size <= limits.maxItems) {
          break;
        }
        if (candidate.direction === "incoming" && !hasActiveTransfer(candidate.id)) {
          items.delete(candidate.id);
          releaseDownload(candidate.id);
        }
      }
    }
  }

  function toOffer(item: FileItem): FileSignal {
    return {
      type: "file-offer",
      offerId: item.offerId,
      name: item.name,
      size: item.size,
      mime: item.mime,
      ...(selfCaps.length > 0 && { caps: selfCaps }),
      ...(item.path && { path: item.path }),
      ...(item.batchId && { batchId: item.batchId }),
      ...(item.digest && { digest: item.digest }),
      ...(isPartial(item) && { have: item.have }),
    };
  }

  /** An outgoing offer this device can only serve part of. */
  function isPartial(item: FileItem) {
    return (
      item.direction === "outgoing" &&
      item.have !== undefined &&
      item.have > 0 &&
      item.have < item.size
    );
  }

  /**
   * Announces an offer — to one peer, or to the room.
   *
   * A complete offer is broadcast, as it always has been. A partial one is
   * sent only to peers that advertised `partial`, because a peer that doesn't
   * understand `have` would read it as a whole file and get a `part` it has no
   * way to act on. `hello` is where those peers become known, so this runs
   * again for each one that arrives.
   */
  function announceOffer(item: FileItem, to?: PeerId) {
    if (!isPartial(item) || !selfCaps.includes("partial")) {
      sendSignal(toOffer(item), to);
      return;
    }
    if (to !== undefined) {
      if (peerCaps.get(to)?.includes("partial")) {
        sendSignal(toOffer(item), to);
      }
      return;
    }
    for (const [peer, caps] of peerCaps) {
      if (caps.includes("partial")) {
        sendSignal(toOffer(item), peer);
      }
    }
  }

  function hasCap(cap: Capability, remote: Capability[] | undefined) {
    return selfCaps.includes(cap) && remote?.includes(cap) === true;
  }

  function createDownload(sink: FileSink): Download {
    return {
      sink,
      writes: Promise.resolve(),
      verifiedBytes: 0,
      blockHashes: [],
      key: null,
      pending: 0,
      closing: false,
      settled: false,
    };
  }

  /** Forget a download and abort its sink once queued work has drained. */
  function releaseDownload(itemId: string) {
    handoffs.delete(itemId);
    settlePartialSeed(itemId, false);
    const download = downloads.get(itemId);
    if (!download) {
      return;
    }
    downloads.delete(itemId);
    if (download.settled) {
      return;
    }
    download.settled = true;
    void download.writes.then(() => abortSink(download.sink));
  }

  function outgoingItems() {
    return [...items.values()].filter((item) => item.direction === "outgoing");
  }

  // ---------------------------------------------------------------------------
  // Transfer lifecycle

  function clearRate(item: FileItem) {
    item.bytesPerSecond = undefined;
    item.etaMs = undefined;
  }

  function sampleRate(transfer: Transfer, item: FileItem) {
    const now = Date.now();
    if (transfer.rateAt === 0) {
      transfer.rateAt = now;
      transfer.rateBytes = transfer.received;
      return;
    }
    const elapsed = now - transfer.rateAt;
    if (elapsed < RATE_SAMPLE_MS) {
      return;
    }
    const instant = ((transfer.received - transfer.rateBytes) * 1000) / elapsed;
    transfer.rate =
      transfer.rate === 0
        ? instant
        : RATE_SMOOTHING * instant + (1 - RATE_SMOOTHING) * transfer.rate;
    transfer.rateAt = now;
    transfer.rateBytes = transfer.received;
    item.bytesPerSecond = Math.round(transfer.rate);
    item.etaMs =
      transfer.rate > 0
        ? Math.round(((item.size - transfer.received) / transfer.rate) * 1000)
        : undefined;
  }

  /**
   * What a send transfer has actually delivered. With `flow` the receiver
   * credits what it has committed, which is the honest number; without it the
   * best the sender knows is what it handed to the channel.
   */
  function deliveredBytes(transfer: Transfer) {
    return transfer.flow ? transfer.creditedBytes : transfer.sentBytes;
  }

  /**
   * The send-side counterpart of `sampleRate`, kept separate because it reads
   * a different counter and writes onto the transfer rather than the item: an
   * item can have several send transfers, each with its own rate.
   */
  function sampleSendRate(transfer: Transfer) {
    const now = Date.now();
    const delivered = deliveredBytes(transfer);
    if (transfer.rateAt === 0) {
      transfer.rateAt = now;
      transfer.rateBytes = delivered;
      return;
    }
    const elapsed = now - transfer.rateAt;
    if (elapsed < RATE_SAMPLE_MS) {
      return;
    }
    const instant = ((delivered - transfer.rateBytes) * 1000) / elapsed;
    transfer.rate =
      transfer.rate === 0
        ? instant
        : RATE_SMOOTHING * instant + (1 - RATE_SMOOTHING) * transfer.rate;
    transfer.rateAt = now;
    transfer.rateBytes = delivered;
  }

  /**
   * Rebuilds an outgoing item's per-device progress from the transfers still
   * running for it. Called wherever a counter moves; the emit it schedules is
   * already coalesced, so this runs far more often than the UI sees it.
   */
  function refreshOutgoing(itemId: string) {
    const item = items.get(itemId);
    if (!item || item.direction !== "outgoing") {
      return;
    }
    const progress: OutgoingTransfer[] = [];
    for (const transfer of transfers.values()) {
      if (transfer.itemId !== itemId || transfer.role !== "send" || transfer.closed) {
        continue;
      }
      sampleSendRate(transfer);
      const bytes = deliveredBytes(transfer);
      const rate = Math.round(transfer.rate);
      progress.push({
        peerId: transfer.remotePeer,
        bytes,
        committed: transfer.flow,
        ...(rate > 0 && { bytesPerSecond: rate }),
        ...(rate > 0 && { etaMs: Math.round(((item.size - bytes) / rate) * 1000) }),
      });
    }
    item.outgoingTransfers = progress;
    emitSoon();
  }

  function touch(transfer: Transfer) {
    if (transfer.stallTimer !== null) {
      clearTimeout(transfer.stallTimer);
    }
    transfer.stallTimer = setTimeout(() => {
      failTransfer(transfer, "stalled", true);
    }, limits.stallMs);
  }

  function clearRestart(transfer: Transfer) {
    if (transfer.restartTimer !== null) {
      clearTimeout(transfer.restartTimer);
      transfer.restartTimer = null;
    }
  }

  /**
   * Re-offers with `iceRestart`, which gathers fresh candidates over the
   * existing connection rather than tearing the transfer down.
   *
   * Only the sender offers, because only the sender ever does: the receiver
   * answers a restart offer through the same path as the first one, so a peer
   * running an older version needs no new message type to take part. The
   * receiver's side of a restart is simply to wait, which is what the grace
   * timer buys it.
   */
  async function renegotiate(transfer: Transfer) {
    try {
      const offer = await transfer.pc.createOffer({ iceRestart: true });
      await transfer.pc.setLocalDescription(offer);
      sendSignal(
        {
          type: "rtc-description",
          transferId: transfer.id,
          description: { type: "offer", sdp: offer.sdp ?? "" },
        },
        transfer.remotePeer,
      );
    } catch {
      failTransfer(transfer, "nat", true);
    }
  }

  /**
   * One attempt to recover a failed connection, on both peers. False once that
   * attempt has been spent, which is the caller's cue to fail the transfer —
   * including when the restart itself reports `failed`, which is the ordinary
   * way a restart that cannot connect ends.
   */
  function beginIceRestart(transfer: Transfer): boolean {
    if (transfer.iceRestarted) {
      return false;
    }
    transfer.iceRestarted = true;
    // The channel is down for the duration, so nothing will touch the stall
    // timer; restarting it keeps the grace period from being cut short by a
    // stall that is really this reconnection.
    touch(transfer);
    transfer.restartTimer = setTimeout(() => {
      transfer.restartTimer = null;
      const current = transfers.get(transfer.id);
      if (current) {
        failTransfer(current, "nat", true);
      }
    }, limits.iceRestartMs);
    if (transfer.role === "send") {
      void renegotiate(transfer);
    }
    return true;
  }

  function closeTransfer(transfer: Transfer) {
    if (transfer.closed) {
      return false;
    }
    transfer.closed = true;
    if (transfer.stallTimer !== null) {
      clearTimeout(transfer.stallTimer);
      transfer.stallTimer = null;
    }
    clearRestart(transfer);
    try {
      transfer.channel?.close();
      transfer.pc.close();
    } catch {
      // already closed
    }
    transfers.delete(transfer.id);
    return true;
  }

  function finishSend(transfer: Transfer, completed: boolean) {
    if (!closeTransfer(transfer)) {
      return;
    }
    const item = items.get(transfer.itemId);
    if (item) {
      item.activeTransfers = Math.max(0, item.activeTransfers - 1);
      if (completed) {
        item.completedTransfers += 1;
      }
      // The transfer is closed now, so this drops it from the per-device list.
      refreshOutgoing(transfer.itemId);
      emit();
    }
  }

  function failTransfer(
    transfer: Transfer,
    code: FailureCode,
    notifyRemote: boolean,
    remoteReason?: string,
  ) {
    if (transfer.closed) {
      return;
    }
    const message =
      code === "remote-canceled" ? (remoteReason ?? "The transfer was canceled.") : MESSAGES[code];
    if (notifyRemote) {
      sendSignal(
        { type: "transfer-cancel", transferId: transfer.id, reason: message },
        transfer.remotePeer,
      );
    }

    if (transfer.role === "send") {
      finishSend(transfer, false);
      return;
    }

    closeTransfer(transfer);
    transfer.blockParts = [];
    const item = items.get(transfer.itemId);
    const download = transfer.download;
    if (!item || item.status === "done" || !download) {
      return;
    }

    // A sink that is already closing can't take more bytes, so it can't resume.
    const retain =
      transfer.blocks &&
      !download.closing &&
      hasCap("resume", item.caps) &&
      RESUMABLE.has(code);

    const settle = () => {
      if (item.status === "done") {
        return;
      }
      // Another device in the room may have the rest. Trying it is not a
      // retry of something that failed — nothing is wrong with the bytes so
      // far — so nothing is reported and the item stays in flight.
      if (
        retain &&
        code !== "paused" &&
        downloads.get(item.id) === download &&
        !download.settled &&
        handoff(item, download, transfer.remotePeer)
      ) {
        return;
      }
      if (retain && downloads.get(item.id) === download && !download.settled) {
        item.resumableBytes = download.verifiedBytes;
      } else {
        releaseDownload(item.id);
        item.resumableBytes = undefined;
      }
      const paused = code === "paused" && item.resumableBytes !== undefined;
      item.status = paused ? "paused" : "failed";
      item.error = paused ? undefined : message;
      item.errorCode = paused ? undefined : code;
      item.bytes = item.resumableBytes ?? 0;
      clearRate(item);
      emit();
      if (!paused) {
        onNotice({ type: "failed", item: { ...item }, code, message });
      }
    };

    if (retain && download.pending > 0) {
      // Let verified blocks already queued land first, so resumableBytes is
      // final before anyone can press resume.
      void download.writes.then(settle);
    } else if (retain) {
      settle();
    } else {
      releaseDownload(item.id);
      settle();
    }
  }

  function createPeerConnection(transfer: Omit<Transfer, "pc">): RTCPeerConnection {
    // Resolved per connection, so a function can return credentials that were
    // refreshed since the manager was created.
    const pc = newPeerConnection({
      iceServers: typeof iceServers === "function" ? iceServers() : iceServers,
    });

    pc.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        return;
      }
      const json = event.candidate.toJSON();
      const candidate: RtcCandidate = {
        candidate: json.candidate ?? "",
        sdpMid: json.sdpMid,
        sdpMLineIndex: json.sdpMLineIndex,
        usernameFragment: json.usernameFragment,
      };
      sendSignal(
        { type: "rtc-candidate", transferId: transfer.id, candidate },
        transfer.remotePeer,
      );
    });

    pc.addEventListener("connectionstatechange", () => {
      const current = transfers.get(transfer.id);
      if (!current) {
        return;
      }
      if (pc.connectionState === "connected") {
        // The restart took, or the connection recovered on its own.
        clearRestart(current);
        return;
      }
      if (pc.connectionState === "failed" && !beginIceRestart(current)) {
        failTransfer(current, "nat", true);
      }
    });

    return pc;
  }

  async function flushCandidates(transfer: Transfer) {
    const pending = transfer.pendingCandidates;
    transfer.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await transfer.pc.addIceCandidate(candidate);
      } catch {
        // stale or malformed candidate; ICE will use the others
      }
    }
  }

  function waitForDrain(channel: RTCDataChannel) {
    return new Promise<void>((resolve) => {
      const done = () => {
        channel.removeEventListener("bufferedamountlow", done);
        channel.removeEventListener("close", done);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", done);
      channel.addEventListener("close", done);
    });
  }

  /** Resolves when the receiver credits more bytes, or the transfer ends. */
  function waitForCredit(transfer: Transfer) {
    return new Promise<void>((resolve) => {
      transfer.onCredit = () => {
        transfer.onCredit = null;
        resolve();
      };
    });
  }

  /**
   * Sends one chunk once the channel has room, and — in flow mode — once the
   * receiver is no longer `windowBytes` behind. False if the transfer ended.
   */
  async function sendChunk(
    transfer: Transfer,
    channel: RTCDataChannel,
    chunk: ArrayBuffer | string,
  ) {
    while (
      channel.bufferedAmount > limits.bufferHighBytes ||
      (transfer.flow && transfer.sentBytes - transfer.creditedBytes > limits.windowBytes)
    ) {
      if (transfer.closed || channel.readyState !== "open") {
        return false;
      }
      await (channel.bufferedAmount > limits.bufferHighBytes
        ? waitForDrain(channel)
        : // The stall timer is running: a receiver that never credits fails it.
          waitForCredit(transfer));
    }
    if (transfer.closed || channel.readyState !== "open") {
      return false;
    }
    if (typeof chunk === "string") {
      channel.send(chunk);
    } else {
      channel.send(chunk);
      transfer.sentBytes += chunk.byteLength;
      // Without `flow` this is the only signal the sender has that bytes are
      // moving, so it is what an upload bar has to be drawn from.
      if (!transfer.flow) {
        refreshOutgoing(transfer.itemId);
      }
    }
    touch(transfer);
    return true;
  }

  /**
   * `source` is a Blob rather than a File because a seeded offer is served out
   * of the resume store, which hands back bytes and not a named file. Only
   * `slice` and `size` are used, and `File extends Blob`.
   */
  async function pumpFile(transfer: Transfer, channel: RTCDataChannel, source: Blob) {
    const item = items.get(transfer.itemId);
    const cachedHashes = item && offerBlockHashes.get(item.offerId);
    const maxMessage = transfer.pc.sctp?.maxMessageSize;
    const chunkSize =
      maxMessage && maxMessage > 0
        ? Math.min(limits.chunkBytes, maxMessage)
        : limits.chunkBytes;

    try {
      if (transfer.blocks) {
        for (let start = transfer.offset; start < source.size; start += BLOCK_BYTES) {
          const block = new Uint8Array(
            await source.slice(start, start + BLOCK_BYTES).arrayBuffer(),
          );
          const index = start / BLOCK_BYTES;
          // Hashed already if this offer carries a digest.
          const hash =
            cachedHashes?.[index] ?? (await sha256Hex(block));
          for (let offset = 0; offset < block.byteLength; offset += chunkSize) {
            const chunk = block.buffer.slice(offset, offset + chunkSize);
            if (!(await sendChunk(transfer, channel, chunk))) {
              return;
            }
          }
          const message = JSON.stringify({ t: "block", i: index, h: hash });
          if (!(await sendChunk(transfer, channel, message))) {
            return;
          }
        }
      } else {
        for (let offset = 0; offset < source.size; ) {
          if (transfer.closed || channel.readyState !== "open") {
            return;
          }
          const chunk = await source.slice(offset, offset + chunkSize).arrayBuffer();
          if (!(await sendChunk(transfer, channel, chunk))) {
            return;
          }
          offset += chunk.byteLength;
        }
      }
      // Everything this device holds, which is not everything there is: the
      // receiver keeps it and picks the rest up from another peer.
      const short = item !== undefined && source.size < item.size;
      const end = short
        ? JSON.stringify({ t: "part", b: source.size })
        : DONE_MESSAGE;
      if (!(await sendChunk(transfer, channel, end))) {
        return;
      }
      // After a prefix there is no ack to wait for: the receiver closes once it
      // has kept what arrived. Closing from this side instead could discard
      // blocks still queued behind the message, so the wait is the same.
      transfer.doneSent = true;
      // Only the receiver's ack says the file was saved; its commit may take a
      // while, so wait for it instead of treating the quiet as a stall. Reusing
      // the stall slot means closeTransfer clears this timer too.
      if (transfer.stallTimer !== null) {
        clearTimeout(transfer.stallTimer);
      }
      transfer.stallTimer = setTimeout(() => finishSend(transfer, false), ACK_TIMEOUT_MS);
    } catch {
      failTransfer(transfer, "read-error", true);
    }
  }

  function newTransfer(
    id: string,
    role: Transfer["role"],
    remotePeer: PeerId,
    itemId: string,
    setup: Pick<Transfer, "download" | "blocks" | "offset" | "flow">,
  ): Transfer {
    const base = {
      id,
      role,
      remotePeer,
      itemId,
      channel: null,
      pendingCandidates: [],
      stallTimer: null,
      iceRestarted: false,
      restartTimer: null,
      ...setup,
      blockParts: [],
      blockReceived: 0,
      blockStart: setup.offset,
      discard: false,
      finishing: false,
      received: setup.offset,
      rateAt: 0,
      rateBytes: 0,
      rate: 0,
      doneSent: false,
      closed: false,
      sentBytes: setup.offset,
      creditedBytes: setup.offset,
      flow: setup.flow,
      onCredit: null,
    };
    return { ...base, pc: createPeerConnection(base) };
  }

  function handoffState(itemId: string, bytes: number) {
    const state = handoffs.get(itemId);
    if (!state || bytes > state.bytes) {
      const fresh = { attempts: 0, bytes, tried: new Set<PeerId>() };
      handoffs.set(itemId, fresh);
      return fresh;
    }
    return state;
  }

  /**
   * Which peer to pull this file from, starting at `from`.
   *
   * Downloads are strictly sequential, so what a peer has is always a prefix
   * and a single number decides whether it is any use: a source that holds no
   * more than this device already does has nothing to give. Among the rest, one
   * that hasn't already let this download down is preferred, and then whichever
   * holds the most — which for complete sources is all of them.
   */
  function pickSource(item: FileItem, from: number): ItemSource | null {
    const usable = (item.sources ?? []).filter(
      (source) =>
        source.have > from &&
        // Continuing part way through needs both the hashes and the offset.
        (from === 0 ||
          (hasCap("blocks", source.caps) && hasCap("resume", source.caps))),
    );
    if (usable.length === 0) {
      return null;
    }
    const tried = handoffs.get(item.id)?.tried;
    const fresh = tried ? usable.filter((source) => !tried.has(source.peerId)) : usable;
    const pool = fresh.length > 0 ? fresh : usable;
    return pool.reduce((best, source) => (source.have > best.have ? source : best));
  }

  /**
   * Continues a download at another peer, keeping the sink and every verified
   * block. False when there is nowhere to continue, which is the caller's cue
   * to settle the item as a failure.
   *
   * The sink, the verified watermark and the block hashes are all
   * source-agnostic: every block was checked against a hash that came from the
   * same digest, so who sent it makes no difference to what is on disk.
   */
  function handoff(item: FileItem, download: Download, failed?: PeerId): boolean {
    const state = handoffState(item.id, download.verifiedBytes);
    if (failed !== undefined) {
      state.tried.add(failed);
    }
    if (state.attempts >= MAX_HANDOFF_ATTEMPTS) {
      return false;
    }
    const next = pickSource(item, download.verifiedBytes);
    if (!next || next.peerId === failed) {
      return false;
    }
    state.attempts += 1;
    promoteSource(item, next);
    return beginReceive(item, download, true);
  }

  /**
   * Opens the connection for a download that already has its sink, and tells
   * the sender where to start. `keepOnFailure` is set when the sink holds a
   * prefix worth keeping if signaling turns out to be down.
   */
  function beginReceive(item: FileItem, download: Download, keepOnFailure: boolean) {
    const blocks = hasCap("blocks", item.caps);
    const flow = blocks && hasCap("flow", item.caps);
    const offset = download.verifiedBytes;

    const transferId = createId();
    const transfer = newTransfer(transferId, "receive", item.peerId, item.id, {
      download,
      blocks,
      flow,
      offset,
    });
    transfer.pc.addEventListener("datachannel", (event) => {
      attachReceiveChannel(transfer, event.channel);
    });

    const signal: FileSignal = {
      type: "file-request",
      offerId: item.offerId,
      transferId,
      ...(selfCaps.length > 0 && { caps: selfCaps }),
      ...(offset > 0 && { offset }),
    };
    if (!sendSignal(signal, item.peerId)) {
      closeTransfer(transfer);
      if (!keepOnFailure) {
        releaseDownload(item.id);
      }
      return false;
    }

    transfers.set(transferId, transfer);
    item.status = "connecting";
    item.bytes = offset;
    item.error = undefined;
    item.errorCode = undefined;
    item.blob = undefined;
    item.savedToSink = undefined;
    item.resumableBytes = undefined;
    clearRate(item);
    touch(transfer);
    emit();
    return true;
  }

  /**
   * Picks a download back up from the store after a reload: reopens the file
   * where it left off, or starts it over if the store can no longer supply it.
   */
  async function beginStoredReceive(item: FileItem, key: ResumeKey, state: ResumeState) {
    let sink: FileSink | null = null;
    try {
      sink = await resumeStore!.open(key, state);
    } catch {
      sink = null;
    }
    if (items.get(item.id) !== item || item.status !== "connecting") {
      if (sink) {
        abortSink(sink);
      }
      return;
    }
    stored.delete(item.id);
    const download = createDownload(sink ?? createMemorySink(item.mime));
    if (sink) {
      download.verifiedBytes = state.verifiedBytes;
      download.blockHashes = state.blockHashes.slice();
      download.key = key;
    } else if (item.size > limits.maxMemoryBytes) {
      item.status = "failed";
      item.resumableBytes = undefined;
      item.bytes = 0;
      emit();
      onNotice({
        type: "failed",
        item: { ...item },
        code: "needs-sink",
        message: MESSAGES["needs-sink"],
      });
      return;
    }
    releaseDownload(item.id);
    downloads.set(item.id, download);
    if (!beginReceive(item, download, false)) {
      item.status = "offered";
      item.bytes = 0;
      emit();
    }
  }

  function resumeKeyFor(item: FileItem): ResumeKey | null {
    return item.digest
      ? {
          digest: item.digest,
          size: item.size,
          name: item.name,
          mime: item.mime,
          ...(item.path !== undefined && { path: item.path }),
        }
      : null;
  }

  /** Whether this item could be picked up again after a reload. */
  function canStore(item: FileItem) {
    return (
      resumeStore !== undefined &&
      item.direction === "incoming" &&
      item.digest !== undefined &&
      hasCap("blocks", item.caps) &&
      hasCap("resume", item.caps)
    );
  }

  /** Ask the store what is already on disk for a freshly offered file. */
  async function loadStored(item: FileItem) {
    const key = resumeKeyFor(item);
    if (!resumeStore || !key) {
      return;
    }
    let state: ResumeState | null = null;
    try {
      state = await resumeStore.load(key);
    } catch {
      return;
    }
    const current = items.get(item.id);
    if (
      !state ||
      state.verifiedBytes <= 0 ||
      state.verifiedBytes >= item.size ||
      current !== item ||
      item.status !== "offered" ||
      downloads.has(item.id)
    ) {
      return;
    }
    stored.set(item.id, state);
    item.resumableBytes = state.verifiedBytes;
    item.bytes = state.verifiedBytes;
    emit();
  }

  /**
   * What happens to the stored copy of a download that just finished. Under
   * `keepReceived` it stays, recorded as complete so the next page load finds
   * it and can seed it; otherwise it goes, as it always has.
   */
  function keepOrForget(item: FileItem, download: Download) {
    const key = download.key;
    if (!keepReceived || !key || !resumeStore?.keep) {
      forgetStored(item);
      return;
    }
    stored.delete(item.id);
    void Promise.resolve(
      resumeStore.keep(key, {
        verifiedBytes: item.size,
        blockHashes: download.blockHashes.slice(),
      }),
    ).catch(() => {});
  }

  function forgetStored(item: FileItem) {
    stored.delete(item.id);
    const key = resumeKeyFor(item);
    if (resumeStore && key && canStore(item)) {
      void Promise.resolve(resumeStore.forget(key)).catch(() => {});
    }
  }

  /**
   * Hashes an offered file block by block, then re-announces the offer with a
   * `digest` over it. Old peers drop the field, and a receiver that already has
   * the offer keeps the one it has. Hashing a large file takes a while, so the
   * file is offered first and this catches up.
   */
  async function hashOffer(item: FileItem, file: File) {
    const hashes: string[] = [];
    try {
      for (let start = 0; start < file.size; start += BLOCK_BYTES) {
        const block = new Uint8Array(
          await file.slice(start, start + BLOCK_BYTES).arrayBuffer(),
        );
        hashes.push(await sha256Hex(block));
        if (disposed || items.get(item.id) !== item) {
          return;
        }
        item.hashedBytes = Math.min(start + BLOCK_BYTES, file.size);
        emitSoon();
      }
    } catch {
      // Unreadable now; the transfer itself will report it if it is requested.
      item.hashedBytes = undefined;
      emitSoon();
      return;
    }
    if (disposed || items.get(item.id) !== item) {
      return;
    }
    offerBlockHashes.set(item.offerId, hashes);
    item.digest = await digestOfBlocks(hashes);
    if (disposed || items.get(item.id) !== item) {
      return;
    }
    announceOffer(item);
    emit();
  }

  /**
   * The bytes behind an offer: the file this device picked, or — for a seeded
   * offer — whatever the store still holds. Null once neither is there.
   */
  async function resolveSource(offerId: string): Promise<Blob | null> {
    const file = outgoingFiles.get(offerId);
    if (file) {
      return file;
    }
    const key = outgoingSources.get(offerId);
    if (!key || !resumeStore?.read) {
      return null;
    }
    try {
      const blob = await resumeStore.read(key);
      // Whatever is left, which may be a prefix: how much of the file that is
      // is the caller's to check against the offer.
      return blob && blob.size > 0 ? blob : null;
    } catch {
      return null;
    }
  }

  async function startSend(
    from: PeerId,
    request: Extract<FileSignal, { type: "file-request" }>,
  ) {
    const { offerId, transferId } = request;
    const id = itemKey(selfId, offerId);
    const item = items.get(id);
    if (transfers.has(transferId)) {
      return;
    }
    const gone = () =>
      sendSignal(
        { type: "transfer-cancel", transferId, reason: "This file is no longer shared." },
        from,
      );
    if (!item) {
      gone();
      return;
    }
    // A file this device picked is in memory; a file it is seeding has to be
    // read back out of the store, which may have evicted it since the offer.
    const source = await resolveSource(offerId);
    // Reading the store is a turn of its own, so check again: the offer may
    // have been revoked, or this transfer already started, while it ran.
    if (!source || items.get(id) !== item || transfers.has(transferId)) {
      if (!source) {
        gone();
      }
      return;
    }

    const blocks = hasCap("blocks", request.caps);
    const flow = blocks && hasCap("flow", request.caps);
    // Serving less than the whole file is only honest if the receiver knows to
    // expect it; otherwise there is nothing to say so with, and a short stream
    // would read as a truncated file.
    if (source.size < item.size && !(blocks && hasCap("partial", request.caps))) {
      gone();
      return;
    }
    const offset = blocks && selfCaps.includes("resume") ? (request.offset ?? 0) : 0;
    if (offset > source.size || (offset % BLOCK_BYTES !== 0 && offset !== source.size)) {
      sendSignal(
        { type: "transfer-cancel", transferId, reason: "Can't resume from there." },
        from,
      );
      return;
    }

    const transfer = newTransfer(transferId, "send", from, id, {
      download: null,
      blocks,
      flow,
      offset,
    });
    transfers.set(transferId, transfer);
    item.activeTransfers += 1;
    // A device that has asked for the file but not yet been sent a byte is
    // still pulling it, so it belongs in the list from here rather than from
    // the first chunk.
    refreshOutgoing(transfer.itemId);
    emit();

    const channel = transfer.pc.createDataChannel("file", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = limits.bufferLowBytes;
    transfer.channel = channel;

    channel.addEventListener("open", () => {
      touch(transfer);
      void pumpFile(transfer, channel, source);
    });
    channel.addEventListener("message", (event) => {
      if (event.data === ACK_MESSAGE) {
        finishSend(transfer, true);
        return;
      }
      if (typeof event.data !== "string" || !event.data.startsWith(CREDIT_PREFIX)) {
        return;
      }
      const credited = parseCreditMessage(event.data);
      if (credited !== null && credited > transfer.creditedBytes) {
        transfer.creditedBytes = credited;
        refreshOutgoing(transfer.itemId);
        // Progress the sender can see, so a slow sink isn't read as a stall.
        // Not once everything is sent: the ack timer has the slot then, and a
        // trailing credit must not shorten it back to a stall.
        if (!transfer.doneSent) {
          touch(transfer);
        }
        transfer.onCredit?.();
      }
    });
    channel.addEventListener("close", () => {
      // Without an ack the receiver never confirmed the save: it may have
      // failed to commit, or gone away mid-commit.
      finishSend(transfer, false);
    });

    touch(transfer);
    try {
      const offer = await transfer.pc.createOffer();
      await transfer.pc.setLocalDescription(offer);
      sendSignal(
        {
          type: "rtc-description",
          transferId,
          description: { type: "offer", sdp: offer.sdp ?? "" },
        },
        from,
      );
    } catch {
      failTransfer(transfer, "negotiation", true);
    }
  }

  /**
   * Queues sink work behind everything before it. A failure fails the
   * transfer and discards whatever was queued after it.
   */
  function queueSinkWork(
    transfer: Transfer,
    work: (download: Download) => void | Promise<void>,
  ) {
    const download = transfer.download;
    if (!download) {
      return;
    }
    download.pending += 1;
    download.writes = download.writes
      // `disposed` matters as much as the other two: work queued before dispose
      // would otherwise write into a sink that has already been aborted, and
      // checkpoint bytes past the point the manager stopped owning them.
      .then(() =>
        transfer.discard || download.settled || disposed ? undefined : work(download),
      )
      .catch((error: unknown) => {
        transfer.discard = true;
        failTransfer(
          transfer,
          error instanceof CorruptBlockError ? "corrupt" : "write-error",
          true,
        );
      })
      .finally(() => {
        download.pending -= 1;
      });
  }

  function receiveBlockMessage(transfer: Transfer, item: FileItem, raw: string) {
    const message = parseBlockMessage(raw);
    const expected = Math.min(BLOCK_BYTES, item.size - transfer.blockStart);
    if (message && transfer.blockReceived < expected) {
      failTransfer(transfer, "incomplete", true);
      return;
    }
    if (
      !message ||
      message.index * BLOCK_BYTES !== transfer.blockStart ||
      transfer.blockReceived !== expected
    ) {
      failTransfer(transfer, "corrupt", true);
      return;
    }

    const parts = transfer.blockParts;
    transfer.blockParts = [];
    transfer.blockReceived = 0;
    transfer.blockStart += expected;

    queueSinkWork(transfer, async (download) => {
      const block = joinParts(parts, expected);
      if ((await sha256Hex(block)) !== message.hash) {
        throw new CorruptBlockError();
      }
      await download.sink.write(block);
      download.blockHashes[message.index] = message.hash;
      download.verifiedBytes += block.byteLength;
      // Settled while this block was in flight — cancelled, dismissed, revoked.
      // `queueSinkWork` only checks before work starts, and this block must
      // not record progress for, or re-offer, a download that has ended.
      if (download.settled || downloads.get(item.id) !== download) {
        return;
      }
      if (download.key && resumeStore && !disposed) {
        // The store decides how much of this is durable; a reload resumes from
        // whatever it recorded, never from what merely arrived. A manager that
        // was disposed mid-block records nothing: its sink is already aborted,
        // so those bytes are not there to resume from.
        void Promise.resolve(
          resumeStore.checkpoint(download.key, {
            verifiedBytes: download.verifiedBytes,
            blockHashes: download.blockHashes,
          }),
        ).catch(() => {});
      }
      refreshPartialSeed(item, download);
      if (transfer.flow && transfer.channel?.readyState === "open") {
        // Only what the sink has taken, so the sender's window bounds this
        // device's memory rather than trailing it.
        transfer.channel.send(
          JSON.stringify({ t: "credit", b: download.verifiedBytes }),
        );
      }
    });
  }

  async function finishReceive(transfer: Transfer, channel: RTCDataChannel) {
    const download = transfer.download;
    if (!download) {
      return;
    }
    transfer.finishing = true;
    // Committing the file is this device's work, not the sender's silence.
    if (transfer.stallTimer !== null) {
      clearTimeout(transfer.stallTimer);
      transfer.stallTimer = null;
    }
    await download.writes;
    const item = items.get(transfer.itemId);
    if (transfer.closed || download.settled || !item) {
      return;
    }
    if (transfer.blocks && download.verifiedBytes !== item.size) {
      failTransfer(transfer, "corrupt", true);
      return;
    }
    // Every block matched the hash sent beside it; this checks those hashes
    // against the digest that came over signaling, a different path entirely.
    if (transfer.blocks && item.digest) {
      const digest = await digestOfBlocks(download.blockHashes);
      if (transfer.closed || download.settled) {
        return;
      }
      if (digest !== item.digest) {
        failTransfer(transfer, "digest-mismatch", true);
        return;
      }
    }

    let result: void | Blob;
    download.closing = true;
    try {
      result = await download.sink.close();
    } catch {
      failTransfer(transfer, "write-error", true);
      return;
    }
    // Until close resolves the download stays abortable, so a cancel during
    // it releases the sink and this finds it settled.
    if (download.settled) {
      return;
    }
    download.settled = true;
    downloads.delete(item.id);
    handoffs.delete(item.id);
    if (transfer.closed || items.get(item.id) !== item) {
      return;
    }

    keepOrForget(item, download);
    // Kept, the partial offer becomes a complete one; forgotten, the store
    // has nothing left to serve it from.
    settlePartialSeed(item.id, keepReceived && resumeStore?.keep !== undefined);
    item.blob = result instanceof Blob ? result : undefined;
    item.savedToSink = !(result instanceof Blob);
    item.status = "done";
    item.bytes = item.size;
    item.error = undefined;
    item.errorCode = undefined;
    item.resumableBytes = undefined;
    clearRate(item);

    if (channel.readyState === "open") {
      channel.send(ACK_MESSAGE);
      // The sender closes on ack; close ourselves if it never does. Reusing
      // the stall slot means closeTransfer and dispose clear this timer too.
      transfer.stallTimer = setTimeout(
        () => closeTransfer(transfer),
        RECEIVER_CLOSE_GRACE_MS,
      );
    } else {
      closeTransfer(transfer);
    }
    emit();
    onNotice({ type: "received", item: { ...item } });
  }

  /**
   * The sender has served everything it holds. Record what that turned out to
   * be and end this transfer; `failTransfer`'s resumable path keeps the sink
   * and hands the download to another peer. `stalled` is only the fallback for
   * when no peer has any more of it than this device does — in which case the
   * prefix is kept and the person can try again later.
   */
  function handlePart(transfer: Transfer, item: FileItem, at: number) {
    const source = item.sources?.find(
      (candidate) =>
        candidate.peerId === transfer.remotePeer && candidate.offerId === item.offerId,
    );
    if (source) {
      source.have = Math.max(0, Math.min(at, item.size));
    }
    failTransfer(transfer, "stalled", false);
  }

  function attachReceiveChannel(transfer: Transfer, channel: RTCDataChannel) {
    transfer.channel = channel;
    channel.binaryType = "arraybuffer";

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      const item = items.get(transfer.itemId);
      if (!item || transfer.closed || transfer.finishing) {
        return;
      }

      if (typeof event.data === "string") {
        if (transfer.blocks && event.data.startsWith(PART_PREFIX)) {
          const at = parsePartMessage(event.data);
          if (at !== null) {
            handlePart(transfer, item, at);
          }
          return;
        }
        if (transfer.blocks && event.data.startsWith("{")) {
          receiveBlockMessage(transfer, item, event.data);
          return;
        }
        if (event.data !== DONE_MESSAGE) {
          return;
        }
        if (transfer.received !== item.size || transfer.blockReceived !== 0) {
          failTransfer(transfer, "incomplete", true);
          return;
        }
        void finishReceive(transfer, channel);
        return;
      }

      const chunk = new Uint8Array(event.data);
      transfer.received += chunk.byteLength;
      if (transfer.received > item.size) {
        failTransfer(transfer, "overflow", true);
        return;
      }
      if (transfer.blocks) {
        transfer.blockReceived += chunk.byteLength;
        if (transfer.blockReceived > BLOCK_BYTES) {
          failTransfer(transfer, "corrupt", true);
          return;
        }
        transfer.blockParts.push(chunk);
      } else {
        queueSinkWork(transfer, (download) => download.sink.write(chunk));
      }
      item.bytes = transfer.received;
      item.status = "transferring";
      sampleRate(transfer, item);
      touch(transfer);
      emitSoon();
    });

    channel.addEventListener("close", () => {
      const item = items.get(transfer.itemId);
      if (item?.status === "done") {
        closeTransfer(transfer);
      } else if (!transfer.finishing) {
        failTransfer(transfer, "closed", false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Signal handling

  /** The active source is always the first entry, so these stay in step. */
  function promoteSource(item: FileItem, source: ItemSource) {
    item.peerId = source.peerId;
    item.offerId = source.offerId;
    item.caps = source.caps;
  }

  /**
   * An incoming item already holding this exact content, or undefined. Only
   * offers that carry a `digest` can be matched: without one there is nothing
   * that says two peers mean the same bytes, so a v1 offer gets its own row
   * exactly as it always has.
   */
  function itemForContent(offer: FileOffer) {
    if (!offer.digest) {
      return undefined;
    }
    for (const item of items.values()) {
      if (
        item.direction === "incoming" &&
        item.digest === offer.digest &&
        item.size === offer.size &&
        item.status !== "revoked"
      ) {
        return item;
      }
    }
    return undefined;
  }

  /** The item a signal about `offerId` from `from` is about, if any. */
  function itemForOffer(from: PeerId, offerId: string) {
    const direct = items.get(itemKey(from, offerId));
    if (direct) {
      return direct;
    }
    for (const item of items.values()) {
      if (
        item.direction === "incoming" &&
        item.sources?.some(
          (source) => source.peerId === from && source.offerId === offerId,
        )
      ) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * Forgets what `from` was offering. Returns whether anything is left to
   * download from; the caller revokes the item when nothing is.
   */
  function dropSource(item: FileItem, from: PeerId, offerId?: string) {
    const sources = item.sources ?? [];
    const remaining = sources.filter(
      (source) =>
        source.peerId !== from ||
        (offerId !== undefined && source.offerId !== offerId),
    );
    if (remaining.length === 0) {
      return false;
    }
    if (remaining.length !== sources.length) {
      item.sources = remaining;
      if (item.peerId === from) {
        promoteSource(item, remaining[0]);
      }
    }
    return true;
  }

  /**
   * An outgoing offer for bytes the store holds — all of them, or a verified
   * prefix of `have`. The caller announces it.
   */
  function addSeed(
    key: ResumeKey,
    blockHashes: string[],
    what: { name: string; mime: string; path?: string },
    have: number,
  ): FileItem {
    const offerId = createId();
    const item: FileItem = {
      id: itemKey(selfId, offerId),
      offerId,
      name: sanitizeFileName(what.name || "file"),
      size: key.size,
      mime: what.mime,
      digest: key.digest,
      ...(what.path !== undefined && { path: sanitizeRelativePath(what.path) }),
      direction: "outgoing",
      peerId: selfId,
      ts: Date.now(),
      status: "offered",
      bytes: 0,
      activeTransfers: 0,
      completedTransfers: 0,
      seeded: true,
      ...(have < key.size && { have }),
    };
    outgoingSources.set(offerId, key);
    // Already verified block by block on the way in, so a peer pulling this
    // file is never made to wait for it to be hashed again.
    offerBlockHashes.set(offerId, blockHashes);
    addItem(item);
    return item;
  }

  /** Drops an outgoing offer and tells the room, cutting off anyone pulling it. */
  function withdraw(item: FileItem) {
    outgoingFiles.delete(item.offerId);
    outgoingSources.delete(item.offerId);
    offerBlockHashes.delete(item.offerId);
    items.delete(item.id);
    sendSignal({ type: "file-revoke", offerId: item.offerId });
    for (const transfer of [...transfers.values()]) {
      if (transfer.itemId === item.id) {
        failTransfer(transfer, "revoked", true);
      }
    }
  }

  function announcePartial(itemId: string) {
    const entry = partialSeeds.get(itemId);
    const seed = entry && items.get(itemKey(selfId, entry.offerId));
    if (!entry || !seed) {
      return;
    }
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.announced = seed.have ?? seed.size;
    announceOffer(seed);
    emitSoon();
  }

  /**
   * Keeps a download's partial offer in step with it: made once the first
   * block is verified, then re-announced as more arrives — every
   * REANNOUNCE_BYTES, or REANNOUNCE_MS after the last change, whichever comes
   * first. This is what lets the second device to get a file start serving
   * the third before it has finished.
   *
   * Only for downloads the store is keeping, since the store is where a peer's
   * request is served from.
   */
  function refreshPartialSeed(item: FileItem, download: Download) {
    const key = download.key;
    if (
      disposed ||
      !seedWhileDownloading ||
      !selfCaps.includes("partial") ||
      !key ||
      !resumeStore?.read ||
      download.verifiedBytes < BLOCK_BYTES ||
      download.verifiedBytes >= item.size
    ) {
      return;
    }
    const entry = partialSeeds.get(item.id);
    const seed = entry && items.get(itemKey(selfId, entry.offerId));
    if (!entry || !seed) {
      // Already offering this content some other way — a finished copy, say.
      if (outgoingItems().some((candidate) => candidate.digest === key.digest)) {
        return;
      }
      const created = addSeed(
        key,
        download.blockHashes,
        { name: item.name, mime: item.mime, path: item.path },
        download.verifiedBytes,
      );
      partialSeeds.set(item.id, {
        offerId: created.offerId,
        announced: 0,
        timer: null,
      });
      announcePartial(item.id);
      emit();
      return;
    }
    seed.have = download.verifiedBytes;
    if (seed.have - entry.announced >= REANNOUNCE_BYTES) {
      announcePartial(item.id);
    } else if (entry.timer === null) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        announcePartial(item.id);
      }, REANNOUNCE_MS);
    }
  }

  /**
   * The download a partial offer followed has ended. Finished and kept, the
   * offer becomes a complete one; otherwise there is nothing behind it any
   * more, and it is withdrawn.
   */
  function settlePartialSeed(itemId: string, complete: boolean) {
    const entry = partialSeeds.get(itemId);
    if (!entry) {
      return;
    }
    partialSeeds.delete(itemId);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    const seed = items.get(itemKey(selfId, entry.offerId));
    if (!seed) {
      return;
    }
    if (complete) {
      seed.have = undefined;
      announceOffer(seed);
    } else {
      withdraw(seed);
    }
    emit();
  }

  function handleOffer(from: PeerId, offer: FileOffer) {
    if (offer.size <= 0 || offer.size > limits.maxFileBytes) {
      return;
    }
    const id = itemKey(from, offer.offerId);
    const existing = items.get(id) ?? itemForOffer(from, offer.offerId);
    if (existing) {
      // Re-announced after the sender reconnected, or once its digest is ready.
      const source = existing.sources?.find(
        (candidate) => candidate.peerId === from && candidate.offerId === offer.offerId,
      );
      if (source) {
        source.caps = offer.caps;
        source.have = offer.have ?? offer.size;
      }
      if (existing.peerId === from && existing.offerId === offer.offerId) {
        existing.caps = offer.caps;
      }
      if (offer.digest && !existing.digest) {
        existing.digest = offer.digest;
        emit();
        void loadStored(existing);
      }
      if (existing.status === "revoked") {
        existing.status = "offered";
        existing.error = undefined;
        existing.errorCode = undefined;
        emit();
      }
      return;
    }

    // Another device in the room holding the same bytes is another way to get
    // them, not another file: one row, one download, several places to pull
    // it from.
    const held = itemForContent(offer);
    if (held) {
      held.sources = [
        ...(held.sources ?? []),
        {
          peerId: from,
          offerId: offer.offerId,
          // A partial offer says how much; a complete one says nothing and
          // means all of it.
          have: offer.have ?? offer.size,
          ...(offer.caps && { caps: offer.caps }),
        },
      ];
      emit();
      return;
    }

    // This device is the one offering it — the file it shared, passed back by
    // a peer that received it. There is nothing to download.
    if (
      offer.digest &&
      outgoingItems().some(
        (candidate) => candidate.digest === offer.digest && candidate.size === offer.size,
      )
    ) {
      return;
    }

    const item: FileItem = {
      id,
      offerId: offer.offerId,
      name: sanitizeFileName(offer.name),
      size: offer.size,
      mime: offer.mime,
      caps: offer.caps,
      ...(offer.digest !== undefined && { digest: offer.digest }),
      ...(offer.path !== undefined && { path: sanitizeRelativePath(offer.path) }),
      ...(offer.batchId !== undefined && { batchId: offer.batchId }),
      direction: "incoming",
      peerId: from,
      ts: Date.now(),
      status: "offered",
      bytes: 0,
      activeTransfers: 0,
      completedTransfers: 0,
      sources: [
        {
          peerId: from,
          offerId: offer.offerId,
          // A partial offer says how much; a complete one says nothing and
          // means all of it.
          have: offer.have ?? offer.size,
          ...(offer.caps && { caps: offer.caps }),
        },
      ],
    };
    addItem(item);
    emit();
    void loadStored(item);
    onNotice({ type: "incoming-offer", item: { ...item } });
  }

  function revokeIncoming(item: FileItem, code: "revoked" | "sender-left") {
    if (item.status === "offered" || item.status === "failed" || item.status === "paused") {
      item.status = "revoked";
      item.error = undefined;
      item.errorCode = undefined;
      // Nothing left to resume from, so don't keep the partial file open.
      forgetStored(item);
      item.resumableBytes = undefined;
      item.bytes = 0;
      releaseDownload(item.id);
      return true;
    }
    if (item.status === "connecting" || item.status === "transferring") {
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === item.id) {
          failTransfer(transfer, code, false);
        }
      }
    }
    return false;
  }

  async function handleDescription(
    transfer: Transfer,
    description: RTCSessionDescriptionInit,
  ) {
    try {
      if (description.type === "offer" && transfer.role === "receive") {
        await transfer.pc.setRemoteDescription(description);
        await flushCandidates(transfer);
        const answer = await transfer.pc.createAnswer();
        await transfer.pc.setLocalDescription(answer);
        sendSignal(
          {
            type: "rtc-description",
            transferId: transfer.id,
            description: { type: "answer", sdp: answer.sdp ?? "" },
          },
          transfer.remotePeer,
        );
      } else if (description.type === "answer" && transfer.role === "send") {
        await transfer.pc.setRemoteDescription(description);
        await flushCandidates(transfer);
      }
    } catch {
      failTransfer(transfer, "negotiation", true);
    }
  }

  /**
   * Feed every signal from `from` in here. Signals from other peers are
   * untrusted: validate them with `parseFileSignal` first.
   */
  function handleSignal(from: PeerId, payload: FileSignal) {
    if (disposed || from === selfId) {
      return;
    }

    switch (payload.type) {
      case "hello":
        if (payload.caps) {
          peerCaps.set(from, payload.caps);
        } else {
          peerCaps.delete(from);
        }
        for (const item of outgoingItems()) {
          announceOffer(item, from);
        }
        return;

      case "file-offer":
        handleOffer(from, payload);
        return;

      case "file-revoke": {
        const item = itemForOffer(from, payload.offerId);
        if (!item || item.direction !== "incoming") {
          return;
        }
        // Only the last source leaving takes the file away; before that this
        // is one device of several stopping.
        if (dropSource(item, from, payload.offerId)) {
          emit();
        } else if (revokeIncoming(item, "revoked")) {
          emit();
        }
        return;
      }

      case "peer-left": {
        peerCaps.delete(from);
        // Established data channels are P2P and outlive the signaling socket,
        // so only idle offers are dropped here; in-flight transfers settle on
        // their own.
        let changed = false;
        for (const item of items.values()) {
          if (item.direction !== "incoming") {
            continue;
          }
          const offered = item.sources?.some((source) => source.peerId === from);
          if (!offered) {
            continue;
          }
          changed = dropSource(item, from)
            ? true
            : revokeIncoming(item, "sender-left") || changed;
        }
        if (changed) {
          emit();
        }
        return;
      }

      case "file-request":
        void startSend(from, payload);
        return;

      case "rtc-description": {
        const transfer = transfers.get(payload.transferId);
        if (transfer && transfer.remotePeer === from) {
          void handleDescription(transfer, payload.description);
        }
        return;
      }

      case "rtc-candidate": {
        const transfer = transfers.get(payload.transferId);
        if (!transfer || transfer.remotePeer !== from) {
          return;
        }
        const candidate: RTCIceCandidateInit = {
          candidate: payload.candidate.candidate,
          sdpMid: payload.candidate.sdpMid ?? null,
          sdpMLineIndex: payload.candidate.sdpMLineIndex ?? null,
          usernameFragment: payload.candidate.usernameFragment ?? null,
        };
        if (transfer.pc.remoteDescription) {
          transfer.pc.addIceCandidate(candidate).catch(() => {});
        } else {
          transfer.pendingCandidates.push(candidate);
        }
        return;
      }

      case "transfer-cancel": {
        const transfer = transfers.get(payload.transferId);
        if (transfer && transfer.remotePeer === from) {
          failTransfer(transfer, "remote-canceled", false, payload.reason);
        }
        return;
      }
    }
  }

  /**
   * The body of `request`, as a plain closure so that `resume` can reach it
   * without going through `this` — the manager is a returned object literal,
   * and destructuring one of its methods is the idiomatic way to use it.
   */
  function requestItem(id: string, options: RequestOptions = {}) {
    const item = items.get(id);
    if (
      !item ||
      item.direction !== "incoming" ||
      (item.status !== "offered" &&
        item.status !== "failed" &&
        item.status !== "paused")
    ) {
      if (options.sink) {
        abortSink(options.sink);
      }
      return false;
    }

    // Asked for by hand: whichever peers let an earlier attempt down get
    // another chance, and the handoff budget starts again.
    handoffs.delete(id);

    const retained = downloads.get(id);
    const resuming =
      retained !== undefined && hasCap("blocks", item.caps) && hasCap("resume", item.caps);
    if (resuming) {
      // The retained sink already holds the verified prefix.
      if (options.sink) {
        abortSink(options.sink);
      }
      const next = pickSource(item, retained.verifiedBytes);
      if (next) {
        promoteSource(item, next);
      }
      return beginReceive(item, retained, true);
    }
    const start = pickSource(item, 0);
    if (start) {
      promoteSource(item, start);
    }

    // Nothing in memory, but the store may still have this file from an
    // earlier page load — or can give it somewhere durable to start.
    const key = resumeKeyFor(item);
    if (resumeStore && key && canStore(item) && !options.sink) {
      const state = stored.get(id) ?? { verifiedBytes: 0, blockHashes: [] };
      item.status = "connecting";
      item.error = undefined;
      item.errorCode = undefined;
      emit();
      void beginStoredReceive(item, key, state);
      return true;
    }

    if (!options.sink && item.size > limits.maxMemoryBytes) {
      onNotice({
        type: "failed",
        item: { ...item },
        code: "needs-sink",
        message: MESSAGES["needs-sink"],
      });
      return false;
    }
    releaseDownload(id);
    const download = createDownload(options.sink ?? createMemorySink(item.mime));
    downloads.set(id, download);
    const keepOnFailure = false;
    return beginReceive(item, download, keepOnFailure);
  }

  // ---------------------------------------------------------------------------
  // Public API

  return {
    handleSignal,

    /** Call once signaling is ready: asks peers for their offers and re-announces ours. */
    announce() {
      if (
        !sendSignal({
          type: "hello",
          ...(selfCaps.length > 0 && { caps: selfCaps }),
        })
      ) {
        return;
      }
      for (const item of outgoingItems()) {
        announceOffer(item);
      }
    },

    /**
     * Announce files to every peer. Pass `{ file, path }` to say which folder a
     * file sits in, and `batch: true` to mark the files as one group.
     */
    offerFiles(entries: Array<File | OfferEntry>, options: OfferOptions = {}) {
      const rejected: OfferRejection[] = [];
      let offered = 0;
      const batchId = options.batch ? createId() : undefined;

      for (const entry of entries) {
        // Structural, not `entry instanceof File`: a File from another realm
        // — an iframe, a worker, a polyfill, Node's own — is still a file,
        // and an OfferEntry is told apart by carrying one rather than being
        // one. The library types its transports structurally for the same
        // reason.
        const { file, path } = "file" in entry ? entry : { file: entry, path: undefined };
        if (file.size === 0) {
          rejected.push({ file, code: "empty", limit: 0 });
          continue;
        }
        if (file.size > limits.maxFileBytes) {
          rejected.push({ file, code: "too-large", limit: limits.maxFileBytes });
          continue;
        }

        const offerId = createId();
        const item: FileItem = {
          id: itemKey(selfId, offerId),
          offerId,
          name: sanitizeFileName(file.name || "file"),
          size: file.size,
          mime: file.type,
          ...(path !== undefined && { path: sanitizeRelativePath(path) }),
          ...(batchId !== undefined && { batchId }),
          direction: "outgoing",
          peerId: selfId,
          ts: Date.now(),
          status: "offered",
          bytes: 0,
          activeTransfers: 0,
          completedTransfers: 0,
        };
        outgoingFiles.set(offerId, file);
        addItem(item);
        announceOffer(item);
        offered += 1;
        if (options.digest && selfCaps.includes("blocks")) {
          item.hashedBytes = 0;
          void hashOffer(item, file);
        }
      }

      if (offered > 0) {
        emit();
      }
      return { offered, rejected };
    },

    /**
     * Re-offer files this device already holds, as `resume.list()` returns
     * them. The offer carries the original digest, name, size, mime and path
     * under a fresh offer id; the bytes are read from the store only when a
     * peer actually asks for them.
     */
    seed(entries: StoredFile[]) {
      const offered: FileItem[] = [];
      const already = new Set(
        outgoingItems()
          .map((item) => item.digest)
          .filter((digest): digest is string => digest !== undefined),
      );
      for (const entry of entries) {
        const { key, state, meta } = entry;
        if (
          !HASH_PATTERN.test(key.digest) ||
          key.size <= 0 ||
          key.size > limits.maxFileBytes ||
          state.verifiedBytes <= 0 ||
          state.verifiedBytes > key.size ||
          // A prefix can only be offered where there is a way to say so.
          (state.verifiedBytes < key.size && !selfCaps.includes("partial")) ||
          already.has(key.digest)
        ) {
          continue;
        }
        already.add(key.digest);
        const item = addSeed(
          key,
          state.blockHashes.slice(),
          { name: meta.name || key.name, mime: meta.mime, path: meta.path },
          state.verifiedBytes,
        );
        announceOffer(item);
        offered.push({ ...item });
      }
      if (offered.length > 0) {
        emit();
      }
      return offered;
    },

    /** Stop sharing an outgoing file. Devices mid-download are cut off. */
    revoke(id: string) {
      const item = items.get(id);
      if (!item || item.direction !== "outgoing") {
        return;
      }
      for (const [incomingId, entry] of partialSeeds) {
        if (entry.offerId === item.offerId) {
          if (entry.timer !== null) {
            clearTimeout(entry.timer);
          }
          partialSeeds.delete(incomingId);
        }
      }
      withdraw(item);
      emit();
    },

    /**
     * Ask the sender for an incoming file. Returns false if the item can't be
     * downloaded or signaling is unavailable; a passed sink is aborted then.
     * A file over `limits.maxMemoryBytes` with no sink also returns false, with
     * a `needs-sink` failure notice.
     */
    request: requestItem,

    /**
     * Pause an incoming download, keeping every verified block. `resume` (or
     * `request`) picks it up from there, into the same sink. Only possible when
     * both peers support `resume`; returns false otherwise, and the caller can
     * offer `cancel` instead.
     */
    pause(id: string) {
      const item = items.get(id);
      if (
        !item ||
        item.status === "done" ||
        !hasCap("blocks", item.caps) ||
        !hasCap("resume", item.caps)
      ) {
        return false;
      }
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === id && transfer.role === "receive" && !transfer.finishing) {
          failTransfer(transfer, "paused", true);
          return true;
        }
      }
      return false;
    },

    /**
     * Continue a paused or failed download. The same as calling `request`
     * again — and it calls the function, not `this.request`, so that a
     * destructured `const { resume } = createFileTransferManager(…)` works
     * like every other method here.
     */
    resume(id: string, options: RequestOptions = {}) {
      return requestItem(id, options);
    },

    /** Abort an in-progress incoming download. */
    cancel(id: string) {
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === id && transfer.role === "receive") {
          failTransfer(transfer, "canceled", true);
        }
      }
    },

    /** Remove a finished, failed, or revoked incoming item from the list. */
    dismiss(id: string) {
      const item = items.get(id);
      if (item?.direction === "incoming" && !hasActiveTransfer(id)) {
        forgetStored(item);
        items.delete(id);
        releaseDownload(id);
        emit();
      }
    },

    getItems: snapshot,

    getItem(id: string) {
      const item = items.get(id);
      return item ? { ...item } : undefined;
    },

    dispose() {
      // First, so releasing the downloads below doesn't withdraw their partial
      // offers one signal at a time: a tab going away says so once, through
      // its signaling layer's peer-left.
      for (const entry of partialSeeds.values()) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer);
        }
      }
      partialSeeds.clear();
      for (const transfer of [...transfers.values()]) {
        closeTransfer(transfer);
      }
      for (const id of [...downloads.keys()]) {
        releaseDownload(id);
      }
      items.clear();
      outgoingFiles.clear();
      outgoingSources.clear();
      offerBlockHashes.clear();
      peerCaps.clear();
      handoffs.clear();
      emit();
      disposed = true;
    },
  };
}
