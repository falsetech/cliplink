import { errorResponse, noStoreJson } from "@/lib/cliplink/errors";
import { storage } from "@/lib/cliplink/storage";
import type { CreateRoomRequest, CreateRoomResponse } from "@/lib/cliplink/types";
import { validateRoomTtl } from "@/lib/cliplink/validation";

export async function POST(request: Request) {
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

  const room = await storage.createRoom(ttl.ttlSeconds);
  const response: CreateRoomResponse = {
    code: room.code,
    ttlSeconds: ttl.ttlSeconds,
  };

  return noStoreJson(response, { status: 201 });
}
