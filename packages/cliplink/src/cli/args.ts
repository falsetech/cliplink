/**
 * Argument parsing, kept apart from anything that touches the network or the
 * filesystem so the whole surface can be tested as a pure function.
 *
 * The commands and flags are each one table. The parser, `--help` and the
 * shell completions all read them, so a flag cannot be accepted without being
 * documented, or completed without being accepted.
 */

import {
  isValidRoomCode,
  MAX_ROOM_CODE_LENGTH,
  MAX_ROOM_TTL_SECONDS,
  MAX_DEVICE_NAME_CHARS,
  MIN_PASSPHRASE_CHARS,
  MIN_ROOM_CODE_LENGTH,
  MIN_ROOM_TTL_SECONDS,
  normalizeDeviceName,
  normalizeRoomCode,
  validateRoomTtl,
} from "../index.ts";

import type { Env } from "./env.ts";

export const DEFAULT_BASE_URL = "https://cliplink.thebkht.com";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

export const COMMANDS = [
  { name: "send", usage: "send [text]", summary: "Send a clip. With no text, reads stdin." },
  { name: "recv", usage: "recv", summary: "Print clips as they arrive, until Ctrl-C." },
  {
    name: "watch",
    usage: "watch",
    summary: "Sync this machine's clipboard with a room.",
  },
  { name: "rooms", usage: "rooms", summary: "List the rooms --save has kept." },
  { name: "link", usage: "link", summary: "Print the share link and QR for a room." },
  {
    name: "completions",
    usage: "completions <shell>",
    summary: `Print a completion script: ${SHELLS.join(", ")}.`,
  },
  { name: "help", usage: null, summary: "Print usage." },
  { name: "version", usage: null, summary: "Print the version." },
] as const;
export type Command = (typeof COMMANDS)[number]["name"];

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
  /** `send` and `watch`: the code to claim for a room being created. */
  code: string | null;
  /**
   * A passphrase to derive the key from, out of CLIPLINK_PASSPHRASE. Never
   * from argv: `--passphrase` asks for it on the terminal instead.
   */
  passphrase: string | null;
  /** `--passphrase`: read the passphrase from the terminal. */
  askPassphrase: boolean;
  /** `send` and `watch`: the name clips are shown under. Null means the hostname. */
  name: string | null;
  /** `send` only: a one-time clip, deleted once another device reads it. */
  burn: boolean;
  /** `recv` only: print the next clip and exit. */
  one: boolean;
  /** `recv` only: print each clip as a JSON object rather than as its text. */
  json: boolean;
  /** `recv` only: replay this many of the room's existing clips before listening. */
  last: number | null;
  /** `recv` only: replay every clip the room still holds before listening. */
  all: boolean;
  /** `recv` only: give up after this many seconds. */
  timeoutSeconds: number | null;
  /** `watch` only: send what is copied here, but write nothing to the clipboard. */
  sendOnly: boolean;
  /** `watch` only: copy what arrives, but send nothing from the clipboard. */
  recvOnly: boolean;
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
  /** `rooms` only: print the saved codes alone, one per line. */
  codes: boolean;
  /** `completions` only: the shell to write a script for. */
  shell: Shell | null;
};

export type ParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; message: string };

/** The commands that resolve a room, which is what most flags are about. */
const ROOM_COMMANDS = ["send", "recv", "watch", "link"] as const satisfies readonly Command[];

export type FlagSpec = {
  name: `--${string}`;
  short?: `-${string}`;
  /** Other spellings that are accepted and never advertised. */
  also?: readonly string[];
  /** What the value is called in `--help`. Present exactly when the flag takes one. */
  value?: string;
  /** The commands it means something to. Absent means every command. */
  commands?: readonly Command[];
  /** What `--help` says; a newline continues the description on the next line. */
  help: string;
  /** What a shell can offer as the value. */
  complete?: "rooms";
  /** Parsing it settles the command, whatever else the line says. */
  settles?: Command;
  /** Records the flag. A string is the error to report instead. */
  set?: (args: ParsedArgs, value: string) => string | void;
};

