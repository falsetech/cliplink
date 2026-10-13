import { POLL_INTERVAL_MS, type Clip } from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import { createRandomPeerId } from "./identity.ts";
import type { Reporter } from "./output.ts";
import type { Session } from "./room.ts";

/**
 * Following a room, shared by `recv` and `watch`: where to start, the cursor
 * that keeps a clip from being handled twice, and the socket with its polling
 * fallback.
 */

/** Backoff between realtime attempts, matching the web app's 2s → 15s. */
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 15_000;

export type Stop = () => void;

/**
 * The clip id to start after, which is what decides how much of the room's
 * backlog is replayed.
 *
 * The default is the newest clip: a room keeps its last fifty, and dumping
 * those into a pipe is not what "receive" means. `--all` starts from nothing
 * and `--last N` from just below the newest N, so both are a choice of where
 * the cursor begins rather than a second kind of request.
 */
export function replayFrom(
  clips: Clip[],
  args: Pick<ParsedArgs, "all" | "last">,
) {
  if (args.all) {
    return 0;
  }

  const ids = clips.map((clip) => clip.id).sort((left, right) => left - right);
  if (args.last === null) {
    return ids.at(-1) ?? 0;
  }
  // Fewer clips than asked for is not an error; the room has what it has.
  return ids[ids.length - args.last - 1] ?? 0;
}

/** Highest clip id handled so far, shared by the socket and the poller. */
export type Cursor = { lastSeenId: number };

/**
 * The clips not yet handled, oldest first, moving the cursor past them.
 *
 * The socket and the poller both deliver through this, and whichever delivers
 * a clip first moves the cursor, so a clip cannot be handled twice when the
 * two overlap during a fallback.
 */
export function takeFresh(cursor: Cursor, clips: Clip[]) {
  const fresh = clips
    .filter((clip) => clip.id > cursor.lastSeenId)
    .sort((left, right) => left.id - right.id);
  if (fresh.length > 0) {
    cursor.lastSeenId = fresh[fresh.length - 1].id;
  }
  return fresh;
}

/**
 * The realtime socket with a polling fallback, which is the same arrangement
 * the room UI makes — and for the same reason. The socket is what makes a clip
 * land in well under a second; polling is what makes the command work anyway
 * on a network, or a local dev server, where the upgrade does not happen.
 */
export function listen(
  session: Session,
  report: Reporter,
  cursor: Cursor,
  emit: (clips: Clip[]) => void,
  isFinished: () => boolean,
): Stop {
  const peerId = createRandomPeerId();
  let streamCleanup: (() => void) | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let attempts = 0;
  let announcedFallback = false;
  /** Whether the last poll failed, so a run of failures is reported once. */
  let pollFailing = false;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const poll = async () => {
    try {
      const { clips } = await session.transport.pollClips(
        session.code,
        cursor.lastSeenId,
      );
      if (pollFailing) {
        pollFailing = false;
        report.note(`Reached ${session.code} again.`);
      }
      emit(clips);
    } catch (error) {
      // Once per run of failures, not once per poll. A server that is down
      // stays down, and a line every 1.5s for as long as that lasts buries
      // the clips in the scrollback and the first line that said why.
      if (!pollFailing) {
        pollFailing = true;
        report.warn(
          `Could not reach ${session.code}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!isFinished()) {
        void poll();
      }
    }, POLL_INTERVAL_MS);
  };

  const connect = () => {
    if (isFinished()) {
      return;
    }

    streamCleanup = session.transport.streamClips(session.code, cursor.lastSeenId, peerId, {
      onOpen: () => {
        attempts = 0;
        stopPolling();
        if (announcedFallback) {
          report.note("Realtime connection restored.");
          announcedFallback = false;
        }
      },
      onClips: emit,
      onDisconnect: (reason) => {
        streamCleanup = null;
        if (isFinished() || reason === "closed") {
          return;
        }
        if (!announcedFallback) {
          report.note("Realtime unavailable. Polling instead.");
          announcedFallback = true;
        }
        startPolling();
        const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempts);
        attempts += 1;
        retryTimer = setTimeout(connect, delay);
      },
    });

    // No WebSocket at all: polling is the whole strategy, not a fallback.
    if (!streamCleanup) {
      startPolling();
    }
  };

  connect();

  return () => {
    stopPolling();
    if (retryTimer) {
      clearTimeout(retryTimer);
    }
    streamCleanup?.();
  };
}
