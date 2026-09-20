import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { parseArgs, type ParsedArgs } from "../src/cli/args.ts";
import type { Reporter } from "../src/cli/output.ts";
import { recv } from "../src/cli/recv.ts";
import {
  deriveOpenRoomKey,
  encryptClipText,
  generateRoomKey,
  POLL_INTERVAL_MS,
  RoomKeyMismatchError,
  type Clip,
  type RoomKey,
} from "../src/index.ts";
import { FakeSocket, settle, waitFor } from "./support.ts";

/**
 * `recv` opens its own session, so these tests stand in for the two things it
 * reaches for: `globalThis.fetch` for the room API and `globalThis.WebSocket`
 * for the realtime socket. Everything between — the encrypted transport, the
 * key handling, the cursor, the backoff — is the real code, and the clips
 * that cross the fake server are really sealed.
 *
 * Time is fake (`mock.timers`), so a backoff of fifteen seconds is one line;
 * the WebCrypto work underneath is real, which is what `waitFor` is for.
 */

const CODE = "X7KP2M";
const BASE = "https://cliplink.test";

/** The retry ladder in `recv.ts`: 2s doubling to a 15s cap. */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 15_000];

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

/** The room API, with the clips it holds already sealed. */
class FakeServer {
  stored: Clip[] = [];
  keyCheck: string | undefined;
  roomStatus = 200;
  /** `after` cursor of every poll, in order. */
  polls: number[] = [];
  onPoll: (after: number) => Promise<Response> = async (after) =>
    json({ clips: this.stored.filter((clip) => clip.id > after) });

  fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));

    if (url.pathname === `/rooms/${CODE}`) {
      if (this.roomStatus !== 200) {
        return json({ error: "Room not found", code: "room_not_found" }, this.roomStatus);
      }
      return json({
        room: { code: CODE, createdAt: 0, ttlSeconds: 21_600, keyCheck: this.keyCheck },
        clips: this.stored,
      });
    }

    if (url.pathname === `/rooms/${CODE}/clips`) {
      const after = Number(url.searchParams.get("after"));
      this.polls.push(after);
      return this.onPoll(after);
    }

    throw new Error(`Unexpected request to ${url}`);
  };
}

function reporter() {
  const data: string[] = [];
  const notes: string[] = [];
  const warns: string[] = [];
  const report: Reporter = {
    data: (text) => {
      data.push(text);
    },
    note: (text = "") => {
      notes.push(text);
    },
    warn: (text) => {
      warns.push(text);
    },
    interactive: false,
  };
  return { report, data, notes, warns };
}

function argsFor(flags: string[] = []): ParsedArgs {
  const parsed = parseArgs(["recv", "--room", CODE, "--open", "--url", BASE, ...flags]);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.args;
}

/**
 * Wraps the (already faked) timer functions to keep a ledger of the ones still
 * pending. A `setInterval` that is never cleared keeps a Node process alive,
 * so "the ledger is empty" is what "`recv` can exit" means. `mock.timers.reset`
 * puts the originals back, wrappers and all.
 */
function trackTimers() {
  const live = new Set<unknown>();
  const { setTimeout: fakeSetTimeout, setInterval: fakeSetInterval } = globalThis;
  const { clearTimeout: fakeClearTimeout, clearInterval: fakeClearInterval } = globalThis;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const handle = fakeSetTimeout(() => {
      live.delete(handle);
      callback(...rest);
    }, ms);
    live.add(handle);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.setInterval = ((callback: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const handle = fakeSetInterval(callback, ms, ...rest);
    live.add(handle);
    return handle;
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    live.delete(handle);
    fakeClearTimeout(handle);
  }) as typeof globalThis.clearTimeout;
  globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    live.delete(handle);
    fakeClearInterval(handle);
  }) as typeof globalThis.clearInterval;

  return live;
}

