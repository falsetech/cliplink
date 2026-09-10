# CLIPLINK — Product Requirements Document

**Version**: 1.6  
**Status**: M3 complete; M4 transport and P2P file transfer shipped  
**Author**: bkht  
**Date**: 2026-08-17  
**Last Updated**: 2026-08-17

---

## 1. Overview

CLIPLINK is a lightweight, zero-auth web service for syncing clipboard content across devices in real time. Users create a room, share a short code, and anything sent from one device is instantly available — and copied — on the other. No accounts, no install, no friction.

This PRD now reflects both the original product intent and the current implementation status in the deployed codebase.

---

## 2. Problem

Copying a URL, snippet, or chunk of text from one device to another is annoying. The common workarounds — emailing yourself, using Notes, texting yourself, AirDrop (Apple-only) — are all either slow, platform-locked, or require effort disproportionate to the task. There is no fast, universal, open-in-browser solution.

---

## 3. Goals

- Sync clipboard content between any two (or more) devices in under 500ms
- Require zero sign-up, zero install
- Work on any device with a modern browser
- Be shareable via a link or a 6-character room code

### Non-goals (v1)

- End-to-end encryption (planned for v2)
- File/image transfer
- Persistent history across sessions
- Mobile native apps

---

## 4. Users

**Primary**: Developers, power users, and anyone who regularly works across multiple devices (laptop + phone, two laptops, desktop + tablet).

**Secondary**: Anyone sharing a link or snippet with someone else in the same physical space — a fast, frictionless alternative to "just send it to me on Slack."

---

## 5. User Stories

| #   | Story                                                                               |
| --- | ----------------------------------------------------------------------------------- |
| 1   | As a user, I can create a new room instantly without signing up                     |
| 2   | As a user, I can join a room by entering a 6-character code                         |
| 3   | As a user, I can join a room by opening a shared URL                                |
| 4   | As a user, content I send is immediately available on all other devices in the room |
| 5   | As a user, incoming content is automatically copied to my clipboard                 |
| 6   | As a user, I can see a history of clips sent in the current session                 |
| 7   | As a user, I can copy any previous clip from history with one click                 |
| 8   | As a user, I can share the room link directly from within the app                   |

---

## 6. Features

### 6.0 Current Implementation Status

Implemented and deployed:

- Landing screen with create-room and join-by-code flows
- Room entry via `?room=XXXXXX`
- Room header with always-visible room code badge
- Text editor with live character count
- Send via button and `Cmd/Ctrl + Enter`
- "Paste from device" clipboard read action
- History list with `↑ OUT` / `↓ IN`, timestamps, preview, and one-click copy
- Toast notifications and subtle full-screen receive flash
- HTTP polling transport as the realtime fallback
- API routes for room creation, room fetch, clip creation, and polling
- Session-local sender identity and session-local visible history
- Atomic per-IP clip rate limiting via Upstash Redis (fails open on Redis errors)
- Vercel deployment, no custom adapter required
- Upstash Redis-backed room storage in production (hash + sorted set per room)
- WebSocket realtime transport backed by Upstash Redis pub/sub, with polling fallback and reconnect/backoff behavior
- QR code sharing from the room view
- Mobile-responsive landing and room layouts
- Configurable per-room TTL (1h–24h bounds, 6h default)
- Custom domain support (ops step via `vercel domains add`)
- Peer-to-peer file transfer over WebRTC data channels (see §6.6, §7.6) — files are never uploaded or stored

Not yet implemented:

- End-to-end encryption for text clips

### 6.1 Rooms

- Rooms are identified by a randomly generated 6-character alphanumeric code (e.g. `X7KP2M`)
- Rooms are ephemeral; server-side room state is designed to expire automatically after inactivity
- Any number of devices can join the same room
- No authentication required to create or join a room
- Rooms are accessible via `cliplink.app/?room=X7KP2M`

### 6.2 Send

- Users type or paste content into the editor
- Clicking **Send** (or pressing `Cmd/Ctrl + Enter`) broadcasts the clip to all peers in the room
- A "Paste from device" button pulls current clipboard content into the editor
- Character count is shown live

### 6.3 Receive

- Incoming clips are displayed in the history panel with direction indicator (↓ IN) and timestamp
- The latest incoming clip is automatically copied to the device clipboard (with browser permission)
- A subtle full-screen flash and toast notification confirms receipt
- History is limited to the last 20 clips in the current session
- If clipboard write is blocked, the clip still appears in history and manual copy remains available

### 6.4 History

- Each clip shows: direction (IN / OUT), timestamp, truncated preview, and a one-click copy button
- History is local to the session — cleared on page reload or room leave
- Outgoing clips are marked ↑ OUT; incoming are marked ↓ IN
- Visible history is capped to 20 items; stored room history is capped to 50 clips

