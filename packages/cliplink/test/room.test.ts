import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { parseArgs, type ParsedArgs } from "../src/cli/args.ts";
import { readSavedRooms, saveRoom } from "../src/cli/config.ts";
import { openSession } from "../src/cli/room.ts";
import { deriveOpenRoomKey, generateRoomKey } from "../src/index.ts";

/**
 * `openSession` is where the CLI decides which room it is talking to and which
 * key opens it. The precedence between the four places a key can come from is
 * the security-relevant part, so each pair is pinned here rather than left to
 * the order the branches happen to sit in.
 *
 * `findSavedRoom` and `saveRoom` read `process.env` directly — `openSession`
 * threads no env through — so these tests point the real thing at a temporary
 * directory rather than faking the config module.
 */

const CODE = "X7KP2M";
const BASE = "https://cliplink.test";

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

/** Just the room-creating half of the API; joining reaches no server. */
class FakeServer {
  ttlSeconds = 21_600;
  creates: Array<Record<string, unknown>> = [];

  fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/rooms") {
      this.creates.push(JSON.parse(String(init?.body ?? "{}")));
      return json({ code: CODE, ttlSeconds: this.ttlSeconds });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
}

function argsFor(argv: string[]): ParsedArgs {
  const parsed = parseArgs([...argv, "--url", BASE], {});
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  return parsed.args;
}

