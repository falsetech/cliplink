import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatRoomKey, generateRoomKey } from "@thebkht/cliplink";

import { extractKey, extractRoomCode, KeyError, resolveKey } from "../src/key.ts";

const ROOM = "X7KP2M";

describe("extractKey", () => {
  it("takes a bare key as it is", () => {
    assert.equal(extractKey("ABCDEF01"), "ABCDEF01");
  });

  it("takes the key out of a room link, which is what people paste", async () => {
    const key = await generateRoomKey();
    const url = `https://cliplink.example/room/${ROOM}#k=${key.encoded}`;
    assert.equal(extractKey(url), key.encoded);
  });

  it("strips the grouping dashes printed for reading aloud", async () => {
    const key = await generateRoomKey();
    assert.equal(extractKey(formatRoomKey(key.encoded)), key.encoded);
  });

  it("is null for empty input", () => {
    assert.equal(extractKey("   "), null);
  });
});

describe("extractRoomCode", () => {
  it("reads the code out of a room link", () => {
    assert.equal(
      extractRoomCode(`https://cliplink.example/room/${ROOM}#k=AAA`),
      ROOM,
    );
  });

  it("upper-cases a code typed in lower case", () => {
    assert.equal(extractRoomCode("https://cliplink.example/room/x7kp2m"), ROOM);
  });

  it("is null when there is no room path", () => {
    assert.equal(extractRoomCode("X7KP2M"), null);
  });
});

describe("resolveKey", () => {
  it("derives an open room's key from its code, with nothing supplied", async () => {
    const resolved = await resolveKey(ROOM, { key: null, open: true, source: "flag" });
    assert.equal(resolved.source, "open");
  });

  it("imports a supplied key and keeps the source it came from", async () => {
    const key = await generateRoomKey();
    const resolved = await resolveKey(ROOM, {
      key: key.encoded,
      open: false,
      source: "saved",
    });
    assert.equal(resolved.key.check, key.check);
    assert.equal(resolved.source, "saved");
  });

  it("accepts a whole room link as the key", async () => {
    const key = await generateRoomKey();
    const resolved = await resolveKey(ROOM, {
      key: `https://cliplink.example/room/${ROOM}#k=${key.encoded}`,
      open: false,
      source: "flag",
    });
    assert.equal(resolved.key.check, key.check);
  });

  it("explains that an encrypted room needs its key", async () => {
    await assert.rejects(
      resolveKey(ROOM, { key: null, open: false, source: "flag" }),
      (error: Error) => {
        assert.ok(error instanceof KeyError);
        assert.match(error.message, /end-to-end encrypted/);
        assert.match(error.message, /--open/);
        return true;
      },
    );
  });

  it("says a malformed key is malformed rather than failing to decrypt later", async () => {
    await assert.rejects(
      resolveKey(ROOM, { key: "TOO-SHORT", open: false, source: "flag" }),
      /not a valid room key/,
    );
  });
});
