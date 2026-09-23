# cliplink — the CLI

Cross-device clipboard, from the terminal. Pipe something into a room and it
appears — and is copied — on every other device in that room.

The `cliplink` binary ships with [`@thebkht/cliplink`](./README.md), the same
package that holds the protocol, so there is one thing to install and one
implementation of the encryption behind it.

```bash
npm install -g @thebkht/cliplink
```

```bash
git log -1 | cliplink send
```

That creates a room, sends the text, and prints a link and a QR code. Scan it
and the clip is on your phone. No account, no install on the other device.

## Usage

```
cliplink send [text]        Send a clip. With no text, reads stdin.
cliplink recv               Print clips as they arrive, until Ctrl-C.
cliplink rooms              List the rooms --save has kept.
cliplink link               Print the share link and QR for a room.
```

| Option | |
| --- | --- |
| `-r, --room <code\|url>` | Room to join. A full room link works too. |
| `-k, --key <key\|url>` | Room key. See [Keys](#keys). |
| `--open` | Room with no key of its own: the code opens it. |
| `--save` | Remember this room and key in the config file. |
| `--ttl <seconds>` | Lifetime of a room being created (3600–86400). |
| `-1, --one` | `recv`: print the next clip, then exit. |
| `--json` | `recv`: print each clip as a JSON object. |
| `--last <n>` | `recv`: replay the last n clips before listening. |
| `--all` | `recv`: replay every clip the room still holds. |
| `--timeout <secs>` | `recv`: give up after this long. Exits 1 if no clip arrived. |
| `--forget <code>` | `rooms`: forget one saved room. |
| `--forget-all` | `rooms`: forget every saved room. |
| `--prune` | `rooms`: drop the rooms that have expired. |
| `--show-keys` | `rooms`: print the saved keys, withheld by default. |
| `-q, --quiet` | Suppress commentary on stderr. |
| `--no-color` | Draw the QR without colour. |
| `--url <origin>` | Deployment to talk to. |

Short flags cluster, so `-q1` is `-q -1`. A flag that takes a value comes last.

Environment: `CLIPLINK_ROOM`, `CLIPLINK_ROOM_KEY`, `CLIPLINK_URL`,
`CLIPLINK_CONFIG_DIR`, `NO_COLOR`.

## stdout is the data channel

Clip text goes to stdout. Everything else — room codes, the QR, status,
errors — goes to stderr. So this copies the clip and nothing else:

```bash
cliplink recv --room X7KP2M --one | pbcopy
```

The QR is printed only when stderr is a terminal, so it never lands in a file.

`cliplink link` and `cliplink rooms` follow the same rule: the link, and the
listing, are what you asked for, so they go to stdout and can be piped. Under
`--json`, `recv` writes one JSON object per line — `id`, `text`, `senderId`,
`ts` — still on stdout, still nothing else.

## Keys

Rooms are end-to-end encrypted. The server stores ciphertext and never holds
the key, so joining a room means supplying it. In order of preference:

| | Where the key lives |
| --- | --- |
| Let the CLI create the room | Process memory and your scrollback. Nothing at rest. |
| `CLIPLINK_ROOM_KEY=…` | The process environment. |
| `--save`, then rejoin by code | `~/.config/cliplink/rooms.json`, mode `0600`. |
| `--key <key>` | Shell history, and visible in `ps`. |

Creating the room is the default for a reason: it is the only path where the
key is never handed across a boundary at all. `--save` is the one thing here
that writes a key to disk, and it does so only when you ask, per run.

`--open` rooms derive their key from the room code. The server sees the code,
so those are encrypted at rest but **not** end-to-end.

`cliplink rooms` lists what `--save` has kept — code, origin, age — but
withholds the keys unless `--show-keys` asks for them, so reminding yourself of
a room code does not put key material into your scrollback. `--forget` and
`--forget-all` remove entries; forgetting them all removes the file rather than
leaving an empty one behind.

## Examples

```bash
# Create a room, send, print a QR for the phone
pbpaste | cliplink send

# Keep the room so later runs need only the code
cliplink send "note to self" --save
cliplink send "and another" --room X7KP2M

# Wait for one clip from the phone and put it on the clipboard
cliplink recv --room X7KP2M --one | pbcopy

# Follow a room
cliplink recv --room X7KP2M | tee -a clips.log

# Catch up on what the room already holds, then keep following
cliplink recv --room X7KP2M --all

# Wait, but not forever: exits 1 if nothing arrived
cliplink recv --room X7KP2M --one --timeout 30 | pbcopy

# Script against the clip metadata, not just the text
cliplink recv --room X7KP2M --json | jq -r '.senderId'

# Show the link and QR again for a room you already have
cliplink link --room X7KP2M

# See what is saved, and drop what has expired
cliplink rooms --prune
```

## What it does not do

**Files.** In the browser they travel peer-to-peer over WebRTC data channels.
Node has no WebRTC without a native dependency, and these packages carry none.

## How it works

It speaks the same wire protocol as the web app, through the same code — the
[library half](./README.md) of this package, which holds the encryption, the
room types and both transports. A clip is sealed with AES-GCM-256 before it
leaves the process, and the realtime socket falls back to polling exactly as
the browser does.

## License

[MIT](./LICENSE) © Bakhtiyor Ganijon