describe("openSession", () => {
  const realFetch = globalThis.fetch;
  const realConfigDir = process.env.CLIPLINK_CONFIG_DIR;

  let server: FakeServer;
  let dir: string;

  beforeEach(async () => {
    server = new FakeServer();
    globalThis.fetch = server.fetch as unknown as typeof globalThis.fetch;
    dir = await mkdtemp(join(tmpdir(), "cliplink-room-"));
    process.env.CLIPLINK_CONFIG_DIR = dir;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (realConfigDir === undefined) {
      delete process.env.CLIPLINK_CONFIG_DIR;
    } else {
      process.env.CLIPLINK_CONFIG_DIR = realConfigDir;
    }
    await rm(dir, { recursive: true, force: true });
  });

  describe("creating a room", () => {
    it("creates one when none was named, and says so", async () => {
      const session = await openSession(argsFor(["send", "hi"]));

      assert.equal(session.created, true);
      assert.equal(session.code, CODE);
      assert.equal(session.keySource, "generated");
    });

    it("tells the server the fingerprint and never the key", async () => {
      const session = await openSession(argsFor(["send", "hi"]));

      assert.equal(server.creates.length, 1);
      assert.equal(server.creates[0].keyCheck, session.key.check);
      assert.notEqual(session.key.check, session.key.encoded);
      assert.doesNotMatch(JSON.stringify(server.creates[0]), new RegExp(session.key.encoded));
    });

    it("puts the key in the link's fragment", async () => {
      const session = await openSession(argsFor(["send", "hi"]));

      assert.equal(session.url, `${BASE}/room/${CODE}#k=${session.key.encoded}`);
    });

    it("passes --ttl through, and omits it when it was not given", async () => {
      await openSession(argsFor(["send", "hi", "--ttl", "7200"]));
      assert.equal(server.creates[0].ttlSeconds, 7200);

      await openSession(argsFor(["send", "hi"]));
      assert.equal("ttlSeconds" in server.creates[1], false);
    });

    it("writes nothing without --save", async () => {
      await openSession(argsFor(["send", "hi"]));

      assert.deepEqual(await readSavedRooms({ CLIPLINK_CONFIG_DIR: dir }), []);
    });

    it("records the expiry the server reported under --save", async () => {
      server.ttlSeconds = 3_600;
      const before = Date.now();
      const session = await openSession(argsFor(["send", "hi", "--save"]));
      const after = Date.now();

      const [saved] = await readSavedRooms({ CLIPLINK_CONFIG_DIR: dir });
      assert.equal(saved.code, CODE);
      assert.equal(saved.key, session.key.encoded);
      assert.equal(saved.baseUrl, BASE);
      // Creating is the only path told the lifetime, so this is a real expiry
      // rather than the upper bound a joined room falls back to.
      assert.ok(saved.expiresAt !== undefined);
      assert.ok(saved.expiresAt >= before + 3_600_000);
      assert.ok(saved.expiresAt <= after + 3_600_000);
    });
  });

  describe("joining a room", () => {
    it("reaches no server: the code and the key are all it needs", async () => {
      const key = await generateRoomKey();
      const session = await openSession(argsFor(["send", "hi", "-r", CODE, "-k", key.encoded]));

      assert.equal(session.created, false);
      assert.deepEqual(server.creates, []);
    });

    it("takes the code out of a pasted room link", async () => {
      const key = await generateRoomKey();
      const session = await openSession(
        argsFor(["send", "hi", "-r", `${BASE}/room/${CODE}`, "-k", key.encoded]),
      );

      assert.equal(session.code, CODE);
    });

    it("normalizes a code given in lower case", async () => {
      const key = await generateRoomKey();
      const session = await openSession(
        argsFor(["send", "hi", "-r", CODE.toLowerCase(), "-k", key.encoded]),
      );

      assert.equal(session.code, CODE);
    });

    it("rejects something that is not a room code", async () => {
      await assert.rejects(
        openSession(argsFor(["send", "hi", "-r", "nope", "--open"])),
        /"nope" is not a room code/,
      );
    });

    it("carries no key in the link for an --open room", async () => {
      const session = await openSession(argsFor(["send", "hi", "-r", CODE, "--open"]));

      assert.equal(session.url, `${BASE}/room/${CODE}`);
      assert.equal(session.keySource, "open");
      assert.equal(
        session.key.encoded,
        (await deriveOpenRoomKey(CODE)).encoded,
        "the key is derived from the code alone",
      );
    });

    it("fails when the room is encrypted and no key can be found", async () => {
      await assert.rejects(
        openSession(argsFor(["send", "hi", "-r", CODE])),
        /is end-to-end encrypted, so it needs its key/,
      );
    });

    it("fails on a key that is not one", async () => {
      await assert.rejects(
        openSession(argsFor(["send", "hi", "-r", CODE, "-k", "not-a-key"])),
        /not a valid room key/,
      );
    });
  });

  describe("where the key comes from", () => {
    it("takes --key when it is the only source", async () => {
      const key = await generateRoomKey();
      const session = await openSession(argsFor(["send", "hi", "-r", CODE, "-k", key.encoded]));

      assert.equal(session.key.encoded, key.encoded);
      assert.equal(session.keySource, "flag");
    });

    it("takes the fragment of a room link given as --room", async () => {
      const key = await generateRoomKey();
      const session = await openSession(
        argsFor(["send", "hi", "-r", `${BASE}/room/${CODE}#k=${key.encoded}`]),
      );

      assert.equal(session.key.encoded, key.encoded);
      assert.equal(session.keySource, "flag");
    });

    it("takes the saved key when nothing else names one", async () => {
      const key = await generateRoomKey();
      await saveRoom(
        { code: CODE, key: key.encoded, baseUrl: BASE, savedAt: Date.now() },
        { CLIPLINK_CONFIG_DIR: dir },
      );

      const session = await openSession(argsFor(["send", "hi", "-r", CODE]));

      assert.equal(session.key.encoded, key.encoded);
      assert.equal(session.keySource, "saved");
    });

    it("prefers --key over the saved key", async () => {
      const saved = await generateRoomKey();
      const flag = await generateRoomKey();
      await saveRoom(
        { code: CODE, key: saved.encoded, baseUrl: BASE, savedAt: Date.now() },
        { CLIPLINK_CONFIG_DIR: dir },
      );

      const session = await openSession(argsFor(["send", "hi", "-r", CODE, "-k", flag.encoded]));

      assert.equal(session.key.encoded, flag.encoded);
      assert.equal(session.keySource, "flag");
    });

    it("prefers --key over the fragment of the link it was given beside", async () => {
      const inLink = await generateRoomKey();
      const flag = await generateRoomKey();

      const session = await openSession(
        argsFor([
          "send",
          "hi",
          "-r",
          `${BASE}/room/${CODE}#k=${inLink.encoded}`,
          "-k",
          flag.encoded,
        ]),
      );

      assert.equal(session.key.encoded, flag.encoded);
    });

    it("prefers a link's fragment over the saved key", async () => {
      const saved = await generateRoomKey();
      const inLink = await generateRoomKey();
      await saveRoom(
        { code: CODE, key: saved.encoded, baseUrl: BASE, savedAt: Date.now() },
        { CLIPLINK_CONFIG_DIR: dir },
      );

      const session = await openSession(
        argsFor(["send", "hi", "-r", `${BASE}/room/${CODE}#k=${inLink.encoded}`]),
      );

      assert.equal(session.key.encoded, inLink.encoded);
    });

    it("derives an --open room's key whatever is saved under that code", async () => {
      const saved = await generateRoomKey();
      await saveRoom(
        { code: CODE, key: saved.encoded, baseUrl: BASE, savedAt: Date.now() },
        { CLIPLINK_CONFIG_DIR: dir },
      );

      const session = await openSession(argsFor(["send", "hi", "-r", CODE, "--open"]));

      // resolveKey returns the derived key before it looks at the one it was
      // handed, so this holds however the saved lookup is guarded — room.ts
      // skipping it for open rooms saves a disk read, not a wrong answer.
      assert.equal(session.key.encoded, (await deriveOpenRoomKey(CODE)).encoded);
      assert.equal(session.keySource, "open");
    });

    it("reports a key from CLIPLINK_ROOM_KEY as coming from the flag", async () => {
      const key = await generateRoomKey();
      const parsed = parseArgs(["send", "hi", "-r", CODE, "--url", BASE], {
        CLIPLINK_ROOM_KEY: key.encoded,
      });
      assert.ok(parsed.ok);

      const session = await openSession(parsed.args);

      // parseArgs folds the environment into args.key before openSession sees
      // it, so the two are indistinguishable by the time the source is chosen.
      // "env" is therefore never reported, and keySource reads "flag" here.
      assert.equal(session.key.encoded, key.encoded);
      assert.equal(session.keySource, "flag");
    });
  });

  describe("--save on a join", () => {
    it("saves the resolved key with no expiry, since a join is not told one", async () => {
      const key = await generateRoomKey();
      await openSession(argsFor(["send", "hi", "-r", CODE, "-k", key.encoded, "--save"]));

      const [saved] = await readSavedRooms({ CLIPLINK_CONFIG_DIR: dir });
      assert.equal(saved.key, key.encoded);
      assert.equal(saved.expiresAt, undefined);
    });

    it("writes nothing without --save", async () => {
      const key = await generateRoomKey();
      await openSession(argsFor(["send", "hi", "-r", CODE, "-k", key.encoded]));

      assert.deepEqual(await readSavedRooms({ CLIPLINK_CONFIG_DIR: dir }), []);
    });

    it("matches a saved room by code alone, whatever origin it was saved for", async () => {
      const key = await generateRoomKey();
      await saveRoom(
        { code: CODE, key: key.encoded, baseUrl: "http://localhost:3000", savedAt: Date.now() },
        { CLIPLINK_CONFIG_DIR: dir },
      );

      // The origin is recorded but not consulted, so a room code saved against
      // a dev server supplies its key when the same code is joined against
      // another deployment. The key simply will not decrypt there.
      const session = await openSession(argsFor(["send", "hi", "-r", CODE]));

      assert.equal(session.key.encoded, key.encoded);
    });
  });
});
