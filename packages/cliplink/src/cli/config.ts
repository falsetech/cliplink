import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { MAX_ROOM_TTL_SECONDS } from "../index.ts";

import type { Env } from "./env.ts";

/**
 * The saved-rooms file: the only thing in this CLI that writes a room key to
 * disk, and it does so only when `--save` is given.
 *
 * Everywhere else a key lives in process memory and in the terminal's own
 * scrollback, which is what keeps the web app's property — the key is never at
 * rest — true of the CLI by default. `--save` trades that away deliberately, so
 * it is opt-in per run, the file is created `0600`, and nothing here ever
 * invents a reason to write.
 */

export type SavedRoom = {
  code: string;
  /** Absent for an open room, whose key comes from the code. */
  key?: string;
  baseUrl: string;
  savedAt: number;
  /**
   * When the room expires, in epoch ms, for the runs that were told. Creating a
   * room yields its TTL; joining one does not, so this is absent for rooms
   * saved by `--save` on a join.
   */
  expiresAt?: number;
};

type ConfigFile = { rooms: SavedRoom[] };

/** Rooms kept before the oldest is dropped. A room outlives its TTL here only as a stale entry. */
const MAX_SAVED_ROOMS = 25;

export function configPath(env: Env = process.env) {
  const base =
    env.CLIPLINK_CONFIG_DIR ??
    (env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, "cliplink")
      : join(homedir(), ".config", "cliplink"));
  return join(base, "rooms.json");
}

function isSavedRoom(value: unknown): value is SavedRoom {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const room = value as Record<string, unknown>;
  return (
    typeof room.code === "string" &&
    typeof room.baseUrl === "string" &&
    typeof room.savedAt === "number" &&
    (room.key === undefined || typeof room.key === "string") &&
    (room.expiresAt === undefined || typeof room.expiresAt === "number")
  );
}

/**
 * Returns an empty list rather than throwing when the file is missing or
 * unreadable. Not finding a convenience is not a failure worth stopping for,
 * and the room can always be named on the command line instead.
 */
export async function readSavedRooms(
  env: Env = process.env,
): Promise<SavedRoom[]> {
  try {
    const raw = await readFile(configPath(env), "utf8");
    const parsed = JSON.parse(raw) as ConfigFile;
    return Array.isArray(parsed?.rooms) ? parsed.rooms.filter(isSavedRoom) : [];
  } catch {
    return [];
  }
}

export async function findSavedRoom(
  code: string,
  env: Env = process.env,
): Promise<SavedRoom | null> {
  const wanted = code.toUpperCase();
  const rooms = await readSavedRooms(env);
  return rooms.find((room) => room.code.toUpperCase() === wanted) ?? null;
}

async function writeRooms(rooms: SavedRoom[], env: Env): Promise<string> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // The mode is passed on create and set again after: an existing file keeps
  // its old mode through a write, and this file may hold keys.
  await writeFile(path, `${JSON.stringify({ rooms }, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}

/** Newest first, one entry per room code. */
export async function saveRoom(
  room: SavedRoom,
  env: Env = process.env,
): Promise<string> {
  const existing = await readSavedRooms(env);
  const rooms = [
    room,
    ...existing.filter(
      (saved) => saved.code.toUpperCase() !== room.code.toUpperCase(),
    ),
  ].slice(0, MAX_SAVED_ROOMS);

  return writeRooms(rooms, env);
}

/**
 * When a saved room is past saving, as well as this can be known without
 * asking the server.
 *
 * A room saved on a join carries no expiry, so it falls back to the longest a
 * room may be configured to live. That is a bound rather than a reading: an
 * entry it calls expired certainly is, and one it does not may still have been
 * collected. Pruning is therefore about clearing out what is definitely dead,
 * not about keeping an accurate picture of the server.
 */
export function isExpired(room: SavedRoom, now = Date.now()) {
  return now >= (room.expiresAt ?? room.savedAt + MAX_ROOM_TTL_SECONDS * 1000);
}

/** The forgotten room, or null when no room was saved under that code. */
export async function forgetRoom(
  code: string,
  env: Env = process.env,
): Promise<SavedRoom | null> {
  const wanted = code.toUpperCase();
  const rooms = await readSavedRooms(env);
  const room = rooms.find((saved) => saved.code.toUpperCase() === wanted);
  if (!room) {
    return null;
  }

  await writeRooms(
    rooms.filter((saved) => saved.code.toUpperCase() !== wanted),
    env,
  );
  return room;
}

/**
 * Removes the file rather than writing an empty one. Forgetting every room
 * should leave nothing behind that once held a key, and a file of `[]` is a
 * worse answer to "is anything saved" than no file at all.
 */
export async function forgetAllRooms(env: Env = process.env): Promise<number> {
  const rooms = await readSavedRooms(env);
  await rm(configPath(env), { force: true });
  return rooms.length;
}

/** The rooms dropped, which is empty when none had expired. */
export async function pruneRooms(
  env: Env = process.env,
  now = Date.now(),
): Promise<SavedRoom[]> {
  const rooms = await readSavedRooms(env);
  const expired = rooms.filter((room) => isExpired(room, now));
  if (expired.length > 0) {
    await writeRooms(
      rooms.filter((room) => !isExpired(room, now)),
      env,
    );
  }
  return expired;
}
