# Contributing to CLIPLINK

Thanks for taking the time. CLIPLINK is a small project, so the process is light.

## Before you start

For anything beyond a bug fix or a typo, **open an issue first**. CLIPLINK is deliberately narrow in scope — zero auth, ephemeral, no accounts, no persistence — and a quick conversation saves you writing code that does not fit that shape.

Explicit non-goals: user accounts, persistent history across sessions, server-side file storage, and native mobile apps.

## Setup

Requires **Node.js >= 20.9** and **pnpm** (see [`.nvmrc`](.nvmrc); `corepack enable` gets you the right pnpm).

```bash
pnpm install
pnpm dev
```

No Redis, no Vercel account, no environment file. Without credentials the app uses an in-memory store (`lib/cliplink/storage.ts`) and a process-local event bus (`lib/cliplink/pubsub.ts`). That covers most development.

You need real Upstash credentials only when your change touches cross-instance behavior — pub/sub fan-out or atomic rate limiting. Copy `.env.example` to `.env.local` and fill it in.

## Before you push

CI runs exactly these, so run them locally first:

```bash
pnpm -F @thebkht/rtc-file-transfer test
pnpm -F @thebkht/rtc-file-transfer build
pnpm lint
pnpm type-check
pnpm build
```

The file-transfer package in `packages/rtc-file-transfer` has tests; the app has **no test suite yet**. Adding one is on the roadmap and PRs that start it are very welcome. In the meantime, describe how you verified your change by hand.

## Manual verification

Most of CLIPLINK is about two devices talking, so most changes need two clients. Two browser tabs work for text sync; two separate browsers (or a phone on the same network) are better for file transfer.

Worth checking depending on what you touched:

- **Transport changes** — verify both paths. Kill the WebSocket (offline the network briefly in DevTools) and confirm the room degrades to polling and recovers.
- **File transfer** — file transfer requires the WebSocket transport; Attach and Download are disabled on the polling fallback. Test an offer, a download, a withdrawal, and a late joiner seeing an open offer.
- **Room lifecycle** — TTL is refreshed on write, not on read. A passively polling tab must not keep a room alive forever.

## Code style

- TypeScript throughout; no new `any`.
- Tailwind utility classes for styling — canonical class names, no arbitrary values where a token exists.
- Shared logic belongs in `lib/cliplink/`, UI in `components/`, routes in `app/`.
- Match the surrounding code. The codebase has a consistent voice; follow it rather than introducing a new one.

## Commits and pull requests

- Imperative subject lines, matching the existing history: `Add QR code sharing`, not `added qr` or `feat: qr`. Run `git log --oneline` for the pattern.
- No `Co-Authored-By` trailers.
- One logical change per PR. Keep refactors separate from behavior changes.
- In the PR description: what changed, why, and how you verified it. Link the issue if there is one.

## Project layout

```
app/              Routes and API handlers (App Router)
  rooms/          Room creation, fetch, clips, WebSocket upgrade
components/       React components
  cliplink/       File transfer UI and hooks
lib/cliplink/     Storage, transports, pub/sub, validation, WebRTC
```

There is no `src/` directory.
