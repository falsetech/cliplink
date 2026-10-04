import { NextResponse, type NextRequest } from "next/server";

type PolicyInput = {
  nonce: string;
  /** The host the page was requested on, which is where its room socket lives. */
  host: string;
  /** Served over https, as every deployment is; plain http is a local run. */
  secure: boolean;
  dev: boolean;
};

/**
 * The page's Content-Security-Policy.
 *
 * The room key lives in the URL fragment, so a script that should not be on
 * the page could read it and undo the end-to-end encryption. Scripts are
 * therefore allowed by a per-request nonce and nothing else: no inline script
 * without it, and no host allowlist for one to be loaded from.
 *
 * Styles are looser. Sonner injects a `<style>` that carries no nonce, and
 * several components render `style` attributes, so inline styles stay allowed.
 *
 * WebRTC and its STUN/TURN servers are not governed by any of this.
 */
function contentSecurityPolicy({ nonce, host, secure, dev }: PolicyInput): string {
  const directives = [
    "default-src 'self'",
    // React evaluates strings in development to rebuild server error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Thumbnails of received images are object URLs.
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    // Named as well as 'self': older Safari does not take 'self' to cover the
    // WebSocket scheme of the same host.
    `connect-src 'self' ${secure ? "wss" : "ws"}://${host}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (secure) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy({
    nonce,
    host: request.nextUrl.host,
    secure: request.nextUrl.protocol === "https:",
    dev: process.env.NODE_ENV === "development",
  });

  // On the request as well as the response: Next reads the nonce out of the
  // request's policy while rendering and applies it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. The room API under /rooms (the socket upgrade included),
      // the share target, build assets and anything with a file extension
      // render no document for a policy to protect. `/room/…` is a page, so
      // only `rooms` as a whole segment is skipped.
      source:
        "/((?!rooms(?:/|$)|share-target|_next/static|_next/image|_vercel|.*\\.[\\w]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