export const FLAGS: readonly FlagSpec[] = [
  {
    name: "--room",
    short: "-r",
    value: "<code|url>",
    commands: ROOM_COMMANDS,
    help: "Room to join. A full room link works too.",
    complete: "rooms",
    set: (args, value) => {
      args.room = value;
    },
  },
  {
    name: "--key",
    short: "-k",
    value: "<key|url>",
    commands: ROOM_COMMANDS,
    help: "Room key. See KEYS below.",
    set: (args, value) => {
      args.key = value;
    },
  },
  {
    name: "--passphrase",
    commands: ROOM_COMMANDS,
    help: `Ask for a passphrase to use as the room key\n(${MIN_PASSPHRASE_CHARS}+ characters). See KEYS below.`,
    set: (args) => {
      args.askPassphrase = true;
    },
  },
  {
    name: "--open",
    commands: ROOM_COMMANDS,
    help: "Room with no key of its own: the code opens it.",
    set: (args) => {
      args.open = true;
    },
  },
  {
    name: "--save",
    commands: ROOM_COMMANDS,
    help: "Remember this room and key in the config file.",
    set: (args) => {
      args.save = true;
    },
  },
  {
    name: "--code",
    value: "<code>",
    commands: ["send", "watch"],
    help: `Code to claim for a room being created\n(${MIN_ROOM_CODE_LENGTH}–${MAX_ROOM_CODE_LENGTH} letters and digits).`,
    set: (args, value) => {
      const code = normalizeRoomCode(value);
      // normalizeRoomCode forgives what a paste carries in, and also cuts at
      // the longest code; a code that only fit by being cut is not the one
      // that was typed.
      if (!isValidRoomCode(code) || code !== value.replace(/[\s-]/g, "").toUpperCase()) {
        return `--code takes ${MIN_ROOM_CODE_LENGTH} to ${MAX_ROOM_CODE_LENGTH} letters and digits.`;
      }
      args.code = code;
    },
  },
  {
    name: "--ttl",
    value: "<seconds>",
    commands: ["send", "watch"],
    help: `Lifetime of a room being created\n(${MIN_ROOM_TTL_SECONDS}–${MAX_ROOM_TTL_SECONDS}).`,
    set: (args, value) => {
      // validateRoomTtl is the same check the server applies, so the bounds
      // the help text advertises are enforced before a round trip rather than
      // learned from a rejection. Its messages name the wire field, though,
      // and the person typed a flag.
      const ttl = validateRoomTtl(Number(value));
      if (!ttl.ok) {
        return Number.isFinite(Number(value))
          ? `--ttl must be between ${MIN_ROOM_TTL_SECONDS} and ${MAX_ROOM_TTL_SECONDS} seconds.`
          : "--ttl must be a number of seconds.";
      }
      args.ttlSeconds = ttl.ttlSeconds;
    },
  },
  {
    name: "--name",
    value: "<name>",
    commands: ["send", "watch"],
    help: "The name clips are shown under.\nDefault is this machine's hostname.",
    set: (args, value) => {
      const deviceName = normalizeDeviceName(value);
      if (!deviceName || deviceName !== value.trim()) {
        return `--name takes one line of up to ${MAX_DEVICE_NAME_CHARS} characters.`;
      }
      args.name = deviceName;
    },
  },
  {
    name: "--burn",
    commands: ["send"],
    help: "A one-time clip. The first device to read\nit deletes it for everyone. recv counts as\nreading: what it prints, it deletes.",
    set: (args) => {
      args.burn = true;
    },
  },
  {
    name: "--one",
    short: "-1",
    commands: ["recv"],
    help: "Print the next clip, then exit.",
    set: (args) => {
      args.one = true;
    },
  },
  {
    name: "--json",
    commands: ["recv"],
    help: "Print each clip as a JSON object.",
    set: (args) => {
      args.json = true;
    },
  },
  {
    name: "--last",
    value: "<n>",
    commands: ["recv"],
    help: "Replay the last n clips before listening.",
    set: (args, value) => {
      // Number("") is 0, and an empty --last is a mistake rather than a
      // request for no clips.
      const count = value.trim() === "" ? Number.NaN : Number(value);
      if (!Number.isInteger(count) || count < 0) {
        return "--last takes a whole number of clips.";
      }
      args.last = count;
    },
  },
  {
    name: "--all",
    commands: ["recv"],
    help: "Replay every clip the room still holds.",
    set: (args) => {
      args.all = true;
    },
  },
  {
    name: "--timeout",
    value: "<secs>",
    commands: ["recv"],
    help: "Give up after this long. Exits 1 if no\nclip arrived, so a script can tell.",
    set: (args, value) => {
      const seconds = value.trim() === "" ? Number.NaN : Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return "--timeout takes a positive number of seconds.";
      }
      args.timeoutSeconds = seconds;
    },
  },
  {
    name: "--send-only",
    commands: ["watch"],
    help: "Send what is copied here; write nothing\nto this clipboard.",
    set: (args) => {
      args.sendOnly = true;
    },
  },
  {
    name: "--recv-only",
    commands: ["watch"],
    help: "Copy what arrives; send nothing from\nthis clipboard.",
    set: (args) => {
      args.recvOnly = true;
    },
  },
  {
    name: "--forget",
    value: "<code>",
    commands: ["rooms"],
    help: "Forget one saved room.",
    complete: "rooms",
    set: (args, value) => {
      args.forget = value;
    },
  },
  {
    name: "--forget-all",
    commands: ["rooms"],
    help: "Forget every saved room.",
    set: (args) => {
      args.forgetAll = true;
    },
  },
  {
    name: "--prune",
    commands: ["rooms"],
    help: "Drop the rooms that have expired.",
    set: (args) => {
      args.prune = true;
    },
  },
  {
    name: "--show-keys",
    commands: ["rooms"],
    help: "Print the saved keys, withheld by default.",
    set: (args) => {
      args.showKeys = true;
    },
  },
  {
    name: "--codes",
    commands: ["rooms"],
    help: "Print only the saved codes, one per line.",
    set: (args) => {
      args.codes = true;
    },
  },
  {
    name: "--quiet",
    short: "-q",
    help: "Suppress commentary on stderr.",
    set: (args) => {
      args.quiet = true;
    },
  },
  {
    name: "--no-color",
    also: ["--no-colour"],
    commands: ROOM_COMMANDS,
    help: "Draw the QR without colour. See NO_COLOR.",
    set: (args) => {
      args.color = false;
    },
  },
  {
    name: "--url",
    value: "<origin>",
    commands: ROOM_COMMANDS,
    help: `Deployment to talk to.\nDefault ${DEFAULT_BASE_URL}`,
    set: (args, value) => {
      args.baseUrl = value;
    },
  },
  { name: "--help", short: "-h", help: "This text.", settles: "help" },
  { name: "--version", short: "-v", help: "Version.", settles: "version" },
];

