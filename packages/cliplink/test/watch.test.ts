import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { parseArgs, type ParsedArgs } from "../src/cli/args.ts";
import type { Clipboard } from "../src/cli/clipboard.ts";
import type { Reporter } from "../src/cli/output.ts";
import { CLIPBOARD_POLL_MS, watch } from "../src/cli/watch.ts";
import {
  decryptClipText,
  deriveOpenRoomKey,
  encryptClipText,
  generateRoomKey,
  MAX_CLIP_CHARS,
  type Clip,
  type RoomKey,
} from "../src/index.ts";
import { FakeSocket, settle, waitFor } from "./support.ts";

/**
 * `watch` against the same stand-ins `recv.test.ts` uses — `fetch` for the
 * room API, `WebSocket` for the socket — plus a clipboard held in memory.
 * The clips that cross are really sealed, and the clock is fake, so a
 * clipboard poll is one `tick`.
 */

const CODE = "X7KP2M";
const BASE = "https://cliplink.test";

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

type Posted = { text: string; senderId: string };

class FakeServer {
  stored: Clip[] = [];
  posted: Posted[] = [];
  erases: Array<{ ids: number[] }> = [];
  requests = 0;
  /** Awaited before a delete is answered, so a test can hold one open. */
  beforeErase: () => Promise<void> = async () => {};
  private nextId = 100;

  fetch = async (input: string | URL | Request, init?: RequestInit) => {
    this.requests += 1;
    const url = new URL(String(input));

    if (url.pathname === `/rooms/${CODE}`) {
      return json({ room: { code: CODE, createdAt: 0, ttlSeconds: 21_600 }, clips: this.stored });
    }
    if (url.pathname === `/rooms/${CODE}/clips` && init?.method === "POST") {
      const clip = JSON.parse(String(init.body)) as Posted;
      this.posted.push(clip);
      return json({ clip: { id: (this.nextId += 1), ts: 1_700_000_000, ...clip } }, 201);
    }
    if (url.pathname === `/rooms/${CODE}/clips` && init?.method === "DELETE") {
      await this.beforeErase();
      const body = JSON.parse(String(init.body)) as { ids: number[] };
      this.erases.push(body);
      return json({ ids: body.ids, gen: this.erases.length });
    }
    if (url.pathname === `/rooms/${CODE}/clips`) {
      return json({ clips: [] });
    }

    throw new Error(`Unexpected request to ${url}`);
  };
}

/** A clipboard in memory, recording every write. */
class FakeClipboard implements Clipboard {
  name = "fake";
  content: string;
  writes: string[] = [];
  reads = 0;
  /** What a read appends, as some tools add a newline to what was written. */
  suffix = "";

  constructor(content = "") {
    this.content = content;
  }

  read = async () => {
    this.reads += 1;
    return `${this.content}${this.suffix}`;
  };

  write = async (text: string) => {
    this.content = text;
    this.writes.push(text);
  };
}

function reporter() {
  const notes: string[] = [];
  const warns: string[] = [];
  const report: Reporter = {
    data: () => {
      throw new Error("watch writes nothing to stdout");
    },
    note: (text = "") => {
      notes.push(text);
    },
    warn: (text) => {
      warns.push(text);
    },
    interactive: false,
  };
  return { report, notes, warns };
}

function argsFor(flags: string[] = []): ParsedArgs {
  const parsed = parseArgs(["watch", "--room", CODE, "--open", "--url", BASE, ...flags]);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.args;
}

