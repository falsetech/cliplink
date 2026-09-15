import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidId, parseFileSignal } from "../src/index.ts";

const ID = "0123456789abcdef";

describe("parseFileSignal", () => {
  it("rebuilds valid signals from known fields only", () => {
    assert.deepEqual(parseFileSignal({ type: "hello", extra: 1 }), { type: "hello" });
    assert.deepEqual(
      parseFileSignal({ type: "file-offer", offerId: ID, name: "a.txt", size: 3, mime: "", x: 1 }),
      { type: "file-offer", offerId: ID, name: "a.txt", size: 3, mime: "" },
    );
    assert.deepEqual(
      parseFileSignal({
        type: "rtc-candidate",
        transferId: ID,
        candidate: { candidate: "c", sdpMid: null, sdpMLineIndex: 0 },
      }),
      {
        type: "rtc-candidate",
        transferId: ID,
        candidate: { candidate: "c", sdpMid: null, sdpMLineIndex: 0, usernameFragment: undefined },
      },
    );
  });

  it("rejects bad offers", () => {
    const offer = { type: "file-offer", offerId: ID, name: "a", size: 10, mime: "" };
    assert.equal(parseFileSignal({ ...offer, size: 0 }), null);
    assert.equal(parseFileSignal({ ...offer, size: -1 }), null);
    assert.equal(parseFileSignal({ ...offer, size: 1.5 }), null);
    assert.equal(parseFileSignal({ ...offer, size: "10" }), null);
    assert.equal(parseFileSignal({ ...offer, name: "" }), null);
    assert.equal(parseFileSignal({ ...offer, offerId: "short" }), null);
    assert.equal(parseFileSignal({ ...offer, offerId: "has spaces in it" }), null);
    assert.equal(parseFileSignal(offer, { maxFileBytes: 9 }), null);
  });

  it("bounds SDP and cancel reasons", () => {
    const sdp = "x".repeat(101);
    const description = { type: "rtc-description", transferId: ID, description: { type: "offer", sdp } };
    assert.notEqual(parseFileSignal(description), null);
    assert.equal(parseFileSignal(description, { maxSdpChars: 100 }), null);
    assert.equal(
      parseFileSignal({ ...description, description: { type: "pranswer", sdp } }),
      null,
    );
    assert.equal(
      parseFileSignal({ type: "transfer-cancel", transferId: ID, reason: "r".repeat(201) }),
      null,
    );
  });

  it("rejects peer-left, unknown types, and non-objects", () => {
    assert.equal(parseFileSignal({ type: "peer-left" }), null);
    assert.equal(parseFileSignal({ type: "nope" }), null);
    assert.equal(parseFileSignal(null), null);
    assert.equal(parseFileSignal([]), null);
    assert.equal(parseFileSignal("hello"), null);
  });
});

describe("capabilities", () => {
  it("keeps known caps, drops unknown ones, and never rejects the signal over them", () => {
    const offer = { type: "file-offer", offerId: ID, name: "a", size: 10, mime: "" };
    assert.deepEqual(parseFileSignal({ ...offer, caps: ["resume", "future", "blocks"] }), {
      ...offer,
      caps: ["blocks", "resume"],
    });
    assert.deepEqual(parseFileSignal({ ...offer, caps: ["future"] }), offer);
    assert.deepEqual(parseFileSignal({ ...offer, caps: "blocks" }), offer);
    assert.deepEqual(parseFileSignal({ ...offer, caps: Array(9).fill("blocks") }), offer);
  });

  it("accepts a positive integer resume offset only", () => {
    const request = { type: "file-request", offerId: ID, transferId: ID };
    assert.deepEqual(parseFileSignal({ ...request, offset: 1048576 }), {
      ...request,
      offset: 1048576,
    });
    for (const offset of [0, -1, 1.5, "8", 2 ** 60]) {
      assert.deepEqual(parseFileSignal({ ...request, offset }), request);
    }
  });
});

describe("folders", () => {
  const offer = { type: "file-offer", offerId: ID, name: "a", size: 10, mime: "" };

  it("keeps a sanitized path and a valid batch id", () => {
    assert.deepEqual(parseFileSignal({ ...offer, path: "/photos//2024", batchId: ID }), {
      ...offer,
      path: "photos/2024",
      batchId: ID,
    });
  });

  it("drops bad paths and batch ids without rejecting the offer", () => {
    for (const path of ["../up", "", 7, "p".repeat(1025)]) {
      assert.deepEqual(parseFileSignal({ ...offer, path }), offer);
    }
    assert.deepEqual(parseFileSignal({ ...offer, batchId: "not an id" }), offer);
  });
});

describe("isValidId", () => {
  it("accepts generated ids and rejects free text", () => {
    assert.equal(isValidId(crypto.randomUUID()), true);
    assert.equal(isValidId("abc"), false);
    assert.equal(isValidId("x".repeat(65)), false);
    assert.equal(isValidId("../../etc/passwd"), false);
  });
});
