import {
  deriveOpenRoomKey,
  deriveRoomKeyFromPassphrase,
  generateRoomKey,
  looksLikeRoomKey,
  type RoomKey,
} from "./crypto.ts";
import { ApiRequestError, type HttpClient } from "./http.ts";
import { validatePassphrase } from "./passphrase.ts";
import { MAX_ROOM_CODE_LENGTH, MIN_ROOM_CODE_LENGTH } from "./protocol.ts";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "./room-code.ts";
import type { RoomCode } from "./types.ts";

/** Fresh codes to try when a passphrase room's generated code is taken. */
const GENERATED_CODE_ATTEMPTS = 5;

export type CreateRoomFailure =
  /** The chosen code is not a room code. */
  | "invalid_code"
  /** Too short, too long, or shaped like a generated key. */
  | "invalid_passphrase"
  /** Someone already holds the chosen code. */
  | "code_taken"
  /** The server made a room under another code: it predates chosen codes. */
  | "code_ignored"
  /** The server answered with something that is not a room code. */
  | "bad_response";

export class RoomCreateError extends Error {
  readonly reason: CreateRoomFailure;

  constructor(reason: CreateRoomFailure, message: string) {
    super(message);
    this.name = "RoomCreateError";
    this.reason = reason;
  }
}

export type CreateKeyedRoomOptions = {
  http: Pick<HttpClient, "createRoomRequest">;
  /** A code to claim, as typed. Normalized here. */
  code?: string;
  /** Derive the key from this, rather than generating one. */
  passphrase?: string;
  ttlSeconds?: number;
};

export type CreateOpenRoomOptions = Omit<CreateKeyedRoomOptions, "passphrase">;

/** A room as created: its code, and the key that opens it. */
export type CreatedRoom = {
  code: RoomCode;
  key: RoomKey;
  ttlSeconds: number;
};

/**
 * Creates an end-to-end encrypted room: picks or claims its code, generates
 * or derives its key, and tells the server only the key's fingerprint.
 *
 * The web app and the CLI both create rooms through here, because the rules
 * are the kind that must not drift between two copies. A passphrase salted
 * with one code and sent with another, or normalized one way here and another
 * way there, makes a room nobody can get back into.
 *
 * A passphrase is salted with the room code, so its key cannot exist before
 * the code does. With no code chosen, this one picks the code itself rather
 * than letting the server, and picks again if the server says it is taken.
 */
export async function createKeyedRoom({
  http,
  code: requested,
  passphrase,
  ttlSeconds,
}: CreateKeyedRoomOptions): Promise<CreatedRoom> {
  const chosen = chosenCode(requested);

  if (passphrase !== undefined) {
    const valid = validatePassphrase(passphrase);
    if (!valid.ok) {
      throw new RoomCreateError("invalid_passphrase", valid.message);
    }
    // Joining reads anything key-shaped as a key, so this passphrase would
    // never be tried as one.
    if (looksLikeRoomKey(passphrase)) {
      throw new RoomCreateError(
        "invalid_passphrase",
        "That passphrase reads as a room key. Choose a different one.",
      );
    }
  }

  // Neither chosen: today's path, where the server allocates the code.
  if (chosen === undefined && passphrase === undefined) {
    const key = await generateRoomKey();
    const response = await http.createRoomRequest({
      keyCheck: key.check,
      eraseCheck: key.eraseCheck,
      ttlSeconds,
    });
    return { code: checkedCode(response.code), key, ttlSeconds: response.ttlSeconds };
  }

  const attempts = chosen === undefined ? GENERATED_CODE_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    const code = chosen ?? generateRoomCode();
    const key =
      passphrase === undefined
        ? await generateRoomKey()
        : await deriveRoomKeyFromPassphrase(passphrase, code);

    try {
      const response = await http.createRoomRequest({
        code,
        keyCheck: key.check,
        eraseCheck: key.eraseCheck,
        ttlSeconds,
      });
      checkHonoured(response.code, code);
      return { code, key, ttlSeconds: response.ttlSeconds };
    } catch (error) {
      if (!isCodeTaken(error)) {
        throw error;
      }
      if (chosen !== undefined) {
        throw codeTaken(chosen);
      }
      if (attempt >= attempts) {
        throw new RoomCreateError(
          "code_taken",
          "Could not find a free room code. Try again.",
        );
      }
    }
  }
}

/**
 * Creates an open room: no key of its own, so the code opens it, and the
 * server can derive the key as well as anyone. A chosen code is allowed, and
 * that is the caller's informed choice — a code a person can remember is a
 * code another person can guess, and here the code is the whole of the key.
 */
export async function createOpenRoom({
  http,
  code: requested,
  ttlSeconds,
}: CreateOpenRoomOptions): Promise<CreatedRoom> {
  const chosen = chosenCode(requested);

  let response;
  try {
    response = await http.createRoomRequest({ code: chosen, ttlSeconds });
  } catch (error) {
    throw chosen !== undefined && isCodeTaken(error) ? codeTaken(chosen) : error;
  }

  const code = checkedCode(response.code);
  if (chosen !== undefined) {
    checkHonoured(code, chosen);
  }
  return {
    code,
    key: await deriveOpenRoomKey(code),
    ttlSeconds: response.ttlSeconds,
  };
}

/** The code asked for, normalized, or undefined to let one be picked. */
function chosenCode(requested: string | undefined) {
  if (!requested) {
    return undefined;
  }

  const code = normalizeRoomCode(requested);
  if (!isValidRoomCode(code)) {
    throw new RoomCreateError(
      "invalid_code",
      `A room code is ${MIN_ROOM_CODE_LENGTH} to ${MAX_ROOM_CODE_LENGTH} letters and digits.`,
    );
  }
  return code;
}

/**
 * A server from before chosen codes ignores the field and allocates one. A
 * passphrase key is salted with the code that was asked for, and a person
 * expects the code they chose, so a room under any other code is a failure.
 */
function checkHonoured(answered: unknown, requested: RoomCode) {
  if (checkedCode(answered) !== requested) {
    throw new RoomCreateError(
      "code_ignored",
      "This server does not support choosing a room code.",
    );
  }
}

function codeTaken(code: RoomCode) {
  return new RoomCreateError(
    "code_taken",
    `Room ${code} is already in use. Choose another code.`,
  );
}

function isCodeTaken(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    error.code === "room_code_taken"
  );
}

/**
 * The code goes into the link, the QR, a saved room and from there into shell
 * completions, so an answer that is not a room code gets no further.
 */
function checkedCode(code: unknown): RoomCode {
  if (typeof code !== "string" || !isValidRoomCode(code)) {
    throw new RoomCreateError(
      "bad_response",
      `The server answered with "${String(code).slice(0, 40)}", which is not a room code.`,
    );
  }
  return code;
}
