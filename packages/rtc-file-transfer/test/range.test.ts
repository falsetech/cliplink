import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prefixRange } from "../src/sinks.ts";

describe("prefixRange", () => {
  const size = 1000;

  it("serves what is there, and says where it stops", () => {
    assert.deepEqual(prefixRange(size, 400, "bytes=0-"), {
      status: 206,
      start: 0,
      end: 399,
      contentRange: "bytes 0-399/1000",
    });
    assert.deepEqual(prefixRange(size, 400, "bytes=100-199"), {
      status: 206,
      start: 100,
      end: 199,
      contentRange: "bytes 100-199/1000",
    });
    // Asked for more than has arrived: a short answer, which is legal.
    assert.deepEqual(prefixRange(size, 400, "bytes=300-799"), {
      status: 206,
      start: 300,
      end: 399,
      contentRange: "bytes 300-399/1000",
    });
  });

  it("serves a complete file like any other", () => {
    assert.deepEqual(prefixRange(size, size, "bytes=900-"), {
      status: 206,
      start: 900,
      end: 999,
      contentRange: "bytes 900-999/1000",
    });
    assert.deepEqual(prefixRange(size, size, "bytes=-100"), {
      status: 206,
      start: 900,
      end: 999,
      contentRange: "bytes 900-999/1000",
    });
  });

  it("treats a missing or malformed header as the start of the file", () => {
    for (const header of [null, "", "items=0-10", "bytes=abc", "bytes=-"]) {
      assert.deepEqual(prefixRange(size, 400, header), {
        status: 206,
        start: 0,
        end: 399,
        contentRange: "bytes 0-399/1000",
      }, String(header));
    }
  });

  it("uses the first of several ranges", () => {
    assert.deepEqual(prefixRange(size, size, "bytes=10-19, 30-39"), {
      status: 206,
      start: 10,
      end: 19,
      contentRange: "bytes 10-19/1000",
    });
  });

  it("says not yet for bytes still to arrive, and never for bytes past the end", () => {
    assert.deepEqual(prefixRange(size, 400, "bytes=400-"), {
      status: 416,
      contentRange: "bytes */1000",
      pending: true,
    });
    // A suffix of the file is at its end, which hasn't arrived.
    assert.deepEqual(prefixRange(size, 400, "bytes=-100"), {
      status: 416,
      contentRange: "bytes */1000",
      pending: true,
    });
    assert.deepEqual(prefixRange(size, 400, "bytes=1000-"), {
      status: 416,
      contentRange: "bytes */1000",
      pending: false,
    });
    assert.deepEqual(prefixRange(size, 400, "bytes=50-10"), {
      status: 416,
      contentRange: "bytes */1000",
      pending: false,
    });
  });

  it("never serves past what it was told is there, whatever that claims", () => {
    assert.deepEqual(prefixRange(size, 5000, "bytes=0-"), {
      status: 206,
      start: 0,
      end: 999,
      contentRange: "bytes 0-999/1000",
    });
    assert.deepEqual(prefixRange(size, -3, "bytes=0-"), {
      status: 416,
      contentRange: "bytes */1000",
      pending: true,
    });
  });
});
