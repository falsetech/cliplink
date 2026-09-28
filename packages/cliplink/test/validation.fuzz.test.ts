import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fc from "fast-check";

import {
  CIPHERTEXT_PATTERN,
  MAX_ROOM_TTL_SECONDS,
  MAX_SIGNAL_BYTES,
  MIN_ROOM_TTL_SECONDS,
  ROOM_KEY_CHECK_CHARS,
} from "../src/protocol.ts";
import {
  parseClientMessage,
  parseSignalPayload,
  validateKeyCheck,
  validatePeerId,
  validateRoomTtl,
} from "../src/validation.ts";

/**
 * Property tests over the server's trust boundary.
 *
 * `validation.test.ts` pins what these functions do for inputs someone thought
 * of. This file asserts what must hold for inputs nobody thought of, which is
 * the half that matters here: `parseClientMessage` reads a string straight off
 * a client socket, the validators are hand-written rather than a schema
 * library, and the server relays what they pass without being able to read it.
 *
 * The properties are about the boundary rather than the answer. "Rejects this
 * particular string" is an example; "never returns a field it was not given,
 * whatever it is handed" is what stops a field being smuggled past the parser
 * into a message relayed to every peer in the room.
 *
 * Arbitrary JSON alone never builds a message these parsers accept — measured
 * at zero in twenty thousand runs, since `sealed` must match a pattern and
 * `type` must be an exact string. A property that only ever sees a rejection
 * proves nothing about what is let through, so the generators below mix that
 * junk with messages built valid and then perturbed, and `acceptsSomething`
 * fails the test if a run stops reaching the accept path at all.
 */

/** Guards a property whose point is what it permits, not what it refuses. */
function acceptsSomething(accepted: number, what: string) {
  assert.ok(
    accepted > 0,
    `nothing reached the accept path, so this proved nothing about ${what}`,
  );
}

/** Arbitrary JSON, including the shapes a hand-written guard tends to miss. */
const json: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noDefaultInfinity: true, noNaN: false }),
    fc.string(),
    fc.array(tie("value")),
    fc.dictionary(
      // Keys that mean something to the JavaScript object model, alongside
      // ordinary ones: a guard written with `in`, or a bare property read, can
      // be answered by the prototype rather than by the payload.
      fc.oneof(
        fc.string(),
        fc.constantFrom("__proto__", "constructor", "prototype", "toString"),
      ),
      tie("value"),
    ),
  ),
})).value;

const PEER_ID = fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/);
/** Tied to the constant rather than spelling the length out, so a change here is felt. */
const KEY_CHECK = fc
  .array(fc.constantFrom(..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"), {
    minLength: ROOM_KEY_CHECK_CHARS,
    maxLength: ROOM_KEY_CHECK_CHARS,
  })
  .map((chars) => chars.join(""));
const SEALED = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,64}$/)
  .map((body) => `v1.${body}`);

/** A well-formed signal, then perturbed: wrong types, missing fields, near misses. */
const clientMessage: fc.Arbitrary<unknown> = fc.oneof(
  fc.record(
    {
      type: fc.oneof(fc.constant("signal"), fc.string()),
      to: fc.oneof(PEER_ID, fc.string(), json),
      sealed: fc.oneof(SEALED, fc.string(), json),
    },
    { requiredKeys: ["type"] },
  ),
  // The same message carrying fields nobody asked for, which is what a parser
  // that spread its input rather than rebuilding it would pass through.
  fc
    .tuple(
      fc.record({ type: fc.constant("signal"), to: PEER_ID, sealed: SEALED }),
      fc.dictionary(fc.string(), json, { maxKeys: 4 }),
    )
    .map(([valid, extra]) => ({ ...extra, ...valid })),
  json,
);

const raw = clientMessage.map((value) => JSON.stringify(value) ?? "");

