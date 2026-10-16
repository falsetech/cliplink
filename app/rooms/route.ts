import {
  errorResponse,
  noStoreJson,
  rateLimitResponse,
  storageErrorResponse,
} from "@/lib/cliplink/errors";
import { openRoomEraseCheck } from "@/lib/cliplink/erase";
import { getClientIp, roomCreateRateLimit } from "@/lib/cliplink/rate-limit";
import { RoomCodeTakenError, storage } from "@/lib/cliplink/storage";
import type { CreateRoomRequest, CreateRoomResponse } from "@/lib/cliplink/types";
import {
  validateEraseCheck,
  validateKeyCheck,
  validateRequestedRoomCode,
  validateRoomTtl,
} from "@/lib/cliplink/validation";

export async function POST(request: Request) {
  const rateLimit = await roomCreateRateLimit.check(getClientIp(request));
  if (!rateLimit.ok) {
    return rateLimitResponse(
      "Too many rooms created. Please wait a moment and try again.",
      rateLimit.retryAfterSeconds,
    );
  }

  let payload: CreateRoomRequest = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody) as CreateRoomRequest;
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
    }
  }

  const ttl = validateRoomTtl(payload.ttlSeconds);
  if (!ttl.ok) {
    return errorResponse(400, "invalid_ttl", ttl.message);
  }

  const keyCheck = validateKeyCheck(payload.keyCheck);
  if (!keyCheck.ok) {
    return errorResponse(400, "invalid_key_check", keyCheck.message);
  }

  const eraseCheck = validateEraseCheck(payload.eraseCheck);
  if (!eraseCheck.ok) {
    return errorResponse(400, "invalid_erase_check", eraseCheck.message);
  }

  const code = validateRequestedRoomCode(payload.code);
  if (!code.ok) {
    return errorResponse(400, "invalid_room_code", code.message);
  }

  let room;
  try {
    room = await storage.createRoom({
      code: code.code,
      ttlSeconds: ttl.ttlSeconds,
      keyCheck: keyCheck.keyCheck,
      // A room with no key fingerprint is an open one, whose check only the
      // server can supply — see openRoomEraseCheck. A keyed room that sent
      // none stays undeletable: its creator predates deletion.
      eraseCheck:
        eraseCheck.eraseCheck ??
        (keyCheck.keyCheck ? undefined : openRoomEraseCheck),
    });
  } catch (error) {
    if (error instanceof RoomCodeTakenError) {
      return errorResponse(
        409,
        "room_code_taken",
        "That room code is already in use.",
      );
    }
    return storageErrorResponse(error);
  }

  const response: CreateRoomResponse = {
    code: room.code,
    ttlSeconds: ttl.ttlSeconds,
  };

  return noStoreJson(response, { status: 201 });
}
