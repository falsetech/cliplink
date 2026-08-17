# CLIPLINK

CLIPLINK is a lightweight zero-auth clipboard sync app built with Next.js App Router, deployed to Vercel with Upstash Redis for storage and realtime pub/sub.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Without Redis env vars set, the app falls back to an in-memory store for local dev (single-process only, no realtime fanout across instances). For the full experience — WebSocket realtime, atomic rate limiting — pull real Upstash credentials with `vercel env pull`.

## Environment Variables

Provision an Upstash Redis database via the Vercel Marketplace, then set:

```bash
UPSTASH_REDIS_REST_URL=       # REST client - storage, rate limiting
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_REDIS_URL=            # rediss:// connection string - pub/sub (WebSocket fanout)
```

## Deployment

CLIPLINK deploys to Vercel with zero adapter config — standard Next.js App Router build/output.

```bash
vercel deploy
```

Custom domain: `vercel domains add <domain>` once deployed.

The app ships M3 (custom domain, atomic rate limiting, configurable room expiry) plus a pulled-forward M4 goal: WebSocket realtime transport backed by Upstash Redis pub/sub, replacing the earlier SSE-over-KV-polling approach, with polling as the fallback transport.
