import { NextResponse } from "next/server";

/**
 * The share sheet's POST normally never gets here: the service worker in
 * public/sw.js answers it on the device. This only runs when that worker isn't
 * active yet, such as the first share straight after installing.
 *
 * The body is never read. It holds the user's shared files, and files must not
 * reach the server, so they are dropped unread and the user is asked to try
 * again once the worker has taken over.
 */
export function POST(request: Request) {
  return NextResponse.redirect(new URL("/share?error=unavailable", request.url), 303);
}
