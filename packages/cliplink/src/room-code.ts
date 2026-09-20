import { ROOM_CODE_LENGTH } from "./protocol.ts";

const ROOM_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`);
/** 32 characters: no O/0 or I/1 to confuse, and a power of two so a byte maps without bias. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRoomCode(value: string | null | undefined) {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(value: string) {
  return ROOM_CODE_PATTERN.test(value);
}

/**
 * A room code is the room's only identifier, and for a room opened by its code
 * alone — see `deriveOpenRoomKey` — it is the whole of the key material. So it
 * comes from the CSPRNG, not `Math.random`, whose output is predictable from a
 * handful of earlier draws.
 *
 * The alphabet is exactly 32 characters, so the low five bits of a random byte
 * index it uniformly: no modulo bias, and no rejection loop to get there.
 */
export function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}

/** The fragment key the room key travels under. */
export const ROOM_KEY_FRAGMENT_PARAM = "k";

/**
 * A shareable room link. The key goes in the fragment, which browsers do not
 * send to the server — that is the whole reason the encryption is end-to-end
 * and not merely at rest. Anything that builds a link, QR or share sheet must
 * go through here, or it will hand someone a room they cannot read.
 */
export function buildRoomUrl(code: string, origin: string, roomKey?: string) {
  const url = new URL(`/room/${code}`, origin);
  // The key goes in the fragment and nowhere else. A path segment or a query
  // parameter travels to the server in the request line and is written to its
  // logs; a fragment is never sent at all.
  url.hash = roomKey ? `${ROOM_KEY_FRAGMENT_PARAM}=${roomKey}` : "";
  return url.toString();
}

/** Reads the room key back out of a `#k=…` fragment. */
export function parseRoomKeyFromHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get(ROOM_KEY_FRAGMENT_PARAM);
}

/** The fragment to append when routing, so a replace does not drop the key. */
export function roomKeyFragment(roomKey: string | null) {
  return roomKey ? `#${ROOM_KEY_FRAGMENT_PARAM}=${roomKey}` : "";
}
