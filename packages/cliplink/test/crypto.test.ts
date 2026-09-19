import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptClipText,
  deriveOpenRoomKey,
  encryptClipText,
  formatRoomKey,
  generateRoomKey,
  importRoomKey,
  normalizeRoomKey,
  openSignal,
  sealSignal,
} from "../src/crypto.ts";
import { ROOM_KEY_CHARS, ROOM_KEY_CHECK_CHARS } from "../src/protocol.ts";

const ROOM = "X7KP2M";

/**
 * Produced by `lib/cliplink/crypto.ts` as it stood before this package existed,
 * with a fixed key (byte `i` = `i * 7 + 3`).
 *
 * This is the compatibility gate. Browser tabs that were loaded before a deploy
 * keep talking to ones loaded after it, so a change that cannot open these is a
 * change that breaks rooms in flight — not a test to update.
 */
const LEGACY = {
  encoded: "0C51260Z4RPK8ET29585EQK5DHSQN0C8HYB9V95BPAWW1HYETQE0",
  check: "HQTVJ4C81PPB4",
  openCheck: "1KPT9S58ARR70",
  clip: "v1.WUhReeFw7yWVvsnVTdLCSoX75CSDtfUee4TQc8vQR1cW6sH-vpY24NKuI7aJjDFrL-3rCw",
  signal: "v1.mfbMzWyNi8MWgPyLHq1Sj5vQW9xsHcKbj7BqY-eGg8mKVqFUNJx4UA1qR1dhj0Bx",
} as const;

describe("wire compatibility with the pre-package build", () => {
  it("opens a clip sealed by the old build", async () => {
    const key = await importRoomKey(LEGACY.encoded);
    assert.ok(key);
    assert.equal(
      await decryptClipText(key, ROOM, LEGACY.clip),
      "hello from the old build",
    );
  });

  it("opens a signal sealed by the old build", async () => {
    const key = await importRoomKey(LEGACY.encoded);
    assert.ok(key);
    assert.deepEqual(await openSignal(key, ROOM, LEGACY.signal), {
      type: "hello-ack",
    });
  });

  it("derives the same fingerprint, so joiners are not told the key is wrong", async () => {
    const key = await importRoomKey(LEGACY.encoded);
    assert.ok(key);
    assert.equal(key.check, LEGACY.check);
  });

  it("derives the same open-room key from the room code", async () => {
    const key = await deriveOpenRoomKey(ROOM);
    assert.equal(key.check, LEGACY.openCheck);
  });
});

describe("generateRoomKey", () => {
  it("serializes to the documented length", async () => {
    const key = await generateRoomKey();
    assert.equal(key.encoded.length, ROOM_KEY_CHARS);
    assert.equal(key.check.length, ROOM_KEY_CHECK_CHARS);
  });

  it("does not repeat", async () => {
    const [first, second] = await Promise.all([
      generateRoomKey(),
      generateRoomKey(),
    ]);
    assert.notEqual(first.encoded, second.encoded);
  });
});

describe("round trip", () => {
  it("opens what it sealed", async () => {
    const key = await generateRoomKey();
    const text = "multi\nline — with ünicode 🎉";
    const sealed = await encryptClipText(key, ROOM, text);
    assert.match(sealed, /^v1\./);
    assert.equal(await decryptClipText(key, ROOM, sealed), text);
  });

  it("round-trips a signal payload", async () => {
    const key = await generateRoomKey();
    const payload = { type: "hello-ack" };
    const sealed = await sealSignal(key, ROOM, payload);
    assert.deepEqual(await openSignal(key, ROOM, sealed), payload);
  });

  it("uses a fresh nonce, so the same text does not seal identically", async () => {
    const key = await generateRoomKey();
    const [first, second] = await Promise.all([
      encryptClipText(key, ROOM, "same"),
      encryptClipText(key, ROOM, "same"),
    ]);
    assert.notEqual(first, second);
  });
});

