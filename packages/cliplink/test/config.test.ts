import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { Env } from "../src/cli/env.ts";
import {
  configPath,
  findSavedRoom,
  forgetAllRooms,
  forgetRoom,
  isExpired,
  pruneRooms,
  readSavedRooms,
  saveRoom,
} from "../src/cli/config.ts";
import { MAX_ROOM_TTL_SECONDS } from "../src/index.ts";

const dirs: string[] = [];

async function tempEnv() {
  const dir = await mkdtemp(join(tmpdir(), "cliplink-test-"));
  dirs.push(dir);
  return { CLIPLINK_CONFIG_DIR: dir } as Env;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("configPath", () => {
  it("prefers CLIPLINK_CONFIG_DIR", () => {
    assert.equal(configPath({ CLIPLINK_CONFIG_DIR: "/tmp/x" }), "/tmp/x/rooms.json");
  });

  it("falls back to XDG_CONFIG_HOME", () => {
    assert.equal(
      configPath({ XDG_CONFIG_HOME: "/tmp/xdg" }),
      "/tmp/xdg/cliplink/rooms.json",
    );
  });
});

describe("saveRoom", () => {
  it("writes the file readable only by its owner, because it holds keys", async () => {
    const env = await tempEnv();
    const path = await saveRoom(
      { code: "X7KP2M", key: "KEY", baseUrl: "https://example", savedAt: 1 },
      env,
    );

    const info = await stat(path);
    assert.equal(info.mode & 0o777, 0o600);
  });

  it("round-trips a room", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "KEY", baseUrl: "https://example", savedAt: 1 },
      env,
    );

    assert.equal(
      (await findSavedRoom("X7KP2M", "https://example", env))?.key,
      "KEY",
    );
  });

  it("finds a room whatever case it is asked for in", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "KEY", baseUrl: "https://example", savedAt: 1 },
      env,
    );

    assert.ok(await findSavedRoom("x7kp2m", "https://example", env));
  });

  it("keeps the same code on two servers as two rooms", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "DEV", baseUrl: "http://localhost:3000", savedAt: 1 },
      env,
    );
    await saveRoom(
      { code: "X7KP2M", key: "PROD", baseUrl: "https://cliplink.app", savedAt: 2 },
      env,
    );

    // Deduplicating on the code alone would have evicted the first, leaving
    // the origin-aware lookup nothing to tell apart.
    assert.equal((await readSavedRooms(env)).length, 2);
    assert.equal(
      (await findSavedRoom("X7KP2M", "http://localhost:3000", env))?.key,
      "DEV",
    );
    assert.equal(
      (await findSavedRoom("X7KP2M", "https://cliplink.app", env))?.key,
      "PROD",
    );
  });

  it("replaces rather than duplicates a room saved twice", async () => {
    const env = await tempEnv();
    const room = { code: "X7KP2M", baseUrl: "https://example", savedAt: 1 };
    await saveRoom({ ...room, key: "OLD" }, env);
    await saveRoom({ ...room, key: "NEW", savedAt: 2 }, env);

    const rooms = await readSavedRooms(env);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].key, "NEW");
  });

  it("keeps the newest room first", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "AAAAAA", baseUrl: "u", savedAt: 1 }, env);
    await saveRoom({ code: "BBBBBB", baseUrl: "u", savedAt: 2 }, env);

    assert.deepEqual(
      (await readSavedRooms(env)).map((room) => room.code),
      ["BBBBBB", "AAAAAA"],
    );
  });

  it("caps the list rather than growing without bound", async () => {
    const env = await tempEnv();
    for (let index = 0; index < 30; index += 1) {
      await saveRoom(
        { code: `R${String(index).padStart(5, "0")}`, baseUrl: "u", savedAt: index },
        env,
      );
    }

    assert.equal((await readSavedRooms(env)).length, 25);
  });

  it("saves an open room with no key", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", baseUrl: "u", savedAt: 1 }, env);

    assert.equal((await findSavedRoom("X7KP2M", "u", env))?.key, undefined);
  });
});

describe("findSavedRoom", () => {
  const room = {
    code: "X7KP2M",
    key: "KEY",
    baseUrl: "https://cliplink.app",
    savedAt: 1,
  };

  it("withholds a room saved against a different server", async () => {
    const env = await tempEnv();
    await saveRoom(room, env);

    // The whole point: a six-character code is unique only to the server that
    // issued it, so the dev room's key must not be offered for the same code
    // in production. Being handed no key is the right answer, not a miss.
    assert.equal(await findSavedRoom("X7KP2M", "http://localhost:3000", env), null);
  });

  it("still matches when the origin is written differently", async () => {
    const env = await tempEnv();
    await saveRoom(room, env);

    for (const baseUrl of [
      "https://cliplink.app/",
      "https://CLIPLINK.app",
      "https://cliplink.app:443",
    ]) {
      assert.ok(await findSavedRoom("X7KP2M", baseUrl, env), baseUrl);
    }
  });

  it("tells two paths on one host apart, but not by a trailing slash", async () => {
    const env = await tempEnv();
    await saveRoom({ ...room, baseUrl: "https://example.com/a" }, env);

    assert.ok(await findSavedRoom("X7KP2M", "https://example.com/a", env));
    // A path is where a trailing slash is the difference between two strings
    // and no difference at all in the server they name; on a bare origin the
    // URL parser has already made both "/".
    assert.ok(await findSavedRoom("X7KP2M", "https://example.com/a/", env));
    assert.equal(await findSavedRoom("X7KP2M", "https://example.com/b", env), null);
  });

  it("matches an unparseable baseUrl against itself, not against everything", async () => {
    const env = await tempEnv();
    await saveRoom({ ...room, baseUrl: "not a url" }, env);

    assert.ok(await findSavedRoom("X7KP2M", "not a url", env));
    assert.equal(await findSavedRoom("X7KP2M", "also not a url", env), null);
  });
});

