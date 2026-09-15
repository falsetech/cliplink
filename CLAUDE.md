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

pnpm is the package manager — do not create a `package-lock.json`. The app has **no test suite**; do not invent a root `pnpm test` or `pnpm format`. The workspace package does: `pnpm -F @thebkht/rtc-file-transfer test` (Node test runner, no dependencies). CI runs the package tests and build, then lint, type-check, and build.

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
  cliplink/               Room UI, sheets and hooks
  ui/                     shadcn components (Base UI), restyled to Apple conventions
lib/cliplink/             All domain logic
lib/utils.ts              cn() — clsx + tailwind-merge
packages/
  rtc-file-transfer/      @thebkht/rtc-file-transfer — published to npm
```

There is **no** `src/`, `hooks/`, `store/`, or `server/` directory.

### `lib/cliplink/`

| File | Responsibility |
| --- | --- |
| `types.ts` | Shared types, including the `TransportClient` interface |
| `constants.ts` | App limits and timing — TTLs, caps, rate limits. File-transfer tuning lives in the package |
| `storage.ts` | Room/clip persistence behind a `StorageAdapter`; Redis or in-memory |
| `redis.ts` | Upstash REST client, returns `null` when unconfigured |
| `pubsub.ts` | `ioredis` pub/sub fan-out, with a process-local `EventEmitter` fallback |
| `ws.ts` | WebSocket transport implementation |
| `http.ts` | Polling transport implementation and the shared fetch helpers |
| `rate-limit.ts` | Atomic per-IP limiting via `@upstash/ratelimit`; fails open |
| `validation.ts` | Input validation — hand-written, **not** Zod |
| `room-code.ts`, `session.ts`, `clipboard.ts`, `format.ts`, `errors.ts` | Focused helpers |

### Things that are easy to get wrong

- **Two transports, one interface.** WebSocket is primary, polling is the fallback; both implement `TransportClient` so the UI's retry/backoff state machine is written once. Changes to connection behavior belong behind that interface, not in the component.
- **Everything degrades without credentials.** `getRedis()` returns `null` and storage falls back to memory; pub/sub falls back to a process-local bus. The app must always boot and work single-process with no env file — this is the documented contributor path. Never introduce a hard requirement on an env var.
- **File transfer is a published package.** WebRTC offer/accept, chunking, backpressure, and stall detection live in `packages/rtc-file-transfer`, consumed via `workspace:*`. Keep it free of cliplink specifics (env vars, toast copy, rooms) and runtime dependencies; the wire protocol is v1 and must stay compatible with deployed clients. Its `exports` point at `src/` in the workspace and are rewritten to `dist/` by `publishConfig` at publish time.
- **Files never reach the server.** The socket route relays signaling envelopes only. Any change that buffers or proxies file bytes server-side is a design violation.
- **TTL is refreshed on write, not on read.** `appendClip` and `touchRoom` extend a room's life; polling must not. This was a deliberate fix — do not reintroduce read-side refresh.
- **Rate limiting fails open** by design. Preserve that on Redis errors.
- **No env var may be required at build time.** CI builds with no credentials at all.

### Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS v4 · Upstash Redis (`@upstash/redis`, `@upstash/ratelimit`) · `ioredis` for pub/sub · `ws` · `next-themes` · shadcn/ui on Base UI (`@base-ui/react`), Sonner for toasts, `lucide-react` · WebRTC data channels.

There is **no** Prisma, NextAuth, Vercel AI SDK, or Zod in this project. Do not add a dependency for something the codebase already does by hand.

## Conventions

- TypeScript throughout; no new `any`.
- Tailwind utility classes, canonical names, no arbitrary values where a token exists.
- Colours are OKLCH tokens in `app/globals.css` on shadcn's names (`primary`, `muted-foreground`, …) plus `link`, `success` and `warning`. `--primary` is the filled-button blue; use `text-link` for blue text. The system font stack is deliberate — no web fonts.
- `shadcn` rewrites `lib/utils.ts` and imports `cn` from a package called `cn` on init/add; point imports back at `@/lib/utils`.
- Shared logic in `lib/cliplink/`, UI in `components/`, routes in `app/`.
- Commit messages: imperative subject, no `Co-Authored-By` trailers.
- Run `pnpm lint && pnpm type-check && pnpm build` before declaring work done.
