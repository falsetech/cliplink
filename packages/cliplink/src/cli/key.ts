import {
  deriveOpenRoomKey,
  deriveRoomKeyFromPassphrase,
  formatRoomKey,
  importRoomKey,
  MAX_ROOM_CODE_LENGTH,
  MIN_ROOM_CODE_LENGTH,
  normalizeRoomKey,
  parseRoomKeyFromHash,
  validatePassphrase,
  type RoomKey,
} from "../index.ts";

/**
 * Where a room key may come from, in the order it is looked for.
 *
 * The ordering is the security decision: the explicit flag wins because
 * someone who typed it means it, then the environment, then the saved file,
 * which is the only source that persists anything. A key given on the command
 * line is the least private of the three — it lands in shell history and is
 * visible in `ps` — so the help text says so and the other two exist to avoid
 * needing it.
 */
export type KeySource =
  | "flag"
  | "env"
  | "saved"
  | "open"
  | "generated"
  | "passphrase";

export type ResolvedKey = {
  key: RoomKey;
  source: KeySource;
};

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

/**
 * Accepts a bare key, the grouped form printed for reading aloud, or a whole
 * room URL — pasting the link you were sent is the obvious thing to try, and
 * failing on it would teach nothing.
 */
export function extractKey(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("#")) {
    const fromHash = parseRoomKeyFromHash(trimmed.slice(trimmed.indexOf("#")));
    if (fromHash) {
      return normalizeRoomKey(fromHash);
    }
  }

  return normalizeRoomKey(trimmed);
}

const ROOM_PATH = new RegExp(
  `/room/([A-Za-z0-9]{${MIN_ROOM_CODE_LENGTH},${MAX_ROOM_CODE_LENGTH}})(?![A-Za-z0-9])`,
);

/** The room code in a room URL, so a pasted link names both halves. */
export function extractRoomCode(input: string): string | null {
  const match = input.trim().match(ROOM_PATH);
  return match ? match[1].toUpperCase() : null;
}

export async function resolveKey(
  roomCode: string,
  options: {
    key: string | null;
    open: boolean;
    source: KeySource;
    passphrase?: string | null;
  },
): Promise<ResolvedKey> {
  if (options.open) {
    return { key: await deriveOpenRoomKey(roomCode), source: "open" };
  }

  if (!options.key && options.passphrase) {
    const valid = validatePassphrase(options.passphrase);
    if (!valid.ok) {
      throw new KeyError(valid.message);
    }
    return {
      key: await deriveRoomKeyFromPassphrase(options.passphrase, roomCode),
      source: "passphrase",
    };
  }

  const encoded = options.key ? extractKey(options.key) : null;
  if (!encoded) {
    throw new KeyError(
      `Room ${roomCode} is end-to-end encrypted, so it needs its key.\n` +
        "Pass the room link or key as --key, set CLIPLINK_ROOM_KEY, use --passphrase if\n" +
        "the room was made with one, or --open for a room that has none.",
    );
  }

  const key = await importRoomKey(encoded);
  if (!key) {
    throw new KeyError(
      `That is not a valid room key.\nKeys look like ${formatRoomKey("0".repeat(52))}.`,
    );
  }

  return { key, source: options.source };
}
