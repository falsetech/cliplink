import type { ParsedArgs } from "./args.ts";
import type { Reporter } from "./output.ts";
import { renderQr } from "./qr.ts";
import { openSession } from "./room.ts";

/**
 * `cliplink link` — the share link for a room you already have.
 *
 * `send` prints a link and a QR only when it creates the room, so the way to
 * get a second device onto a room already in progress was to scroll back far
 * enough to find them. This resolves the room exactly as `send` and `recv` do
 * — saved key, `CLIPLINK_ROOM_KEY`, a pasted link's fragment — and prints what
 * they print.
 *
 * It opens no socket and asks the server nothing: the link is the room code and
 * the key, both of which are in hand by the time the session is resolved. The
 * key never leaves the fragment, which is the property the link has in the
 * browser and the reason the QR is drawn here rather than fetched as an image.
 */
export async function link(args: ParsedArgs, report: Reporter): Promise<number> {
  const session = await openSession(args);

  // The link is what was asked for, so it goes to stdout and can be piped; the
  // QR is a way of reading it and goes to stderr with the rest of the
  // commentary.
  report.data(session.url);

  if (report.interactive) {
    report.note("");
    report.note(renderQr(session.url));
  }

  return 0;
}
