import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";

import { parseArgs, type ParsedArgs } from "../src/cli/args.ts";
import type { Reporter } from "../src/cli/output.ts";
import { send } from "../src/cli/send.ts";
import {
  decryptClipText,
  importRoomKey,
  normalizeDeviceName,
  openClipMeta,
  parseRoomKeyFromHash,
  type RoomKey,
} from "../src/index.ts";

/**
 * `send` end to end against a fake room API: the room it creates, the clip it
 * posts, and what it does when the server does not keep a promise it made.
 * The encryption is real, so what the fake server holds is what a real one
 * would — which is how these tests can say what it could and could not read.
 */

const CODE = "X7KP2M";
const BASE = "https://cliplink.test";

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

type PostedClip = { text: string; senderId: string; meta?: string; burn?: true };

class FakeServer {
  creates: Array<Record<string, unknown>> = [];
  posted: PostedClip[] = [];
  erases: Array<{ token: string | undefined; body: unknown }> = [];
  /** Behave as a server from before one-time clips: keep it as an ordinary one. */
  dropBurn = false;

  fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));

    if (url.pathname === "/rooms") {
      this.creates.push(JSON.parse(String(init?.body ?? "{}")));
      return json({ code: CODE, ttlSeconds: 21_600 });
    }
    if (url.pathname === `/rooms/${CODE}`) {
      return json({
        room: { code: CODE, createdAt: 0, ttlSeconds: 21_600, keyCheck: this.creates[0]?.keyCheck },
        clips: [],
      });
    }
    if (url.pathname === `/rooms/${CODE}/clips` && init?.method === "POST") {
      const clip = JSON.parse(String(init.body)) as PostedClip;
      this.posted.push(clip);
      const stored = { id: 7, ts: 1_700_000_000, ...clip };
      if (this.dropBurn) {
        delete stored.burn;
      }
      return json({ clip: stored }, 201);
    }
    if (url.pathname === `/rooms/${CODE}/clips` && init?.method === "DELETE") {
      const body = JSON.parse(String(init.body)) as { ids: number[] };
      this.erases.push({
        token: (init.headers as Record<string, string>).Authorization,
        body,
      });
      return json({ ids: body.ids, gen: 1 });
    }

    throw new Error(`Unexpected request to ${url}`);
  };
}

function reporter() {
  const notes: string[] = [];
  const warns: string[] = [];
  const report: Reporter = {
    data: () => {},
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

function argsFor(argv: string[]): ParsedArgs {
  const parsed = parseArgs(["send", ...argv, "--url", BASE], {});
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.args;
}

const noStdin = Object.assign(Readable.from([]), { isTTY: true });

describe("send", () => {
  const realFetch = globalThis.fetch;
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
    globalThis.fetch = server.fetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Runs `send`, and recovers the key from the link it printed, as a person would. */
  async function run(argv: string[]) {
    const out = reporter();
    const code = await send(argsFor(argv), out.report, noStdin);
    const link = out.notes.find((note) => note.startsWith(BASE));
    const encoded = link ? parseRoomKeyFromHash(new URL(link).hash) : null;
    const key: RoomKey | null = encoded ? await importRoomKey(encoded) : null;
    return { ...out, code, key };
  }

  it("creates its room with an erase check, or clips in it could never be deleted", async () => {
    const { key } = await run(["hello"]);

    assert.ok(key);
    assert.equal(server.creates[0].eraseCheck, key.eraseCheck);
    assert.equal(JSON.stringify(server.creates[0]).includes(key.eraseToken), false);
  });

  it("posts only ciphertext, which the key in the printed link opens", async () => {
    const { code, key } = await run(["hello"]);

    assert.equal(code, 0);
    assert.ok(key);
    assert.equal(await decryptClipText(key, CODE, server.posted[0].text), "hello");
    assert.equal(JSON.stringify(server.posted[0]).includes("hello"), false);
  });

  it("names the sender as this machine unless told otherwise, and only under the seal", async () => {
    const { key } = await run(["hello"]);
    const [posted] = server.posted;

    assert.ok(key);
    assert.ok(posted.meta);
    assert.deepEqual(await openClipMeta(key, CODE, posted.text, posted.meta), {
      name: normalizeDeviceName(hostname()) ?? "CLI",
    });
  });

  it("names the sender as --name says", async () => {
    const { key } = await run(["hello", "--name", "build box"]);
    const [posted] = server.posted;

    assert.ok(key);
    assert.deepEqual(await openClipMeta(key, CODE, posted.text, posted.meta!), {
      name: "build box",
    });
  });

  it("sends an ordinary clip as one, with no mention of burning", async () => {
    await run(["hello"]);

    assert.equal("burn" in server.posted[0], false);
    assert.deepEqual(server.erases, []);
  });

  it("marks a --burn clip as one-time, beside it and under the seal", async () => {
    const { code, key } = await run(["hunter2", "--burn"]);
    const [posted] = server.posted;

    assert.equal(code, 0);
    assert.ok(key);
    assert.equal(posted.burn, true);
    assert.deepEqual(
      (await openClipMeta(key, CODE, posted.text, posted.meta!)) as { burn?: true },
      { name: normalizeDeviceName(hostname()) ?? "CLI", burn: true },
    );
    assert.deepEqual(server.erases, [], "it is the reader that deletes it, not the sender");
  });

  it("takes back a --burn clip a server stored as ordinary, and fails", async () => {
    server.dropBurn = true;

    const { code, warns } = await run(["hunter2", "--burn"]);

    assert.equal(code, 1);
    assert.equal(server.erases.length, 1);
    assert.deepEqual(server.erases[0].body, { ids: [7] });
    // No link is printed for a send that failed, so the key is not to hand.
    // The token is still checkable: it must hash to what the room was made with.
    const token = server.erases[0].token?.replace(/^Bearer /, "") ?? "";
    assert.equal(
      createHash("sha256").update(token).digest("base64url"),
      server.creates[0].eraseCheck,
    );
    assert.match(warns.join("\n"), /does not support one-time clips/);
  });
});
