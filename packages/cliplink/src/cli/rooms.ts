import { normalizeRoomCode } from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import {
  forgetAllRooms,
  forgetRoom,
  isExpired,
  pruneRooms,
  readSavedRooms,
  type SavedRoom,
} from "./config.ts";
import type { Env } from "./env.ts";
import { extractRoomCode } from "./key.ts";
import type { Reporter } from "./output.ts";

/**
 * `cliplink rooms` — what `--save` has written, and the means to unwrite it.
 *
 * Keys are withheld from the listing unless `--show-keys` asks for them. The
 * point of `--save` being opt-in per run is that keys stay scarce, and a
 * command people run to remind themselves of a room code should not spray key
 * material into scrollback, a screen share, or a terminal recording on the way
 * to answering.
 */

const UNITS = [
  { ms: 86_400_000, name: "day" },
  { ms: 3_600_000, name: "hour" },
  { ms: 60_000, name: "minute" },
] as const;

/** A duration at one unit of precision: long enough to judge by, short enough to align. */
function duration(ms: number) {
  for (const unit of UNITS) {
    const count = Math.floor(ms / unit.ms);
    if (count >= 1) {
      return `${count} ${unit.name}${count === 1 ? "" : "s"}`;
    }
  }
  return "under a minute";
}

function when(room: SavedRoom, now: number) {
  const age = `saved ${duration(now - room.savedAt)} ago`;
  if (isExpired(room, now)) {
    return `${age}, expired`;
  }
  // A room saved on a join was never told its lifetime, so the only honest
  // thing to say about its expiry is nothing.
  return room.expiresAt === undefined
    ? age
    : `${age}, expires in ${duration(room.expiresAt - now)}`;
}

function keyColumn(room: SavedRoom, showKeys: boolean) {
  if (room.key === undefined) {
    return "open room";
  }
  return showKeys ? room.key : "key saved";
}

/** Pads every column but the last, which has nothing to line up against. */
function table(rows: string[][]) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === row.length - 1 ? cell : cell.padEnd(widths[column]),
      )
      .join("  ")
      .trimEnd(),
  );
}

export async function rooms(
  args: ParsedArgs,
  report: Reporter,
  env: Env = process.env,
  now = Date.now(),
): Promise<number> {
  if (args.forget !== null) {
    const code = normalizeRoomCode(extractRoomCode(args.forget) ?? args.forget);
    const forgotten = await forgetRoom(code, env);
    if (!forgotten) {
      report.warn(`No room saved as ${code || args.forget}.`);
      return 1;
    }
    report.note(`Forgot ${forgotten.code}.`);
    return 0;
  }

  if (args.forgetAll) {
    const count = await forgetAllRooms(env);
    report.note(
      count === 0
        ? "No rooms were saved."
        : `Forgot ${count} room${count === 1 ? "" : "s"}.`,
    );
    return 0;
  }

  if (args.prune) {
    const dropped = await pruneRooms(env, now);
    report.note(
      dropped.length === 0
        ? "Nothing to prune; no saved room has expired."
        : `Pruned ${dropped.length} expired room${dropped.length === 1 ? "" : "s"}: ${dropped
            .map((room) => room.code)
            .join(", ")}.`,
    );
  }

  const saved = await readSavedRooms(env);
  if (saved.length === 0) {
    report.note("No rooms saved. Send with --save to keep one.");
    return 0;
  }

  // The listing is the answer to the question, so it goes to stdout and can be
  // grepped; the counts and the key notice above are commentary.
  for (const line of table(
    saved.map((room) => [
      room.code,
      room.baseUrl,
      when(room, now),
      keyColumn(room, args.showKeys),
    ]),
  )) {
    report.data(line);
  }

  if (!args.showKeys && saved.some((room) => room.key !== undefined)) {
    report.note("");
    report.note("Keys are withheld. Pass --show-keys to print them.");
  }

  return 0;
}
