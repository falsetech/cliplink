import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeError } from "../src/cli/errors.ts";
import { KeyError } from "../src/cli/key.ts";
import { RoomKeyMismatchError } from "../src/index.ts";

/**
 * What the CLI prints when something reaches the top of a command. The
 * mapping's whole job is to replace the messages that explain nothing, and to
 * leave alone the ones that do — so both halves are pinned, including the near
 * misses that must *not* be rewritten.
 */
describe("describeError", () => {
  it("says a wrong key is a wrong key, in terms of what to go and check", () => {
    const message = describeError(new RoomKeyMismatchError());

    assert.equal(
      message,
      "That key does not open this room. Check the link or key you were given.",
    );
    // The error's own wording names the room; the CLI's names the link or key
    // the person was handed, which is the thing they can act on.
    assert.notEqual(message, new RoomKeyMismatchError().message);
  });

  it("keeps a KeyError's own message, which was written for this CLI", () => {
    const message = "Room X7KP2M is end-to-end encrypted, so it needs its key.";

    assert.equal(describeError(new KeyError(message)), message);
  });

  it("turns a failed fetch into something that names the cause", () => {
    assert.equal(
      describeError(new TypeError("fetch failed")),
      "Could not reach the server. Check your connection, or --url.",
    );
  });

  it("recognises a failed fetch whatever case it is reported in", () => {
    for (const message of ["Fetch failed", "Failed to FETCH", "terminated during fetch"]) {
      assert.match(describeError(new TypeError(message)), /Could not reach the server/);
    }
  });

  it("leaves a TypeError that is not about fetching alone", () => {
    // Otherwise a programming mistake would be reported as a network problem
    // and chased in the wrong place.
    assert.equal(
      describeError(new TypeError("x is not a function")),
      "x is not a function",
    );
  });

  it("does not rewrite a non-TypeError that happens to mention fetch", () => {
    assert.equal(
      describeError(new Error("could not fetch the room")),
      "could not fetch the room",
    );
  });

  it("keeps the message of any other Error", () => {
    assert.equal(describeError(new Error("Room not found")), "Room not found");
  });

  it("keeps the message of an Error subclass it does not know", () => {
    class OddError extends Error {}

    assert.equal(describeError(new OddError("something odd")), "something odd");
  });

  it("describes what was thrown when it was not an Error at all", () => {
    assert.equal(describeError("just a string"), "just a string");
    assert.equal(describeError(404), "404");
    assert.equal(describeError(null), "null");
    assert.equal(describeError(undefined), "undefined");
  });

  it("returns a string for anything thrown, including what has no message", () => {
    for (const thrown of [new Error(""), "", null, undefined, {}, []]) {
      assert.equal(typeof describeError(thrown), "string");
    }
  });

  it("passes an empty message through as empty, printing a blank line", () => {
    // Not an endorsement: an Error thrown with no message reaches stderr as
    // nothing at all, which says less than the stack it replaced. Pinned so a
    // fix is a deliberate change rather than an accident.
    assert.equal(describeError(new Error("")), "");
    assert.equal(describeError(""), "");
  });
});
