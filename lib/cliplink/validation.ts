import {
  MAX_CLIP_CHARS,
  MAX_ROOM_TTL_SECONDS,
  MIN_ROOM_TTL_SECONDS,
  ROOM_TTL_SECONDS,
} from "@/lib/cliplink/constants";
import { isValidRoomCode } from "@/lib/cliplink/room-code";

export function validateRoomCode(code: string) {
  return isValidRoomCode(code);
}

export function validateClipText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false as const,
      message: "Clip text cannot be empty.",
    };
  }

  if (trimmed.length > MAX_CLIP_CHARS) {
    return {
      ok: false as const,
      message: `Clip text exceeds the ${MAX_CLIP_CHARS.toLocaleString()} character limit.`,
    };
  }

  return {
    ok: true as const,
    text: trimmed,
  };
}

export function validateSenderId(senderId: string) {
  return typeof senderId === "string" && senderId.trim().length >= 6;
}

export function validateRoomTtl(input: unknown) {
  if (input === undefined || input === null) {
    return { ok: true as const, ttlSeconds: ROOM_TTL_SECONDS };
  }

  if (typeof input !== "number" || !Number.isFinite(input)) {
    return {
      ok: false as const,
      message: "ttlSeconds must be a number.",
    };
  }

  const ttlSeconds = Math.floor(input);
  if (ttlSeconds < MIN_ROOM_TTL_SECONDS || ttlSeconds > MAX_ROOM_TTL_SECONDS) {
    return {
      ok: false as const,
      message: `ttlSeconds must be between ${MIN_ROOM_TTL_SECONDS} and ${MAX_ROOM_TTL_SECONDS}.`,
    };
  }

  return {
    ok: true as const,
    ttlSeconds,
  };
}
