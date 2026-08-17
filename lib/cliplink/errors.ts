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

export function storageErrorResponse(error: unknown) {
  console.error("Storage backend error", error);
  return errorResponse(
    503,
    "storage_unavailable",
    "Storage is temporarily unavailable. Please try again.",
  );
}
