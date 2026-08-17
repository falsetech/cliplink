import Redis from "ioredis";

import type { Clip } from "@/lib/cliplink/types";

declare global {
  var __cliplinkPubsubClient: Redis | undefined;
}

function getPubsubUrl() {
  return (
    process.env.UPSTASH_REDIS_URL ??
    process.env.REDIS_URL ??
    process.env.KV_URL ??
    null
  );
}

function getPublisher(): Redis | null {
  const url = getPubsubUrl();
  if (!url) {
    return null;
  }

  if (!globalThis.__cliplinkPubsubClient) {
    globalThis.__cliplinkPubsubClient = new Redis(url, {
      maxRetriesPerRequest: null,
    });
  }

  return globalThis.__cliplinkPubsubClient;
}

function channelName(code: string) {
  return `room:${code}:events`;
}

export async function publishClip(code: string, clip: Clip) {
  const client = getPublisher();
  if (!client) {
    return;
  }

  try {
    await client.publish(channelName(code), JSON.stringify(clip));
  } catch (error) {
    console.error("Failed to publish clip to pub/sub channel", error);
  }
}

export function subscribeRoom(code: string, onClip: (clip: Clip) => void) {
  const url = getPubsubUrl();
  if (!url) {
    return () => {};
  }

  const subscriber = new Redis(url, { maxRetriesPerRequest: null });
  const channel = channelName(code);

  subscriber.subscribe(channel).catch((error) => {
    console.error("Failed to subscribe to room channel", error);
  });

  const handleMessage = (receivedChannel: string, message: string) => {
    if (receivedChannel !== channel) {
      return;
    }

    try {
      onClip(JSON.parse(message) as Clip);
    } catch {
      // ignore malformed pub/sub payloads
    }
  };

  subscriber.on("message", handleMessage);

  return () => {
    subscriber.off("message", handleMessage);
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.quit().catch(() => {});
  };
}
