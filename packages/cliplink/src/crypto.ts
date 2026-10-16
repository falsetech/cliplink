/**
 * End-to-end encryption for clips and file signaling.
 *
 * The room key is generated in the browser and never sent to the server: it
 * travels in the URL fragment, which browsers do not transmit, or is read out
 * and typed in. The server therefore holds ciphertext it cannot open, and the
 * room code — which it must see to route anything — is not key material.
 *
 * WebCrypto only. Nothing here may be imported by a route: `crypto.subtle` is
 * the client's, and the server has no business holding these functions. The
 * one exception is `deriveOpenRoomKey`, for the reason given on it — an open
 * room's key is the server's to derive by design.
 */

import { normalizePassphrase, validatePassphrase } from "./passphrase.ts";

const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Bytes of the non-secret key fingerprint. Not a key, and not reversible. */
const CHECK_BYTES = 8;
const ERASE_TOKEN_BYTES = 32;
const WIRE_PREFIX = "v1.";

/**
 * Crockford base32: no I, L, O or U, so the ambiguous glyph pairs and the one
 * letter that forms unintended words are all absent. Read a key aloud and it
 * transcribes unambiguously.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DECODE = new Map<string, number>(
  [...ALPHABET].map((char, index) => [char, index]),
);
// Crockford's own leniencies, so a key typed from a screen still imports.
DECODE.set("O", 0);
DECODE.set("I", 1);
DECODE.set("L", 1);

/** 32 bytes at 5 bits per character. */
const ENCODED_KEY_CHARS = Math.ceil((KEY_BYTES * 8) / 5);

export type RoomKey = {
  /** The serialized key — what travels in the fragment and what a user pastes. */
  encoded: string;
  clipKey: CryptoKey;
  signalKey: CryptoKey;
  /** Seals what travels beside a clip's text: who sent it. */
  metaKey: CryptoKey;
  /**
   * A short fingerprint the server may hold. Derived through the same one-way
   * KDF as the subkeys, so it reveals nothing, and it lets a joiner be told
   * "wrong key" at once instead of discovering it when a clip fails to open.
   */
  check: string;
  /**
   * Presented to the server to delete clips. Derived, so every key holder has
   * the same one and nobody else can produce it; one-way, so the server
   * learning it on first use tells it nothing about the key.
   */
  eraseToken: string;
  /**
   * SHA-256 of `eraseToken`, given to the server when the room is created. It
   * is what the server checks a presented token against, so it never has to
   * hold the token itself until someone actually deletes something.
   */
  eraseCheck: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(text: string): Uint8Array<ArrayBuffer> | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = DECODE.get(char);
    if (index === undefined) {
      return null;
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function deriveRoomKey(raw: Uint8Array<ArrayBuffer>): Promise<RoomKey> {
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);

  // Separate subkeys per context: clips and signaling have different message
  // shapes and rates, and neither should be able to weaken the other.
  const params = (info: string) => ({
    name: "HKDF" as const,
    hash: "SHA-256" as const,
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  });

  const [clipKey, signalKey, metaKey, checkBits, eraseBits] = await Promise.all([
    crypto.subtle.deriveKey(
      params("cliplink:clip"),
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveKey(
      params("cliplink:signal"),
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveKey(
      params("cliplink:meta"),
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveBits(params("cliplink:check"), base, CHECK_BYTES * 8),
    crypto.subtle.deriveBits(
      params("cliplink:erase"),
      base,
      ERASE_TOKEN_BYTES * 8,
    ),
  ]);

  const eraseToken = encodeBase32(new Uint8Array(eraseBits));
  const eraseCheck = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(eraseToken)),
    ),
  );

  return {
    encoded: encodeBase32(raw),
    clipKey,
    signalKey,
    metaKey,
    check: encodeBase32(new Uint8Array(checkBits)),
    eraseToken,
    eraseCheck,
  };
}

export async function generateRoomKey(): Promise<RoomKey> {
  return deriveRoomKey(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/**
 * The key for an *open* room: derived from the room code, so there is nothing
 * extra to share and the code alone opens the room.
 *
 * This is deliberately NOT end-to-end. The server receives the room code in
 * order to route anything at all, so it can derive this key too. What it buys
 * is one wire format instead of two — an open room is encrypted in Redis and
 * over the wire exactly like any other, and nothing downstream needs a second
 * code path — plus protection from anyone who has the stored data but not the
 * code. Rooms that need the server excluded generate a real key instead.
 */
export async function deriveOpenRoomKey(roomCode: string): Promise<RoomKey> {
  const seed = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`cliplink:open-room:${roomCode}`),
  );
  return deriveRoomKey(new Uint8Array(seed));
}

/**
 * PBKDF2-SHA-256 rounds for a passphrase. OWASP's figure for this hash, and
 * the whole of what stands between a weak passphrase and someone testing
 * guesses against the room's stored fingerprint. Part of the derivation: a
 * different count is a different key, so it cannot change without a new salt
 * prefix to go with it.
 */
export const PASSPHRASE_KDF_ITERATIONS = 600_000;
const PASSPHRASE_SALT_PREFIX = "cliplink:passphrase:v1:";

/**
 * A room key from a passphrase someone chose, for a room they can reopen
 * anywhere by typing it.
 *
 * Unlike a generated key this has little entropy, so it goes through a slow
 * KDF before the usual HKDF split — the server keeps the key's fingerprint,
 * and every guess against it has to pay for these rounds. The room code is
 * the salt, so one passphrase opens one room and no table of guesses carries
 * from one room to the next. `roomCode` must be canonical (see
 * `normalizeRoomCode`); a lowercase code derives a different key.
 */
export async function deriveRoomKeyFromPassphrase(
  passphrase: string,
  roomCode: string,
): Promise<RoomKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(PASSPHRASE_SALT_PREFIX + roomCode),
      iterations: PASSPHRASE_KDF_ITERATIONS,
    },
    base,
    KEY_BYTES * 8,
  );
  return deriveRoomKey(new Uint8Array(bits));
}

