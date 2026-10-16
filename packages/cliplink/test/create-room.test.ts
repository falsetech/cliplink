import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createKeyedRoom,
  createOpenRoom,
  RoomCreateError,
} from "../src/create-room.ts";
import {
  deriveOpenRoomKey,
  deriveRoomKeyFromPassphrase,
  generateRoomKey,
} from "../src/crypto.ts";
import { ApiRequestError } from "../src/http.ts";
import type { CreateRoomRequest } from "../src/types.ts";

const PASSPHRASE = "correct horse battery staple";

/**
 * A server that hands out what it is asked for, unless the code is in
 * `taken` — or, as one from before chosen codes did, ignores the ask.
 */
function fakeServer({
  taken = new Set<string>(),
  ignoresCode = false,
}: { taken?: Set<string>; ignoresCode?: boolean } = {}) {
  const requests: CreateRoomRequest[] = [];
  const http = {
    async createRoomRequest(request: CreateRoomRequest = {}) {
      requests.push(request);
      if (request.code && taken.has(request.code) && !ignoresCode) {
        throw new ApiRequestError(
          "That room code is already in use.",
          409,
          "room_code_taken",
        );
      }
      return {
        code: !ignoresCode && request.code ? request.code : "SRVR42",
        ttlSeconds: request.ttlSeconds ?? 21_600,
      };
    },
  };
  return { http, requests };
}

function failsWith(reason: RoomCreateError["reason"]) {
  return (error: unknown) =>
    error instanceof RoomCreateError && error.reason === reason;
}

describe("createKeyedRoom", () => {
  it("leaves the code to the server when nothing is chosen", async () => {
    const { http, requests } = fakeServer();

    const room = await createKeyedRoom({ http, ttlSeconds: 3600 });

    assert.equal(room.code, "SRVR42");
    assert.equal(room.ttlSeconds, 3600);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].code, undefined);
    assert.equal(requests[0].keyCheck, room.key.check);
    assert.equal(requests[0].eraseCheck, room.key.eraseCheck);
  });

  it("claims a chosen code, normalized, with a generated key", async () => {
    const { http, requests } = fakeServer();

    const room = await createKeyedRoom({ http, code: "my-desk" });

    assert.equal(room.code, "MYDESK");
    assert.equal(requests[0].code, "MYDESK");
    assert.equal(requests[0].keyCheck, room.key.check);
  });

  it("salts a passphrase with the chosen code", async () => {
    const { http } = fakeServer();

    const room = await createKeyedRoom({ http, code: "mydesk", passphrase: PASSPHRASE });

    const expected = await deriveRoomKeyFromPassphrase(PASSPHRASE, "MYDESK");
    assert.equal(room.key.encoded, expected.encoded);
  });

  it("picks the code itself for a passphrase, and picks again when it is taken", async () => {
    const taken = new Set<string>();
    const { http, requests } = fakeServer({ taken });
    const realHttp = http.createRoomRequest;
    // Take whatever is asked for first, so the retry is forced.
    http.createRoomRequest = async (request = {}) => {
      if (requests.length === 0 && request.code) {
        taken.add(request.code);
      }
      return realHttp(request);
    };

    const room = await createKeyedRoom({ http, passphrase: PASSPHRASE });

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].code, requests[1].code);
    assert.equal(room.code, requests[1].code);
    // The key that comes back is the one salted with the code that won.
    const expected = await deriveRoomKeyFromPassphrase(PASSPHRASE, room.code);
    assert.equal(room.key.encoded, expected.encoded);
  });

  it("does not retry a chosen code that is taken", async () => {
    const { http, requests } = fakeServer({ taken: new Set(["MYDESK"]) });

    await assert.rejects(createKeyedRoom({ http, code: "MYDESK" }), failsWith("code_taken"));
    assert.equal(requests.length, 1);
  });

  it("gives up after a few generated codes", async () => {
    const { http, requests } = fakeServer();
    http.createRoomRequest = async (request = {}) => {
      requests.push(request);
      throw new ApiRequestError("That room code is already in use.", 409, "room_code_taken");
    };

    await assert.rejects(createKeyedRoom({ http, passphrase: PASSPHRASE }), failsWith("code_taken"));
    assert.equal(requests.length, 5);
  });

  it("notices a server that ignored the chosen code", async () => {
    const { http } = fakeServer({ ignoresCode: true });

    await assert.rejects(createKeyedRoom({ http, code: "MYDESK" }), failsWith("code_ignored"));
  });

  it("refuses a server answer that is not a room code", async () => {
    const http = {
      createRoomRequest: async () => ({ code: "../etc", ttlSeconds: 60 }),
    };

    await assert.rejects(createKeyedRoom({ http }), failsWith("bad_response"));
  });

  it("checks the code and passphrase before anything is sent", async () => {
    const { http, requests } = fakeServer();
    const key = await generateRoomKey();

    await assert.rejects(createKeyedRoom({ http, code: "ABC" }), failsWith("invalid_code"));
    await assert.rejects(
      createKeyedRoom({ http, passphrase: "too short" }),
      failsWith("invalid_passphrase"),
    );
    // Joining would read this as a key and never try it as a passphrase.
    await assert.rejects(
      createKeyedRoom({ http, passphrase: key.encoded }),
      failsWith("invalid_passphrase"),
    );
    assert.equal(requests.length, 0);
  });

  it("passes other failures through untouched", async () => {
    const http = {
      createRoomRequest: async () => {
        throw new ApiRequestError("Too many rooms created.", 429, "rate_limited");
      },
    };

    await assert.rejects(createKeyedRoom({ http, code: "MYDESK" }), /Too many rooms/);
  });
});

describe("createOpenRoom", () => {
  it("lets the server pick the code, and derives the key from it", async () => {
    const { http, requests } = fakeServer();

    const room = await createOpenRoom({ http });

    assert.equal(room.code, "SRVR42");
    assert.deepEqual(requests[0], { code: undefined, ttlSeconds: undefined });
    assert.equal(room.key.encoded, (await deriveOpenRoomKey("SRVR42")).encoded);
  });

  it("claims a chosen code, normalized, and sends no key fingerprint", async () => {
    const { http, requests } = fakeServer();

    const room = await createOpenRoom({ http, code: "my-notes" });

    assert.equal(room.code, "MYNOTES");
    assert.equal(requests[0].code, "MYNOTES");
    assert.equal(requests[0].keyCheck, undefined);
    assert.equal(room.key.encoded, (await deriveOpenRoomKey("MYNOTES")).encoded);
  });

  it("says a taken code is taken, and does not retry", async () => {
    const { http, requests } = fakeServer({ taken: new Set(["MYNOTES"]) });

    await assert.rejects(createOpenRoom({ http, code: "MYNOTES" }), failsWith("code_taken"));
    assert.equal(requests.length, 1);
  });

  it("notices a server that ignored the chosen code", async () => {
    const { http } = fakeServer({ ignoresCode: true });

    await assert.rejects(createOpenRoom({ http, code: "MYNOTES" }), failsWith("code_ignored"));
  });

  it("checks the code before anything is sent", async () => {
    const { http, requests } = fakeServer();

    await assert.rejects(createOpenRoom({ http, code: "ABC" }), failsWith("invalid_code"));
    assert.equal(requests.length, 0);
  });
});
