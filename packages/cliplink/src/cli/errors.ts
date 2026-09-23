import { RoomKeyMismatchError } from "../index.ts";

import { KeyError } from "./key.ts";

/**
 * What to print when something thrown reaches the top of a command.
 *
 * The failures worth naming precisely are the ones whose own message explains
 * nothing to the person who hit them: a wrong key and an unreachable server
 * look nothing alike, and `fetch failed` describes neither. Everything else
 * keeps its own message, because a message written for this CLI is better than
 * anything a mapping could substitute for it.
 *
 * It lives apart from `cli.ts` because that module runs the CLI when it is
 * imported, so nothing in it can be reached from a test.
 */
export function describeError(error: unknown): string {
  if (error instanceof RoomKeyMismatchError) {
    return "That key does not open this room. Check the link or key you were given.";
  }
  if (error instanceof KeyError) {
    return error.message;
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "Could not reach the server. Check your connection, or --url.";
  }
  return error instanceof Error ? error.message : String(error);
}
