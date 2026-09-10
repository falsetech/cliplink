import {
  DEFAULT_ICE_SERVERS,
  FILE_BUFFER_HIGH_BYTES,
  FILE_BUFFER_LOW_BYTES,
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_SESSION_FILES,
  TRANSFER_STALL_MS,
} from "@/lib/cliplink/constants";
import { createRandomId } from "@/lib/cliplink/session";
import type {
  FileOffer,
  PeerId,
  RtcCandidate,
  SignalPayload,
} from "@/lib/cliplink/types";

export type FileItemStatus =
  | "offered"
  | "connecting"
  | "transferring"
  | "done"
  | "failed"
  | "revoked";

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
  /** Devices currently pulling / that finished pulling this file (outgoing only). */
  activeTransfers: number;
  completedTransfers: number;
};

export type TransferNotice =
  | { type: "incoming-offer"; item: FileItem }
  | { type: "received"; item: FileItem }
  | { type: "failed"; item: FileItem; message: string };

type ManagerOptions = {
  peerId: PeerId;
  sendSignal: (payload: SignalPayload, to?: PeerId) => boolean;
  onItemsChange: (items: FileItem[]) => void;
  onNotice: (notice: TransferNotice) => void;
  iceServers?: RTCIceServer[];
};

type Transfer = {
  id: string;
  role: "send" | "receive";
  remotePeer: PeerId;
  itemId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  stallTimer: number | null;
  chunks: ArrayBuffer[];
  received: number;
  doneSent: boolean;
  closed: boolean;
};

const DONE_MESSAGE = "done";
const ACK_MESSAGE = "ack";
const PROGRESS_EMIT_MS = 100;
const RECEIVER_CLOSE_GRACE_MS = 5_000;
const NAT_ERROR =
  "Couldn't connect directly to the other device. This network blocks peer-to-peer.";

export type FileTransferManager = ReturnType<typeof createFileTransferManager>;

function itemKey(peerId: PeerId, offerId: string) {
  return `${peerId}:${offerId}`;
}

/** Replaces path separators and control characters in peer-supplied names. */
function sanitizeFileName(name: string) {
  const cleaned = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return char === "/" || char === "\\" || code < 32 || code === 127 ? "_" : char;
  })
    .join("")
    .trim();
  return cleaned || "file";
}

/** Reads `NEXT_PUBLIC_ICE_SERVERS` (JSON array) so a TURN relay can be added without code changes. */
export function resolveIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) {
    return DEFAULT_ICE_SERVERS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as RTCIceServer[])
      : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

/**
 * Peer-to-peer file transfer over WebRTC data channels.
 *
 * Senders announce file metadata over the signaling channel and keep only a
 * `File` reference in memory. A receiver that asks for a file gets its own
 * RTCPeerConnection; bytes flow browser-to-browser and are never stored or
 * relayed by the server.
 */
