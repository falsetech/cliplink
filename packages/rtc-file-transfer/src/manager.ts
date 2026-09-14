import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_LIMITS,
  createRandomId,
  type TransferLimits,
} from "./defaults.ts";
import type { FileOffer, FileSignal, PeerId, RtcCandidate } from "./protocol.ts";

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
  /** Assembled file once an incoming transfer completes. Lives in memory only. */
  blob?: Blob;
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
};

type Timer = ReturnType<typeof setTimeout>;

type Transfer = {
  id: string;
  role: "send" | "receive";
  remotePeer: PeerId;
  itemId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  stallTimer: Timer | null;
  chunks: ArrayBuffer[];
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
};

export type FileTransferManager = ReturnType<typeof createFileTransferManager>;

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

  const items = new Map<string, FileItem>();
  const outgoingFiles = new Map<string, File>();
  const transfers = new Map<string, Transfer>();
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
    };
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
    transfer.chunks = [];
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
    const item = items.get(transfer.itemId);
    if (item && item.status !== "done") {
      item.status = "failed";
      item.error = message;
      item.errorCode = code;
      item.bytes = 0;
      clearRate(item);
      emit();
      onNotice({ type: "failed", item: { ...item }, code, message });
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

  async function pumpFile(transfer: Transfer, channel: RTCDataChannel, file: File) {
    const maxMessage = transfer.pc.sctp?.maxMessageSize;
    const chunkSize =
      maxMessage && maxMessage > 0
        ? Math.min(limits.chunkBytes, maxMessage)
        : limits.chunkBytes;

    try {
      let offset = 0;
      while (offset < file.size) {
        if (transfer.closed || channel.readyState !== "open") {
          return;
        }
        if (channel.bufferedAmount > limits.bufferHighBytes) {
          await waitForDrain(channel);
          continue;
        }
        const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
        if (transfer.closed || channel.readyState !== "open") {
          return;
        }
        channel.send(chunk);
        offset += chunk.byteLength;
        touch(transfer);
      }
      channel.send(DONE_MESSAGE);
      transfer.doneSent = true;
    } catch {
      failTransfer(transfer, "read-error", true);
    }
  }

  function newTransfer(
    id: string,
    role: Transfer["role"],
    remotePeer: PeerId,
    itemId: string,
  ): Transfer {
    const base = {
      id,
      role,
      remotePeer,
      itemId,
      channel: null,
      pendingCandidates: [],
      stallTimer: null,
      chunks: [],
      received: 0,
      rateAt: 0,
      rateBytes: 0,
      rate: 0,
      doneSent: false,
      closed: false,
    };
    return { ...base, pc: createPeerConnection(base) };
  }

  async function startSend(from: PeerId, offerId: string, transferId: string) {
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

    const transfer = newTransfer(transferId, "send", from, id);
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
      // A close right after "done" means the receiver already has every byte.
      finishSend(transfer, transfer.doneSent);
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

  function attachReceiveChannel(transfer: Transfer, channel: RTCDataChannel) {
    transfer.channel = channel;
    channel.binaryType = "arraybuffer";

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      const item = items.get(transfer.itemId);
      if (!item || transfer.closed) {
        return;
      }

      if (typeof event.data === "string") {
        if (event.data !== DONE_MESSAGE) {
          return;
        }
        if (transfer.received !== item.size) {
          failTransfer(transfer, "incomplete", true);
          return;
        }
        item.blob = new Blob(transfer.chunks, {
          type: item.mime || "application/octet-stream",
        });
        item.status = "done";
        item.bytes = item.size;
        item.error = undefined;
        item.errorCode = undefined;
        clearRate(item);
        transfer.chunks = [];
        channel.send(ACK_MESSAGE);
        if (transfer.stallTimer !== null) {
          clearTimeout(transfer.stallTimer);
        }
        // The sender closes on ack; close ourselves if it never does. Reusing
        // the stall slot means closeTransfer and dispose clear this timer too.
        transfer.stallTimer = setTimeout(
          () => closeTransfer(transfer),
          RECEIVER_CLOSE_GRACE_MS,
        );
        emit();
        onNotice({ type: "received", item: { ...item } });
        return;
      }

      transfer.received += event.data.byteLength;
      if (transfer.received > item.size) {
        failTransfer(transfer, "overflow", true);
        return;
      }
      transfer.chunks.push(event.data);
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
      } else {
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
        void startSend(from, payload.offerId, payload.transferId);
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

    /** Ask the sender for an incoming file. Returns false if signaling is unavailable. */
    request(id: string) {
      const item = items.get(id);
      if (
        !item ||
        item.direction !== "incoming" ||
        (item.status !== "offered" && item.status !== "failed")
      ) {
        return false;
      }

      const transferId = createId();
      const transfer = newTransfer(transferId, "receive", item.peerId, id);
      transfer.pc.addEventListener("datachannel", (event) => {
        attachReceiveChannel(transfer, event.channel);
      });

      if (
        !sendSignal(
          { type: "file-request", offerId: item.offerId, transferId },
          item.peerId,
        )
      ) {
        transfer.pc.close();
        return false;
      }

      transfers.set(transferId, transfer);
      item.status = "connecting";
      item.bytes = 0;
      item.error = undefined;
      item.errorCode = undefined;
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
        emit();
      }
    },

    dispose() {
      for (const transfer of [...transfers.values()]) {
        closeTransfer(transfer);
      }
      items.clear();
      outgoingFiles.clear();
      emit();
      disposed = true;
    },
  };
}
