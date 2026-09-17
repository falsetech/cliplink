import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { Env } from "../src/env.ts";
import { configPath, findSavedRoom, readSavedRooms, saveRoom } from "../src/config.ts";

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

    assert.equal((await findSavedRoom("X7KP2M", env))?.key, "KEY");
  });

  it("finds a room whatever case it is asked for in", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "KEY", baseUrl: "https://example", savedAt: 1 },
      env,
    );

    assert.ok(await findSavedRoom("x7kp2m", env));
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

    assert.equal((await findSavedRoom("X7KP2M", env))?.key, undefined);
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
    assert.equal(await findSavedRoom("X7KP2M", await tempEnv()), null);
  });
});
