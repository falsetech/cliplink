import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "node:test";

import {
  broadcastChannelSignaling,
  peerJsSignaling,
  simplePeerSignaling,
  supabaseSignaling,
  trysteroSignaling,
  webSocketSignaling,
  type PeerJsConnectionLike,
  type SignalingAdapter,
} from "../src/adapters.ts";
import {
  createFileTransferManager,
  type FileItem,
  type FileSignal,
  type PeerId,
} from "../src/index.ts";
import { FakeNetwork, FakePeerConnection, randomBytes, waitFor } from "./fake-rtc.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** Records what a manager would have been told. */
function recorder() {
  const signals: Array<[PeerId, FileSignal]> = [];
  let announced = 0;
  return {
    signals,
    announced: () => announced,
    manager: {
      handleSignal: (from: PeerId, signal: FileSignal) => void signals.push([from, signal]),
      announce: () => void (announced += 1),
    },
  };
}

const offer: FileSignal = {
  type: "file-offer",
  offerId: "offer-0001",
  name: "a.bin",
  size: 10,
  mime: "",
};

/** A real manager over fake WebRTC, wired through an adapter. */
function peer(id: PeerId, net: FakeNetwork, adapter: SignalingAdapter) {
  const state = { items: [] as FileItem[] };
  const manager = createFileTransferManager({
    peerId: id,
    sendSignal: adapter.sendSignal,
    onItemsChange: (items) => {
      state.items = items;
    },
    createPeerConnection: () => new FakePeerConnection(net) as unknown as RTCPeerConnection,
  });
  const detach = adapter.connect(manager);
  cleanups.push(() => {
    detach();
    manager.dispose();
  });
  return { manager, state, detach };
}

