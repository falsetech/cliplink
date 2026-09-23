/**
 * Argument parsing, kept apart from anything that touches the network or the
 * filesystem so the whole surface can be tested as a pure function.
 */

import {
  MAX_ROOM_TTL_SECONDS,
  MIN_ROOM_TTL_SECONDS,
  validateRoomTtl,
} from "../index.ts";

import type { Env } from "./env.ts";

export const COMMANDS = ["send", "recv", "rooms", "link", "help", "version"] as const;
export type Command = (typeof COMMANDS)[number];

export const DEFAULT_BASE_URL = "https://cliplink.thebkht.com";

export type ParsedArgs = {
  command: Command;
  /** Positional text for `send`. Empty means stdin. */
  text: string;
  room: string | null;
  key: string | null;
  /** Derive the key from the room code: no key to share, and not end-to-end. */
  open: boolean;
  /** Write the room and key to the config file. The one path that persists a key. */
  save: boolean;
  /** `recv` only: print the next clip and exit. */
  one: boolean;
  /** `recv` only: print each clip as a JSON object rather than as its text. */
  json: boolean;
  /** `recv` only: replay this many of the room's existing clips before listening. */
  last: number | null;
  /** `recv` only: replay every clip the room still holds before listening. */
  all: boolean;
  /** Suppress the human-facing commentary on stderr. */
  quiet: boolean;
  /**
   * Whether to colour the QR. Off leaves it in the terminal's own colours,
   * which many scanners will not read on a dark theme — but honouring the
   * request is the point, and the link is printed as text either way.
   */
  color: boolean;
  ttlSeconds: number | null;
  baseUrl: string;
  /** `rooms` only: the room to forget. */
  forget: string | null;
  /** `rooms` only: forget every saved room. */
  forgetAll: boolean;
  /** `rooms` only: drop the rooms that have expired. */
  prune: boolean;
  /** `rooms` only: print the saved keys, which the listing otherwise withholds. */
  showKeys: boolean;
};

export type ParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; message: string };

const FLAGS_WITH_VALUES = new Set([
  "--room",
  "--key",
  "--ttl",
  "--url",
  "--forget",
  "--last",
]);

const ALIASES: Record<string, string> = {
  "-r": "--room",
  "-k": "--key",
  "-1": "--one",
  "-q": "--quiet",
  "-h": "--help",
  "-v": "--version",
};

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Parses `argv` as the CLI sees it, without the node and script entries.
 *
 * Unknown flags are an error rather than positional text: a mistyped `--quite`
 * silently becoming the clip you send is the kind of thing you only notice on
 * the other device.
 */