/** Strips the grouping dashes and anything else a paste may have carried in. */
export function normalizeRoomKey(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Grouped for reading aloud and for typing without losing your place. */
export function formatRoomKey(encoded: string) {
  return (normalizeRoomKey(encoded).match(/.{1,4}/g) ?? []).join("-");
}

/** Null rather than throwing: a mistyped key is an ordinary outcome here. */
export async function importRoomKey(encoded: string): Promise<RoomKey | null> {
  const normalized = normalizeRoomKey(encoded);
  if (normalized.length !== ENCODED_KEY_CHARS) {
    return null;
  }

  const raw = decodeBase32(normalized);
  if (!raw || raw.length !== KEY_BYTES) {
    return null;
  }

  try {
    return await deriveRoomKey(raw);
  } catch {
    return null;
  }
}

/**
 * Whether typed text reads as a generated room key. One rule, used both to
 * interpret what a joiner typed and to refuse a passphrase at creation that
 * would later be mistaken for a key — a room nobody could get back into.
 */
export function looksLikeRoomKey(typed: string) {
  const normalized = normalizeRoomKey(typed);
  return (
    normalized.length === ENCODED_KEY_CHARS && decodeBase32(normalized) !== null
  );
}

/**
 * Whatever a joiner typed into the one field that asks for "key or
 * passphrase": a 52-character key if it reads as one, a passphrase otherwise.
 * Null when it is neither — too short to be a passphrase, or too long to feed
 * the KDF. A passphrase that is merely wrong still derives a key; the room's
 * fingerprint is what turns that away.
 */
export async function resolveRoomSecret(
  typed: string,
  roomCode: string,
): Promise<{ key: RoomKey; kind: "key" | "passphrase" } | null> {
  if (looksLikeRoomKey(typed)) {
    const key = await importRoomKey(typed);
    return key ? { key, kind: "key" } : null;
  }

  if (!validatePassphrase(typed).ok) {
    return null;
  }

  return {
    key: await deriveRoomKeyFromPassphrase(typed, roomCode),
    kind: "passphrase",
  };
}

/**
 * The room code is the additional data on every message, so a ciphertext
 * lifted out of one room cannot be replayed into another. `aad` is the room
 * code alone for clips and signals; clip metadata binds more, see below.
 */
async function seal(key: CryptoKey, aad: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );

  const packed = new Uint8Array(iv.length + sealed.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(sealed), iv.length);
  return WIRE_PREFIX + encodeBase64Url(packed);
}

async function open(key: CryptoKey, aad: string, wire: string) {
  if (!wire.startsWith(WIRE_PREFIX)) {
    return null;
  }

  const packed = decodeBase64Url(wire.slice(WIRE_PREFIX.length));
  if (!packed || packed.length <= IV_BYTES) {
    return null;
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: packed.subarray(0, IV_BYTES),
        additionalData: encoder.encode(aad),
      },
      key,
      packed.subarray(IV_BYTES),
    );
    return decoder.decode(plaintext);
  } catch {
    // Wrong key, wrong room, or a tampered message. GCM does not distinguish
    // them and neither should the caller.
    return null;
  }
}

export function encryptClipText(key: RoomKey, roomCode: string, text: string) {
  return seal(key.clipKey, roomCode, text);
}

export function decryptClipText(key: RoomKey, roomCode: string, wire: string) {
  return open(key.clipKey, roomCode, wire);
}

export function sealSignal(key: RoomKey, roomCode: string, payload: unknown) {
  return seal(key.signalKey, roomCode, JSON.stringify(payload));
}

export async function openSignal(
  key: RoomKey,
  roomCode: string,
  wire: string,
): Promise<unknown | null> {
  const plaintext = await open(key.signalKey, roomCode, wire);
  if (plaintext === null) {
    return null;
  }

  try {
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

/**
 * Metadata is bound to the sealed text it accompanies as well as to the room,
 * so the server cannot move one clip's attribution onto another. Its own
 * subkey keeps it out of the text slot too: a metadata ciphertext offered as
 * a clip's text will not open.
 */
function metaAad(roomCode: string, textWire: string) {
  return `${roomCode}\u0000${textWire}`;
}

export function sealClipMeta(
  key: RoomKey,
  roomCode: string,
  textWire: string,
  meta: unknown,
) {
  return seal(key.metaKey, metaAad(roomCode, textWire), JSON.stringify(meta));
}

export async function openClipMeta(
  key: RoomKey,
  roomCode: string,
  textWire: string,
  wire: string,
): Promise<unknown | null> {
  const plaintext = await open(key.metaKey, metaAad(roomCode, textWire), wire);
  if (plaintext === null) {
    return null;
  }

  try {
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}
