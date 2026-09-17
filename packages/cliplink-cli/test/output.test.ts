import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createReporter } from "../src/output.ts";
import { renderQr } from "../src/qr.ts";
import { readStdin } from "../src/send.ts";

function streams({ isTTY = false } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (text: string) => out.push(text) } as unknown as NodeJS.WritableStream,
    stderr: Object.assign(
      { write: (text: string) => err.push(text) } as unknown as NodeJS.WritableStream,
      { isTTY },
    ),
  };
}

/** An async iterable is all `readStdin` consumes; the rest of the stream is not. */
function asStream(chunks: AsyncIterable<Buffer>) {
  return chunks as unknown as NodeJS.ReadableStream;
}

describe("the stdout/stderr split", () => {
  it("puts clip text on stdout and nothing else", () => {
    const { out, err, stdout, stderr } = streams();
    const report = createReporter({ stdout, stderr });

    report.data("the clip");
    report.note("room X7KP2M");
    report.warn("something went wrong");

    assert.deepEqual(out, ["the clip\n"]);
    assert.deepEqual(err, ["room X7KP2M\n", "something went wrong\n"]);
  });

  it("silences notes under --quiet but never warnings", () => {
    const { out, err, stdout, stderr } = streams();
    const report = createReporter({ quiet: true, stdout, stderr });

    report.data("the clip");
    report.note("room X7KP2M");
    report.warn("something went wrong");

    assert.deepEqual(out, ["the clip\n"]);
    assert.deepEqual(err, ["something went wrong\n"]);
  });

  it("reports whether stderr is a terminal, so decoration is optional", () => {
    assert.equal(createReporter(streams({ isTTY: true })).interactive, true);
    assert.equal(createReporter(streams({ isTTY: false })).interactive, false);
  });
});

describe("readStdin", () => {
  it("joins every chunk", async () => {
    async function* chunks() {
      yield Buffer.from("hello ");
      yield Buffer.from("world");
    }
    assert.equal(await readStdin(asStream(chunks())), "hello world");
  });

  it("preserves multi-byte characters split across chunks", async () => {
    const bytes = Buffer.from("🎉");
    async function* chunks() {
      yield bytes.subarray(0, 2);
      yield bytes.subarray(2);
    }
    assert.equal(await readStdin(asStream(chunks())), "🎉");
  });

  it("is empty for an empty stream", async () => {
    async function* chunks(): AsyncGenerator<Buffer> {}
    assert.equal(await readStdin(asStream(chunks())), "");
  });
});

describe("renderQr", () => {
  it("is square once the half-block rows are counted as two", () => {
    const lines = renderQr("https://cliplink.example/room/X7KP2M", {
      color: false,
    }).split("\n");
    const width = lines[0].length;
    // Two module rows per text row, so height*2 is the module count, give or
    // take the odd row the quiet zone absorbs.
    assert.ok(Math.abs(lines.length * 2 - width) <= 1, `${width} wide, ${lines.length} tall`);
  });

  it("surrounds the code with a light quiet zone", () => {
    const lines = renderQr("https://cliplink.example/room/X7KP2M", {
      color: false,
    }).split("\n");
    assert.match(lines[0], /^ +$/);
    assert.match(lines.at(-1)!, /^ +$/);
    assert.ok(lines.every((line) => line.startsWith("  ") && line.endsWith("  ")));
  });

  it("pins dark-on-light, so a dark terminal does not invert it", () => {
    const lines = renderQr("https://cliplink.example", { color: true }).split("\n");
    assert.ok(lines.every((line) => line.startsWith("[30;47m")));
    assert.ok(lines.every((line) => line.endsWith("[0m")));
  });

  it("grows with the length of the link", () => {
    const short = renderQr("https://cliplink.example/room/X7KP2M", { color: false });
    const withKey = renderQr(
      `https://cliplink.example/room/X7KP2M#k=${"A".repeat(52)}`,
      { color: false },
    );
    assert.ok(withKey.split("\n")[0].length > short.split("\n")[0].length);
  });
});
