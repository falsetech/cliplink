import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { ROOM_CODE_LENGTH } from "../src/protocol.ts";
import {
  buildRoomUrl,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  parseRoomKeyFromHash,
  ROOM_KEY_FRAGMENT_PARAM,
  roomKeyFragment,
} from "../src/room-code.ts";

// The generator's alphabet: A–Z without I and O, and 2–9. Spelled out as a
// pattern rather than imported, so a change to the alphabet has to be made
// here too — a code someone has already read aloud must not start meaning
// something else.
const GENERATED_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

afterEach(() => {
  mock.restoreAll();
});

describe("generateRoomCode", () => {
  it("emits ROOM_CODE_LENGTH characters, every one from the alphabet", () => {
    assert.equal(ROOM_CODE_LENGTH, 6);
    for (let index = 0; index < 500; index += 1) {
      assert.match(generateRoomCode(), GENERATED_CODE);
    }
  });

  it("never emits the characters that read as one another", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      for (const char of generateRoomCode()) {
        seen.add(char);
      }
    }
    for (const ambiguous of ["0", "O", "1", "I"]) {
      assert.equal(seen.has(ambiguous), false, ambiguous);
    }
  });

  it("emits codes the validator accepts, and that normalizing leaves alone", () => {
    for (let index = 0; index < 100; index += 1) {
      const code = generateRoomCode();
      assert.equal(isValidRoomCode(code), true);
      assert.equal(normalizeRoomCode(code), code);
    }
  });

  it("maps the low five bits of each random byte onto the alphabet", () => {
    mock.method(crypto, "getRandomValues", <T extends ArrayBufferView>(array: T): T => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set([0, 1, 2, 3, 4, 5]);
      return array;
    });
    assert.equal(generateRoomCode(), "ABCDEF");

    mock.restoreAll();
    mock.method(crypto, "getRandomValues", <T extends ArrayBufferView>(array: T): T => {
      // 31 is the last letter of the alphabet; 32 and 255 wrap onto the first and last.
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set([31, 32, 63, 64, 255, 0]);
      return array;
    });
    assert.equal(generateRoomCode(), "9A9A9A");
  });

  it("gives every character the same share of the byte range, so there is no bias", () => {
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 256; byte += 1) {
      mock.method(crypto, "getRandomValues", <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(byte);
        return array;
      });
      const char = generateRoomCode()[0];
      counts.set(char, (counts.get(char) ?? 0) + 1);
      mock.restoreAll();
    }

    assert.equal(counts.size, 32);
    for (const [char, count] of counts) {
      assert.equal(count, 8, `${char} appears ${count} times in 256 bytes`);
    }
  });

  it("draws from the CSPRNG and never from Math.random", () => {
    // A room code is the whole of the key for an open room. Math.random's
    // output is predictable from a few earlier draws; make it unusable, and
    // the generator must still work.
    mock.method(Math, "random", () => {
      throw new Error("generateRoomCode must not use Math.random");
    });
    assert.match(generateRoomCode(), GENERATED_CODE);
  });
});

describe("normalizeRoomCode", () => {
  it("uppercases and strips what a person adds when typing or pasting", () => {
    assert.equal(normalizeRoomCode("x7kp2m"), "X7KP2M");
    assert.equal(normalizeRoomCode(" x7k-p2m "), "X7KP2M");
    assert.equal(normalizeRoomCode("X7K P2M"), "X7KP2M");
    assert.equal(normalizeRoomCode("X7K\tP2M\n"), "X7KP2M");
  });

  it("stops at the code length", () => {
    assert.equal(normalizeRoomCode("x7kp2mzzz"), "X7KP2M");
    assert.equal(normalizeRoomCode("X7KP2M".repeat(4)).length, ROOM_CODE_LENGTH);
  });

  it("returns an empty string for nothing usable", () => {
    assert.equal(normalizeRoomCode(""), "");
    assert.equal(normalizeRoomCode(null), "");
    assert.equal(normalizeRoomCode(undefined), "");
    assert.equal(normalizeRoomCode("--- ---"), "");
  });

  it("is idempotent", () => {
    for (const input of ["x7k-p2m", "  abc  ", "X7KP2M", "toolongcode123"]) {
      const once = normalizeRoomCode(input);
      assert.equal(normalizeRoomCode(once), once);
    }
  });

  it("yields something isValidRoomCode accepts only when six characters survive", () => {
    assert.equal(isValidRoomCode(normalizeRoomCode("x7k-p2m")), true);
    assert.equal(isValidRoomCode(normalizeRoomCode("x7k-p2")), false);
    assert.equal(isValidRoomCode(normalizeRoomCode("")), false);
  });
});

