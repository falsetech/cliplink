<div align="center">

# CLIPLINK

**Copy here. Paste anywhere.** Fast cross-device clipboard sync — no account, no install.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/thebkht/cliplink/actions/workflows/ci.yml/badge.svg)](https://github.com/thebkht/cliplink/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)

[**Live demo → cliplink.thebkht.com**](https://cliplink.thebkht.com)

<img src="public/og.png" alt="CLIPLINK" width="720">

</div>

---

## Why

Moving a URL, a snippet, or a file from your laptop to your phone is still solved badly. AirDrop is Apple-only. Nearby Share is Android-only. Everything genuinely cross-platform means emailing yourself, DMing yourself on Slack, or uploading to someone else's cloud.

CLIPLINK is the browser-native answer. Open a page, get a 6-character room code, share it with your other device — anything you send appears there instantly and is copied to the clipboard automatically.

Nothing persists. Rooms expire on a timer, history is session-local, and files never touch a server at all.

## Features

- **Zero auth, zero install** — create or join a room in one click, in any modern browser
- **Join three ways** — 6-character code, shared URL (`/?room=X7KP2M`), or in-room QR code
- **Realtime text sync** — WebSocket transport, with HTTP polling as an automatic fallback
- **Auto-copy on receive** — incoming clips land on your clipboard, with a toast and a subtle flash
- **Session history** — last 20 clips with direction, timestamp, one-click copy, expand-in-place, and an Open action on link clips
- **Keyboard-first** — every room action has a binding; `?` shows the cheat sheet and `⌘K`/`Ctrl+K` opens the command palette
- **Know the state** — device count, a live expiry countdown, and a badge that says when you have dropped to the polling fallback
- **Peer-to-peer file transfer** — up to 500 MB per file over WebRTC data channels, via attach, drag-and-drop, or paste. Bytes flow browser-to-browser; the server only relays signaling
- **Ephemeral by design** — per-room TTL configurable from 1h to 24h (6h default), max 50 clips retained per room
- **Rate limited** — 60 requests per minute per IP, enforced atomically in Redis

Exact limits live in [`lib/cliplink/constants.ts`](lib/cliplink/constants.ts).

### Keyboard shortcuts

`⌘` is `Ctrl` on Windows and Linux.

| Keys | Action |
| --- | --- |
| `Enter` | Send the clip |
| `⇧Enter` / `⌘Enter` | New line instead of sending |
| `⌘K` | Command palette |
| `⌘⇧C` | Copy the latest received clip |
| `⌘⇧V` | Paste from device into the editor |
| `⌘⇧⌫` | Clear the editor (undoable) |
| `?` | This list |

These work anywhere. The rest need focus to be outside the compose box:

| Keys | Action |
| --- | --- |
| `E` or `/` | Focus the editor |
| `L` | Copy the room link |
| `Q` | Show the QR code |
| `A` | Attach files |
| `T` | Toggle the theme |
| `X` | Leave the room |
| `1`–`9` | Copy that history row |
| `Esc` | Close a sheet, cancel a pending Leave, or leave the editor |

Typing any other character with nothing focused starts a clip.

## Architecture

| Layer | Implementation |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Storage | Upstash Redis (hash + sorted set per room), in-memory fallback |
| Realtime | WebSocket primary, HTTP polling fallback |
| Fan-out | Redis pub/sub via `ioredis`, process-local `EventEmitter` fallback |
| Files | WebRTC data channels, peer-to-peer |
| Hosting | Vercel — stock Next.js build, no custom adapter |

Two things here are worth reading even if you never run CLIPLINK:

**The transport abstraction.** Both realtime transports implement one `TransportClient` interface ([`lib/cliplink/types.ts`](lib/cliplink/types.ts)), so the room UI's retry/backoff/fallback state machine is written once. WebSockets ([`lib/cliplink/ws.ts`](lib/cliplink/ws.ts)) replaced an earlier SSE implementation without the UI changing at all; polling ([`lib/cliplink/http.ts`](lib/cliplink/http.ts)) remains the fallback. Running WebSockets on Vercel Functions is documented thinly elsewhere — this is a complete working example.

**Server-free file transfer.** [`lib/cliplink/file-transfer.ts`](lib/cliplink/file-transfer.ts) implements offer/accept, chunking with backpressure, stall detection, and withdrawal over raw WebRTC data channels — no TURN-dependent SaaS in the middle.

The API surface is four routes: `POST /rooms` (create), `GET /rooms/:code` (fetch), `POST|GET /rooms/:code/clips` (send / poll after id), and `GET /rooms/:code/socket` (WebSocket upgrade for clips and signaling).

## Getting started

**No Redis and no Vercel account are required.** Without credentials the app falls back to an in-memory store and a process-local event bus, which is enough to develop against and to sync between two tabs on one machine.

```bash
git clone https://github.com/thebkht/cliplink.git
cd cliplink
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

Requires Node.js >= 20.9 and [pnpm](https://pnpm.io). The fallback is single-process only — state is lost on restart and is not shared across instances, so for the full experience (cross-instance fan-out, atomic rate limiting) provision Redis as below.

## Environment variables

Every variable is optional. Copy [`.env.example`](.env.example) to `.env.local` and fill in what you need.

| Variable | Purpose | If unset |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Room + clip storage, rate limiting | In-memory store |
| `UPSTASH_REDIS_REST_TOKEN` | Same | In-memory store |
| `UPSTASH_REDIS_URL` | `rediss://` connection for pub/sub fan-out | Fan-out is process-local |
| `NEXT_PUBLIC_ICE_SERVERS` | JSON array of `RTCIceServer`; add a TURN relay for restrictive NATs | Public STUN servers |

Aliases are also accepted, so the Vercel Upstash integration works with no renaming: `KV_REST_API_URL` / `KV_REST_API_TOKEN` for the REST pair, and `REDIS_URL` / `KV_URL` for the pub/sub connection.

## Self-hosting

Provision an Upstash Redis database (the [Vercel Marketplace](https://vercel.com/marketplace) integration wires the variables up automatically), then:

```bash
vercel deploy
vercel domains add <your-domain>   # optional
```

It is a stock Next.js App Router build, so anywhere that runs Next.js 16 with WebSocket support will work.

## Roadmap

- **End-to-end encryption for clips** — clip text currently reaches Redis in plaintext; see [Security](SECURITY.md)
- **Test coverage** — none today, starting with the transport state machine and the file-transfer lifecycle
- **WebRTC reliability** across restrictive NATs

Have an idea? [Open an issue](https://github.com/thebkht/cliplink/issues/new/choose).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

For security issues, do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Bakhtiyor Ganijon
