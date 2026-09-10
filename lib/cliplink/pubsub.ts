import { EventEmitter } from "node:events";

import Redis from "ioredis";

import type { Clip, SignalEnvelope } from "@/lib/cliplink/types";

declare global {
  var __cliplinkPubsubClient: Redis | undefined;
  var __cliplinkLocalBus: EventEmitter | undefined;
}

type RoomHandlers = {
  onClip: (clip: Clip) => void;
  onSignal: (envelope: SignalEnvelope) => void;
};

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

/**
 * Process-local fallback bus used when no Redis URL is configured (local dev,
 * in-memory storage). Only fans out within a single server process.
 */
function getLocalBus() {
  if (!globalThis.__cliplinkLocalBus) {
    globalThis.__cliplinkLocalBus = new EventEmitter();
    globalThis.__cliplinkLocalBus.setMaxListeners(0);
  }
  return globalThis.__cliplinkLocalBus;
}

function clipChannel(code: string) {
  return `room:${code}:events`;
}

function signalChannel(code: string) {
  return `room:${code}:signal`;
}

async function publish(channel: string, message: string) {
  const client = getPublisher();
  if (!client) {
    getLocalBus().emit(channel, message);
    return;
  }

  await client.publish(channel, message);
}

export async function publishClip(code: string, clip: Clip) {
  try {
    await publish(clipChannel(code), JSON.stringify(clip));
  } catch (error) {
    console.error("Failed to publish clip to pub/sub channel", error);
  }
}

export async function publishSignal(code: string, envelope: SignalEnvelope) {
  try {
    await publish(signalChannel(code), JSON.stringify(envelope));
  } catch (error) {
    console.error("Failed to publish signal to pub/sub channel", error);
  }
}

export function subscribeRoom(code: string, handlers: RoomHandlers) {
  const clips = clipChannel(code);
  const signals = signalChannel(code);

  const handleMessage = (receivedChannel: string, message: string) => {
    try {
      if (receivedChannel === clips) {
        handlers.onClip(JSON.parse(message) as Clip);
      } else if (receivedChannel === signals) {
        handlers.onSignal(JSON.parse(message) as SignalEnvelope);
      }
    } catch {
      // ignore malformed pub/sub payloads
    }
  };

  const url = getPubsubUrl();
  if (!url) {
    const bus = getLocalBus();
    const onClips = (message: string) => handleMessage(clips, message);
    const onSignals = (message: string) => handleMessage(signals, message);
    bus.on(clips, onClips);
    bus.on(signals, onSignals);
    return () => {
      bus.off(clips, onClips);
      bus.off(signals, onSignals);
    };
  }

  // One subscriber connection per socket carries both room channels.
  const subscriber = new Redis(url, { maxRetriesPerRequest: null });

  subscriber.subscribe(clips, signals).catch((error) => {
    console.error("Failed to subscribe to room channels", error);
  });

  subscriber.on("message", handleMessage);

  return () => {
    subscriber.off("message", handleMessage);
    subscriber.unsubscribe(clips, signals).catch(() => {});
    subscriber.quit().catch(() => {});
  };
}
