import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

import {
  decryptClipText,
  encryptClipText,
  generateRoomKey,
  openSignal,
  sealSignal,
  type RoomKey,
} from "../src/crypto.ts";
import {
  createEncryptedTransport,
  RoomKeyMismatchError,
  UNDECRYPTABLE_TEXT,
} from "../src/encrypted-transport.ts";
import { CIPHERTEXT_PATTERN } from "../src/protocol.ts";
import type { Clip, GetRoomResponse, SealedTransport, SignalPayload } from "../src/types.ts";
import { settle, waitFor } from "./support.ts";

const ROOM = "X7KP2M";
const OTHER_ROOM = "Q2W3E4";
const PEER = "peer-abcdef";

type Handlers = Parameters<SealedTransport["streamClips"]>[3];

/**
 * The wire half of the seam: a `SealedTransport` that records what it is asked
 * and lets a test push messages up through the handlers it was given. It only
 * ever sees ciphertext, which is the point — the tests assert on that.
 */
function fakeWire() {
  const state = {
    room: { code: ROOM, createdAt: 0, ttlSeconds: 21_600 } as GetRoomResponse["room"],
    roomClips: [] as Clip[],
    polled: [] as Clip[],
    pollArgs: [] as Array<{ code: string; afterId: number }>,
    canSend: true,
    sentClips: [] as Array<{ code: string; text: string; senderId: string }>,
    sentSignals: [] as Array<{ sealed: string; to?: string }>,
    streamArgs: null as { code: string; afterId: number; peerId: string } | null,
    handlers: null as Handlers | null,
    streamReturn: (() => {}) as (() => void) | null,
    disconnects: 0,
  };

  const wire: SealedTransport = {
    async connect() {
      return { room: state.room, clips: state.roomClips };
    },
    async sendClip(code, payload) {
      state.sentClips.push({ code, ...payload });
      return {
        clip: { id: 9, text: payload.text, senderId: payload.senderId, ts: 1_700_000_000 },
        expiresAt: 4_242,
      };
    },
    async pollClips(code, afterId) {
      state.pollArgs.push({ code, afterId });
      return { clips: state.polled };
    },
    streamClips(code, afterId, peerId, handlers) {
      state.streamArgs = { code, afterId, peerId };
      state.handlers = handlers;
      return state.streamReturn;
    },
    canSend: () => state.canSend,
    sendSealedSignal(sealed, to) {
      state.sentSignals.push({ sealed, to });
      return true;
    },
    disconnect() {
      state.disconnects += 1;
    },
  };

  return { wire, state };
}