/** Every spelling a flag answers to, mapped to its entry. */
const BY_SPELLING = new Map<string, FlagSpec>(
  FLAGS.flatMap((flag) =>
    [flag.name, flag.short, ...(flag.also ?? [])]
      .filter((spelling): spelling is string => spelling !== undefined)
      .map((spelling) => [spelling, flag] as const),
  ),
);

/** The flags a command accepts. */
export function flagsFor(command: Command) {
  return FLAGS.filter((flag) => !flag.commands || flag.commands.includes(command));
}

function isCommand(value: string): value is Command {
  return COMMANDS.some((command) => command.name === value);
}

function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

/** "send", "send and watch", "send, recv and watch". */
function list(names: readonly string[], conjunction = "and") {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}

/**
 * Splits `-q1` into `-q -1`, the way every other CLI does.
 *
 * Only a run whose every letter is a known short flag is expanded. Anything
 * else is passed through untouched, so `-50` and `-kSECRET` still reach the
 * unknown-option error rather than being taken apart into letters and
 * misreported. A short flag that takes a value has to come last, since the
 * token after the cluster can only be one flag's value.
 */
function expandClusters(argv: string[]): ParseResult | string[] {
  const expanded: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    // Past `--` nothing is a flag, cluster-shaped or not.
    if (raw === "--") {
      expanded.push(...argv.slice(index));
      break;
    }

    const letters = /^-([A-Za-z0-9]{2,})$/.exec(raw)?.[1];
    if (
      letters === undefined ||
      BY_SPELLING.has(raw) ||
      ![...letters].every((letter) => BY_SPELLING.has(`-${letter}`))
    ) {
      expanded.push(raw);
      continue;
    }

    for (const [position, letter] of [...letters].entries()) {
      const flag = BY_SPELLING.get(`-${letter}`);
      if (flag?.value && position < letters.length - 1) {
        return {
          ok: false,
          message: `${flag.name} takes a value, so -${letter} must come last in ${raw}.`,
        };
      }
      expanded.push(`-${letter}`);
    }
  }

  return expanded;
}

/**
 * Parses `argv` as the CLI sees it, without the node and script entries.
 *
 * Unknown flags are an error rather than positional text: a mistyped `--quite`
 * silently becoming the clip you send is the kind of thing you only notice on
 * the other device. So is a known flag given to a command it means nothing to
 * — silently ignoring one would let `cliplink send --prune` look like it had
 * pruned something.
 */
