import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { parseArgs } from "../src/cli/args.ts";
import { configPath, saveRoom } from "../src/cli/config.ts";
import type { Env } from "../src/cli/env.ts";
import { createReporter } from "../src/cli/output.ts";
import { rooms } from "../src/cli/rooms.ts";

const dirs: string[] = [];

async function tempEnv() {
  const dir = await mkdtemp(join(tmpdir(), "cliplink-rooms-"));
  dirs.push(dir);
  return { CLIPLINK_CONFIG_DIR: dir } as Env;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Collects the two streams apart, since which one a line lands on is the contract. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const sink = (lines: string[]) =>
    ({ write: (text: string) => lines.push(text) }) as unknown as NodeJS.WritableStream;
  return {
    out,
    err,
    report: createReporter({ stdout: sink(out), stderr: sink(err) }),
    get stdout() {
      return out.join("");
    },
    get stderr() {
      return err.join("");
    },
  };
}

async function run(argv: string[], env: Env, now?: number) {
  const parsed = parseArgs(argv, {});
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  const sinks = capture();
  const code = await rooms(parsed.args, sinks.report, env, now);
  return { code, ...sinks };
}

const NOW = 1_700_000_000_000;

describe("rooms listing", () => {
  it("says so when nothing is saved, on stderr", async () => {
    const result = await run(["rooms"], await tempEnv(), NOW);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /No rooms saved/);
  });

  it("puts the listing on stdout so it can be grepped", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", key: "SECRET", baseUrl: "https://example", savedAt: NOW },
      env,
    );

    const result = await run(["rooms"], env, NOW);

    assert.match(result.stdout, /^X7KP2M {2}https:\/\/example/m);
  });

  it("withholds the key until it is asked for", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", key: "SECRET", baseUrl: "u", savedAt: NOW }, env);

    const withheld = await run(["rooms"], env, NOW);
    assert.doesNotMatch(withheld.stdout, /SECRET/);
    assert.match(withheld.stdout, /key saved/);
    assert.match(withheld.stderr, /--show-keys/);

    const shown = await run(["rooms", "--show-keys"], env, NOW);
    assert.match(shown.stdout, /SECRET/);
    assert.doesNotMatch(shown.stderr, /--show-keys/);
  });

  it("says nothing about keys when no saved room has one", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", baseUrl: "u", savedAt: NOW }, env);

    const result = await run(["rooms"], env, NOW);
    assert.match(result.stdout, /open room/);
    assert.doesNotMatch(result.stderr, /--show-keys/);
  });

  it("reports age, and an expiry only for a room that recorded one", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "JOINED", baseUrl: "u", savedAt: NOW - 3_600_000 }, env);
    await saveRoom(
      {
        code: "MADEUP",
        baseUrl: "u",
        savedAt: NOW - 60_000,
        expiresAt: NOW + 1_800_000,
      },
      env,
    );

    const result = await run(["rooms"], env, NOW);

    assert.match(result.stdout, /MADEUP.*saved 1 minute ago, expires in 30 minutes/);
    assert.match(result.stdout, /JOINED {2}u {2}saved 1 hour ago +open room/);
  });

  it("marks an expired room rather than hiding it", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "X7KP2M", baseUrl: "u", savedAt: NOW - 10_000, expiresAt: NOW - 1 },
      env,
    );

    assert.match((await run(["rooms"], env, NOW)).stdout, /expired/);
  });
});

describe("rooms --forget", () => {
  it("forgets the named room", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", key: "K", baseUrl: "u", savedAt: NOW }, env);

    const result = await run(["rooms", "--forget", "X7KP2M"], env, NOW);

    assert.equal(result.code, 0);
    assert.match(result.stderr, /Forgot X7KP2M/);
    assert.match((await run(["rooms"], env, NOW)).stderr, /No rooms saved/);
  });

  it("accepts a lowercase code and a whole room link", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "X7KP2M", baseUrl: "u", savedAt: NOW }, env);
    assert.equal((await run(["rooms", "--forget", "x7kp2m"], env, NOW)).code, 0);

    await saveRoom({ code: "X7KP2M", baseUrl: "u", savedAt: NOW }, env);
    assert.equal(
      (await run(["rooms", "--forget", "https://example/room/X7KP2M#k=AAA"], env, NOW))
        .code,
      0,
    );
  });

  it("fails rather than reporting success for a room that was never saved", async () => {
    const result = await run(["rooms", "--forget", "X7KP2M"], await tempEnv(), NOW);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /No room saved as X7KP2M/);
  });
});

describe("rooms --forget-all", () => {
  it("removes the file, so nothing that held a key is left behind", async () => {
    const env = await tempEnv();
    await saveRoom({ code: "AAAAAA", key: "K", baseUrl: "u", savedAt: NOW }, env);
    await saveRoom({ code: "BBBBBB", key: "K", baseUrl: "u", savedAt: NOW }, env);

    const result = await run(["rooms", "--forget-all"], env, NOW);

    assert.match(result.stderr, /Forgot 2 rooms/);
    await assert.rejects(stat(configPath(env)));
  });

  it("says so when there was nothing to forget", async () => {
    const result = await run(["rooms", "--forget-all"], await tempEnv(), NOW);
    assert.match(result.stderr, /No rooms were saved/);
  });
});

describe("rooms --prune", () => {
  it("drops the expired rooms and then lists what is left", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "LIVE01", baseUrl: "u", savedAt: NOW, expiresAt: NOW + 60_000 },
      env,
    );
    await saveRoom(
      { code: "DEAD01", baseUrl: "u", savedAt: NOW - 10_000, expiresAt: NOW - 1 },
      env,
    );

    const result = await run(["rooms", "--prune"], env, NOW);

    assert.match(result.stderr, /Pruned 1 expired room: DEAD01/);
    assert.match(result.stdout, /LIVE01/);
    assert.doesNotMatch(result.stdout, /DEAD01/);
  });

  it("says so when nothing had expired", async () => {
    const env = await tempEnv();
    await saveRoom(
      { code: "LIVE01", baseUrl: "u", savedAt: NOW, expiresAt: NOW + 60_000 },
      env,
    );

    assert.match((await run(["rooms", "--prune"], env, NOW)).stderr, /Nothing to prune/);
  });
});