### 6.5 Sharing

- Room code is always visible and clickable to copy the room link
- Shareable URL format: `cliplink.app/?room=XXXXXX`
- In-room QR code sharing is available for handoff between devices
- Visiting the URL directly drops the user into the room

### 6.6 Files

- Share any file type (zip included) up to 500 MB via the Attach button, drag and drop onto the clipboard panel, or pasting a file/image with `Cmd/Ctrl + V`; multiple files become separate offers
- Sharing is an *offer*: every device in the room sees the file's name and size and chooses to Download; devices that join later still see open offers
- An offer is available only while the sender's tab is open — closing it, leaving the room, or "Stop sharing" withdraws it
- Received files are saved automatically when the download finishes; received images show an inline thumbnail and can be saved again
- File transfer requires the realtime (WebSocket) connection; on the polling fallback, Attach and Download are disabled
- The Files list is session-local, like clip history, and capped to 20 items

---

## 7. Technical Architecture

### 7.1 Frontend

- Next.js 16 App Router application
- Interactive room experience implemented as a client component
- Navigator Clipboard API for auto-copy on receive
- WebSocket is the primary realtime transport in the deployed app
- HTTP polling remains in place as the fallback transport and compatibility layer
- The `TransportClient` abstraction let WebSockets replace SSE without any change to the room UI's retry/backoff/fallback state machine — same pattern that will apply to any future transport swap
- M0 prototype remains in `prototype.html` as the original single-file reference

### 7.2 Backend

| Layer     | Current implementation           | Notes                                       |
| --------- | --------------------------------- | -------------------------------------------- |
| Runtime   | Next.js App Router on Vercel      | No custom adapter needed                    |
| Storage   | Upstash Redis in production       | In-memory fallback remains for local/dev    |
| Transport | WebSocket with polling fallback   | Cross-instance fanout via Redis pub/sub     |
| Hosting   | Vercel deployment                 | Standard Next.js build/output               |

### 7.3 Data Model

Per room `code`, two Redis keys:

```ts
// room:<code>:meta — hash
type RoomMeta = {
  code: string;
  createdAt: number;
  ttlSeconds: number; // configurable per room, 1h–24h bounds
};

// room:<code>:clips — sorted set, member = JSON-serialized Clip, score = clip.id
type Clip = {
  id: number; // timestamp-based
  text: string;
  senderId: string; // anonymous random ID per session
  ts: number;
};
```

Room TTL defaults to **6 hours**, configurable per room between 1h and 24h, applied via native Redis `EXPIRE`/`PEXPIRE`. TTL is refreshed on write (`appendClip`/`touchRoom`), not on every read — an open tab passively polling no longer keeps a room alive indefinitely, unlike the prior KV-backed implementation. Clips capped at 50 per room via `ZREMRANGEBYRANK` on each append.

### 7.4 API Routes

| Method | Route                          | Description                                    |
| ------ | ------------------------------ | ----------------------------------------------- |
| `POST` | `/rooms`                       | Create a new room, returns `{ code, ttlSeconds }`, optional `ttlSeconds` body |
| `GET`  | `/rooms/:code`                 | Get room data                                   |
| `POST` | `/rooms/:code/clips`           | Send a new clip, publishes to the room's pub/sub channel |
| `GET`  | `/rooms/:code/clips?after=:id` | Poll for new clips since `id`                   |
| `GET`  | `/rooms/:code/socket?peer=:id` | WebSocket upgrade for realtime clip delivery and file-transfer signaling |

All routes implemented. The prior SSE route (`GET /rooms/:code/stream`) has been removed — WebSocket now covers "fast," polling covers "fallback."

### 7.5 Transport

The client interface (`TransportClient`) is unchanged across every stage — only the underlying connection mechanism changes.

```
M1  →  HTTP polling      (1.5s interval, stateless Workers + KV)          [superseded]
M2  →  SSE               (real-time push, stateless Workers + KV)         [superseded]
M3+ →  WebSocket + pub/sub (Vercel Functions + Upstash Redis pub/sub)     [current]
```

#### Current — WebSocket + Redis pub/sub

`GET /rooms/:code/socket` upgrades to a WebSocket via `@vercel/functions`' `experimental_upgradeWebSocket`. Vercel Functions have no instance affinity across connections — a WS held by one instance won't see a clip POSTed to another — so cross-instance fanout goes through an Upstash Redis pub/sub channel per room (`room:<code>:events`), published on every successful clip POST.

```ts
// clip POST handler, after storage.appendClip succeeds
await publishClip(code, clip);
```