export function parseArgs(rawArgv: string[], env: Env = {}): ParseResult {
  const expanded = expandClusters(rawArgv);
  if (!Array.isArray(expanded)) {
    return expanded;
  }
  const argv = expanded;

  const args: ParsedArgs = {
    command: "help",
    text: "",
    room: env.CLIPLINK_ROOM ?? null,
    key: env.CLIPLINK_ROOM_KEY ?? null,
    open: false,
    save: false,
    code: null,
    passphrase: env.CLIPLINK_PASSPHRASE || null,
    askPassphrase: false,
    name: null,
    burn: false,
    one: false,
    json: false,
    last: null,
    all: false,
    timeoutSeconds: null,
    sendOnly: false,
    recvOnly: false,
    quiet: false,
    // https://no-color.org: set to anything non-empty, and colour is off.
    color: (env.NO_COLOR ?? "") === "",
    ttlSeconds: null,
    baseUrl: env.CLIPLINK_URL ?? DEFAULT_BASE_URL,
    forget: null,
    forgetAll: false,
    prune: false,
    showKeys: false,
    codes: false,
    shell: null,
  };

  const positional: string[] = [];
  let command: Command | null = null;
  /** The flags given on the command line, in order, by their canonical name. */
  const given: FlagSpec[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    // `--` ends flag parsing, so a clip may begin with a dash.
    if (raw === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (raw.startsWith("-") && raw !== "-") {
      const eq = raw.indexOf("=");
      const spelling = eq === -1 ? raw : raw.slice(0, eq);
      const inline = eq === -1 ? null : raw.slice(eq + 1);
      const flag = BY_SPELLING.get(spelling);

      if (!flag) {
        return { ok: false, message: `Unknown option ${spelling}.` };
      }
      if (flag.settles) {
        return { ok: true, args: { ...args, command: flag.settles } };
      }

      let value = "";
      if (flag.value) {
        const next = inline ?? argv[++index];
        if (next === undefined) {
          return { ok: false, message: `${flag.name} needs a value.` };
        }
        value = next;
      } else if (inline !== null) {
        return { ok: false, message: `${flag.name} does not take a value.` };
      }

      const error = flag.set?.(args, value);
      if (typeof error === "string") {
        return { ok: false, message: error };
      }
      given.push(flag);
      continue;
    }

    if (command === null && isCommand(raw)) {
      command = raw;
      continue;
    }

    positional.push(raw);
  }

  if (command === null) {
    return {
      ok: false,
      message: `Expected a command: ${list(
        COMMANDS.map((entry) => entry.name),
        "or",
      )}.`,
    };
  }

  args.command = command;
  args.text = positional.join(" ");

  const misplaced = given.find(
    (flag) => flag.commands && !flag.commands.includes(command),
  );
  if (misplaced?.commands) {
    return {
      ok: false,
      message: `${misplaced.name} applies to ${list(misplaced.commands)}, not ${command}.`,
    };
  }

  /** Whether the room was named on the command line or came from the environment. */
  const roomFromFlag = given.some((flag) => flag.name === "--room");

  if (args.open && args.key) {
    return {
      ok: false,
      message: "--open derives the key from the room code, so --key cannot be given too.",
    };
  }
  const hasPassphrase = args.passphrase !== null || args.askPassphrase;
  if (args.open && hasPassphrase) {
    return {
      ok: false,
      message: "--open derives the key from the room code, so a passphrase cannot be given too.",
    };
  }
  if (args.key && hasPassphrase) {
    return {
      ok: false,
      message: "A room opens with its key or with a passphrase, not both.\nCheck --key, --passphrase, CLIPLINK_ROOM_KEY and CLIPLINK_PASSPHRASE.",
    };
  }
  if (args.open && args.save) {
    return {
      ok: false,
      message: "--open rooms have no key to save; the room code alone opens them.",
    };
  }
  if (args.last !== null && args.all) {
    return {
      ok: false,
      message: "--last takes a count and --all takes everything; pick one.",
    };
  }
  if (args.sendOnly && args.recvOnly) {
    return {
      ok: false,
      message: "--send-only and --recv-only together would do nothing; pick one.",
    };
  }
  if (args.forget !== null && args.forgetAll) {
    return {
      ok: false,
      message: "--forget names one room and --forget-all takes them all; pick one.",
    };
  }

  if (command === "completions") {
    if (!isShell(args.text)) {
      return {
        ok: false,
        message: args.text
          ? `No completions for "${args.text}". Pick one of ${SHELLS.join(", ")}.`
          : `completions needs a shell: ${SHELLS.join(", ")}.`,
      };
    }
    args.shell = args.text;
    args.text = "";
  } else if (command !== "send" && args.text) {
    return { ok: false, message: `${command} takes no text.` };
  }

  if ((command === "recv" || command === "link") && !args.room) {
    // link never creates a room. Minting one just to print its link would
    // leave a room on the server that nobody asked for.
    return {
      ok: false,
      message: `${command} needs a room: pass --room, or CLIPLINK_ROOM.`,
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

  if (args.code !== null && args.room) {
    return {
      ok: false,
      message: roomFromFlag
        ? "--code names a room being created, and this run joins one. Pass the code as --room to join it."
        : "--code names a room being created, and CLIPLINK_ROOM already names one to join. Unset it to create a room.",
    };
  }

  return { ok: true, args };
}
