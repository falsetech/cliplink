import { Ratelimit } from "@upstash/ratelimit";

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/cliplink/constants";
import { getRedis } from "@/lib/cliplink/redis";

type WindowState = {
  count: number;
  resetAt: number;
};

declare global {
  var __cliplinkRateLimit: Map<string, WindowState> | undefined;
  var __cliplinkRatelimiter: Ratelimit | undefined;
}

function getMemoryStore() {
  if (!globalThis.__cliplinkRateLimit) {
    globalThis.__cliplinkRateLimit = new Map<string, WindowState>();
  }

  return globalThis.__cliplinkRateLimit;
}

function checkMemoryRateLimit(key: string) {
  const store = getMemoryStore();
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
    };
  }

  current.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

function getRatelimiter(): Ratelimit | null {
  const redis = getRedis();
  if (!redis) {
    return null;
  }

  if (!globalThis.__cliplinkRatelimiter) {
    globalThis.__cliplinkRatelimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        RATE_LIMIT_MAX_REQUESTS,
        `${RATE_LIMIT_WINDOW_MS} ms`,
      ),
      prefix: "cliplink:ratelimit",
    });
  }

  return globalThis.__cliplinkRatelimiter;
}

export function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function checkRateLimit(key: string) {
  const limiter = getRatelimiter();
  if (!limiter) {
    return checkMemoryRateLimit(key);
  }

  try {
    const result = await limiter.limit(key);
    if (result.success) {
      return { ok: true, retryAfterSeconds: 0 };
    }

    return {
      ok: false,
      retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch (error) {
    console.error("Rate limit check failed, failing open", error);
    return { ok: true, retryAfterSeconds: 0 };
  }
}
