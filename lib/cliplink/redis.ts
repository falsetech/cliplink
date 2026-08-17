import { Redis } from "@upstash/redis";

declare global {
  var __cliplinkRedisClient: Redis | undefined;
}

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (!globalThis.__cliplinkRedisClient) {
    globalThis.__cliplinkRedisClient = new Redis({ url, token });
  }

  return globalThis.__cliplinkRedisClient;
}