describe("recv", () => {
  const realFetch = globalThis.fetch;
  const realWebSocket = globalThis.WebSocket;

  let server: FakeServer;
  let openKey: RoomKey;
  let controllers: AbortController[];
  /** Timers set and neither fired nor cleared: what would keep the process alive. */
  let liveTimers: Set<unknown>;

  before(async () => {
    openKey = await deriveOpenRoomKey(CODE);
  });

  beforeEach(() => {
    server = new FakeServer();
    controllers = [];
    FakeSocket.reset();
    globalThis.fetch = server.fetch as unknown as typeof globalThis.fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof globalThis.WebSocket;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    liveTimers = trackTimers();
  });

  afterEach(() => {
    // A test that failed halfway must not leave a listener polling behind it.
    for (const controller of controllers) {
      controller.abort();
    }
    mock.timers.reset();
    globalThis.fetch = realFetch;
    globalThis.WebSocket = realWebSocket;
  });

  const seal = async (id: number, text: string, key = openKey): Promise<Clip> => ({
    id,
    text: await encryptClipText(key, CODE, text),
    senderId: "someone-else",
    ts: 1_700_000_000 + id,
  });

  /** Runs `recv` until it has opened its first socket, which is when it is listening. */
  async function start(flags: string[] = []) {
    const controller = new AbortController();
    controllers.push(controller);
    const out = reporter();
    const result = recv(argsFor(flags), out.report, controller.signal);
    await waitFor(() => FakeSocket.instances.length > 0, "the room socket");
    return { ...out, result, abort: () => controller.abort() };
  }

  const sockets = () => FakeSocket.instances;
  const tick = (ms: number) => mock.timers.tick(ms);

  describe("starting", () => {
    it("begins after the newest clip the room holds, and prints nothing that was already there", async () => {
      server.stored = [await seal(1, "old"), await seal(2, "older")];
      const { data } = await start();

      // The socket is asked only for what comes after the newest clip.
      assert.match(FakeSocket.last.url, /after=2\b/);

      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(3, "fresh") });
      await waitFor(() => data.length === 1, "the new clip");

      assert.deepEqual(data, ["fresh"]);
    });

    it("starts from the beginning in an empty room", async () => {
      await start();
      assert.match(FakeSocket.last.url, /after=0\b/);
    });

    it("says where it is listening on stderr, and keeps stdout for clips alone", async () => {
      const { notes, data, warns } = await start();
      assert.deepEqual(notes, [`Listening on ${CODE}. Ctrl-C to stop.`]);
      assert.deepEqual([data, warns], [[], []]);
    });

    it("says it is waiting for the next clip under --one", async () => {
      const { notes } = await start(["--one"]);
      assert.deepEqual(notes, [`Listening on ${CODE}. Waiting for the next clip.`]);
    });

    it("fails before listening when the room is not there", async () => {
      server.roomStatus = 404;
      await assert.rejects(recv(argsFor(), reporter().report), /Room not found/);
      assert.equal(sockets().length, 0);
    });

    it("fails before listening when the key is not the room's", async () => {
      const wrong = await generateRoomKey();
      const right = await generateRoomKey();
      server.keyCheck = right.check;

      const parsed = parseArgs(["recv", "--room", CODE, "--key", wrong.encoded, "--url", BASE]);
      assert.ok(parsed.ok);

      await assert.rejects(
        recv(parsed.args, reporter().report),
        (error: unknown) => error instanceof RoomKeyMismatchError,
      );
      assert.equal(sockets().length, 0);
    });
  });

  describe("over the realtime socket", () => {
    it("prints each clip as it arrives, opened", async () => {
      const { data } = await start();
      FakeSocket.last.ready();

      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "one") });
      await waitFor(() => data.length === 1, "clip one");
      FakeSocket.last.deliver({ type: "clip", clip: await seal(2, "two\nlines") });
      await waitFor(() => data.length === 2, "clip two");

      assert.deepEqual(data, ["one", "two\nlines"]);
    });

    it("never prints a clip twice, or one older than what it has printed", async () => {
      const { data } = await start();
      FakeSocket.last.ready();

      FakeSocket.last.deliver({ type: "clip", clip: await seal(7, "seven") });
      await waitFor(() => data.length === 1, "clip seven");

      FakeSocket.last.deliver({ type: "clip", clip: await seal(7, "seven") });
      FakeSocket.last.deliver({ type: "clip", clip: await seal(6, "six, arriving late") });
      FakeSocket.last.deliver({ type: "clip", clip: await seal(8, "eight") });
      await waitFor(() => data.length === 2, "clip eight");
      await settle();

      assert.deepEqual(data, ["seven", "eight"]);
    });

    it("does not announce a fallback while the socket is healthy", async () => {
      const { notes } = await start();
      FakeSocket.last.ready();
      tick(60_000);

      assert.equal(server.polls.length, 0);
      assert.equal(sockets().length, 1);
      assert.equal(notes.length, 1);
    });
  });

  describe("--one", () => {
    it("prints the next clip, exits 0, and closes the socket", async () => {
      const { data, result } = await start(["--one"]);
      FakeSocket.last.ready();

      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "just this") });

      assert.equal(await result, 0);
      assert.deepEqual(data, ["just this"]);
      assert.equal(FakeSocket.last.closed, true);
    });

    it("prints only the oldest clip of a batch", async () => {
      server.stored = [];
      const { data, result } = await start(["--one"]);
      FakeSocket.last.fail();
      server.stored = [await seal(3, "third"), await seal(2, "second")];

      tick(POLL_INTERVAL_MS);

      assert.equal(await result, 0);
      assert.deepEqual(data, ["second"]);
    });

    it("stops polling and reconnecting once it has its clip", async () => {
      const { result } = await start(["--one"]);
      FakeSocket.last.fail();
      server.stored = [await seal(1, "there")];
      tick(POLL_INTERVAL_MS);
      await result;
      assert.equal(liveTimers.size, 0, "a timer left running would hold the process open");

      const polls = server.polls.length;
      tick(120_000);

      assert.equal(server.polls.length, polls);
      assert.equal(sockets().length, 1);
    });
  });

  describe("stopping", () => {
    it("resolves 0 on abort, closing the socket", async () => {
      const { result, abort } = await start();
      FakeSocket.last.ready();

      abort();

      assert.equal(await result, 0);
      assert.equal(FakeSocket.last.closed, true);
    });

    it("cancels the poller and the pending reconnect", async () => {
      const { result, abort } = await start();
      FakeSocket.last.fail(); // Now polling, with a reconnect scheduled.

      abort();
      assert.equal(await result, 0);
      tick(120_000);

      assert.equal(server.polls.length, 0);
      assert.equal(sockets().length, 1);
    });

    it("leaves no timer running, so the process can exit", async () => {
      const { result, abort } = await start();
      FakeSocket.last.fail(); // A poller and a pending reconnect: the most there can be.
      assert.ok(liveTimers.size >= 2, "the fallback should have timers running");

      abort();
      await result;

      assert.equal(liveTimers.size, 0);
    });

    it("prints nothing after it has stopped", async () => {
      const { data, result, abort } = await start();
      FakeSocket.last.ready();
      abort();
      await result;

      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "too late") });
      await settle();

      assert.deepEqual(data, []);
    });
  });

  describe("when the socket drops", () => {
    it("says so once, then polls at the poll interval from the cursor", async () => {
      server.stored = [await seal(4, "already here")];
      const { notes, data } = await start();
      FakeSocket.last.ready();
      FakeSocket.last.fail();

      assert.deepEqual(notes.slice(1), ["Realtime unavailable. Polling instead."]);

      tick(POLL_INTERVAL_MS - 1);
      assert.equal(server.polls.length, 0, "not before the interval");

      server.stored = [...server.stored, await seal(5, "found by polling")];
      tick(1);
      await waitFor(() => data.length === 1, "the polled clip");

      assert.deepEqual(server.polls, [4]);
      assert.deepEqual(data, ["found by polling"]);

      tick(POLL_INTERVAL_MS);
      await waitFor(() => server.polls.length === 2, "the second poll");
      assert.deepEqual(server.polls, [4, 5], "the cursor moved with what was printed");
    });

    it("prints a polled batch oldest first", async () => {
      const { data } = await start();
      FakeSocket.last.fail();
      server.stored = [await seal(9, "nine"), await seal(8, "eight"), await seal(10, "ten")];

      tick(POLL_INTERVAL_MS);
      await waitFor(() => data.length === 3, "the polled batch");

      assert.deepEqual(data, ["eight", "nine", "ten"]);
    });

    it("does not repeat the announcement when a retry fails too", async () => {
      const { notes } = await start();
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[0]);
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[1]);
      FakeSocket.last.fail();

      assert.equal(sockets().length, 3);
      assert.equal(notes.filter((note) => /Realtime unavailable/.test(note)).length, 1);
    });

    it("retries the socket at 2s, 4s, 8s, then every 15s", async () => {
      await start();

      for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
        const before = sockets().length;
        assert.equal(before, index + 1);
        FakeSocket.last.fail();

        tick(delay - 1);
        assert.equal(sockets().length, before, `no retry ${index + 1} before ${delay}ms`);
        tick(1);
        assert.equal(sockets().length, before + 1, `retry ${index + 1} at ${delay}ms`);
      }
    });

    it("reconnects from the cursor, not from where it first started", async () => {
      const { data } = await start();
      FakeSocket.last.fail();
      server.stored = [await seal(3, "three")];
      tick(POLL_INTERVAL_MS);
      await waitFor(() => data.length === 1, "the polled clip");

      tick(RETRY_DELAYS_MS[0] - POLL_INTERVAL_MS);

      assert.equal(sockets().length, 2);
      assert.match(FakeSocket.last.url, /after=3\b/);
    });

    it("keeps polling after a poll fails, and says why on stderr", async () => {
      const { data, warns } = await start();
      FakeSocket.last.fail();

      server.onPoll = async () => {
        throw new Error("network down");
      };
      tick(POLL_INTERVAL_MS);
      await waitFor(() => warns.length >= 1, "the warning");
      assert.equal(warns[0], `Could not reach ${CODE}: network down`);

      server.onPoll = async (after) =>
        json({ clips: [await seal(1, "back online")].filter((clip) => clip.id > after) });
      tick(POLL_INTERVAL_MS);
      await waitFor(() => data.length === 1, "the clip after recovery");

      assert.deepEqual(data, ["back online"]);
    });
  });

  describe("when the socket comes back", () => {
    it("stops polling, says so once, and starts the backoff over", async () => {
      const { notes } = await start();
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[0]);
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[1]); // The second retry — so the next delay would be 8s.
      assert.equal(sockets().length, 3);

      FakeSocket.last.ready();
      assert.equal(notes.filter((note) => note === "Realtime connection restored.").length, 1);

      const polls = server.polls.length;
      tick(POLL_INTERVAL_MS * 6);
      assert.equal(server.polls.length, polls, "the poller stopped");

      // Backoff was reset: the next failure retries at 2s, not 8s.
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[0] - 1);
      assert.equal(sockets().length, 3);
      tick(1);
      assert.equal(sockets().length, 4);
    });

    it("announces a second fallback afresh", async () => {
      const { notes } = await start();
      FakeSocket.last.fail();
      tick(RETRY_DELAYS_MS[0]);
      FakeSocket.last.ready();
      FakeSocket.last.fail();

      assert.deepEqual(
        notes.slice(1),
        [
          "Realtime unavailable. Polling instead.",
          "Realtime connection restored.",
          "Realtime unavailable. Polling instead.",
        ],
      );
    });
  });

  describe("when the socket and the poller overlap", () => {
    // Both ask the server for clips after one shared cursor, and whichever
    // delivers first moves it. These are the two orders they can meet in.

    it("prints a clip once when the socket delivers it while a poll for it is in flight", async () => {
      const { data } = await start();
      FakeSocket.last.ready();
      FakeSocket.last.fail();

      // The poll starts, and hangs — its answer is still on the wire.
      let answerPoll!: (clips: Clip[]) => void;
      server.onPoll = () =>
        new Promise<Response>((resolve) => {
          answerPoll = (clips) => resolve(json({ clips }));
        });
      tick(POLL_INTERVAL_MS);
      assert.equal(server.polls.length, 1);

      // The socket comes back and delivers clip 2 first.
      tick(RETRY_DELAYS_MS[0] - POLL_INTERVAL_MS);
      FakeSocket.last.ready();
      const two = await seal(2, "two");
      FakeSocket.last.deliver({ type: "clip", clip: two });
      await waitFor(() => data.length === 1, "clip two from the socket");

      // Now the poll answers, and — asked after the old cursor — it includes 2.
      answerPoll([two, await seal(3, "three")]);
      await waitFor(() => data.length === 2, "clip three from the poll");
      await settle();

      assert.deepEqual(data, ["two", "three"]);
    });

    it("prints a clip once when the poller delivers it and the new socket replays it", async () => {
      const { data } = await start();
      FakeSocket.last.fail();

      const two = await seal(2, "two");
      server.stored = [two];
      tick(POLL_INTERVAL_MS);
      await waitFor(() => data.length === 1, "clip two from the poll");

      // The reconnect asks from the cursor, so it should not be sent 2 again —
      // but a server that replays is not a server that should print twice.
      tick(RETRY_DELAYS_MS[0] - POLL_INTERVAL_MS);
      assert.match(FakeSocket.last.url, /after=2\b/);
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: two });
      FakeSocket.last.deliver({ type: "clip", clip: await seal(3, "three") });
      await waitFor(() => data.length === 2, "clip three");
      await settle();

      assert.deepEqual(data, ["two", "three"]);
    });
  });

  describe("with no WebSocket at all", () => {
    it("polls as its whole strategy, without announcing a fallback", async () => {
      // @ts-expect-error — removing the global is the condition under test.
      delete globalThis.WebSocket;

      const controller = new AbortController();
      controllers.push(controller);
      const { report, data, notes } = reporter();
      const result = recv(argsFor(), report, controller.signal);
      await waitFor(() => notes.length > 0, "recv to start listening");

      server.stored = [await seal(1, "polled")];
      tick(POLL_INTERVAL_MS);
      await waitFor(() => data.length === 1, "the polled clip");

      assert.deepEqual(data, ["polled"]);
      assert.equal(sockets().length, 0);
      assert.deepEqual(notes, [`Listening on ${CODE}. Ctrl-C to stop.`]);

      controller.abort();
      assert.equal(await result, 0);
    });
  });
});
