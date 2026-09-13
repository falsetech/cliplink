import { NextResponse } from "next/server";

import type { ApiError } from "@/lib/cliplink/types";

export function errorResponse(
  status: number,
  code: string,
  error: string,
  details?: string,
) {
  const body: ApiError = { code, error, details };
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

/**
 * A 429 that says when to come back in a header a client can act on, rather
 * than only in prose a human has to read.
 */
export function rateLimitResponse(error: string, retryAfterSeconds: number) {
  // Never zero: a Retry-After of 0 invites an immediate retry, which is the
  // behaviour the limit exists to prevent.
  const seconds = Math.max(1, retryAfterSeconds);
  const body: ApiError = {
    code: "rate_limited",
    error,
    details: `Retry after ${seconds} seconds.`,
  };
  return NextResponse.json(body, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(seconds),
    },
  });
}

export function storageErrorResponse(error: unknown) {
  console.error("Storage backend error", error);
  return errorResponse(
    503,
    "storage_unavailable",
    "Storage is temporarily unavailable. Please try again.",
  );
}