describe("createEncryptedTransport", () => {
  let key: RoomKey;
  let otherKey: RoomKey;

  before(async () => {
    key = await generateRoomKey();
    otherKey = await generateRoomKey();
  });

  const clip = (id: number, text: string): Clip => ({
    id,
    text,
    senderId: "someone-else",
    ts: 1_700_000_000 + id,
  });

  const sealedClip = async (id: number, text: string, under = key, room = ROOM) =>
    clip(id, await encryptClipText(under, room, text));

  /** A transport over a fresh fake wire, with the room key loaded unless told otherwise. */
  function setup({ withKey = true } = {}) {
    const { wire, state } = fakeWire();
    const transport = createEncryptedTransport(wire);
    if (withKey) {
      transport.setRoomKey(ROOM, key);
    }
    return { transport, wire, state };
  }

  /** Streams with a recording `onSignal`, and returns what it heard. */
  function stream(transport: ReturnType<typeof setup>["transport"]) {
    const signals: Array<{ from: string; payload: SignalPayload }> = [];
    const clips: Clip[][] = [];
    const events: string[] = [];
    const cleanup = transport.streamClips(ROOM, 5, "peer-me-12345", {
      onOpen: () => events.push("open"),
      onClips: (incoming) => clips.push(incoming),
      onSignal: (from, payload) => signals.push({ from, payload }),
      onDisconnect: (reason) => events.push(`disconnect:${reason}`),
    });
    return { signals, clips, events, cleanup };
  }

  describe("connect", () => {
    it("opens every clip the room already holds and leaves the rest of each intact", async () => {
      const { transport, state } = setup();
      state.roomClips = [await sealedClip(1, "first"), await sealedClip(2, "second — ünïcode ✓")];

      const response = await transport.connect(ROOM);

      assert.deepEqual(
        response.clips.map(({ id, text, senderId, ts }) => ({ id, text, senderId, ts })),
        [
          { id: 1, text: "first", senderId: "someone-else", ts: 1_700_000_001 },
          { id: 2, text: "second — ünïcode ✓", senderId: "someone-else", ts: 1_700_000_002 },
        ],
      );
      assert.equal(response.room.code, ROOM);
    });

    it("substitutes a placeholder for a clip it cannot open, rather than dropping it", async () => {
      const { transport, state } = setup();
      state.roomClips = [
        await sealedClip(1, "readable"),
        await sealedClip(2, "wrong key", otherKey),
        await sealedClip(3, "wrong room", key, OTHER_ROOM),
        clip(4, "v1.notreallyciphertext"),
        clip(5, "plain text that was never encrypted"),
        await sealedClip(6, "also readable"),
      ];

      const { clips } = await transport.connect(ROOM);

      assert.deepEqual(
        clips.map((entry) => [entry.id, entry.text]),
        [
          [1, "readable"],
          [2, UNDECRYPTABLE_TEXT],
          [3, UNDECRYPTABLE_TEXT],
          [4, UNDECRYPTABLE_TEXT],
          [5, UNDECRYPTABLE_TEXT],
          [6, "also readable"],
        ],
      );
    });

    it("throws RoomKeyMismatchError when the key is not the one the room was made with", async () => {
      const { transport, state } = setup();
      state.room = { ...state.room, keyCheck: otherKey.check };
      state.roomClips = [await sealedClip(1, "unreachable")];

      await assert.rejects(transport.connect(ROOM), (error: unknown) => {
        assert.ok(error instanceof RoomKeyMismatchError);
        assert.equal(error.name, "RoomKeyMismatchError");
        assert.match(error.message, /does not match this room/);
        return true;
      });
    });

    it("connects when the room's fingerprint matches the key", async () => {
      const { transport, state } = setup();
      state.room = { ...state.room, keyCheck: key.check };
      state.roomClips = [await sealedClip(1, "hello")];

      const { clips } = await transport.connect(ROOM);
      assert.equal(clips[0].text, "hello");
    });

    it("connects to a room with no fingerprint, an open or older one, whatever the key", async () => {
      const { transport, state } = setup();
      assert.equal(state.room.keyCheck, undefined);
      await assert.doesNotReject(transport.connect(ROOM));
    });

    it("with no key loaded, reads nothing and still does not throw", async () => {
      const { transport, state } = setup({ withKey: false });
      state.room = { ...state.room, keyCheck: key.check };
      state.roomClips = [await sealedClip(1, "hello")];

      const { clips } = await transport.connect(ROOM);
      assert.deepEqual(
        clips.map((entry) => entry.text),
        [UNDECRYPTABLE_TEXT],
      );
    });

    it("stops reading once the key is cleared", async () => {
      const { transport, state } = setup();
      state.roomClips = [await sealedClip(1, "hello")];
      assert.equal((await transport.connect(ROOM)).clips[0].text, "hello");

      transport.clearRoomKey();
      assert.equal((await transport.connect(ROOM)).clips[0].text, UNDECRYPTABLE_TEXT);
    });
  });

  describe("sendClip", () => {
    it("refuses to send without a key, and sends nothing", async () => {
      const { transport, state } = setup({ withKey: false });

      await assert.rejects(
        transport.sendClip(ROOM, { text: "secret", senderId: "cli-sender-1" }),
        /no key is loaded/,
      );
      assert.equal(state.sentClips.length, 0);
    });

    it("refuses after the key is cleared", async () => {
      const { transport, state } = setup();
      transport.clearRoomKey();

      await assert.rejects(transport.sendClip(ROOM, { text: "secret", senderId: "cli-sender-1" }));
      assert.equal(state.sentClips.length, 0);
    });

    it("puts only ciphertext on the wire, which the room key opens", async () => {
      const { transport, state } = setup();

      await transport.sendClip(ROOM, { text: "the secret text", senderId: "cli-sender-1" });

      const [sent] = state.sentClips;
      assert.equal(sent.code, ROOM);
      assert.equal(sent.senderId, "cli-sender-1");
      assert.match(sent.text, CIPHERTEXT_PATTERN);
      assert.equal(sent.text.includes("secret"), false);
      assert.equal(await decryptClipText(key, ROOM, sent.text), "the secret text");
    });

    it("seals afresh each time, so the same text never repeats on the wire", async () => {
      const { transport, state } = setup();

      await transport.sendClip(ROOM, { text: "same", senderId: "cli-sender-1" });
      await transport.sendClip(ROOM, { text: "same", senderId: "cli-sender-1" });

      assert.notEqual(state.sentClips[0].text, state.sentClips[1].text);
    });

    it("hands back the plaintext it was given, so the sender's own row is readable", async () => {
      const { transport } = setup();

      const response = await transport.sendClip(ROOM, { text: "mine", senderId: "cli-sender-1" });

      assert.equal(response.clip.text, "mine");
      assert.equal(response.clip.id, 9);
      assert.equal(response.clip.senderId, "cli-sender-1");
      assert.equal(response.expiresAt, 4_242);
    });
  });

  describe("pollClips", () => {
    it("opens what the poll returns, and asks the wire for the same cursor", async () => {
      const { transport, state } = setup();
      state.polled = [await sealedClip(7, "polled"), await sealedClip(8, "nope", otherKey)];

      const { clips } = await transport.pollClips(ROOM, 6);

      assert.deepEqual(state.pollArgs, [{ code: ROOM, afterId: 6 }]);
      assert.deepEqual(
        clips.map((entry) => [entry.id, entry.text]),
        [
          [7, "polled"],
          [8, UNDECRYPTABLE_TEXT],
        ],
      );
    });
  });

  describe("streamClips", () => {
    it("passes the stream's arguments through and returns the wire's cleanup", () => {
      const { transport, state } = setup();
      const cleanup = () => {};
      state.streamReturn = cleanup;

      assert.equal(stream(transport).cleanup, cleanup);
      assert.deepEqual(state.streamArgs, { code: ROOM, afterId: 5, peerId: "peer-me-12345" });
    });

    it("passes on a null cleanup, which is how a caller learns there is no WebSocket", () => {
      const { transport, state } = setup();
      state.streamReturn = null;

      assert.equal(stream(transport).cleanup, null);
    });

    it("forwards open and disconnect untouched", () => {
      const { transport, state } = setup();
      const { events } = stream(transport);

      state.handlers?.onOpen?.();
      state.handlers?.onDisconnect("error");
      state.handlers?.onDisconnect("closed");

      assert.deepEqual(events, ["open", "disconnect:error", "disconnect:closed"]);
    });

    it("opens streamed clips before handing them up", async () => {
      const { transport, state } = setup();
      const { clips } = stream(transport);

      state.handlers?.onClips([await sealedClip(6, "streamed"), await sealedClip(7, "x", otherKey)]);
      await waitFor(() => clips.length === 1, "the streamed clips");

      assert.deepEqual(
        clips[0].map((entry) => entry.text),
        ["streamed", UNDECRYPTABLE_TEXT],
      );
    });

    describe("signals", () => {
      const deliver = async (
        state: ReturnType<typeof setup>["state"],
        payload: unknown,
        { under = key, room = ROOM } = {},
      ) => {
        state.handlers?.onSealedSignal?.(PEER, await sealSignal(under, room, payload));
      };

      it("opens a sealed signal and delivers it with the peer it came from", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        await deliver(state, { type: "hello-ack" });
        await waitFor(() => signals.length === 1, "the signal");

        assert.deepEqual(signals, [{ from: PEER, payload: { type: "hello-ack" } }]);
      });

      it("rebuilds the payload from the fields the protocol defines", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        await deliver(state, { type: "hello", smuggled: "<script>" });
        await waitFor(() => signals.length === 1, "the signal");

        assert.deepEqual(signals[0].payload, { type: "hello" });
      });

      it("drops a signal it cannot open", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        await deliver(state, { type: "hello" }, { under: otherKey });
        await deliver(state, { type: "hello" }, { room: OTHER_ROOM });
        state.handlers?.onSealedSignal?.(PEER, "v1.notreallyciphertext");
        state.handlers?.onSealedSignal?.(PEER, "garbage");
        // A clip's ciphertext, replayed as a signal: the subkeys differ, so it must not open.
        state.handlers?.onSealedSignal?.(PEER, await encryptClipText(key, ROOM, '{"type":"hello-ack"}'));
        // A good one behind them, so there is something to wait for.
        await deliver(state, { type: "hello-ack" });
        await waitFor(() => signals.length >= 1, "the good signal");
        await settle();

        assert.deepEqual(signals, [{ from: PEER, payload: { type: "hello-ack" } }]);
      });

      it("drops a signal that opens but is not one the protocol defines", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        await deliver(state, { type: "no-such-signal" });
        await deliver(state, "just a string");
        await deliver(state, null);
        await deliver(state, { type: "file-offer", offerId: "short", name: "x", size: 1, mime: "" });
        await deliver(state, { type: "hello-ack" });
        await waitFor(() => signals.length >= 1, "the good signal");
        await settle();

        assert.deepEqual(signals, [{ from: PEER, payload: { type: "hello-ack" } }]);
      });

      it("will not deliver a peer's claim that someone left", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        await deliver(state, { type: "peer-left", from: "peer-victim-01" });
        await deliver(state, { type: "hello-ack" });
        await waitFor(() => signals.length >= 1, "the good signal");
        await settle();

        assert.deepEqual(signals, [{ from: PEER, payload: { type: "hello-ack" } }]);
      });

      it("delivers the server's own peer-left, which arrives unsealed", () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        state.handlers?.onPeerLeft?.("peer-gone-0001");

        assert.deepEqual(signals, [{ from: "peer-gone-0001", payload: { type: "peer-left" } }]);
      });

      it("reads the key when the signal arrives, not when the stream began", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);

        transport.setRoomKey(ROOM, otherKey);
        await deliver(state, { type: "hello-ack" }, { under: otherKey });
        await waitFor(() => signals.length === 1, "the signal");

        assert.equal(signals[0].payload.type, "hello-ack");
      });

      it("hears nothing with no key loaded", async () => {
        const { transport, state } = setup();
        const { signals } = stream(transport);
        const sealed = await sealSignal(key, ROOM, { type: "hello-ack" });

        transport.clearRoomKey();
        state.handlers?.onSealedSignal?.(PEER, sealed);
        await settle();

        assert.deepEqual(signals, []);
      });

      it("copes with a caller that gave no onSignal", async () => {
        const { transport, state } = setup();
        transport.streamClips(ROOM, 0, "peer-me-12345", {
          onClips: () => {},
          onDisconnect: () => {},
        });

        state.handlers?.onSealedSignal?.(PEER, await sealSignal(key, ROOM, { type: "hello-ack" }));
        state.handlers?.onPeerLeft?.(PEER);
        await settle();
      });
    });
  });

  describe("sendSignal", () => {
    it("says no when there is no key", () => {
      const { transport, state } = setup({ withKey: false });
      assert.equal(transport.sendSignal({ type: "hello" }), false);
      assert.equal(state.sentSignals.length, 0);
    });

    it("says no when the socket cannot carry it, so the caller can try again later", async () => {
      const { transport, state } = setup();
      state.canSend = false;

      assert.equal(transport.sendSignal({ type: "hello" }), false);
      await settle();
      assert.equal(state.sentSignals.length, 0);
    });

    it("answers at once, then seals and sends", async () => {
      const { transport, state } = setup();

      assert.equal(transport.sendSignal({ type: "hello-ack" }, "peer-target-01"), true);
      assert.equal(state.sentSignals.length, 0, "nothing is on the wire before sealing finishes");

      await waitFor(() => state.sentSignals.length === 1, "the sealed signal");
      const [sent] = state.sentSignals;
      assert.equal(sent.to, "peer-target-01");
      assert.match(sent.sealed, CIPHERTEXT_PATTERN);
      assert.deepEqual(await openSignal(key, ROOM, sent.sealed), { type: "hello-ack" });
    });

    it("broadcasts when no peer is named", async () => {
      const { transport, state } = setup();
      transport.sendSignal({ type: "hello" });
      await waitFor(() => state.sentSignals.length === 1, "the sealed signal");
      assert.equal(state.sentSignals[0].to, undefined);
    });

    it("keeps send order even when an earlier signal is slower to seal", async () => {
      // An ICE candidate overtaking the description it belongs to breaks the
      // handshake. Make the first seal the slow one; without the chain, the
      // others would overtake it.
      const { transport, state } = setup();
      const original = crypto.subtle.encrypt.bind(crypto.subtle);
      let calls = 0;
      const slowFirst = mock.method(
        crypto.subtle,
        "encrypt",
        async (...args: Parameters<typeof original>) => {
          calls += 1;
          if (calls === 1) {
            await settle(40);
          }
          return original(...args);
        },
      );

      try {
        transport.sendSignal({ type: "hello" }, "peer-first-001");
        transport.sendSignal({ type: "hello-ack" }, "peer-second-01");
        transport.sendSignal({ type: "hello" }, "peer-third-001");
        await waitFor(() => state.sentSignals.length === 3, "all three signals");
      } finally {
        slowFirst.mock.restore();
      }

      assert.deepEqual(
        state.sentSignals.map((sent) => sent.to),
        ["peer-first-001", "peer-second-01", "peer-third-001"],
      );
      const opened = await Promise.all(state.sentSignals.map((sent) => openSignal(key, ROOM, sent.sealed)));
      assert.deepEqual(opened, [{ type: "hello" }, { type: "hello-ack" }, { type: "hello" }]);
    });

    it("drops a signal that cannot be sealed without stalling those behind it", async () => {
      const { transport, state } = setup();
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      // JSON.stringify throws on this, inside the seal.
      assert.equal(transport.sendSignal(cyclic as unknown as SignalPayload, "peer-doomed-01"), true);
      assert.equal(transport.sendSignal({ type: "hello-ack" }, "peer-after-001"), true);
      await waitFor(() => state.sentSignals.length >= 1, "the signal behind the bad one");
      await settle();

      assert.deepEqual(
        state.sentSignals.map((sent) => sent.to),
        ["peer-after-001"],
      );
    });
  });

  describe("disconnect", () => {
    it("disconnects the wire", () => {
      const { transport, state } = setup();
      transport.disconnect();
      assert.equal(state.disconnects, 1);
    });
  });
});