describe("parseClientMessage, against arbitrary input", () => {
  it("never throws, whatever string arrives on the socket", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 4096 }), raw), (text) => {
        parseClientMessage(text);
      }),
    );
  });

  it("returns only the three fields of the message it accepts", () => {
    let accepted = 0;
    fc.assert(
      fc.property(raw, (text) => {
        const message = parseClientMessage(text);
        if (message === null) {
          return;
        }
        accepted += 1;
        // A field carried through from the input would be relayed to every
        // other peer in the room, alongside a payload the server cannot read.
        // The set of keys is the whole guarantee.
        assert.deepEqual(Object.keys(message).sort(), ["sealed", "to", "type"]);
        assert.equal(message.type, "signal");
        assert.ok(CIPHERTEXT_PATTERN.test(message.sealed));
        assert.ok(message.sealed.length > 0);
        assert.ok(message.sealed.length <= MAX_SIGNAL_BYTES);
        assert.ok(message.to === undefined || validatePeerId(message.to));
      }),
    );
    acceptsSomething(accepted, "the messages it accepts");
  });

  it("caps the raw message, so the envelope cannot be used to exceed it", () => {
    // A random oversized string is rejected by JSON.parse whatever the cap
    // does, so it proves nothing. The case the cap is for is a message whose
    // `sealed` is itself within bounds while the envelope around it pushes the
    // whole message past them.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }).map((under) => ({
          type: "signal",
          sealed: `v1.${"A".repeat(MAX_SIGNAL_BYTES - 3 - under)}`,
        })),
        (message) => {
          const text = JSON.stringify(message);
          // `sealed` is always within its own bound, so the raw cap is the
          // only thing that can tell these two apart.
          assert.ok(message.sealed.length <= MAX_SIGNAL_BYTES);
          if (text.length > MAX_SIGNAL_BYTES) {
            assert.equal(parseClientMessage(text), null);
          } else {
            assert.notEqual(parseClientMessage(text), null);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("leaves Object.prototype alone", () => {
    fc.assert(
      fc.property(raw, (text) => {
        parseClientMessage(text);
      }),
    );
    // Read after the run rather than inside it, so a key set by any one input
    // is caught even though nothing in the loop looked for it.
    assert.deepEqual(Object.getOwnPropertyNames({}), []);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe("parseSignalPayload, against arbitrary input", () => {
  it("never throws, and returns null or a payload with a type", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.oneof(json, fc.record({ type: fc.constant("hello-ack") })),
        (value) => {
          const payload = parseSignalPayload(value);
          if (payload === null) {
            return;
          }
          accepted += 1;
          assert.equal(typeof payload.type, "string");
        },
      ),
    );
    acceptsSomething(accepted, "the payloads it accepts");
  });

  it("keeps nothing but the type from a payload it recognises", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), json, { maxKeys: 4 }), (extra) => {
        const payload = parseSignalPayload({ ...extra, type: "hello-ack" });
        assert.deepEqual(payload, { type: "hello-ack" });
      }),
    );
  });
});

describe("the scalar validators, against arbitrary input", () => {
  it("validateRoomTtl accepts only whole seconds inside the advertised range", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.oneof(json, fc.integer({ min: 0, max: MAX_ROOM_TTL_SECONDS * 2 })),
        (value) => {
          const result = validateRoomTtl(value);
          if (!result.ok) {
            return;
          }
          accepted += 1;
          assert.ok(Number.isInteger(result.ttlSeconds));
          assert.ok(result.ttlSeconds >= MIN_ROOM_TTL_SECONDS);
          assert.ok(result.ttlSeconds <= MAX_ROOM_TTL_SECONDS);
        },
      ),
    );
    acceptsSomething(accepted, "the TTLs it accepts");
  });

  it("validateKeyCheck accepts only a fingerprint of the exact shape", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.oneof(json, KEY_CHECK, fc.stringMatching(/^[0-9A-Z]{1,20}$/)),
        (value) => {
          const result = validateKeyCheck(value);
          if (!result.ok || result.keyCheck === undefined) {
            return;
          }
          accepted += 1;
          assert.equal(result.keyCheck.length, ROOM_KEY_CHECK_CHARS);
          assert.match(result.keyCheck, /^[0-9A-Z]+$/);
        },
      ),
    );
    acceptsSomething(accepted, "the fingerprints it accepts");
  });

  it("validatePeerId accepts only what it would let address a message", () => {
    let accepted = 0;
    fc.assert(
      fc.property(fc.oneof(json, PEER_ID, fc.string()), (value) => {
        if (!validatePeerId(value)) {
          return;
        }
        accepted += 1;
        assert.match(value, /^[A-Za-z0-9_-]{8,64}$/);
      }),
    );
    acceptsSomething(accepted, "the peer ids it accepts");
  });
});
