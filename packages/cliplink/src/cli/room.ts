import {
  buildRoomUrl,
  createEncryptedTransport,
  createHttpClient,
  createKeyedRoom,
  createOpenRoom,
  createWebSocketTransport,
  isValidRoomCode,
  MAX_ROOM_CODE_LENGTH,
  MIN_ROOM_CODE_LENGTH,
  normalizeRoomCode,
  RoomCreateError,
  type EncryptedTransport,
  type RoomKey,
} from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import { findSavedRoom, saveRoom } from "./config.ts";
import { extractKey, extractRoomCode, KeyError, resolveKey, type KeySource } from "./key.ts";
import type { Reporter } from "./output.ts";
import { readSecretFromTerminal, type ReadSecret } from "./prompt.ts";
import { renderQr } from "./qr.ts";

export type Session = {
  code: string;
  key: RoomKey;
  keySource: KeySource;
  transport: EncryptedTransport;
  /** The shareable link, key in the fragment. */
  url: string;
  /** True when the room was created by this run. */
  created: boolean;
};

/**
 * Node's own `WebSocket` global, which is why this package has no `ws`
 * dependency: the transport falls through to `globalThis.WebSocket` on its own,
 * and Node has had one since 22. Everything else the package handles.
 */
function transportOptions(baseUrl: string) {
  return { baseUrl };
}

/**
 * Resolves the room this run works against, creating one when none was named.
 *
 * Creating is the default on purpose. A CLI that minted the room and the key
 * itself never has to be handed a key at all, so the common path leaves no key
 * in shell history, in the environment, or on disk — the property the web app
 * has by keeping the key in a URL fragment.
 */
export async function openSession(
  args: ParsedArgs,
  { readSecret = readSecretFromTerminal }: { readSecret?: ReadSecret } = {},
): Promise<Session> {
  const options = transportOptions(args.baseUrl);
  const http = createHttpClient(options);

  if (args.room) {
    const passphrase = await passphraseFor(args, readSecret, false);
    const { code, key, keySource } = await joinRoom(args, passphrase);
    const transport = createEncryptedTransport(createWebSocketTransport(options));
    transport.setRoomKey(code, key);
    return {
      code,
      key,
      keySource,
      transport,
      url: buildRoomUrl(code, args.baseUrl, args.open ? undefined : key.encoded),
      created: false,
    };
  }

  const passphrase = await passphraseFor(args, readSecret, true);
  const request = {
    http,
    code: args.code ?? undefined,
    ttlSeconds: args.ttlSeconds ?? undefined,
  };
  // The server is told the key's fingerprint and erase check, never the key,
  // and a chosen code is claimed or refused in the same request. An open
  // room has no key of its own to tell it about.
  const { code, key, ttlSeconds } = await (
    args.open
      ? createOpenRoom(request)
      : createKeyedRoom({ ...request, passphrase: passphrase ?? undefined })
  ).catch((error: unknown) => {
    // Its messages are written for a person, but name no server.
    if (error instanceof RoomCreateError && error.reason === "bad_response") {
      throw new Error(`${args.baseUrl}: ${error.message}`);
    }
    throw error;
  });
  const transport = createEncryptedTransport(createWebSocketTransport(options));
  transport.setRoomKey(code, key);

  if (args.save) {
    const savedAt = Date.now();
    // Creating is the one path that learns the room's lifetime, so it is the
    // one that can record a real expiry rather than an upper bound.
    await saveRoom({
      code,
      key: key.encoded,
      baseUrl: args.baseUrl,
      savedAt,
      expiresAt: savedAt + ttlSeconds * 1000,
    });
  }

  return {
    code,
    key,
    keySource: args.open ? "open" : passphrase === null ? "generated" : "passphrase",
    transport,
    url: buildRoomUrl(code, args.baseUrl, args.open ? undefined : key.encoded),
    created: true,
  };
}

/** What a run that created its room prints, so the other device can join it. */
export function announceNewRoom(session: Session, report: Reporter, color: boolean) {
  report.note(`Room ${session.code} — open on your other device:`);
  report.note();
  report.note(session.url);
  if (report.interactive) {
    report.note();
    report.note(renderQr(session.url, { color }));
  }
  report.note();
  if (session.keySource === "open") {
    report.note("This room is open: anyone with the code can read it, the server included.");
    return;
  }
  report.note("The room key is in the link's #fragment and never reaches the server.");
  if (session.keySource === "passphrase") {
    report.note(`Or join with room code ${session.code} and your passphrase.`);
  }
}

/**
 * The passphrase for this run, if it has one. Asked for twice when creating:
 * a typo there makes a room that the passphrase you meant does not open.
 */
async function passphraseFor(
  args: ParsedArgs,
  readSecret: ReadSecret,
  creating: boolean,
): Promise<string | null> {
  if (!args.askPassphrase) {
    return args.passphrase;
  }

  const passphrase = await readSecret("Passphrase: ");
  if (creating && (await readSecret("Again, to confirm: ")) !== passphrase) {
    throw new KeyError("The passphrases do not match.");
  }
  return passphrase;
}

async function joinRoom(args: ParsedArgs, passphrase: string | null) {
  // A pasted room link names both halves, which is the obvious thing to try.
  const fromLink = extractRoomCode(args.room ?? "");
  const code = normalizeRoomCode(fromLink ?? args.room);
  if (!isValidRoomCode(code)) {
    throw new KeyError(
      `"${args.room}" is not a room code. Codes are ${MIN_ROOM_CODE_LENGTH} to ${MAX_ROOM_CODE_LENGTH} letters and digits, like X7KP2M.`,
    );
  }

  let key = args.key;
  let source: KeySource = key ? "flag" : "env";

  // A link given as --room may carry the key in its fragment.
  if (!key && args.room?.includes("#")) {
    const fromHash = extractKey(args.room);
    if (fromHash) {
      key = fromHash;
      source = "flag";
    }
  }

  // A passphrase someone typed for this run outranks one saved earlier.
  if (!key && !args.open && !passphrase) {
    const saved = await findSavedRoom(code, args.baseUrl);
    if (saved?.key) {
      key = saved.key;
      source = "saved";
    }
  }

  const resolved = await resolveKey(code, {
    key,
    open: args.open,
    source,
    passphrase,
  });

  if (args.save && !args.open) {
    await saveRoom({
      code,
      key: resolved.key.encoded,
      baseUrl: args.baseUrl,
      savedAt: Date.now(),
    });
  }

  return { code, key: resolved.key, keySource: resolved.source };
}
