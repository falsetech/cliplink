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
cliplink watch              Sync this machine's clipboard with a room.
cliplink rooms              List the rooms --save has kept.
cliplink link               Print the share link and QR for a room.
cliplink completions <shell>  Print a completion script: bash, zsh, fish.
```

| Option | |
| --- | --- |
| `-r, --room <code\|url>` | Room to join. A full room link works too. |
| `-k, --key <key\|url>` | Room key. See [Keys](#keys). |
| `--passphrase` | Ask for a passphrase to use as the room key (12+ characters). See [Keys](#keys). |
| `--open` | Room with no key of its own: the code opens it. |
| `--save` | Remember this room and key in the config file. |
| `--code <code>` | `send`, `watch`: code to claim for a room being created (6–16 letters and digits). |
| `--ttl <seconds>` | `send`, `watch`: lifetime of a room being created (3600–86400). |
| `--name <name>` | `send`, `watch`: the name clips are shown under. Default is the hostname. |
| `--burn` | `send`: a one-time clip, deleted once another device reads it. |
| `-1, --one` | `recv`: print the next clip, then exit. |
| `--json` | `recv`: print each clip as a JSON object. |
| `--last <n>` | `recv`: replay the last n clips before listening. |
| `--all` | `recv`: replay every clip the room still holds. |
| `--timeout <secs>` | `recv`: give up after this long. Exits 1 if no clip arrived. |
| `--send-only` | `watch`: send what is copied here; write nothing to this clipboard. |
| `--recv-only` | `watch`: copy what arrives; send nothing from this clipboard. |
| `--forget <code>` | `rooms`: forget one saved room. |
| `--forget-all` | `rooms`: forget every saved room. |
| `--prune` | `rooms`: drop the rooms that have expired. |
| `--show-keys` | `rooms`: print the saved keys, withheld by default. |
| `--codes` | `rooms`: print only the saved codes, one per line. |
| `-q, --quiet` | Suppress commentary on stderr. |
| `--no-color` | Draw the QR without colour. |
| `--url <origin>` | Deployment to talk to. |

Short flags cluster, so `-q1` is `-q -1`. A flag that takes a value comes last.
A flag given to a command it means nothing to is an error, not ignored.

Environment: `CLIPLINK_ROOM`, `CLIPLINK_ROOM_KEY`, `CLIPLINK_PASSPHRASE`, `CLIPLINK_URL`,
`CLIPLINK_CONFIG_DIR`, `NO_COLOR`.

## watch

`cliplink watch` keeps the system clipboard and a room in step until Ctrl-C:
what you copy here is sent, and what arrives is copied here. With no `--room`
it creates one and prints the link and QR, as `send` does.

- It talks to the clipboard through the platform's own tools: `pbcopy` and
  `pbpaste` on macOS; `wl-copy` and `wl-paste` under Wayland; `xclip` or
  `xsel` under X; PowerShell on Windows and under WSL. Without one it says
  what to install and exits 1, before touching a room.
- What is on the clipboard when it starts is not sent. Only a change is.
- It does not send back a clip it has just copied, and skips its own clips
  when the room relays them.
- A one-time clip is deleted once it has been copied, as `recv` deletes one
  it prints.
- The clipboard is read twice a second. A copy larger than the clip limit is
  skipped with a warning.

## Shell completions

```bash
# bash, in ~/.bashrc
source <(cliplink completions bash)

# zsh: save it on $fpath…
cliplink completions zsh > ~/.zfunc/_cliplink
# …or, after compinit in ~/.zshrc
source <(cliplink completions zsh)

# fish
cliplink completions fish > ~/.config/fish/completions/cliplink.fish
```

`--room` and `--forget` complete from the rooms `--save` has kept, through
`cliplink rooms --codes`. Keys are never offered.

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
`ts`, `name` when the clip says who sent it, and `burn` on a one-time clip —
still on stdout, still nothing else.

A one-time clip is deleted from the room once `recv` has printed it: printing
it is reading it. `cliplink send --burn "$(pass show wifi)"` on one machine and
`cliplink recv -r X7KP2M --one | pbcopy` on the other leaves nothing behind.

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

### Passphrases

A room can instead take its key from a passphrase, so that it opens anywhere
from two things a person can remember — the code and the passphrase — with no
link or key to carry across:

```sh
cliplink watch --code MYDESK --passphrase   # asks twice, creates MYDESK
cliplink recv -r MYDESK --passphrase        # asks once, joins it
```

`--passphrase` asks on the terminal and never takes a value, so the passphrase
stays out of shell history and `ps`; for scripts, set `CLIPLINK_PASSPHRASE`.
With no `--code`, a random code is chosen as usual. The passphrase is case
sensitive and needs at least 12 characters.

The key is stretched from the passphrase with PBKDF2-SHA-256 (600 000 rounds)
salted with the room code. The server still never sees it, but it does hold
the key's fingerprint, against which someone with the server's data could test
guesses offline. A passphrase room is exactly as strong as its passphrase:
use several unrelated words. A generated key has no such weakness.

`--code` works for an `--open` room too, but there the code is the key: a code
you can remember is one someone else can guess, and whoever guesses it reads
the room.

A saved room is identified by its code *and* the server it was saved against,
so a room code held for a local dev server is never matched against the same
code on a deployment. `--forget` takes a code alone and so forgets it on every
server it was saved for.

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

# Share this machine's clipboard with a new room
cliplink watch

# Only take clips from the room, never send this clipboard
cliplink watch --room X7KP2M --recv-only

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
