import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArgs } from "../src/cli/args.ts";
import { link } from "../src/cli/link.ts";
import type { Reporter } from "../src/cli/output.ts";
import { generateRoomKey } from "../src/index.ts";

const CODE = "X7KP2M";
const BASE = "https://cliplink.test";

function reporter(interactive = false) {
  const data: string[] = [];
  const notes: string[] = [];
  const warns: string[] = [];
  const report: Reporter = {
    data: (text) => void data.push(text),
    note: (text = "") => void notes.push(text),
    warn: (text) => void warns.push(text),
    interactive,
  };
  return { report, data, notes, warns };
}

async function run(argv: string[], interactive = false) {
  const parsed = parseArgs(argv, {});
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  const out = reporter(interactive);
  const code = await link(parsed.args, out.report);
  return { code, ...out };
}

describe("link", () => {
  it("prints the link on stdout, with the key in the fragment", async () => {
    const key = await generateRoomKey();
    const result = await run(["link", "-r", CODE, "-k", key.encoded, "--url", BASE]);

    assert.equal(result.code, 0);
    assert.deepEqual(result.data, [`${BASE}/room/${CODE}#k=${key.encoded}`]);
  });

  it("carries no key for an --open room, which has none of its own", async () => {
    const result = await run(["link", "-r", CODE, "--open", "--url", BASE]);

    assert.deepEqual(result.data, [`${BASE}/room/${CODE}`]);
  });

  it("takes both halves out of a pasted room link", async () => {
    const key = await generateRoomKey();
    const url = `${BASE}/room/${CODE}#k=${key.encoded}`;
    const result = await run(["link", "-r", url, "--url", BASE]);

    assert.deepEqual(result.data, [url]);
  });

  it("reaches no server, so it works for a room that is gone", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("link must not make a request");
    }) as unknown as typeof globalThis.fetch;
    try {
      assert.equal((await run(["link", "-r", CODE, "--open", "--url", BASE])).code, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps the QR off stdout, so the link can be piped", async () => {
    const result = await run(["link", "-r", CODE, "--open", "--url", BASE], true);

    assert.equal(result.data.length, 1);
    assert.ok(
      result.notes.some((note) => note.includes("█")),
      "the QR is on stderr",
    );
  });

  it("draws no QR when stderr is not a terminal", async () => {
    const result = await run(["link", "-r", CODE, "--open", "--url", BASE], false);

    assert.deepEqual(result.notes, []);
  });

  it("fails on a room code that is not one", async () => {
    await assert.rejects(run(["link", "-r", "nope", "--open", "--url", BASE]), /not a room code/);
  });

  it("fails when the room needs a key and none was given", async () => {
    await assert.rejects(run(["link", "-r", CODE, "--url", BASE]), /needs its key/);
  });
});
