import { POLL_INTERVAL_MS, type Clip } from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import { createRandomPeerId } from "./identity.ts";
import type { Reporter } from "./output.ts";
import { openSession, type Session } from "./room.ts";

/** Backoff between realtime attempts, matching the web app's 2s → 15s. */
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 15_000;

type Stop = () => void;

export async function recv(
  args: ParsedArgs,
  report: Reporter,
  signal?: AbortSignal,
): Promise<number> {
  const session = await openSession(args);
  const response = await session.transport.connect(session.code);

  // Start from the newest clip the room already holds. A room keeps its last
  // fifty, and dumping those into a pipe is not what "receive" means here.
  //
  // One cursor, shared with the listener: the socket and the poller both ask
  // the server for clips after it, and whichever delivers one first moves it,
  // so a clip cannot be printed twice when the two overlap during a fallback.
  const cursor = {
    lastSeenId: response.clips.reduce(
      (highest, clip) => Math.max(highest, clip.id),
      0,
    ),
  };

  report.note(
    `Listening on ${session.code}. ${args.one ? "Waiting for the next clip." : "Ctrl-C to stop."}`,
  );

  return new Promise<number>((resolve) => {
    let finished = false;
    let stop: Stop = () => {};

    const emit = (clips: Clip[]) => {
      const fresh = clips
        .filter((clip) => clip.id > cursor.lastSeenId)
        .sort((left, right) => left.id - right.id);
      if (fresh.length === 0) {
        return;
      }

      cursor.lastSeenId = fresh[fresh.length - 1].id;
      for (const clip of fresh) {
        report.data(args.json ? line(clip) : clip.text);
        if (args.one) {
          finish(0);
          return;
        }
      }
    };

    const finish = (code: number) => {
      if (finished) {
        return;
      }
      finished = true;
      stop();
      session.transport.disconnect();
      resolve(code);
    };

    signal?.addEventListener("abort", () => finish(0), { once: true });
    stop = listen(session, report, cursor, emit, () => finished);
  });
}

/**
 * One clip as a line of JSON, for `--json`.
 *
 * The fields are named rather than the clip being stringified whole, because
 * this is an output format other programs parse: a field added to the wire type
 * should not appear here without someone deciding it should. Text still reaches
 * stdout decrypted — `--json` changes the shape of the output, not what the CLI
 * is willing to reveal.
 */
function line(clip: Clip) {
  return JSON.stringify({
    id: clip.id,
    text: clip.text,
    senderId: clip.senderId,
    ts: clip.ts,
  });
}

/** Highest clip id printed so far, shared by the socket and the poller. */
type Cursor = { lastSeenId: number };

/**
 * The realtime socket with a polling fallback, which is the same arrangement
 * the room UI makes — and for the same reason. The socket is what makes a clip
 * land in well under a second; polling is what makes the command work anyway
 * on a network, or a local dev server, where the upgrade does not happen.
 */
function listen(
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
      emit(clips);
    } catch (error) {
      report.warn(
        `Could not reach ${session.code}: ${error instanceof Error ? error.message : error}`,
      );
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
