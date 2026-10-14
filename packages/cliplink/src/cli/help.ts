import { COMMANDS, FLAGS, type FlagSpec } from "./args.ts";

/** Where every description starts, so the column lines up. */
const DESCRIPTION_COLUMN = 26;

function usage() {
  const listed = COMMANDS.flatMap((command) =>
    command.usage === null ? [] : [{ ...command, usage: `cliplink ${command.usage}` }],
  );
  const width = Math.max(...listed.map((command) => command.usage.length)) + 2;
  return listed
    .map((command) => `  ${command.usage.padEnd(width)}${command.summary}`)
    .join("\n");
}

/**
 * One flag's lines. A flag meant for some commands only says which, unless it
 * belongs to every command that resolves a room, which is most of them and
 * would make the list harder to scan than it is to explain once.
 */
function option(flag: FlagSpec) {
  const spelling = `${flag.short ? `${flag.short}, ` : "    "}${flag.name}${
    flag.value ? ` ${flag.value}` : ""
  }`;
  const scope =
    flag.commands && flag.commands.length < 4 ? `${flag.commands.join(", ")}: ` : "";
  // Scoped, the description reads as the rest of a sentence: "recv: print…".
  const help = scope ? `${flag.help[0].toLowerCase()}${flag.help.slice(1)}` : flag.help;
  const [first, ...rest] = `${scope}${help}`.split("\n");
  const indent = " ".repeat(DESCRIPTION_COLUMN);
  return [
    `  ${spelling.padEnd(DESCRIPTION_COLUMN - 2)}${first}`,
    ...rest.map((line) => `${indent}${line}`),
  ].join("\n");
}

export const HELP = `cliplink — cross-device clipboard, from the terminal

USAGE
${usage()}

  With no --room, send and watch create a room and print a link and QR
  code for the other device. That is the path that leaves no key anywhere.

OPTIONS
${FLAGS.map(option).join("\n")}

KEYS
  Rooms are end-to-end encrypted. The server stores ciphertext and never
  holds the key, so joining a room means supplying it. In order of
  preference:

    1. Let the CLI create the room     nothing to supply, nothing at rest
    2. CLIPLINK_ROOM_KEY=…             scoped to the process
    3. --save, then rejoin by code     ~/.config/cliplink/rooms.json, 0600
    4. --key <key>                     lands in shell history and ps

  --open rooms derive their key from the room code. The server sees the
  code, so those are encrypted at rest but NOT end-to-end.

ENVIRONMENT
  CLIPLINK_ROOM        Default --room
  CLIPLINK_ROOM_KEY    Default --key
  CLIPLINK_URL         Default --url
  CLIPLINK_CONFIG_DIR  Overrides where --save writes
  NO_COLOR             Set to anything: same as --no-color

EXAMPLES
  git log -1 | cliplink send              create a room, send, print a QR
  cliplink send "note to self" --save     keep the room for later
  cliplink recv -r X7KP2M --one | pbcopy  wait for one clip, copy it
  cliplink recv -r X7KP2M -1 --timeout 30 wait, but not forever
  cliplink recv -r X7KP2M                 follow the room until Ctrl-C
  cliplink recv -r X7KP2M --json          one JSON object per clip
  cliplink recv -r X7KP2M --all           everything the room still holds
  cliplink watch                          share this clipboard with a new room
  cliplink watch -r X7KP2M --recv-only    copy what arrives, send nothing
  cliplink link -r X7KP2M                 re-show the link and QR for a room
  cliplink rooms --prune                  list saved rooms, dropping dead ones
  cliplink completions zsh > ~/.zfunc/_cliplink   install zsh completions

  Only clip text goes to stdout, so a pipe gets the clip and nothing else.

Files are not supported here: they travel peer-to-peer over WebRTC in the
browser, which needs a native dependency this CLI does not carry.
`;
