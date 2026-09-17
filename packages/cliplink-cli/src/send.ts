import { MAX_CLIP_CHARS, validateClipText } from "@thebkht/cliplink";

import type { ParsedArgs } from "./args.ts";
import { createRandomSenderId } from "./identity.ts";
import type { Reporter } from "./output.ts";
import { renderQr } from "./qr.ts";
import { openSession } from "./room.ts";

/** Everything piped in, so `git log | cliplink send` works. */
export async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function send(
  args: ParsedArgs,
  report: Reporter,
  stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
): Promise<number> {
  // Text given as arguments wins; otherwise read the pipe. A bare `cliplink
  // send` on a terminal would block on a pipe nobody is writing to, so it is
  // an error with a hint rather than a hang.
  let text = args.text;
  if (!text) {
    if (stdin.isTTY) {
      report.warn(
        'Nothing to send. Pass the text as an argument, or pipe it in:\n  echo "hello" | cliplink send',
      );
      return 2;
    }
    text = await readStdin(stdin);
  }

  const validated = validateClipText(text);
  if (!validated.ok) {
    report.warn(
      text.trim().length > MAX_CLIP_CHARS
        ? `That clip is ${text.trim().length.toLocaleString()} characters; the limit is ${MAX_CLIP_CHARS.toLocaleString()}.`
        : validated.message,
    );
    return 2;
  }

  const session = await openSession(args);
  try {
    await session.transport.connect(session.code);
    await session.transport.sendClip(session.code, {
      text: validated.text,
      senderId: createRandomSenderId(),
    });

    if (session.created) {
      report.note(`Room ${session.code} — open on your other device:`);
      report.note();
      report.note(session.url);
      if (report.interactive) {
        report.note();
        report.note(renderQr(session.url));
      }
      report.note();
      report.note("The room key is in the link's #fragment and never reaches the server.");
    } else {
      report.note(`Sent to ${session.code}.`);
    }
    return 0;
  } finally {
    session.transport.disconnect();
  }
}
