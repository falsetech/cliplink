/*
 * CLIPLINK service worker. It exists for one thing: receiving the OS share
 * sheet. The manifest's share_target POSTs the shared text and files to
 * /share-target, and this worker answers that request itself, so the files
 * stay on the device and never reach the server.
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
  if (
    event.request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname === "/share-target"
  ) {
    event.respondWith(receiveShare(event.request));
  }
});

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
