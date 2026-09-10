import {
  MAX_CLIP_CHARS,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_CHARS,
  MAX_ROOM_TTL_SECONDS,
  MAX_SIGNAL_BYTES,
  MIN_ROOM_TTL_SECONDS,
  ROOM_TTL_SECONDS,
} from "@/lib/cliplink/constants";
import { isValidRoomCode } from "@/lib/cliplink/room-code";
import type { SignalPayload, WsClientMessage } from "@/lib/cliplink/types";

const MAX_ID_CHARS = 64;
const MAX_MIME_CHARS = 255;
const MAX_REASON_CHARS = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

export function validatePeerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_ID_CHARS &&
    ID_PATTERN.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isOptionalNullable<T>(value: unknown, check: (v: unknown) => v is T) {
  return value === undefined || value === null || check(value);
}

function isId(value: unknown): value is string {
  return validatePeerId(value);
}

function parseSignalPayload(input: unknown): SignalPayload | null {
  if (!isRecord(input)) {
    return null;
  }

  switch (input.type) {
    case "hello":
      return { type: "hello" };

    case "file-offer": {
      const { offerId, name, size, mime } = input;
      if (
        !isId(offerId) ||
        !isBoundedString(name, MAX_FILE_NAME_CHARS) ||
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_FILE_BYTES ||
        !(typeof mime === "string" && mime.length <= MAX_MIME_CHARS)
      ) {
        return null;
      }
      return { type: "file-offer", offerId, name, size, mime };
    }

    case "file-revoke":
      return isId(input.offerId) ? { type: "file-revoke", offerId: input.offerId } : null;

    case "file-request":
      return isId(input.offerId) && isId(input.transferId)
        ? { type: "file-request", offerId: input.offerId, transferId: input.transferId }
        : null;

    case "rtc-description": {
      const { transferId, description } = input;
      if (
        !isId(transferId) ||
        !isRecord(description) ||
        (description.type !== "offer" && description.type !== "answer") ||
        !isBoundedString(description.sdp, MAX_SIGNAL_BYTES)
      ) {
        return null;
      }
      return {
        type: "rtc-description",
        transferId,
        description: { type: description.type, sdp: description.sdp },
      };
    }

    case "rtc-candidate": {
      const { transferId, candidate } = input;
      if (
        !isId(transferId) ||
        !isRecord(candidate) ||
        typeof candidate.candidate !== "string" ||
        candidate.candidate.length > 1024 ||
        !isOptionalNullable(candidate.sdpMid, (v): v is string =>
          isBoundedString(v, MAX_ID_CHARS),
        ) ||
        !isOptionalNullable(candidate.sdpMLineIndex, (v): v is number =>
          typeof v === "number" && Number.isInteger(v) && v >= 0,
        ) ||
        !isOptionalNullable(candidate.usernameFragment, (v): v is string =>
          isBoundedString(v, 256),
        )
      ) {
        return null;
      }
      return {
        type: "rtc-candidate",
        transferId,
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid as string | null | undefined,
          sdpMLineIndex: candidate.sdpMLineIndex as number | null | undefined,
          usernameFragment: candidate.usernameFragment as string | null | undefined,
        },
      };
    }

    case "transfer-cancel":
      return isId(input.transferId) && isBoundedString(input.reason, MAX_REASON_CHARS)
        ? { type: "transfer-cancel", transferId: input.transferId, reason: input.reason }
        : null;

    // "peer-left" is server-generated only; clients may not send it.
    default:
      return null;
  }
}

/**
 * Parses and validates a raw message a client sent over the room socket.
 * Rebuilds the payload from known fields so nothing unexpected is relayed.
 */
export function parseClientMessage(raw: string): WsClientMessage | null {
  if (raw.length > MAX_SIGNAL_BYTES) {
    return null;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(input) || input.type !== "signal") {
    return null;
  }

  if (input.to !== undefined && !validatePeerId(input.to)) {
    return null;
  }

  const payload = parseSignalPayload(input.payload);
  if (!payload) {
    return null;
  }

  return { type: "signal", to: input.to, payload };
}
