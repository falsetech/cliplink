import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_LIMITS,
  createRandomId,
  type TransferLimits,
} from "./defaults.ts";
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
  /** The other peer canceled; `message` is the reason it sent. */
  | "remote-canceled";

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
  /** Devices currently pulling / that finished pulling this file (outgoing only). */
  activeTransfers: number;
  completedTransfers: number;
};

/**
 * Where an incoming file's bytes go. `request` takes ownership: the manager
 * calls `close` once every byte has been written, or `abort` if the download
 * fails or never starts. Writes are serialized, and a sink that throws fails
 * the transfer with `write-error`.
 *
 * The receiver cannot slow the sender down, so bytes that arrive faster than
 * the sink writes them queue in memory.
 */
export type FileSink = {
  write(chunk: Uint8Array<ArrayBuffer>): void | Promise<void>;
  /** Return a Blob to expose it as `item.blob`. */
  close(): void | Blob | Promise<void | Blob>;
  abort(): void | Promise<void>;
};

export type RequestOptions = {
  /** Defaults to an in-memory sink that assembles a Blob. */
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
  iceServers?: RTCIceServer[];
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
};

const DONE_MESSAGE = "done";
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
};

/** Failures worth resuming after: the data so far is good, the link wasn't. */
const RESUMABLE = new Set<FailureCode>([
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

async function sha256Hex(data: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

export type FileTransferManager = ReturnType<typeof createFileTransferManager>;

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

/** Replaces path separators and control characters in peer-supplied names. */
export function sanitizeFileName(name: string) {
  const cleaned = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return char === "/" || char === "\\" || code < 32 || code === 127 ? "_" : char;
  })
    .join("")
    .trim();
  return cleaned || "file";
}

/**
 * Peer-to-peer file transfer over WebRTC data channels.
 *
 * Senders announce file metadata over the signaling channel and keep only a
 * `File` reference in memory. A receiver that asks for a file gets its own
 * RTCPeerConnection; bytes flow peer-to-peer and never pass through the
 * signaling server.
 */
export function createFileTransferManager(options: FileTransferOptions) {
  const { peerId: selfId, sendSignal, onItemsChange } = options;
  const onNotice = options.onNotice ?? (() => {});
  const iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
  const limits: TransferLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const createId = options.createId ?? createRandomId;
  const newPeerConnection =
    options.createPeerConnection ?? ((config) => new RTCPeerConnection(config));
  const advertised = new Set(
    options.capabilities ?? (hasSubtleCrypto() ? CAPABILITIES : []),
  );
  const selfCaps: Capability[] = advertised.has("blocks")
    ? CAPABILITIES.filter((cap) => advertised.has(cap))
    : [];

  const items = new Map<string, FileItem>();
  const outgoingFiles = new Map<string, File>();
  const transfers = new Map<string, Transfer>();
  /** Incoming item id → its download, while one is running or can resume. */
  const downloads = new Map<string, Download>();
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
    const snapshot = [...items.values()]
      .sort((left, right) => right.ts - left.ts)
      .map((item) => ({ ...item }));
    onItemsChange(snapshot);
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
    };
  }

  function hasCap(cap: Capability, remote: Capability[] | undefined) {
    return selfCaps.includes(cap) && remote?.includes(cap) === true;
  }

  function createDownload(sink: FileSink): Download {
    return {
      sink,
      writes: Promise.resolve(),
      verifiedBytes: 0,
      pending: 0,
      closing: false,
      settled: false,
    };
  }

  /** Forget a download and abort its sink once queued work has drained. */
  function releaseDownload(itemId: string) {
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

  function touch(transfer: Transfer) {
    if (transfer.stallTimer !== null) {
      clearTimeout(transfer.stallTimer);
    }
    transfer.stallTimer = setTimeout(() => {
      failTransfer(transfer, "stalled", true);
    }, limits.stallMs);
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
      if (retain && downloads.get(item.id) === download && !download.settled) {
        item.resumableBytes = download.verifiedBytes;
      } else {
        releaseDownload(item.id);
        item.resumableBytes = undefined;
      }
      item.status = "failed";
      item.error = message;
      item.errorCode = code;
      item.bytes = item.resumableBytes ?? 0;
      clearRate(item);
      emit();
      onNotice({ type: "failed", item: { ...item }, code, message });
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
    const pc = newPeerConnection({ iceServers });

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
      if (current && pc.connectionState === "failed") {
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

  /** Sends one chunk once the channel has room. False if the transfer ended. */
  async function sendChunk(
    transfer: Transfer,
    channel: RTCDataChannel,
    chunk: ArrayBuffer | string,
  ) {
    while (channel.bufferedAmount > limits.bufferHighBytes) {
      if (transfer.closed || channel.readyState !== "open") {
        return false;
      }
      await waitForDrain(channel);
    }
    if (transfer.closed || channel.readyState !== "open") {
      return false;
    }
    if (typeof chunk === "string") {
      channel.send(chunk);
    } else {
      channel.send(chunk);
    }
    touch(transfer);
    return true;
  }

  async function pumpFile(transfer: Transfer, channel: RTCDataChannel, file: File) {
    const maxMessage = transfer.pc.sctp?.maxMessageSize;
    const chunkSize =
      maxMessage && maxMessage > 0
        ? Math.min(limits.chunkBytes, maxMessage)
        : limits.chunkBytes;

    try {
      if (transfer.blocks) {
        for (let start = transfer.offset; start < file.size; start += BLOCK_BYTES) {
          const block = new Uint8Array(
            await file.slice(start, start + BLOCK_BYTES).arrayBuffer(),
          );
          const hash = await sha256Hex(block);
          for (let offset = 0; offset < block.byteLength; offset += chunkSize) {
            const chunk = block.buffer.slice(offset, offset + chunkSize);
            if (!(await sendChunk(transfer, channel, chunk))) {
              return;
            }
          }
          const index = start / BLOCK_BYTES;
          const message = JSON.stringify({ t: "block", i: index, h: hash });
          if (!(await sendChunk(transfer, channel, message))) {
            return;
          }
        }
      } else {
        for (let offset = 0; offset < file.size; ) {
          if (transfer.closed || channel.readyState !== "open") {
            return;
          }
          const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
          if (!(await sendChunk(transfer, channel, chunk))) {
            return;
          }
          offset += chunk.byteLength;
        }
      }
      if (!(await sendChunk(transfer, channel, DONE_MESSAGE))) {
        return;
      }
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
    setup: Pick<Transfer, "download" | "blocks" | "offset">,
  ): Transfer {
    const base = {
      id,
      role,
      remotePeer,
      itemId,
      channel: null,
      pendingCandidates: [],
      stallTimer: null,
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
    };
    return { ...base, pc: createPeerConnection(base) };
  }

  async function startSend(
    from: PeerId,
    request: Extract<FileSignal, { type: "file-request" }>,
  ) {
    const { offerId, transferId } = request;
    const id = itemKey(selfId, offerId);
    const file = outgoingFiles.get(offerId);
    const item = items.get(id);
    if (!file || !item) {
      sendSignal(
        { type: "transfer-cancel", transferId, reason: "This file is no longer shared." },
        from,
      );
      return;
    }
    if (transfers.has(transferId)) {
      return;
    }

    const blocks = hasCap("blocks", request.caps);
    const offset = blocks && selfCaps.includes("resume") ? (request.offset ?? 0) : 0;
    if (offset > file.size || (offset % BLOCK_BYTES !== 0 && offset !== file.size)) {
      sendSignal(
        { type: "transfer-cancel", transferId, reason: "Can't resume from there." },
        from,
      );
      return;
    }

    const transfer = newTransfer(transferId, "send", from, id, {
      download: null,
      blocks,
      offset,
    });
    transfers.set(transferId, transfer);
    item.activeTransfers += 1;
    emit();

    const channel = transfer.pc.createDataChannel("file", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = limits.bufferLowBytes;
    transfer.channel = channel;

    channel.addEventListener("open", () => {
      touch(transfer);
      void pumpFile(transfer, channel, file);
    });
    channel.addEventListener("message", (event) => {
      if (event.data === ACK_MESSAGE) {
        finishSend(transfer, true);
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
      .then(() => (transfer.discard || download.settled ? undefined : work(download)))
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
      download.verifiedBytes += block.byteLength;
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
    if (transfer.closed || items.get(item.id) !== item) {
      return;
    }

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

  function attachReceiveChannel(transfer: Transfer, channel: RTCDataChannel) {
    transfer.channel = channel;
    channel.binaryType = "arraybuffer";

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      const item = items.get(transfer.itemId);
      if (!item || transfer.closed || transfer.finishing) {
        return;
      }

      if (typeof event.data === "string") {
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

  function handleOffer(from: PeerId, offer: FileOffer) {
    if (offer.size <= 0 || offer.size > limits.maxFileBytes) {
      return;
    }
    const id = itemKey(from, offer.offerId);
    const existing = items.get(id);
    if (existing) {
      // Re-announced after the sender reconnected.
      existing.caps = offer.caps;
      if (existing.status === "revoked") {
        existing.status = "offered";
        existing.error = undefined;
        existing.errorCode = undefined;
        emit();
      }
      return;
    }

    const item: FileItem = {
      id,
      offerId: offer.offerId,
      name: sanitizeFileName(offer.name),
      size: offer.size,
      mime: offer.mime,
      caps: offer.caps,
      direction: "incoming",
      peerId: from,
      ts: Date.now(),
      status: "offered",
      bytes: 0,
      activeTransfers: 0,
      completedTransfers: 0,
    };
    addItem(item);
    emit();
    onNotice({ type: "incoming-offer", item: { ...item } });
  }

  function revokeIncoming(item: FileItem, code: "revoked" | "sender-left") {
    if (item.status === "offered" || item.status === "failed") {
      item.status = "revoked";
      item.error = undefined;
      item.errorCode = undefined;
      // Nothing left to resume from, so don't keep the partial file open.
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
        for (const item of outgoingItems()) {
          sendSignal(toOffer(item), from);
        }
        return;

      case "file-offer":
        handleOffer(from, payload);
        return;

      case "file-revoke": {
        const item = items.get(itemKey(from, payload.offerId));
        if (item && revokeIncoming(item, "revoked")) {
          emit();
        }
        return;
      }

      case "peer-left": {
        // Established data channels are P2P and outlive the signaling socket,
        // so only idle offers are dropped here; in-flight transfers settle on
        // their own.
        let changed = false;
        for (const item of items.values()) {
          if (item.direction === "incoming" && item.peerId === from) {
            changed = revokeIncoming(item, "sender-left") || changed;
          }
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

  // ---------------------------------------------------------------------------
  // Public API

  return {
    handleSignal,

    /** Call once signaling is ready: asks peers for their offers and re-announces ours. */
    announce() {
      if (!sendSignal({ type: "hello" })) {
        return;
      }
      for (const item of outgoingItems()) {
        sendSignal(toOffer(item));
      }
    },

    offerFiles(files: File[]) {
      const rejected: OfferRejection[] = [];
      let offered = 0;

      for (const file of files) {
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
        sendSignal(toOffer(item));
        offered += 1;
      }

      if (offered > 0) {
        emit();
      }
      return { offered, rejected };
    },

    /** Stop sharing an outgoing file. Devices mid-download are cut off. */
    revoke(id: string) {
      const item = items.get(id);
      if (!item || item.direction !== "outgoing") {
        return;
      }
      outgoingFiles.delete(item.offerId);
      items.delete(id);
      sendSignal({ type: "file-revoke", offerId: item.offerId });
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === id) {
          failTransfer(transfer, "revoked", true);
        }
      }
      emit();
    },

    /**
     * Ask the sender for an incoming file. Returns false if the item can't be
     * downloaded or signaling is unavailable; a passed sink is aborted then.
     */
    request(id: string, options: RequestOptions = {}) {
      const item = items.get(id);
      if (
        !item ||
        item.direction !== "incoming" ||
        (item.status !== "offered" && item.status !== "failed")
      ) {
        if (options.sink) {
          abortSink(options.sink);
        }
        return false;
      }

      const retained = downloads.get(id);
      const resuming =
        retained !== undefined && hasCap("blocks", item.caps) && hasCap("resume", item.caps);
      let download: Download;
      if (resuming) {
        // The retained sink already holds the verified prefix.
        if (options.sink) {
          abortSink(options.sink);
        }
        download = retained;
      } else {
        releaseDownload(id);
        download = createDownload(options.sink ?? createMemorySink(item.mime));
        downloads.set(id, download);
      }
      const blocks = hasCap("blocks", item.caps);
      const offset = resuming ? download.verifiedBytes : 0;

      const transferId = createId();
      const transfer = newTransfer(transferId, "receive", item.peerId, id, {
        download,
        blocks,
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
        if (!resuming) {
          releaseDownload(id);
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
        items.delete(id);
        releaseDownload(id);
        emit();
      }
    },

    dispose() {
      for (const transfer of [...transfers.values()]) {
        closeTransfer(transfer);
      }
      for (const id of [...downloads.keys()]) {
        releaseDownload(id);
      }
      items.clear();
      outgoingFiles.clear();
      emit();
      disposed = true;
    },
  };
}
