/*
 * CLIPLINK service worker. It answers two kinds of request itself, and both
 * keep files on the device:
 *
 * - The OS share sheet. The manifest's share_target POSTs the shared text and
 *   files to /share-target, and this worker takes them there instead of the
 *   server.
 * - /_stream/<digest>, which plays a file while it downloads. Received files
 *   are kept in the origin's private file system, and this answers a media
 *   element's Range requests out of whatever has been verified so far.
 *
 * Every other request passes straight through. There is deliberately no
 * offline cache: a stale copy of a realtime app is worse than an honest
 * network error.
 */

const SHARE_CACHE = "cliplink-share-v1";
const SHARE_META = "/share-target/meta";
const SHARE_FILE = "/share-target/file/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method === "GET" && url.pathname.startsWith(STREAM_PATH)) {
    event.respondWith(streamStored(event.request, url.pathname.slice(STREAM_PATH.length)));
  }
});

// -----------------------------------------------------------------------------
// Playing a file while it downloads

const STREAM_PATH = "/_stream/";
/** The seed store's folder: SEED_DIRECTORY in lib/cliplink/file-sink.ts. */
const STORE_DIRECTORY = "cliplink-resume";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
/**
 * The only requests this route answers: a media element fetching what it
 * plays. A stored file's type comes from the peer that offered it, so a
 * navigation here must never render one — an HTML "video" would otherwise run
 * as this origin.
 */
const MEDIA_DESTINATIONS = new Set(["audio", "video"]);
const MEDIA_TYPE = /^(audio|video)\/[a-z0-9][a-z0-9.+-]*$/i;
/**
 * On every answer, in case one is ever opened some other way: no sniffing a
 * script out of the bytes, and no document it could run in.
 */
const STREAM_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};
/** How long a request for bytes that haven't arrived yet waits for them. */
const PENDING_WAIT_MS = 4000;
const PENDING_POLL_MS = 250;

/**
 * prefixRange from @thebkht/rtc-file-transfer/sinks, which is where it is
 * tested. A classic service worker can't import a module, so this is a copy:
 * change both or neither.
 */
function prefixRange(size, available, header) {
  const have = Math.max(0, Math.min(available, size));
  const unsatisfiable = (pending) => ({
    status: 416,
    contentRange: `bytes */${size}`,
    pending,
  });
  const first = (header ?? "").split(",")[0].trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(first);
  let start = 0;
  let end = size - 1;
  if (match && (match[1] !== "" || match[2] !== "")) {
    if (match[1] === "") {
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = Number(match[1]);
      if (match[2] !== "") {
        end = Number(match[2]);
      }
    }
  }
  if (start >= size || end < start) {
    return unsatisfiable(false);
  }
  if (start >= have) {
    return unsatisfiable(true);
  }
  end = Math.min(end, size - 1, have - 1);
  return { status: 206, start, end, contentRange: `bytes ${start}-${end}/${size}` };
}

function partName(index) {
  return `part-${String(index).padStart(5, "0")}`;
}

/** The store's record of this file, or null. Written by opfsResume. */
async function readStored(folder) {
  try {
    const handle = await folder.getFileHandle("state.json");
    const state = JSON.parse(await (await handle.getFile()).text());
    return typeof state.size === "number" &&
      typeof state.verifiedBytes === "number" &&
      typeof state.segmentBytes === "number" &&
      state.segmentBytes > 0
      ? state
      : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serves a Range out of the part files. Only closed parts are readable, and
 * the store records progress only as parts close, so the verified count in
 * state.json is exactly what can be served — nothing unverified ever leaves.
 */
async function streamStored(request, digest) {
  if (!DIGEST_PATTERN.test(digest) || !MEDIA_DESTINATIONS.has(request.destination)) {
    return new Response(null, { status: 404, headers: STREAM_HEADERS });
  }
  try {
    const root = await navigator.storage.getDirectory();
    const folder = await (
      await root.getDirectoryHandle(STORE_DIRECTORY)
    ).getDirectoryHandle(digest);

    const header = request.headers.get("Range");
    let state = await readStored(folder);
    let range = state && prefixRange(state.size, state.verifiedBytes, header);
    // Asked for bytes that are on their way: wait a little for them rather
    // than make the player give up and retry on its own schedule.
    for (
      let waited = 0;
      range?.status === 416 && range.pending && waited < PENDING_WAIT_MS;
      waited += PENDING_POLL_MS
    ) {
      await sleep(PENDING_POLL_MS);
      state = await readStored(folder);
      range = state && prefixRange(state.size, state.verifiedBytes, header);
    }
    // Only a type a media element plays; anything else the peer called it is
    // not this route's to serve, whatever the bytes are.
    const type = state?.meta?.mime;
    if (!state || !range || typeof type !== "string" || !MEDIA_TYPE.test(type)) {
      return new Response(null, { status: 404, headers: STREAM_HEADERS });
    }
    if (range.status === 416) {
      return new Response(null, {
        status: 416,
        headers: { ...STREAM_HEADERS, "Content-Range": range.contentRange },
      });
    }

    const segment = state.segmentBytes;
    const firstPart = Math.floor(range.start / segment);
    const lastPart = Math.floor(range.end / segment);
    const parts = [];
    for (let index = firstPart; index <= lastPart; index += 1) {
      parts.push(await (await folder.getFileHandle(partName(index))).getFile());
    }
    const from = range.start - firstPart * segment;
    const length = range.end - range.start + 1;
    return new Response(new Blob(parts).slice(from, from + length, type), {
      status: 206,
      headers: {
        ...STREAM_HEADERS,
        "Accept-Ranges": "bytes",
        "Content-Range": range.contentRange,
        "Content-Length": String(length),
        "Content-Type": type,
      },
    });
  } catch {
    // No private file system, no such file, or a part went missing under us.
    return new Response(null, { status: 404, headers: STREAM_HEADERS });
  }
}

/**
 * Parks the share in Cache Storage and sends the browser to /share, which
 * reads it back. A redirect rather than a page response, so a reload of the
 * result doesn't resubmit the share.
 */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const field = (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const files = form
      .getAll("files")
      .filter((value) => value instanceof File && value.size > 0);

    // One share at a time: an unclaimed older one is replaced, not merged.
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all(
      files.map((file, index) =>
        cache.put(
          SHARE_FILE + index,
          new Response(file, {
            headers: { "Content-Type": file.type || "application/octet-stream" },
          }),
        ),
      ),
    );
    await cache.put(
      SHARE_META,
      Response.json({
        title: field("title"),
        text: field("text"),
        url: field("url"),
        files: files.map((file) => ({
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        })),
      }),
    );
    return Response.redirect(new URL("/share", self.location.origin).href, 303);
  } catch {
    return Response.redirect(
      new URL("/share?error=unreadable", self.location.origin).href,
      303,
    );
  }
}
