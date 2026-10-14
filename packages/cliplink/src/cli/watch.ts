import { hostname } from "node:os";

import {
  MAX_CLIP_CHARS,
  normalizeDeviceName,
  UNDECRYPTABLE_TEXT,
  validateClipText,
  type Clip,
} from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import { detectClipboard, type Clipboard } from "./clipboard.ts";
import { createRandomSenderId } from "./identity.ts";
import { listen, replayFrom, takeFresh, type Stop } from "./listen.ts";
import type { Reporter } from "./output.ts";
import { announceNewRoom, openSession } from "./room.ts";

/** How often the clipboard is read for a change. */
export const CLIPBOARD_POLL_MS = 500;

/**
 * Two clipboard texts that differ only in line endings or surrounding
 * whitespace are the same clip. A clip is trimmed on the way out, and some
 * tools add a newline or a carriage return on the way back in, so comparing
 * raw text would send a clip straight back to the room it came from.
 */
function sameClip(left: string, right: string) {
  const normal = (text: string) => text.replaceAll("\r\n", "\n").trim();
  return normal(left) === normal(right);
}

/**
 * `cliplink watch` — the system clipboard and a room, kept in step.
 *
 * What is copied here after it starts is sent; what arrives is copied here.
 * The clipboard's contents at launch are not sent: starting a watch is not a
 * request to publish whatever happened to be on the clipboard.
 *
 * Two things keep it from looping. Its own clips come back over the room
 * socket under its sender id, and are skipped. And it remembers the last text
 * it wrote or sent, so a clip it has just written is not read back as a copy
 * and sent again. Reads and writes take turns, so a read that started before
 * a write cannot report what the clipboard held before it.
 */
export async function watch(
  args: ParsedArgs,
  report: Reporter,
  signal?: AbortSignal,
  /** The clipboard, or why there is none. Detected when not given. */
  clipboard?: Clipboard | string,
): Promise<number> {
  // Found before the room, so a machine with no clipboard tool learns that
  // without a room being created for nothing.
  const board = clipboard ?? (await detectClipboard());
  if (typeof board === "string") {
    report.warn(board);
    return 1;
  }

  const sending = !args.recvOnly;
  const receiving = !args.sendOnly;

  /** The last text this run wrote to the clipboard, sent, or found there. */
  let last = "";
  if (sending) {
    try {
      last = await board.read();
    } catch (error) {
      report.warn(`Could not read the clipboard with ${board.name}: ${message(error)}`);
      return 1;
    }
  }

  const session = await openSession(args);
  const response = await session.transport.connect(session.code);
  const senderId = createRandomSenderId();
  const name = args.name ?? normalizeDeviceName(hostname()) ?? "CLI";
  // Clips already in the room are history, not news: nothing is copied until
  // something arrives after the watch began.
  const cursor = { lastSeenId: replayFrom(response.clips, { all: false, last: null }) };

  if (session.created) {
    announceNewRoom(session, report, args.color);
    report.note();
  }
  const direction = sending && receiving ? "both ways" : sending ? "sending only" : "receiving only";
  report.note(`Watching the clipboard (${board.name}) on ${session.code}, ${direction}. Ctrl-C to stop.`);

  return new Promise<number>((resolve) => {
    let finished = false;
    let stop: Stop = () => {};
    let pollTimer: NodeJS.Timeout | null = null;
    /** Whether a clipboard read is in flight, so ticks do not pile up behind a slow tool. */
    let reading = false;
    /** Whether the last read failed, so a run of failures is reported once. */
    let readFailing = false;
    /** Clipboard work, one task at a time. */
    let queue: Promise<void> = Promise.resolve();
    /** Sends and deletions still in flight, which have to land before this exits. */
    const pending = new Set<Promise<void>>();

    const exclusive = (task: () => Promise<void>) => {
      const run = queue.then(task);
      queue = run.catch(() => {});
      return run;
    };

    const track = (work: Promise<void>) => {
      pending.add(work);
      void work.finally(() => pending.delete(work));
    };

    const copy = (clip: Clip) =>
      exclusive(async () => {
        await board.write(clip.text);
        last = clip.text;
        report.note(`Copied a clip from ${clip.from?.name ?? "another device"}.`);
      }).then(
        () => {
          if (clip.burn) {
            // Copying it is reading it, as printing it is for recv.
            track(
              session.transport.eraseClips(session.code, { ids: [clip.id] }).then(
                () => {},
                () => report.warn("Could not delete a one-time clip after copying it."),
              ),
            );
          }
        },
        (error: unknown) => {
          report.warn(`Could not write to the clipboard: ${message(error)}`);
        },
      );

    const receive = (clips: Clip[]) => {
      for (const clip of takeFresh(cursor, clips)) {
        if (finished || clip.senderId === senderId) {
          continue;
        }
        if (clip.text === UNDECRYPTABLE_TEXT) {
          // Copying the placeholder would overwrite the clipboard with a
          // message about a clip rather than the clip. A one-time clip that
          // would not open was not read, so it is not deleted either.
          report.warn("A clip arrived that this key cannot open. Left the clipboard alone.");
          continue;
        }
        track(copy(clip));
      }
    };

    const send = (text: string) => {
      track(
        session.transport
          .sendClip(session.code, { text, senderId, from: { name } })
          .then(
            () => report.note(`Sent ${text.length.toLocaleString()} characters.`),
            (error: unknown) => report.warn(`Could not send the clipboard: ${message(error)}`),
          ),
      );
    };

    const check = () =>
      exclusive(async () => {
        let text: string;
        try {
          text = await board.read();
        } catch (error) {
          if (!readFailing) {
            readFailing = true;
            report.warn(`Could not read the clipboard: ${message(error)}`);
          }
          return;
        }
        if (readFailing) {
          readFailing = false;
          report.note("Reading the clipboard again.");
        }
        if (finished || sameClip(text, last)) {
          return;
        }
        // Remembered whether or not it is sent, so an oversized copy is
        // reported once rather than on every read until something replaces it.
        last = text;

        const validated = validateClipText(text);
        if (!validated.ok) {
          if (text.trim().length > MAX_CLIP_CHARS) {
            report.warn(
              `Not sent: the clipboard holds ${text.trim().length.toLocaleString()} characters; the limit is ${MAX_CLIP_CHARS.toLocaleString()}.`,
            );
          }
          return;
        }
        send(validated.text);
      });

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      stop();
      void (async () => {
        await queue;
        // A copy that lands queues the deletion of a one-time clip after it,
        // so the set can grow while it is being waited on.
        while (pending.size > 0) {
          await Promise.all(pending);
        }
        session.transport.disconnect();
        resolve(0);
      })();
    };

    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) {
      finish();
      return;
    }

    if (receiving) {
      stop = listen(session, report, cursor, receive, () => finished);
    }
    if (sending) {
      pollTimer = setInterval(() => {
        if (finished || reading) {
          return;
        }
        reading = true;
        void check().finally(() => {
          reading = false;
        });
      }, CLIPBOARD_POLL_MS);
    }
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
