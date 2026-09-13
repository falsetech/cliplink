import { MAX_ROOM_CLIPS, ROOM_TTL_SECONDS } from "@/lib/cliplink/constants";
import { getRedis } from "@/lib/cliplink/redis";
import { generateRoomCode } from "@/lib/cliplink/room-code";
import type { Clip, Room } from "@/lib/cliplink/types";

type StorageAdapter = {
  createRoom(ttlSeconds?: number, keyCheck?: string): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  appendClip(code: string, clip: Clip): Promise<Room | null>;
  getClipsAfter(code: string, afterId: number): Promise<Clip[] | null>;
  touchRoom(code: string): Promise<boolean>;
  /**
   * When the room expires, in epoch ms, or null if it is already gone. This is
   * a read: it must never extend the TTL, which only `appendClip` and
   * `touchRoom` are allowed to do.
   */
  getRoomExpiresAt(code: string): Promise<number | null>;
};

type MemoryMeta = {
  code: string;
  createdAt: number;
  ttlSeconds: number;
  keyCheck: string | null;
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
  async createRoom(ttlSeconds = ROOM_TTL_SECONDS, keyCheck) {
    const store = getMemoryMetaStore();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateRoomCode();
      if (!readMemoryMeta(code)) {
        const createdAt = Date.now();
        store.set(code, {
          code,
          createdAt,
          ttlSeconds,
          keyCheck: keyCheck ?? null,
          expiresAt: createdAt + ttlSeconds * 1000,
        });
        getMemoryClipsStore().set(code, []);
        return { code, createdAt, ttlSeconds, keyCheck: keyCheck ?? null, clips: [] };
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
    return {
      code: meta.code,
      createdAt: meta.createdAt,
      ttlSeconds: meta.ttlSeconds,
      keyCheck: meta.keyCheck,
      clips,
    };
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
    return {
      code: meta.code,
      createdAt: meta.createdAt,
      ttlSeconds: meta.ttlSeconds,
      keyCheck: meta.keyCheck,
      clips: nextClips,
    };
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

  async getRoomExpiresAt(code) {
    return readMemoryMeta(code)?.expiresAt ?? null;
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
    async createRoom(ttlSeconds = ROOM_TTL_SECONDS, keyCheck) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = generateRoomCode();
        const exists = await redis.exists(metaKey(code));
        if (!exists) {
          const createdAt = Date.now();
          await redis.hset(metaKey(code), {
            code,
            createdAt,
            ttlSeconds,
            // Empty rather than absent: hset cannot store undefined, and an
            // empty string reads back as "this room has no key".
            keyCheck: keyCheck ?? "",
          });
          await redis.expire(metaKey(code), ttlSeconds);
          return { code, createdAt, ttlSeconds, keyCheck: keyCheck ?? null, clips: [] };
        }
      }

      throw new Error("Failed to allocate a unique room code");
    },

    async getRoom(code) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      const meta = await redis.hgetall<{
        code: string;
        createdAt: number;
        ttlSeconds: number;
        keyCheck?: string;
      }>(metaKey(code));
      if (!meta || !meta.code) {
        return null;
      }

      const members = await redis.zrange<string[]>(clipsKey(code), 0, -1);
      const clips = members
        .map(parseClipMember)
        .filter((clip): clip is Clip => clip !== null)
        .sort((a, b) => a.id - b.id);

      return {
        code: meta.code,
        createdAt: Number(meta.createdAt),
        ttlSeconds: Number(meta.ttlSeconds),
        keyCheck: meta.keyCheck ? String(meta.keyCheck) : null,
        clips,
      };
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

    async getRoomExpiresAt(code) {
      const redis = getRedis();
      if (!redis) {
        throw new Error("Redis client unavailable");
      }

      // PTTL is a read, and reads never refresh — only EXPIRE/PEXPIRE do — so
      // a tab polling this cannot keep a room alive. Milliseconds rather than
      // TTL's whole seconds, so the countdown does not jitter between reads.
      const ttl = await redis.pttl(metaKey(code));
      return ttl >= 0 ? Date.now() + ttl : null;
    },
  };
}

const redisAdapter = createRedisAdapter();

function activeAdapter(): StorageAdapter {
  return getRedis() ? redisAdapter : memoryAdapter;
}

export const storage: StorageAdapter = {
  createRoom: (ttlSeconds, keyCheck) =>
    activeAdapter().createRoom(ttlSeconds, keyCheck),
  getRoom: (code) => activeAdapter().getRoom(code),
  appendClip: (code, clip) => activeAdapter().appendClip(code, clip),
  getClipsAfter: (code, afterId) => activeAdapter().getClipsAfter(code, afterId),
  touchRoom: (code) => activeAdapter().touchRoom(code),
  getRoomExpiresAt: (code) => activeAdapter().getRoomExpiresAt(code),
};

export function createClipId() {
  const now = Date.now();
  const suffix = Math.floor(Math.random() * 1000);
  return now * 1000 + suffix;
}
