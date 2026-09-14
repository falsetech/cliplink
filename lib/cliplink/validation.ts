import { parseFileSignal } from "@thebkht/rtc-file-transfer";

import {
  MAX_CLIP_CHARS,
  MAX_CLIP_CIPHERTEXT_CHARS,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_CHARS,
  MAX_ROOM_TTL_SECONDS,
  MAX_SIGNAL_BYTES,
  MIN_ROOM_TTL_SECONDS,
  ROOM_KEY_CHECK_CHARS,
  ROOM_TTL_SECONDS,
} from "@/lib/cliplink/constants";
import { isValidRoomCode } from "@/lib/cliplink/room-code";
import type { SignalPayload, WsClientMessage } from "@/lib/cliplink/types";

const MAX_ID_CHARS = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateRoomCode(code: string) {
  return isValidRoomCode(code);
}

const CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]+$/;

/**
 * All the server can check. It holds ciphertext it cannot open, so "is this
 * well-formed and within bounds" is the whole of its say — the non-empty and
 * length rules that matter are enforced on the plaintext, in the editor.
 */
export function validateClipCiphertext(text: unknown) {
  if (typeof text !== "string" || !CIPHERTEXT_PATTERN.test(text)) {
    return {
      ok: false as const,
      message: "Clip must be encrypted before it is sent.",
    };
  }

  if (text.length > MAX_CLIP_CIPHERTEXT_CHARS) {
    return {
      ok: false as const,
      message: "Encrypted clip is too large.",
    };
  }

  return { ok: true as const, text };
}

/** Plaintext rules, for the client that can still see the plaintext. */
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

const BASE32_PATTERN = /^[0-9A-Z]+$/;

/**
 * The fingerprint the creator derived from their key. The server stores and
 * echoes it; it cannot check that it corresponds to anything, only that it is
 * the right shape to be a fingerprint at all.
 */
export function validateKeyCheck(input: unknown) {
  if (input === undefined || input === null) {
    return { ok: true as const, keyCheck: undefined };
  }

  if (
    typeof input !== "string" ||
    input.length !== ROOM_KEY_CHECK_CHARS ||
    !BASE32_PATTERN.test(input)
  ) {
    return { ok: false as const, message: "Invalid key fingerprint." };
  }

  return { ok: true as const, keyCheck: input };
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

/**
 * Runs in the browser now, on a payload that has just been decrypted. The
 * server relays signals it cannot read, so this — rebuilding a payload from
 * only the fields we recognise — is the client's job and no longer the
 * server's.
 */
export function parseSignalPayload(input: unknown): SignalPayload | null {
  if (isRecord(input) && input.type === "hello-ack") {
    return { type: "hello-ack" };
  }
  return parseFileSignal(input, {
    maxFileBytes: MAX_FILE_BYTES,
    maxNameChars: MAX_FILE_NAME_CHARS,
    maxSdpChars: MAX_SIGNAL_BYTES,
  });
}

/**
 * Parses a raw message a client sent over the room socket.
 *
 * The payload is sealed, so the server's say is limited to shape: a bounded,
 * well-formed ciphertext addressed to a valid peer. Inspecting the signal
 * itself is no longer possible here and no longer belongs here — the client
 * does it in `parseSignalPayload`, after decryption.
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

  if (
    !isBoundedString(input.sealed, MAX_SIGNAL_BYTES) ||
    !CIPHERTEXT_PATTERN.test(input.sealed)
  ) {
    return null;
  }

  return { type: "signal", to: input.to, sealed: input.sealed };
}