describe("isValidRoomCode", () => {
  it("wants exactly six uppercase letters or digits", () => {
    assert.equal(isValidRoomCode("X7KP2M"), true);
    assert.equal(isValidRoomCode("x7kp2m"), false);
    assert.equal(isValidRoomCode("X7KP2"), false);
    assert.equal(isValidRoomCode("X7KP2MM"), false);
    assert.equal(isValidRoomCode("X7KP-M"), false);
    assert.equal(isValidRoomCode(""), false);
  });
});

describe("buildRoomUrl", () => {
  const ORIGIN = "https://cliplink.example";
  const KEY = "0C51260Z4RPK8ET29585EQK5DHSQN0C8HYB9V95BPAWW1HYETQE0";

  it("puts the key in the fragment, which never reaches the server", () => {
    const url = new URL(buildRoomUrl("X7KP2M", ORIGIN, KEY));
    assert.equal(url.origin, ORIGIN);
    assert.equal(url.pathname, "/room/X7KP2M");
    assert.equal(url.hash, `#${ROOM_KEY_FRAGMENT_PARAM}=${KEY}`);
  });

  it("never lets the key into the path or the query", () => {
    const url = new URL(buildRoomUrl("X7KP2M", ORIGIN, KEY));
    assert.equal(url.pathname.includes(KEY), false);
    assert.equal(url.search, "");
  });

  it("leaves the fragment off when there is no key, as for an open room", () => {
    assert.equal(buildRoomUrl("X7KP2M", ORIGIN), `${ORIGIN}/room/X7KP2M`);
    assert.equal(buildRoomUrl("X7KP2M", ORIGIN, undefined), `${ORIGIN}/room/X7KP2M`);
    assert.equal(buildRoomUrl("X7KP2M", ORIGIN, ""), `${ORIGIN}/room/X7KP2M`);
  });

  it("keeps a port, and replaces any path on the origin", () => {
    assert.equal(
      buildRoomUrl("X7KP2M", "http://localhost:3000/some/page"),
      "http://localhost:3000/room/X7KP2M",
    );
  });

  it("round-trips the key through parseRoomKeyFromHash", () => {
    const url = new URL(buildRoomUrl("X7KP2M", ORIGIN, KEY));
    assert.equal(parseRoomKeyFromHash(url.hash), KEY);
  });
});

describe("parseRoomKeyFromHash", () => {
  it("reads the key with or without the leading #", () => {
    assert.equal(parseRoomKeyFromHash("#k=ABC123"), "ABC123");
    assert.equal(parseRoomKeyFromHash("k=ABC123"), "ABC123");
  });

  it("finds it among other fragment parameters", () => {
    assert.equal(parseRoomKeyFromHash("#tab=files&k=ABC123&x=1"), "ABC123");
  });

  it("returns null when there is none", () => {
    assert.equal(parseRoomKeyFromHash(""), null);
    assert.equal(parseRoomKeyFromHash("#"), null);
    assert.equal(parseRoomKeyFromHash("#tab=files"), null);
  });

  it("keeps the dashes of a key grouped for reading aloud", () => {
    assert.equal(parseRoomKeyFromHash("#k=0C51-260Z-4RPK"), "0C51-260Z-4RPK");
  });
});

describe("roomKeyFragment", () => {
  it("builds the fragment to append when routing", () => {
    assert.equal(roomKeyFragment("ABC123"), "#k=ABC123");
  });

  it("is empty when there is no key", () => {
    assert.equal(roomKeyFragment(null), "");
    assert.equal(roomKeyFragment(""), "");
  });
});