describe("readSavedRooms", () => {
  it("is empty when nothing has been saved", async () => {
    assert.deepEqual(await readSavedRooms(await tempEnv()), []);
  });

  it("is empty rather than throwing when the file is not JSON", async () => {
    const env = await tempEnv();
    await writeFile(configPath(env), "{ not json");

    assert.deepEqual(await readSavedRooms(env), []);
  });

  it("drops entries that are not rooms", async () => {
    const env = await tempEnv();
    await writeFile(
      configPath(env),
      JSON.stringify({
        rooms: [
          { code: "X7KP2M", baseUrl: "u", savedAt: 1 },
          { code: 42 },
          null,
          "nope",
        ],
      }),
    );

    const rooms = await readSavedRooms(env);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].code, "X7KP2M");
  });

  it("finds nothing for a room that was never saved", async () => {
    assert.equal(await findSavedRoom("X7KP2M", "https://example", await tempEnv()), null);
  });
});

describe("isExpired", () => {
  const savedAt = 1_000_000;

  it("reads a recorded expiry", () => {
    const room = { code: "A", baseUrl: "u", savedAt, expiresAt: savedAt + 5_000 };
    assert.equal(isExpired(room, savedAt + 4_999), false);
    assert.equal(isExpired(room, savedAt + 5_000), true);
  });

  it("falls back to the longest a room may live when none was recorded", () => {
    const room = { code: "A", baseUrl: "u", savedAt };
    const bound = savedAt + MAX_ROOM_TTL_SECONDS * 1000;
    assert.equal(isExpired(room, bound - 1), false);
    assert.equal(isExpired(room, bound), true);
  });
});

describe("forgetRoom", () => {
  it("removes the room and returns it", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", key: "KEY", baseUrl: "u", savedAt: 1 }, env);

    assert.deepEqual(
      (await forgetRoom("X7KP2M", env)).map((forgotten) => forgotten.key),
      ["KEY"],
    );
    assert.deepEqual(await readSavedRooms(env), []);
  });

  it("matches the code whatever case it is asked for in", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", baseUrl: "u", savedAt: 1 }, env);

    assert.equal((await forgetRoom("x7kp2m", env)).length, 1);
  });

  it("forgets the code on every server it was saved against", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "DEV", baseUrl: "http://localhost:3000", savedAt: 1 },
      env,
    );
    await saveRoom(
      { code: "X7KP2M", key: "PROD", baseUrl: "https://cliplink.app", savedAt: 2 },
      env,
    );

    // `rooms --forget` is given a code and nothing else, so leaving a copy
    // behind on an origin the user never named would be a surprise.
    assert.equal((await forgetRoom("X7KP2M", env)).length, 2);
    assert.deepEqual(await readSavedRooms(env), []);
  });

  it("leaves the other rooms alone", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "AAAAAA", baseUrl: "u", savedAt: 1 }, env);
    await saveRoom({ code: "BBBBBB", baseUrl: "u", savedAt: 2 }, env);

    await forgetRoom("AAAAAA", env);
    assert.deepEqual((await readSavedRooms(env)).map((room) => room.code), ["BBBBBB"]);
  });

  it("is empty for a room that was never saved, and writes nothing", async () => {
    const env = await tempEnv();

    assert.deepEqual(await forgetRoom("X7KP2M", env), []);
    await assert.rejects(stat(configPath(env)));
  });
});

describe("forgetAllRooms", () => {
  it("removes the file rather than leaving an empty one behind", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "AAAAAA", key: "KEY", baseUrl: "u", savedAt: 1 }, env);
    await saveRoom({ code: "BBBBBB", key: "KEY", baseUrl: "u", savedAt: 2 }, env);

    assert.equal(await forgetAllRooms(env), 2);
    await assert.rejects(stat(configPath(env)));
  });

  it("is zero when nothing was saved", async () => {
    assert.equal(await forgetAllRooms(await tempEnv()), 0);
  });
});

describe("pruneRooms", () => {
  it("drops the expired rooms and keeps the rest", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "LIVE01", baseUrl: "u", savedAt: 0, expiresAt: 10_000 }, env);
    await saveRoom({ code: "DEAD01", baseUrl: "u", savedAt: 0, expiresAt: 5_000 }, env);

    const dropped = await pruneRooms(env, 7_000);

    assert.deepEqual(dropped.map((room) => room.code), ["DEAD01"]);
    assert.deepEqual((await readSavedRooms(env)).map((room) => room.code), ["LIVE01"]);
  });

  it("writes nothing when every room is still live", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "LIVE01", baseUrl: "u", savedAt: 0, expiresAt: 10_000 }, env);
    const before = await stat(configPath(env));

    assert.deepEqual(await pruneRooms(env, 1_000), []);
    assert.equal((await stat(configPath(env))).mtimeMs, before.mtimeMs);
  });

  it("prunes a room with no recorded expiry once it is past the longest TTL", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "OLD001", baseUrl: "u", savedAt: 0 }, env);

    assert.deepEqual(await pruneRooms(env, MAX_ROOM_TTL_SECONDS * 1000), [
      { code: "OLD001", baseUrl: "u", savedAt: 0 },
    ]);
  });
});
