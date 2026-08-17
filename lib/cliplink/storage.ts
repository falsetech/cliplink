import {
  MAX_ROOM_CLIPS,
  RATE_LIMIT_WINDOW_MS,
  ROOM_TTL_SECONDS,
} from "@/lib/cliplink/constants";
import { getRedis } from "@/lib/cliplink/redis";
import { generateRoomCode } from "@/lib/cliplink/room-code";
import type { Clip, Room } from "@/lib/cliplink/types";

type StorageAdapter = {
  createRoom(ttlSeconds?: number): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  appendClip(code: string, clip: Clip): Promise<Room | null>;
  getClipsAfter(code: string, afterId: number): Promise<Clip[] | null>;
  touchRoom(code: string): Promise<boolean>;
};

type MemoryMeta = {
  code: string;
  createdAt: number;
  ttlSeconds: number;
  expiresAt: number;
};

declare global {
  var __cliplinkMemoryMeta: Map<string, MemoryMeta> | undefined;
  var __cliplinkMemoryClips: Map<string, Clip[]> | undefined;
}

function metaKey(code: string) {
  return `room:${code}:meta`;
}

function clipsKey(code: string) {
  return `room:${code}:clips`;
}

function getMemoryMetaStore() {
  if (!globalThis.__cliplinkMemoryMeta) {
    globalThis.__cliplinkMemoryMeta = new Map<string, MemoryMeta>();
  }
  return globalThis.__cliplinkMemoryMeta;
}

function getMemoryClipsStore() {
  if (!globalThis.__cliplinkMemoryClips) {
    globalThis.__cliplinkMemoryClips = new Map<string, Clip[]>();
  }
  return globalThis.__cliplinkMemoryClips;
}

function trimClips(clips: Clip[]) {
  return [...clips].sort((left, right) => left.id - right.id).slice(-MAX_ROOM_CLIPS);
}

function readMemoryMeta(code: string): MemoryMeta | null {
  const store = getMemoryMetaStore();
  const meta = store.get(code);
  if (!meta) {
    return null;
  }

  if (meta.expiresAt <= Date.now()) {
    store.delete(code);
    getMemoryClipsStore().delete(code);
    return null;
  }

  return meta;
}

const memoryAdapter: StorageAdapter = {
  async createRoom(ttlSeconds = ROOM_TTL_SECONDS) {
    const store = getMemoryMetaStore();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateRoomCode();
      if (!readMemoryMeta(code)) {
        const createdAt = Date.now();
        store.set(code, {
          code,
          createdAt,
          ttlSeconds,
          expiresAt: createdAt + ttlSeconds * 1000,
        });
        getMemoryClipsStore().set(code, []);
        return { code, createdAt, clips: [] };
      }
    }

    throw new Error("Failed to allocate a unique room code");
  },

  async getRoom(code) {
    const meta = readMemoryMeta(code);
    if (!meta) {
      return null;
    }

    const clips = getMemoryClipsStore().get(code) ?? [];
    return { code: meta.code, createdAt: meta.createdAt, clips };
  },

  async appendClip(code, clip) {
    const meta = readMemoryMeta(code);
    if (!meta) {
      return null;
    }

    const clipsStore = getMemoryClipsStore();
    const nextClips = trimClips([...(clipsStore.get(code) ?? []), clip]);
    clipsStore.set(code, nextClips);
    meta.expiresAt = Date.now() + meta.ttlSeconds * 1000;
    return { code: meta.code, createdAt: meta.createdAt, clips: nextClips };
  },

  async getClipsAfter(code, afterId) {
    const meta = readMemoryMeta(code);
    if (!meta) {
      return null;
    }

    const clips = getMemoryClipsStore().get(code) ?? [];
    return clips.filter((clip) => clip.id > afterId).sort((a, b) => a.id - b.id);
  },

  async touchRoom(code) {
    const meta = readMemoryMeta(code);
    if (!meta) {
      return false;
    }

    meta.expiresAt = Date.now() + meta.ttlSeconds * 1000;
    return true;
  },
};

function parseClipMember(member: string): Clip | null {
  try {
    return JSON.parse(member) as Clip;
  } catch {
    return null;
  }
}

function createRedisAdapter(): StorageAdapter {
  return {
    async createRoom(ttlSeconds = ROOM_TTL_SECONDS) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = generateRoomCode();
        const exists = await redis.exists(metaKey(code));
        if (!exists) {
          const createdAt = Date.now();
          await redis.hset(metaKey(code), { code, createdAt, ttlSeconds });
          await redis.expire(metaKey(code), ttlSeconds);
          return { code, createdAt, clips: [] };
        }
      }

      throw new Error("Failed to allocate a unique room code");
    },

    async getRoom(code) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      const meta = await redis.hgetall<{ code: string; createdAt: number; ttlSeconds: number }>(
        metaKey(code),
      );
      if (!meta || !meta.code) {
        return null;
      }

      const members = await redis.zrange<string[]>(clipsKey(code), 0, -1);
      const clips = members
        .map(parseClipMember)
        .filter((clip): clip is Clip => clip !== null)
        .sort((a, b) => a.id - b.id);

      return { code: meta.code, createdAt: Number(meta.createdAt), clips };
    },

    async appendClip(code, clip) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      const meta = await redis.hgetall<{ ttlSeconds: number }>(metaKey(code));
      if (!meta || !meta.ttlSeconds) {
        return null;
      }

      const ttlSeconds = Number(meta.ttlSeconds);
      const pipeline = redis.pipeline();
      pipeline.zadd(clipsKey(code), { score: clip.id, member: JSON.stringify(clip) });
      pipeline.zremrangebyrank(clipsKey(code), 0, -(MAX_ROOM_CLIPS + 1));
      pipeline.expire(metaKey(code), ttlSeconds);
      pipeline.expire(clipsKey(code), ttlSeconds);
      await pipeline.exec();

      return this.getRoom(code);
    },

    async getClipsAfter(code, afterId) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      const exists = await redis.exists(metaKey(code));
      if (!exists) {
        return null;
      }

      const members = await redis.zrange<string[]>(clipsKey(code), `(${afterId}`, "+inf", {
        byScore: true,
      });
      return members
        .map(parseClipMember)
        .filter((clip): clip is Clip => clip !== null)
        .sort((a, b) => a.id - b.id);
    },

    async touchRoom(code) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      const meta = await redis.hgetall<{ ttlSeconds: number }>(metaKey(code));
      if (!meta || !meta.ttlSeconds) {
        return false;
      }

      const ttlSeconds = Number(meta.ttlSeconds);
      await redis.expire(metaKey(code), ttlSeconds);
      await redis.expire(clipsKey(code), ttlSeconds);
      return true;
    },
  };
}

const redisAdapter = createRedisAdapter();

function activeAdapter(): StorageAdapter {
  return getRedis() ? redisAdapter : memoryAdapter;
}

export const storage: StorageAdapter = {
  createRoom: (ttlSeconds) => activeAdapter().createRoom(ttlSeconds),
  getRoom: (code) => activeAdapter().getRoom(code),
  appendClip: (code, clip) => activeAdapter().appendClip(code, clip),
  getClipsAfter: (code, afterId) => activeAdapter().getClipsAfter(code, afterId),
  touchRoom: (code) => activeAdapter().touchRoom(code),
};

export function createClipId() {
  const now = Date.now();
  const suffix = Math.floor(Math.random() * 1000);
  return now * 1000 + suffix;
}

export function getRateLimitBucket(timestamp = Date.now()) {
  return Math.floor(timestamp / RATE_LIMIT_WINDOW_MS);
}
