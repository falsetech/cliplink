import {
  errorResponse,
  noStoreJson,
  storageErrorResponse,
} from "@/lib/cliplink/errors";
import { publishClip } from "@/lib/cliplink/pubsub";
import { checkRateLimit, getClientIp } from "@/lib/cliplink/rate-limit";
import { createClipId, storage } from "@/lib/cliplink/storage";
import type {
  CreateClipRequest,
  CreateClipResponse,
  PollClipsResponse,
} from "@/lib/cliplink/types";
import {
  validateClipText,
  validateRoomCode,
  validateSenderId,
} from "@/lib/cliplink/validation";

type RoomRouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(
  request: Request,
  context: RoomRouteContext,
) {
  const { code } = await context.params;
  if (!validateRoomCode(code)) {
    return errorResponse(400, "invalid_room_code", "Invalid room code.");
  }

  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const afterId = Number.isFinite(after) && after >= 0 ? after : 0;

  let clips;
  try {
    clips = await storage.getClipsAfter(code, afterId);
  } catch (error) {
    return storageErrorResponse(error);
  }

  if (!clips) {
    return errorResponse(404, "room_not_found", "Room not found.");
  }

  const response: PollClipsResponse = { clips };
  return noStoreJson(response);
}

export async function POST(
  request: Request,
  context: RoomRouteContext,
) {
  const { code } = await context.params;
  if (!validateRoomCode(code)) {
    return errorResponse(400, "invalid_room_code", "Invalid room code.");
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimit(`${clientIp}:${code}`);
  if (!rateLimit.ok) {
    return errorResponse(
      429,
      "rate_limited",
      "Too many clips sent. Please wait a moment and try again.",
      `Retry after ${rateLimit.retryAfterSeconds} seconds.`,
    );
  }

  let payload: CreateClipRequest;
  try {
    payload = (await request.json()) as CreateClipRequest;
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (!validateSenderId(payload.senderId)) {
    return errorResponse(400, "invalid_sender_id", "Invalid sender id.");
  }

  const validatedText = validateClipText(payload.text);
  if (!validatedText.ok) {
    return errorResponse(400, "invalid_clip_text", validatedText.message);
  }

  const clip = {
    id: createClipId(),
    text: validatedText.text,
    senderId: payload.senderId,
    ts: Date.now(),
  };

  let room;
  try {
    room = await storage.appendClip(code, clip);
  } catch (error) {
    return storageErrorResponse(error);
  }

  if (!room) {
    return errorResponse(404, "room_not_found", "Room not found.");
  }

  await publishClip(code, clip);

  // The append just extended the TTL, so the client's copy is already stale.
  // Returning it here beats making every sender follow up with a second call.
  let expiresAt: number | null = null;
  try {
    expiresAt = await storage.getRoomExpiresAt(code);
  } catch {
    // The clip is stored; a missing countdown is not worth failing the send.
  }

  const response: CreateClipResponse = {
    clip,
    ...(expiresAt === null ? {} : { expiresAt }),
  };
  return noStoreJson(response, { status: 201 });
}