describe("signaling adapters", () => {
  it("transfers a file end to end over a BroadcastChannel", async () => {
    const net = new FakeNetwork();
    const channelA = new BroadcastChannel("rtcft-test");
    const channelB = new BroadcastChannel("rtcft-test");
    cleanups.push(() => {
      channelA.close();
      channelB.close();
    });
    const alice = peer("peer-alice", net, broadcastChannelSignaling(channelA, "peer-alice"));
    const bob = peer("peer-bob00", net, broadcastChannelSignaling(channelB, "peer-bob00"));

    const source = randomBytes(80 * 1024);
    alice.manager.offerFiles([new File([source], "tabs.bin")]);
    await waitFor(() => bob.state.items.some((item) => item.direction === "incoming"));
    const item = bob.state.items.find((candidate) => candidate.direction === "incoming")!;
    assert.equal(bob.manager.request(item.id), true);
    await waitFor(() => bob.state.items[0]?.status === "done");
    assert.deepEqual(new Uint8Array(await bob.state.items[0].blob!.arrayBuffer()), source);

    // Detaching says goodbye, so the other tab drops the offer.
    alice.manager.offerFiles([new File([source], "second.bin")]);
    await waitFor(() => bob.state.items.filter((i) => i.status === "offered").length === 1);
    alice.detach();
    await waitFor(() => bob.state.items.some((i) => i.status === "revoked"));
  });

  it("routes WebSocket envelopes, ignores other traffic, and announces on open", async () => {
    const socket = Object.assign(new EventTarget(), {
      readyState: 0,
      sent: [] as string[],
      send(data: string) {
        this.sent.push(data);
      },
    });
    const adapter = webSocketSignaling(socket as never, "peer-me0001");
    const { manager, signals, announced } = recorder();
    adapter.connect(manager);

    assert.equal(adapter.sendSignal({ type: "hello" }), false, "nothing sends before open");
    assert.equal(announced(), 0);
    socket.readyState = 1;
    socket.dispatchEvent(new Event("open"));
    assert.equal(announced(), 1);
    assert.equal(adapter.sendSignal(offer, "peer-you001"), true);
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      "rtc-file-transfer": { from: "peer-me0001", to: "peer-you001", payload: offer },
    });

    const send = (data: unknown) =>
      socket.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(data) }));
    send({ type: "clip", text: "not a file signal" });
    send({ "rtc-file-transfer": { from: "peer-you001", to: "peer-other1", payload: offer } });
    send({ "rtc-file-transfer": { from: "peer-you001", payload: { type: "peer-left" } } });
    send({ "rtc-file-transfer": { from: "peer-you001", to: "peer-me0001", payload: offer } });
    assert.deepEqual(signals, [["peer-you001", offer]]);
  });

  it("uses Trystero's routing and presence", () => {
    const sent: Array<[unknown, unknown]> = [];
    let receiver: (data: unknown, peerId: string) => void = () => {};
    let onJoin: (peerId: string) => void = () => {};
    let onLeave: (peerId: string) => void = () => {};
    const room = {
      makeAction: () => [
        (data: unknown, target?: unknown) => void sent.push([data, target]),
        (next: typeof receiver) => {
          receiver = next;
        },
      ],
      onPeerJoin: (callback: typeof onJoin) => {
        onJoin = callback;
      },
      onPeerLeave: (callback: typeof onLeave) => {
        onLeave = callback;
      },
    };
    const adapter = trysteroSignaling(room as never, "peer-me0001");
    const { manager, signals, announced } = recorder();
    const detach = adapter.connect(manager);

    adapter.sendSignal(offer, "peer-you001");
    adapter.sendSignal({ type: "hello" });
    assert.deepEqual(sent, [
      [offer, "peer-you001"],
      [{ type: "hello" }, null],
    ]);

    onJoin("peer-you001");
    assert.equal(announced(), 2);
    receiver(offer, "peer-you001");
    receiver({ type: "peer-left" }, "peer-you001");
    onLeave("peer-you001");
    assert.deepEqual(signals, [
      ["peer-you001", offer],
      ["peer-you001", { type: "peer-left" }],
    ]);

    detach();
    receiver(offer, "peer-you001");
    assert.equal(signals.length, 2);
  });

  it("tracks PeerJS connections and trusts the connection, not the envelope, for the sender", () => {
    class FakeConnection extends EventEmitter {
      open = false;
      sent: unknown[] = [];
      readonly peer: string;
      constructor(peer: string) {
        super();
        this.peer = peer;
      }
      send(data: unknown) {
        this.sent.push(data);
      }
    }
    const peerEmitter = new EventEmitter();
    const fakePeer = Object.assign(peerEmitter, {
      connect: (id: string) => new FakeConnection(id) as unknown as PeerJsConnectionLike,
    });
    const adapter = peerJsSignaling(fakePeer as never);
    const { manager, signals } = recorder();
    adapter.connect(manager);

    const incoming = new FakeConnection("peer-you001");
    peerEmitter.emit("connection", incoming);
    assert.equal(adapter.sendSignal(offer, "peer-you001"), false, "not open yet");
    incoming.open = true;
    incoming.emit("open");
    assert.equal(adapter.sendSignal(offer), true);
    assert.equal(incoming.sent.length, 1);

    incoming.emit("data", { "rtc-file-transfer": { from: "peer-forged1", payload: offer } });
    incoming.emit("data", { app: "own message" });
    incoming.emit("close");
    assert.deepEqual(signals, [
      ["peer-you001", offer],
      ["peer-you001", { type: "peer-left" }],
    ]);
    assert.equal(adapter.sendSignal(offer, "peer-you001"), false);
  });

  it("carries signals over a simple-peer connection alongside other data", () => {
    class FakeSimplePeer extends EventEmitter {
      connected = false;
      sent: string[] = [];
      send(data: string) {
        this.sent.push(data);
      }
    }
    const simple = new FakeSimplePeer();
    const adapter = simplePeerSignaling(simple, "peer-you001");
    const { manager, signals, announced } = recorder();
    const detach = adapter.connect(manager);

    assert.equal(adapter.sendSignal(offer), false);
    simple.connected = true;
    simple.emit("connect");
    assert.equal(announced(), 1);
    assert.equal(adapter.sendSignal(offer, "peer-other1"), false, "one-to-one");
    assert.equal(adapter.sendSignal(offer), true);

    const bytes = new TextEncoder().encode(simple.sent[0]);
    simple.emit("data", bytes);
    simple.emit("data", new TextEncoder().encode("hello, app"));
    simple.emit("close");
    assert.deepEqual(signals, [
      ["peer-you001", offer],
      ["peer-you001", { type: "peer-left" }],
    ]);

    detach();
    simple.emit("data", bytes);
    assert.equal(signals.length, 2);
  });

  it("broadcasts over a Supabase channel and mutes on detach", () => {
    const sent: unknown[] = [];
    let callback: (message: { payload?: unknown }) => void = () => {};
    const channel = {
      send: async (message: unknown) => void sent.push(message),
      on: (_type: string, _filter: unknown, next: typeof callback) => {
        callback = next;
      },
    };
    const adapter = supabaseSignaling(channel, "peer-me0001");
    const { manager, signals, announced } = recorder();
    const detach = adapter.connect(manager);
    assert.equal(announced(), 1);

    adapter.sendSignal(offer);
    assert.deepEqual(sent, [
      {
        type: "broadcast",
        event: "rtc-file-transfer",
        payload: { "rtc-file-transfer": { from: "peer-me0001", to: undefined, payload: offer } },
      },
    ]);

    callback({ payload: { "rtc-file-transfer": { from: "peer-you001", payload: offer } } });
    detach();
    callback({ payload: { "rtc-file-transfer": { from: "peer-you001", payload: offer } } });
    assert.deepEqual(signals, [["peer-you001", offer]]);
  });
});
