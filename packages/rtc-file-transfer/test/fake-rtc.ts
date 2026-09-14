import {
  createFileTransferManager,
  parseFileSignal,
  type FileItem,
  type FileSignal,
  type FileTransferManager,
  type FileTransferOptions,
  type PeerId,
  type TransferNotice,
} from "../src/index.ts";

/**
 * In-memory stand-ins for RTCPeerConnection and RTCDataChannel, just faithful
 * enough for the manager: an offer/answer handshake, ordered delivery, and a
 * `bufferedAmount` that only drains when the network is flowing.
 */
export class FakeNetwork {
  flowing = true;
  maxBuffered = 0;
  lowEvents = 0;
  readonly pcs: FakePeerConnection[] = [];
  readonly offers = new Map<string, FakePeerConnection>();

  setFlowing(flowing: boolean) {
    this.flowing = flowing;
    if (flowing) {
      for (const pc of this.pcs) {
        pc.channel?.scheduleFlush();
      }
    }
  }
}

export class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  binaryType = "blob";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  remote: FakeDataChannel | null = null;
  readonly net: FakeNetwork;
  private queue: Array<ArrayBuffer | string> = [];
  private flushScheduled = false;

  constructor(net: FakeNetwork) {
    super();
    this.net = net;
  }

  send(data: ArrayBuffer | string) {
    if (this.readyState !== "open") {
      throw new Error("InvalidStateError");
    }
    const copy = typeof data === "string" ? data : data.slice(0);
    this.queue.push(copy);
    this.bufferedAmount += typeof copy === "string" ? copy.length : copy.byteLength;
    this.net.maxBuffered = Math.max(this.net.maxBuffered, this.bufferedAmount);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      this.flush();
    }, 0);
  }

  private flush() {
    if (!this.net.flowing || this.readyState !== "open") {
      return;
    }
    const wasAbove = this.bufferedAmount > this.bufferedAmountLowThreshold;
    const batch = this.queue;
    this.queue = [];
    this.bufferedAmount = 0;
    for (const data of batch) {
      if (this.remote?.readyState === "open") {
        this.remote.dispatchEvent(new MessageEvent("message", { data }));
      }
    }
    if (wasAbove) {
      this.net.lowEvents += 1;
      this.dispatchEvent(new Event("bufferedamountlow"));
    }
  }

  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  close() {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
    const remote = this.remote;
    // Real close propagation is asynchronous; let queued signals land first.
    setTimeout(() => remote?.close(), 10);
  }
}

let nextSdp = 0;

export class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  sctp = null;
  channel: FakeDataChannel | null = null;
  peer: FakePeerConnection | null = null;
  readonly net: FakeNetwork;

  constructor(net: FakeNetwork) {
    super();
    this.net = net;
    net.pcs.push(this);
  }

  createDataChannel() {
    this.channel = new FakeDataChannel(this.net);
    return this.channel;
  }

  async createOffer() {
    return { type: "offer" as const, sdp: `fake-sdp-${nextSdp++}` };
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: `fake-sdp-${nextSdp++}` };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    if (description.type === "offer" && description.sdp) {
      this.net.offers.set(description.sdp, this);
    }
    const candidate = { candidate: "candidate:fake", sdpMid: "0", sdpMLineIndex: 0 };
    setTimeout(() => {
      this.dispatchEvent(
        Object.assign(new Event("icecandidate"), {
          candidate: { toJSON: () => candidate },
        }),
      );
    }, 0);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    if (description.type === "offer") {
      this.peer = this.net.offers.get(description.sdp ?? "") ?? null;
      if (this.peer) {
        this.peer.peer = this;
      }
      return;
    }
    // Answer applied on the offering side: connect the channels.
    const sender = this.channel;
    const receiverPc = this.peer;
    if (!sender || !receiverPc) {
      return;
    }
    const receiver = new FakeDataChannel(this.net);
    receiver.remote = sender;
    sender.remote = receiver;
    receiverPc.channel = receiver;
    setTimeout(() => {
      receiverPc.dispatchEvent(Object.assign(new Event("datachannel"), { channel: receiver }));
      receiver.open();
      sender.open();
    }, 0);
  }

  async addIceCandidate() {}

  close() {
    this.channel?.close();
  }

  failConnection() {
    this.connectionState = "failed";
    this.dispatchEvent(new Event("connectionstatechange"));
  }
}

type PeerOptions = Partial<
  Pick<FileTransferOptions, "limits" | "createId" | "iceServers">
>;

export type TestPeer = {
  id: PeerId;
  manager: FileTransferManager;
  items: FileItem[];
  notices: TransferNotice[];
  pcs: () => FakePeerConnection[];
};

/**
 * A signaling bus between peers. Every signal is JSON round-tripped and run
 * through `parseFileSignal`, so the manager's own output is checked against
 * the validator on every test.
 */
export class FakeSignaling {
  readonly net = new FakeNetwork();
  readonly peers = new Map<PeerId, TestPeer>();
  connected = true;
  transform: (payload: FileSignal) => FileSignal = (payload) => payload;
  private owners = new Map<FakePeerConnection, PeerId>();

  addPeer(id: PeerId, options: PeerOptions = {}): TestPeer {
    const peer: TestPeer = {
      id,
      items: [],
      notices: [],
      pcs: () => [...this.owners].filter(([, owner]) => owner === id).map(([pc]) => pc),
      manager: null as unknown as FileTransferManager,
    };
    peer.manager = createFileTransferManager({
      peerId: id,
      ...options,
      sendSignal: (payload, to) => this.send(id, payload, to),
      onItemsChange: (items) => {
        peer.items = items;
      },
      onNotice: (notice) => {
        peer.notices.push(notice);
      },
      createPeerConnection: () => {
        const pc = new FakePeerConnection(this.net);
        this.owners.set(pc, id);
        return pc as unknown as RTCPeerConnection;
      },
    });
    this.peers.set(id, peer);
    return peer;
  }

  private send(from: PeerId, payload: FileSignal, to?: PeerId) {
    if (!this.connected) {
      return false;
    }
    const wire = JSON.stringify(this.transform(payload));
    setTimeout(() => {
      const parsed = parseFileSignal(JSON.parse(wire));
      if (!parsed) {
        throw new Error(`parseFileSignal rejected the manager's own signal: ${wire}`);
      }
      for (const peer of this.peers.values()) {
        if (peer.id !== from && (to === undefined || to === peer.id)) {
          peer.manager.handleSignal(from, parsed);
        }
      }
    }, 0);
    return true;
  }

  dispose() {
    for (const peer of this.peers.values()) {
      peer.manager.dispose();
    }
  }
}

export async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function randomBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 31 + 7) % 251;
  }
  return bytes;
}