The socket route subscribes to the room's channel *before* fetching backlog (buffering anything that arrives mid-fetch), then flushes backlog followed by buffered live messages, deduped by clip id — avoiding the gap where a clip published between backlog-read and subscribe would otherwise be lost.

```ts
// app/rooms/[code]/socket/route.ts sketch
return experimental_upgradeWebSocket((ws) => {
  const unsubscribe = subscribeRoom(code, (clip) => sendIfNew(ws, clip));
  // ...fetch backlog, flush buffered, send { type: "ready" }
  ws.on("close", () => unsubscribe());
});
```

Latency: sub-100ms cross-device, since delivery is push-based rather than polled. Reconnects use exponential backoff (2s → 15s cap) with an immediate fall back to HTTP polling while retrying, handled entirely in the room UI's existing state machine — the transport itself just reports open/clip/disconnect via callbacks.

#### Superseded stages (M1 polling, M2 SSE)

Both prior stages ran on stateless Cloudflare Workers polling a KV-backed room blob internally (SSE polled storage every 250ms server-side to fake a push). That polling-over-KV design is what made the Cloudflare free tier's KV read quota (100k reads/day) the practical ceiling on concurrent open rooms — a single tab left open for an hour cost ~14,400 reads. The WebSocket + pub/sub design replaces internal polling with real push, eliminating that read volume entirely.

#### Comparison

|                 | Polling       | SSE (removed)  | WebSocket (current)      |
| --------------- | ------------- | -------------- | ------------------------- |
| Latency         | ~750ms avg    | ~200ms         | sub-100ms                 |
| Infrastructure  | Vercel + Redis| Vercel + Redis | Vercel + Redis (pub/sub)  |
| Complexity      | Low           | Medium         | Medium                    |
| Stateful server | No            | No             | No (state lives in Redis) |
| Full-duplex     | No            | No             | Yes                       |
| Browser support | Universal     | Universal      | Universal                 |
| Recommended for | Fallback only | —              | Primary transport         |

### 7.6 Peer-to-Peer File Transfer

File bytes travel browser-to-browser over WebRTC data channels (DTLS-encrypted). The server only relays small signaling messages and never sees, buffers, or stores file contents — there is no blob storage and nothing is written to Redis.

```
Sender ──WS──▶ /rooms/:code/socket ──publish──▶ Redis room:<code>:signal ──▶ Receiver's socket   (signaling, a few KB)
Sender ◀══════════════ RTCDataChannel (P2P) ══════════════▶ Receiver                              (file bytes)
```

- **Identity**: each page load picks a random `peerId`, sent as `?peer=` on the socket URL. The server stamps `from` on every relayed signal; clients cannot spoof another peer's id on the wire.
- **Signaling channel**: clients send `{ type: "signal", to?, payload }` over the room WebSocket. The server validates it (`parseClientMessage`: known type, bounded strings, `size ≤ 500 MB`), rate-limits per socket, and publishes it on `room:<code>:signal` — the same ioredis subscriber connection as clip events. Each socket forwards signals addressed to its peer (or broadcasts, excluding the sender). Without a Redis URL, a process-local `EventEmitter` fallback is used.
- **Protocol**: `hello` (on socket ready; peers reply with their open offers) → `file-offer` (metadata only) → `file-request` (receiver → sender) → `rtc-description` / `rtc-candidate` exchange → data channel. `file-revoke` withdraws an offer, `transfer-cancel` aborts a transfer, and a server-generated `peer-left` is published when a socket closes so receivers drop that peer's offers.
- **Transfer**: one `RTCPeerConnection` per (receiver, file). The sender streams 64 KiB chunks with `bufferedAmount` backpressure (4 MiB high / 1 MiB low), then `"done"`; the receiver verifies the byte count, assembles a `Blob` in memory, and replies `"ack"`. A transfer fails after 20 s without progress.
- **NAT traversal**: public STUN only (Google, Cloudflare). Roughly 10–20% of strict-NAT/corporate networks cannot connect directly and see a clear error. A TURN relay can be added without code changes via `NEXT_PUBLIC_ICE_SERVERS` (JSON `RTCIceServer[]`).
- **Implementation**: `lib/cliplink/file-transfer.ts` (framework-free manager), `components/cliplink/use-file-transfer.ts` (React state + object URL lifecycle), `components/cliplink/file-transfers.tsx` (Files list).

---

## 8. Security & Privacy

