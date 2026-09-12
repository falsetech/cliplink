This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLIPLINK is a zero-auth, ephemeral cross-device clipboard: create a room, share a 6-character code, and text sent from one device appears — and is auto-copied — on every other device in the room. Files move peer-to-peer over WebRTC and never touch the server.

Read [`AGENTS.md`](AGENTS.md) first: **this is Next.js 16, which has breaking changes from what is likely in your training data.** Consult `node_modules/next/dist/docs/` before writing framework code.

## Commands

```bash
pnpm dev          # dev server
pnpm build        # next build --webpack
pnpm start        # serve the production build
pnpm lint         # eslint
pnpm lint:fix     # eslint --fix
pnpm type-check   # tsc --noEmit
```

pnpm is the package manager — do not create a `package-lock.json`. There is **no test suite**; do not invent `pnpm test` or `pnpm format`. CI runs lint, type-check, and build.

## Architecture

```
app/                      App Router: pages + API routes
  layout.tsx              Root layout, metadata, theme provider
  page.tsx                Landing + room entry
  manifest.json           PWA manifest
  rooms/route.ts          POST — create room
  rooms/[code]/route.ts   GET — fetch room
  rooms/[code]/clips/     POST — send clip; GET — poll clips after id
  rooms/[code]/socket/    GET — WebSocket upgrade (clips + WebRTC signaling)
components/
  cliplink-app.tsx        The room experience (client component)
  cliplink/               File transfer UI and hooks
lib/cliplink/             All domain logic
lib/utils.ts              cn() — clsx + tailwind-merge
```

There is **no** `src/`, `hooks/`, `store/`, or `server/` directory.

### `lib/cliplink/`

| File | Responsibility |
| --- | --- |
| `types.ts` | Shared types, including the `TransportClient` interface |
| `constants.ts` | Every limit and timing value — TTLs, caps, chunk sizes, ICE defaults |
| `storage.ts` | Room/clip persistence behind a `StorageAdapter`; Redis or in-memory |
| `redis.ts` | Upstash REST client, returns `null` when unconfigured |
| `pubsub.ts` | `ioredis` pub/sub fan-out, with a process-local `EventEmitter` fallback |
| `ws.ts` | WebSocket transport implementation |
| `http.ts` | Polling transport implementation and the shared fetch helpers |
| `file-transfer.ts` | WebRTC offer/accept, chunking, backpressure, stall detection |
| `rate-limit.ts` | Atomic per-IP limiting via `@upstash/ratelimit`; fails open |
| `validation.ts` | Input validation — hand-written, **not** Zod |
| `room-code.ts`, `session.ts`, `clipboard.ts`, `format.ts`, `errors.ts` | Focused helpers |

### Things that are easy to get wrong

- **Two transports, one interface.** WebSocket is primary, polling is the fallback; both implement `TransportClient` so the UI's retry/backoff state machine is written once. Changes to connection behavior belong behind that interface, not in the component.
- **Everything degrades without credentials.** `getRedis()` returns `null` and storage falls back to memory; pub/sub falls back to a process-local bus. The app must always boot and work single-process with no env file — this is the documented contributor path. Never introduce a hard requirement on an env var.
- **Files never reach the server.** The socket route relays signaling envelopes only. Any change that buffers or proxies file bytes server-side is a design violation.
- **TTL is refreshed on write, not on read.** `appendClip` and `touchRoom` extend a room's life; polling must not. This was a deliberate fix — do not reintroduce read-side refresh.
- **Rate limiting fails open** by design. Preserve that on Redis errors.
- **No env var may be required at build time.** CI builds with no credentials at all.

### Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS v4 · Upstash Redis (`@upstash/redis`, `@upstash/ratelimit`) · `ioredis` for pub/sub · `ws` · `next-themes` · WebRTC data channels.

There is **no** Prisma, NextAuth, Vercel AI SDK, or Zod in this project. Do not add a dependency for something the codebase already does by hand.

## Conventions

- TypeScript throughout; no new `any`.
- Tailwind utility classes, canonical names, no arbitrary values where a token exists.
- Shared logic in `lib/cliplink/`, UI in `components/`, routes in `app/`.
- Commit messages: imperative subject, no `Co-Authored-By` trailers.
- Run `pnpm lint && pnpm type-check && pnpm build` before declaring work done.