describe("watch", () => {
  const realFetch = globalThis.fetch;
  const realWebSocket = globalThis.WebSocket;

  let server: FakeServer;
  let openKey: RoomKey;
  let controllers: AbortController[];

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
  });

  afterEach(() => {
    for (const controller of controllers) {
      controller.abort();
    }
    mock.timers.reset();
    globalThis.fetch = realFetch;
    globalThis.WebSocket = realWebSocket;
  });

  const seal = async (
    id: number,
    text: string,
    extra: Partial<Clip> = {},
    key = openKey,
  ): Promise<Clip> => ({
    id,
    text: await encryptClipText(key, CODE, text),
    senderId: "someone-else",
    ts: 1_700_000_000 + id,
    ...extra,
  });

  async function start(flags: string[] = [], board = new FakeClipboard("on the clipboard at launch")) {
    const controller = new AbortController();
    controllers.push(controller);
    const out = reporter();
    const result = watch(argsFor(flags), out.report, controller.signal, board);
    await waitFor(
      () => out.notes.some((note) => note.startsWith("Watching")),
      "the watch to start",
    );
    return { ...out, board, result, abort: () => controller.abort() };
  }

  /** One clipboard poll, and the work it starts. */
  async function poll() {
    mock.timers.tick(CLIPBOARD_POLL_MS);
    await settle();
  }

  const sentTexts = () =>
    Promise.all(server.posted.map((clip) => decryptClipText(openKey, CODE, clip.text)));

  describe("receiving", () => {
    it("copies a clip that arrives, and says who sent it", async () => {
      const { board, notes } = await start();
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "from the phone") });

      await waitFor(() => board.writes.length === 1, "the clip to be copied");
      assert.deepEqual(board.writes, ["from the phone"]);
      assert.ok(notes.includes("Copied a clip from another device."));
    });

    it("copies nothing the room held before it started", async () => {
      server.stored = [await seal(1, "old")];
      const { board } = await start();

      assert.match(FakeSocket.last.url, /after=1\b/);
      await settle();
      assert.deepEqual(board.writes, []);
    });

    it("leaves the clipboard alone for a clip it cannot open", async () => {
      const { board, warns } = await start();
      const otherKey = await generateRoomKey();
      FakeSocket.last.ready();
      FakeSocket.last.deliver({
        type: "clip",
        clip: await seal(1, "not for us", { burn: true }, otherKey),
      });

      await waitFor(() => warns.length === 1, "the warning");
      assert.match(warns[0], /cannot open/);
      assert.deepEqual(board.writes, []);
      // Not read, so not spent.
      assert.deepEqual(server.erases, []);
    });

    it("deletes a one-time clip once it has copied it", async () => {
      const { board } = await start();
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(5, "123456", { burn: true }) });

      await waitFor(() => server.erases.length === 1, "the delete");
      assert.deepEqual(board.writes, ["123456"]);
      assert.deepEqual(server.erases, [{ ids: [5] }]);
    });

    it("waits for a pending delete before it exits", async () => {
      const { board, result, abort } = await start();
      let release = () => {};
      server.beforeErase = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(5, "123456", { burn: true }) });
      await waitFor(() => board.writes.length === 1, "the copy");

      abort();
      let exited = false;
      void result.then(() => {
        exited = true;
      });
      await settle();
      assert.equal(exited, false, "still waiting on the delete");

      release();

      assert.equal(await result, 0);
      assert.deepEqual(server.erases, [{ ids: [5] }]);
    });
  });

  describe("sending", () => {
    it("sends what is copied after it starts, but not what was there at launch", async () => {
      const { board } = await start();

      await poll();
      assert.deepEqual(server.posted, []);

      board.content = "copied here";
      await poll();
      await waitFor(() => server.posted.length === 1, "the send");
      assert.deepEqual(await sentTexts(), ["copied here"]);
    });

    it("sends a copy once, however many polls see it", async () => {
      const { board } = await start();
      board.content = "copied here";
      await poll();
      await poll();
      await poll();

      await waitFor(() => server.posted.length === 1, "the send");
      await settle();
      assert.equal(server.posted.length, 1);
    });

    it("names the clip after the machine, or --name", async () => {
      const { board } = await start(["--name", "Work laptop"]);
      board.content = "copied here";
      await poll();

      await waitFor(() => server.posted.length === 1, "the send");
      assert.ok("meta" in server.posted[0], "a sealed name goes with the clip");
    });

    it("skips a clip over the limit, and says so once", async () => {
      const { board, warns } = await start();
      board.content = "x".repeat(MAX_CLIP_CHARS + 1);
      await poll();
      await poll();

      assert.equal(warns.length, 1);
      assert.match(warns[0], /limit/);
      assert.deepEqual(server.posted, []);
    });

    it("sends nothing for an empty clipboard", async () => {
      const { board } = await start();
      board.content = "   ";
      await poll();

      assert.deepEqual(server.posted, []);
    });
  });

  describe("loops", () => {
    it("does not send back a clip it has just copied", async () => {
      const { board } = await start();
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "from the phone") });
      await waitFor(() => board.writes.length === 1, "the copy");

      await poll();
      await poll();
      assert.deepEqual(server.posted, []);
    });

    it("does not send it back when the tool reads it with a newline added", async () => {
      const { board } = await start();
      board.suffix = "\r\n";
      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "from the phone") });
      await waitFor(() => board.writes.length === 1, "the copy");

      await poll();
      assert.deepEqual(server.posted, []);
    });

    it("does not copy its own clip when the room echoes it", async () => {
      const { board } = await start();
      FakeSocket.last.ready();
      board.content = "copied here";
      await poll();
      await waitFor(() => server.posted.length === 1, "the send");

      // The server relays every clip to every socket, the sender's included.
      board.content = "copied since";
      const [posted] = server.posted;
      FakeSocket.last.deliver({
        type: "clip",
        clip: { id: 101, text: posted.text, senderId: posted.senderId, ts: 1_700_000_101 },
      });
      await settle();

      assert.deepEqual(board.writes, []);
      assert.equal(board.content, "copied since");
    });
  });

  describe("one direction", () => {
    it("never reads the clipboard under --recv-only", async () => {
      const { board } = await start(["--recv-only"]);
      board.content = "copied here";
      await poll();

      assert.equal(board.reads, 0);
      assert.deepEqual(server.posted, []);

      FakeSocket.last.ready();
      FakeSocket.last.deliver({ type: "clip", clip: await seal(1, "from the phone") });
      await waitFor(() => board.writes.length === 1, "the copy");
    });

    it("opens no socket under --send-only", async () => {
      const { board } = await start(["--send-only"]);
      board.content = "copied here";
      await poll();

      await waitFor(() => server.posted.length === 1, "the send");
      assert.equal(FakeSocket.instances.length, 0);
    });
  });

  describe("failing", () => {
    it("exits 1 without creating or joining a room when there is no clipboard", async () => {
      const out = reporter();
      const code = await watch(argsFor(), out.report, undefined, "No clipboard tool found.");

      assert.equal(code, 1);
      assert.deepEqual(out.warns, ["No clipboard tool found."]);
      assert.equal(server.requests, 0);
    });

    it("exits 1 when the clipboard cannot be read at all, before touching the room", async () => {
      const board = new FakeClipboard();
      board.read = async () => {
        throw new Error("no display");
      };
      const out = reporter();

      assert.equal(await watch(argsFor(), out.report, undefined, board), 1);
      assert.match(out.warns[0], /Could not read the clipboard with fake: no display/);
      assert.equal(server.requests, 0);
    });

    it("reports a run of failed reads once, and carries on", async () => {
      const { board, warns, notes } = await start();
      const read = board.read;
      board.read = async () => {
        throw new Error("busy");
      };
      await poll();
      await poll();
      assert.equal(warns.length, 1);

      board.read = read;
      board.content = "copied here";
      await poll();
      await waitFor(() => server.posted.length === 1, "the send");
      assert.ok(notes.includes("Reading the clipboard again."));
    });

    it("stops cleanly on Ctrl-C", async () => {
      const { result, abort } = await start();
      FakeSocket.last.ready();
      abort();

      assert.equal(await result, 0);
      assert.ok(FakeSocket.last.closed);
    });
  });
});