describe("refusing what it should refuse", () => {
  it("returns null for the wrong key rather than throwing", async () => {
    const [mine, theirs] = await Promise.all([
      generateRoomKey(),
      generateRoomKey(),
    ]);
    const sealed = await encryptClipText(mine, ROOM, "secret");
    assert.equal(await decryptClipText(theirs, ROOM, sealed), null);
  });

  it("will not open a clip replayed into another room", async () => {
    const key = await generateRoomKey();
    const sealed = await encryptClipText(key, ROOM, "secret");
    assert.equal(await decryptClipText(key, "AAAAAA", sealed), null);
  });

  it("rejects a tampered ciphertext", async () => {
    const key = await generateRoomKey();
    const sealed = await encryptClipText(key, ROOM, "secret");
    const tampered = `${sealed.slice(0, -2)}${sealed.at(-2) === "A" ? "B" : "A"}${sealed.at(-1)}`;
    assert.equal(await decryptClipText(key, ROOM, tampered), null);
  });

  it("rejects a payload without the version prefix", async () => {
    const key = await generateRoomKey();
    assert.equal(await decryptClipText(key, ROOM, "not-a-payload"), null);
  });

  it("returns null for a signal whose plaintext is not JSON", async () => {
    const key = await generateRoomKey();
    // Sealed through the clip subkey, so it opens under neither as JSON.
    const sealed = await encryptClipText(key, ROOM, "{not json");
    assert.equal(await openSignal(key, ROOM, sealed), null);
  });
});

describe("importRoomKey", () => {
  it("accepts the key it exported", async () => {
    const key = await generateRoomKey();
    const imported = await importRoomKey(key.encoded);
    assert.equal(imported?.check, key.check);
  });

  it("accepts the grouped form a user reads off a screen", async () => {
    const key = await generateRoomKey();
    const imported = await importRoomKey(formatRoomKey(key.encoded));
    assert.equal(imported?.check, key.check);
  });

  it("applies Crockford's leniencies for O, I and L", async () => {
    const key = await generateRoomKey();
    const typed = key.encoded
      .replaceAll("0", "O")
      .replaceAll("1", "I");
    assert.equal((await importRoomKey(typed))?.check, key.check);
  });

  it("is null for a key of the wrong length", async () => {
    assert.equal(await importRoomKey("ABC"), null);
  });

  it("is null for a key with characters outside the alphabet", async () => {
    assert.equal(await importRoomKey("U".repeat(ROOM_KEY_CHARS)), null);
  });

  it("is null for an empty key", async () => {
    assert.equal(await importRoomKey(""), null);
  });
});

describe("normalizeRoomKey and formatRoomKey", () => {
  it("strips grouping and case", () => {
    assert.equal(normalizeRoomKey(" abcd-ef01 "), "ABCDEF01");
  });

  it("is null-safe", () => {
    assert.equal(normalizeRoomKey(null), "");
    assert.equal(normalizeRoomKey(undefined), "");
  });

  it("groups in fours", () => {
    assert.equal(formatRoomKey("ABCDEF012"), "ABCD-EF01-2");
  });

  it("round-trips through formatting", async () => {
    const key = await generateRoomKey();
    assert.equal(normalizeRoomKey(formatRoomKey(key.encoded)), key.encoded);
  });
});

describe("deriveOpenRoomKey", () => {
  it("is deterministic, so the code alone opens the room", async () => {
    const [first, second] = await Promise.all([
      deriveOpenRoomKey(ROOM),
      deriveOpenRoomKey(ROOM),
    ]);
    assert.equal(first.encoded, second.encoded);
  });

  it("differs per room code", async () => {
    const [first, second] = await Promise.all([
      deriveOpenRoomKey(ROOM),
      deriveOpenRoomKey("AAAAAA"),
    ]);
    assert.notEqual(first.encoded, second.encoded);
  });
});