export function createFileTransferManager(options: ManagerOptions) {
  const { peerId: selfId, sendSignal, onItemsChange, onNotice } = options;
  const iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;

  const items = new Map<string, FileItem>();
  const outgoingFiles = new Map<string, File>();
  const transfers = new Map<string, Transfer>();
  let emitTimer: number | null = null;
  let disposed = false;

  // ---------------------------------------------------------------------------
  // State emission

  function emit() {
    if (emitTimer !== null) {
      window.clearTimeout(emitTimer);
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
      emitTimer = window.setTimeout(emit, PROGRESS_EMIT_MS);
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

    // Evict the oldest idle items beyond the session cap.
    if (items.size > MAX_SESSION_FILES) {
      const oldestFirst = [...items.values()].sort((a, b) => a.ts - b.ts);
      for (const candidate of oldestFirst) {
        if (items.size <= MAX_SESSION_FILES) {
          break;
        }
        if (candidate.direction === "incoming" && !hasActiveTransfer(candidate.id)) {
          items.delete(candidate.id);
        }
      }
    }
  }

  function toOffer(item: FileItem): SignalPayload {
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

  function touch(transfer: Transfer) {
    if (transfer.stallTimer !== null) {
      window.clearTimeout(transfer.stallTimer);
    }
    transfer.stallTimer = window.setTimeout(() => {
      failTransfer(transfer, "The transfer stalled. Try again.", true);
    }, TRANSFER_STALL_MS);
  }

  function closeTransfer(transfer: Transfer) {
    if (transfer.closed) {
      return false;
    }
    transfer.closed = true;
    if (transfer.stallTimer !== null) {
      window.clearTimeout(transfer.stallTimer);
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

  function failTransfer(transfer: Transfer, message: string, notifyRemote: boolean) {
    if (transfer.closed) {
      return;
    }
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
      item.bytes = 0;
      emit();
      onNotice({ type: "failed", item: { ...item }, message });
    }
  }

  function createPeerConnection(transfer: Omit<Transfer, "pc">): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers });

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
        failTransfer(current, NAT_ERROR, true);
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
      maxMessage && maxMessage > 0 ? Math.min(FILE_CHUNK_BYTES, maxMessage) : FILE_CHUNK_BYTES;

    try {
      let offset = 0;
      while (offset < file.size) {
        if (transfer.closed || channel.readyState !== "open") {
          return;
        }
        if (channel.bufferedAmount > FILE_BUFFER_HIGH_BYTES) {
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
      failTransfer(transfer, "Couldn't read the file on the sending device.", true);
    }
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

    const base = {
      id: transferId,
      role: "send" as const,
      remotePeer: from,
      itemId: id,
      channel: null,
      pendingCandidates: [],
      stallTimer: null,
      chunks: [],
      received: 0,
      doneSent: false,
      closed: false,
    };
    const transfer: Transfer = { ...base, pc: createPeerConnection(base) };
    transfers.set(transferId, transfer);
    item.activeTransfers += 1;
    emit();

    const channel = transfer.pc.createDataChannel("file", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = FILE_BUFFER_LOW_BYTES;
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
      failTransfer(transfer, "Couldn't start the transfer.", true);
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
          failTransfer(transfer, "The file arrived incomplete. Try again.", true);
          return;
        }
        item.blob = new Blob(transfer.chunks, {
          type: item.mime || "application/octet-stream",
        });
        item.status = "done";
        item.bytes = item.size;
        item.error = undefined;
        transfer.chunks = [];
        channel.send(ACK_MESSAGE);
        if (transfer.stallTimer !== null) {
          window.clearTimeout(transfer.stallTimer);
          transfer.stallTimer = null;
        }
        // The sender closes on ack; close ourselves if it never does.
        window.setTimeout(() => closeTransfer(transfer), RECEIVER_CLOSE_GRACE_MS);
        emit();
        onNotice({ type: "received", item: { ...item } });
        return;
      }

      transfer.received += event.data.byteLength;
      if (transfer.received > item.size) {
        failTransfer(transfer, "The sender sent more data than announced.", true);
        return;
      }
      transfer.chunks.push(event.data);
      item.bytes = transfer.received;
      item.status = "transferring";
      touch(transfer);
      emitSoon();
    });

    channel.addEventListener("close", () => {
      const item = items.get(transfer.itemId);
      if (item?.status === "done") {
        closeTransfer(transfer);
      } else {
        failTransfer(transfer, "The connection closed before the file finished.", false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Signal handling

  function handleOffer(from: PeerId, offer: FileOffer) {
    if (offer.size <= 0 || offer.size > MAX_FILE_BYTES) {
      return;
    }
    const id = itemKey(from, offer.offerId);
    const existing = items.get(id);
    if (existing) {
      // Re-announced after the sender reconnected.
      if (existing.status === "revoked") {
        existing.status = "offered";
        existing.error = undefined;
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

  function revokeIncoming(item: FileItem, message: string) {
    if (item.status === "offered" || item.status === "failed") {
      item.status = "revoked";
      item.error = undefined;
      return true;
    }
    if (item.status === "connecting" || item.status === "transferring") {
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === item.id) {
          failTransfer(transfer, message, false);
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
      failTransfer(transfer, "Couldn't negotiate a connection.", true);
    }
  }

  function handleSignal(from: PeerId, payload: SignalPayload) {
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
        if (item && revokeIncoming(item, "The sender stopped sharing this file.")) {
          emit();
        }
        return;
      }

      case "peer-left": {
        // Established data channels are P2P and outlive the socket, so only
        // idle offers are dropped here; in-flight transfers settle on their own.
        let changed = false;
        for (const item of items.values()) {
          if (item.direction === "incoming" && item.peerId === from) {
            changed = revokeIncoming(item, "The sender left.") || changed;
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
          failTransfer(transfer, payload.reason, false);
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API

  return {
    handleSignal,

    /** Call once the realtime socket is ready: asks peers for their offers and re-announces ours. */
    announce() {
      if (!sendSignal({ type: "hello" })) {
        return;
      }
      for (const item of outgoingItems()) {
        sendSignal(toOffer(item));
      }
    },

    offerFiles(files: File[]) {
      const rejected: Array<{ name: string; reason: string }> = [];
      let offered = 0;

      for (const file of files) {
        if (file.size === 0) {
          rejected.push({ name: file.name, reason: "is empty" });
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          rejected.push({ name: file.name, reason: "is over the 500 MB limit" });
          continue;
        }

        const offerId = createRandomId();
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
          failTransfer(transfer, "The sender stopped sharing this file.", true);
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

      const transferId = createRandomId();
      const base = {
        id: transferId,
        role: "receive" as const,
        remotePeer: item.peerId,
        itemId: id,
        channel: null,
        pendingCandidates: [],
        stallTimer: null,
        chunks: [],
        received: 0,
        doneSent: false,
        closed: false,
      };
      const transfer: Transfer = { ...base, pc: createPeerConnection(base) };
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
      touch(transfer);
      emit();
      return true;
    },

    /** Abort an in-progress incoming download. */
    cancel(id: string) {
      for (const transfer of [...transfers.values()]) {
        if (transfer.itemId === id && transfer.role === "receive") {
          failTransfer(transfer, "Download canceled.", true);
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
