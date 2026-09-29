/**
 * How to answer an HTTP Range request for a file of which only a prefix is on
 * disk — a download still arriving.
 *
 * A short answer is legal: `206` with a `Content-Range` that ends before the
 * range asked for. A media element simply asks for the next range, which is
 * what lets a video play while the rest of it downloads. Bytes that haven't
 * arrived get `416` with `pending`, so a caller can wait for them and ask
 * again; bytes past the end of the file get `416` without it.
 *
 * `available` is whatever the caller has verified. Nothing here reads a file,
 * so the same arithmetic can answer a service worker, a server, or a test.
 */
export type PrefixRange =
  | {
      status: 206;
      /** First byte to send. */
      start: number;
      /** Last byte to send, inclusive, as `Content-Range` counts it. */
      end: number;
      contentRange: string;
    }
  | { status: 416; contentRange: string; pending: boolean };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export function prefixRange(
  size: number,
  available: number,
  header: string | null,
): PrefixRange {
  const have = Math.max(0, Math.min(available, size));
  const unsatisfiable = (pending: boolean): PrefixRange => ({
    status: 416,
    contentRange: `bytes */${size}`,
    pending,
  });

  // Only the first range: a media element never asks for several, and a
  // multipart answer would buy nothing here.
  const first = header?.split(",")[0]?.trim() ?? "";
  const match = RANGE_PATTERN.exec(first);
  let start = 0;
  let end = size - 1;
  if (match && (match[1] !== "" || match[2] !== "")) {
    if (match[1] === "") {
      // `bytes=-N`: the last N bytes of the file.
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = Number(match[1]);
      if (match[2] !== "") {
        end = Number(match[2]);
      }
    }
  }
  // A missing or malformed header is read as `bytes=0-`: an honest 200 would
  // have to promise the whole file, and it isn't all here.

  if (start >= size || end < start) {
    return unsatisfiable(false);
  }
  if (start >= have) {
    return unsatisfiable(true);
  }
  end = Math.min(end, size - 1, have - 1);
  return { status: 206, start, end, contentRange: `bytes ${start}-${end}/${size}` };
}