export function parseArgs(argv: string[], env: Env = {}): ParseResult {
  const args: ParsedArgs = {
    command: "help",
    text: "",
    room: env.CLIPLINK_ROOM ?? null,
    key: env.CLIPLINK_ROOM_KEY ?? null,
    open: false,
    save: false,
    one: false,
    json: false,
    last: null,
    all: false,
    quiet: false,
    // https://no-color.org: set to anything non-empty, and colour is off.
    color: (env.NO_COLOR ?? "") === "",
    ttlSeconds: null,
    baseUrl: env.CLIPLINK_URL ?? DEFAULT_BASE_URL,
    forget: null,
    forgetAll: false,
    prune: false,
    showKeys: false,
  };

  const positional: string[] = [];
  let command: Command | null = null;
  /** Whether the room was named on the command line or came from the environment. */
  let roomFromFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const token = ALIASES[raw] ?? raw;

    // `--` ends flag parsing, so a clip may begin with a dash.
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("-") && token !== "-") {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      const inline = eq === -1 ? null : token.slice(eq + 1);

      if (FLAGS_WITH_VALUES.has(name)) {
        const value = inline ?? argv[++index];
        if (value === undefined) {
          return { ok: false, message: `${name} needs a value.` };
        }
        if (name === "--room") {
          args.room = value;
          roomFromFlag = true;
        } else if (name === "--key") {
          args.key = value;
        } else if (name === "--url") {
          args.baseUrl = value;
        } else if (name === "--forget") {
          args.forget = value;
        } else if (name === "--last") {
          // Number("") is 0, and an empty --last is a mistake rather than a
          // request for no clips.
          const count = value.trim() === "" ? Number.NaN : Number(value);
          if (!Number.isInteger(count) || count < 0) {
            return { ok: false, message: "--last takes a whole number of clips." };
          }
          args.last = count;
        } else {
          // validateRoomTtl is the same check the server applies, so the
          // bounds the help text advertises are enforced before a round trip
          // rather than learned from a rejection. Its messages name the wire
          // field, though, and the person typed a flag.
          const ttl = validateRoomTtl(Number(value));
          if (!ttl.ok) {
            return {
              ok: false,
              message: Number.isFinite(Number(value))
                ? `--ttl must be between ${MIN_ROOM_TTL_SECONDS} and ${MAX_ROOM_TTL_SECONDS} seconds.`
                : "--ttl must be a number of seconds.",
            };
          }
          args.ttlSeconds = ttl.ttlSeconds;
        }
        continue;
      }

      if (inline !== null) {
        return { ok: false, message: `${name} does not take a value.` };
      }

      switch (name) {
        case "--open":
          args.open = true;
          break;
        case "--save":
          args.save = true;
          break;
        case "--one":
          args.one = true;
          break;
        case "--json":
          args.json = true;
          break;
        case "--all":
          args.all = true;
          break;
        case "--quiet":
          args.quiet = true;
          break;
        case "--no-color":
        case "--no-colour":
          args.color = false;
          break;
        case "--forget-all":
          args.forgetAll = true;
          break;
        case "--prune":
          args.prune = true;
          break;
        case "--show-keys":
          args.showKeys = true;
          break;
        case "--help":
          return { ok: true, args: { ...args, command: "help" } };
        case "--version":
          return { ok: true, args: { ...args, command: "version" } };
        default:
          return { ok: false, message: `Unknown option ${name}.` };
      }
      continue;
    }

    if (command === null && isCommand(token)) {
      command = token;
      continue;
    }

    positional.push(raw);
  }

  if (command === null) {
    return {
      ok: false,
      message: "Expected a command: send, recv, rooms, link, help or version.",
    };
  }

  args.command = command;
  args.text = positional.join(" ");

  if (args.open && args.key) {
    return {
      ok: false,
      message: "--open derives the key from the room code, so --key cannot be given too.",
    };
  }
  if (args.open && args.save) {
    return {
      ok: false,
      message: "--open rooms have no key to save; the room code alone opens them.",
    };
  }
  if (command === "send" && args.one) {
    return { ok: false, message: "--one applies to recv, not send." };
  }
  if (command !== "recv" && args.json) {
    return { ok: false, message: `--json applies to recv, not ${command}.` };
  }
  if (command !== "recv" && (args.last !== null || args.all)) {
    const name = args.all ? "--all" : "--last";
    return { ok: false, message: `${name} applies to recv, not ${command}.` };
  }
  if (args.last !== null && args.all) {
    return {
      ok: false,
      message: "--last takes a count and --all takes everything; pick one.",
    };
  }
  if (command === "recv" && args.text) {
    return { ok: false, message: "recv takes no text to send." };
  }
  if (command === "recv" && !args.room) {
    return { ok: false, message: "recv needs a room: pass --room, or CLIPLINK_ROOM." };
  }
  if (command === "rooms" && args.text) {
    return { ok: false, message: "rooms takes no text." };
  }
  if (command === "link" && args.text) {
    return { ok: false, message: "link takes no text." };
  }
  if (command === "link" && !args.room) {
    // link never creates a room. Minting one just to print its link would
    // leave a room on the server that nobody asked for.
    return { ok: false, message: "link needs a room: pass --room, or CLIPLINK_ROOM." };
  }
  if (command !== "rooms") {
    // These read and write the saved-rooms file and mean nothing anywhere
    // else. Silently ignoring one would let `cliplink send --prune` look like
    // it had pruned something.
    const misplaced = (
      [
        [args.forget !== null, "--forget"],
        [args.forgetAll, "--forget-all"],
        [args.prune, "--prune"],
        [args.showKeys, "--show-keys"],
      ] as const
    ).find(([given]) => given);
    if (misplaced) {
      return { ok: false, message: `${misplaced[1]} applies to rooms, not ${command}.` };
    }
  }
  if (args.forget !== null && args.forgetAll) {
    return {
      ok: false,
      message: "--forget names one room and --forget-all takes them all; pick one.",
    };
  }
  if (args.ttlSeconds !== null && args.room) {
    // Saying "this run joins one" explains nothing when the room came from the
    // environment and the command line shows no room at all.
    return {
      ok: false,
      message: roomFromFlag
        ? "--ttl sets the lifetime of a room being created, and this run joins one."
        : "--ttl sets the lifetime of a room being created, and CLIPLINK_ROOM already names one to join. Unset it to create a room.",
    };
  }

  return { ok: true, args };
}
