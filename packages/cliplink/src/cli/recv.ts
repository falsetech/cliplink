import { UNDECRYPTABLE_TEXT, type Clip } from "../index.ts";

import type { ParsedArgs } from "./args.ts";
import { listen, replayFrom, takeFresh, type Stop } from "./listen.ts";
import type { Reporter } from "./output.ts";
import { openSession } from "./room.ts";

export async function recv(
  args: ParsedArgs,
  report: Reporter,
  signal?: AbortSignal,
): Promise<number> {
  const session = await openSession(args);
  const response = await session.transport.connect(session.code);

  // One cursor, shared with the listener: the socket and the poller both ask
  // the server for clips after it, and whichever delivers one first moves it,
  // so a clip cannot be printed twice when the two overlap during a fallback.
  // Starting it below the backlog is all replaying takes.
  const cursor = { lastSeenId: replayFrom(response.clips, args) };

  report.note(
    `Listening on ${session.code}. ${args.one ? "Waiting for the next clip." : "Ctrl-C to stop."}`,
  );

  return new Promise<number>((resolve) => {
    let finished = false;
    let stop: Stop = () => {};
    let printed = 0;
    let deadline: NodeJS.Timeout | null = null;
    /** Deletions of one-time clips, which have to land before this exits. */
    const burning: Promise<void>[] = [];

    const emit = (clips: Clip[]) => {
      for (const clip of takeFresh(cursor, clips)) {
        report.data(args.json ? line(clip) : clip.text);
        printed += 1;
        if (clip.burn && clip.text !== UNDECRYPTABLE_TEXT) {
          // Printing it is reading it, and reading a one-time clip spends it.
          // One that would not open was not read, so it is left for a device
          // that can: anyone with the room code can post a clip marked
          // one-time, and must not thereby get this to delete things.
          burning.push(
            session.transport.eraseClips(session.code, { ids: [clip.id] }).then(
              () => {},
              () => report.warn("Could not delete a one-time clip after reading it."),
            ),
          );
        }
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
      if (deadline) {
        clearTimeout(deadline);
      }
      stop();
      void Promise.all(burning).then(() => {
        session.transport.disconnect();
        resolve(code);
      });
    };

    signal?.addEventListener("abort", () => finish(0), { once: true });

    // The room's own clips go through the same path as a clip that arrives
    // later, so --one and --json mean the same thing for both. With neither
    // --last nor --all the cursor already sits at the newest, and this emits
    // nothing.
    emit(response.clips);
    if (finished) {
      return;
    }

    if (args.timeoutSeconds !== null) {
      const seconds = args.timeoutSeconds;
      deadline = setTimeout(() => {
        // Nothing arrived, so nothing was written to stdout — a caller that
        // pipes this needs the exit code to say so, or an empty clip and a
        // clip that never came look alike.
        report.note(
          printed === 0
            ? `Nothing arrived within ${seconds}s.`
            : `Stopping after ${seconds}s.`,
        );
        finish(printed === 0 ? 1 : 0);
      }, seconds * 1000);
    }

    stop = listen(session, report, cursor, emit, () => finished, () => {
      report.warn(`Room ${session.code} has expired, or its code now belongs to another room.`);
      finish(1);
    });
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
    // Absent for a sender that gave no name, as older clients do not.
    name: clip.from?.name,
    // Present, and true, only on a one-time clip.
    burn: clip.burn,
  });
}
