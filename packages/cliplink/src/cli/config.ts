import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
    (room.key === undefined || typeof room.key === "string")
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

/** Newest first, one entry per room code. */
export async function saveRoom(
  room: SavedRoom,
  env: Env = process.env,
): Promise<string> {
  const path = configPath(env);
  const existing = await readSavedRooms(env);
  const rooms = [
    room,
    ...existing.filter(
      (saved) => saved.code.toUpperCase() !== room.code.toUpperCase(),
    ),
  ].slice(0, MAX_SAVED_ROOMS);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // The mode is passed on create and set again after: an existing file keeps
  // its old mode through a write, and this file may hold keys.
  await writeFile(path, `${JSON.stringify({ rooms }, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}
