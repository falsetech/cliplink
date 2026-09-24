import { DEFAULT_BASE_URL } from "./args.ts";

export const HELP = `cliplink — cross-device clipboard, from the terminal

USAGE
  cliplink send [text]        Send a clip. With no text, reads stdin.
  cliplink recv               Print clips as they arrive, until Ctrl-C.
  cliplink rooms              List the rooms --save has kept.
  cliplink link               Print the share link and QR for a room.

  With no --room, send creates a room and prints a link and QR code for
  the other device. That is the path that leaves no key anywhere.

OPTIONS
  -r, --room <code|url>   Room to join. A full room link works too.
  -k, --key <key|url>     Room key. See KEYS below.
      --open              Room with no key of its own: the code opens it.
      --save              Remember this room and key in the config file.
      --ttl <seconds>     Lifetime of a room being created (3600–86400).
  -1, --one               recv: print the next clip, then exit.
      --json              recv: print each clip as a JSON object.
      --last <n>          recv: replay the last n clips before listening.
      --all               recv: replay every clip the room still holds.
      --timeout <secs>    recv: give up after this long. Exits 1 if no
                          clip arrived, so a script can tell.
  -q, --quiet             Suppress commentary on stderr.
      --no-color          Draw the QR without colour. See NO_COLOR.
      --forget <code>     rooms: forget one saved room.
      --forget-all        rooms: forget every saved room.
      --prune             rooms: drop the rooms that have expired.
      --show-keys         rooms: print the saved keys, withheld by default.
      --url <origin>      Deployment to talk to.
                          Default ${DEFAULT_BASE_URL}
  -h, --help              This text.
  -v, --version           Version.

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
  cliplink link -r X7KP2M                 re-show the link and QR for a room
  cliplink rooms --prune                  list saved rooms, dropping dead ones

  Only clip text goes to stdout, so a pipe gets the clip and nothing else.

Files are not supported here: they travel peer-to-peer over WebRTC in the
browser, which needs a native dependency this CLI does not carry.
`;