- Room codes are randomly generated with ~40 bits of entropy — guessing is not practical
- No user data is stored; `senderId` is a random string generated client-side per session
- Rooms and clips expire automatically via Redis TTL, configurable per room (1h–24h, 6h default)
- No logs retained beyond Vercel's default request logging
- HTTPS enforced at the edge
- Files are never uploaded or stored: bytes go peer-to-peer over DTLS-encrypted WebRTC data channels, and only ephemeral signaling passes through the server (never persisted). Receiving always requires an explicit Download click; peer-supplied file names are sanitized
- v2 consideration: optional end-to-end encryption using WebCrypto, key derived from room code + user passphrase
- Per-IP clip creation rate limiting is atomic (Upstash Redis sliding window via `@upstash/ratelimit`), fixing the earlier in-memory limiter's inconsistency across serverless instances; fails open (allows the request) if Redis is unreachable, prioritizing availability

---

## 9. Performance Targets

| Metric                               | Target                   | Transport |
| ------------------------------------ | ------------------------ | --------- |
| Clip delivery latency (same region)  | < 80ms                   | WebSocket |
| Clip delivery latency (cross-region) | < 150ms                  | WebSocket |
| Page load (cold)                     | < 1s on 3G               | —         |
| Function cold start                  | Low, via Vercel Fluid Compute instance reuse | — |
| Time to first room                   | < 3s including page load | —         |

---

## 10. UX Requirements

- No modals, no onboarding, no tooltips — the interface is self-evident
- One primary action per screen (Create Room on landing; Send on room view)
- Confirmation of all async actions via toast (never silent)
- Works without clipboard permission granted (manual copy fallback)
- Room code badge always visible, always one click to copy the link
- Mobile-responsive at all breakpoints

---

## 11. Milestones

| Milestone          | Scope                                                                        | Target  |
| ------------------ | ---------------------------------------------------------------------------- | ------- |
| **M0** — Prototype | Single HTML file, localStorage backend, cross-tab sync                       | Done    |
| **M1** — Alpha     | HTTP polling app flow, room APIs, deployable Cloudflare-backed MVP           | Complete |
| **M2** — Beta      | SSE for real-time push, mobile polish, QR code for room link                 | Complete |
| **M3** — Launch    | Custom domain, rate limiting, abuse protection, optional room expiry control | Complete |
| **M4** — v2        | WebSocket realtime transport, E2E encryption option, file/image support     | Transport and P2P file transfer done; E2E encryption remains |

M1 shipped:

- Product UI migrated from prototype into the Next app
- Polling-based room sync implemented
- API surface implemented
- Rate limiting implemented at a basic level
- Cloudflare KV bound in production
- OpenNext Cloudflare build/deploy pipeline working
- Real cross-device production behavior validated sufficiently to ship M1

M2 shipped:

- SSE stream endpoint added and deployed
- Client-side SSE subscription added with polling fallback and retry behavior
- QR code sharing added to the room view
- Mobile layout tightened for landing and in-room flows

M3 shipped (bundled with a migration off Cloudflare, and pulling M4's transport goal forward — see §7.5):

- Migrated storage from Cloudflare KV to Upstash Redis (hash + sorted set per room, native TTL)
- Migrated hosting from Cloudflare Workers/OpenNext to Vercel — no adapter, `wrangler`/`open-next` config removed
- Replaced the in-memory, isolate-broken rate limiter with an atomic Upstash Redis sliding-window limiter (`@upstash/ratelimit`), fail-open on Redis errors
- Added configurable per-room TTL (1h–24h bounds, 6h default)
- Custom domain supported via standard Vercel domain configuration
- WebSocket realtime transport (M4 goal, pulled forward) backed by Upstash Redis pub/sub, replacing SSE; the SSE route and its polling-over-KV internals are removed
- Storage error handling audited: Redis failures in the three REST routes now return a standardized `storage_unavailable` error instead of leaking a raw 500

---

## 12. Open Questions

- Should rooms support a passphrase for access control, or is code-based access sufficient for v1?
- Room TTL is now configurable (1h–24h, 6h default) — is 6h still the right *default*, or should production default to 24h? (Resolved: configurability shipped; the default value itself is still open.)
- Is the current default rate limit of 60 clips/min/IP sufficient in production?
- Should the room creator have any elevated permissions (e.g. ability to clear history)?
- Should `GET /rooms/:code` expose a computed `expiresAt`/remaining-TTL so the UI can show a countdown? Cheap to add (one Redis `TTL` command) but no UI currently consumes it.
- Should the deployed app keep the current local-session history behavior, or add optional room restore on reload later?

---

## 13. Out of Scope (v1)

- Accounts, authentication, or persistent history
- Server-side file storage or relaying (file transfer is peer-to-peer only)
- Syntax highlighting or rich text
- Mobile native apps (iOS / Android)
- End-to-end encryption
- Collaborative editing (not a doc editor)
