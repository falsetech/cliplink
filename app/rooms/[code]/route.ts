import {
  errorResponse,
  noStoreJson,
  storageErrorResponse,
} from "@/lib/cliplink/errors";
import { storage } from "@/lib/cliplink/storage";
import type { GetRoomResponse } from "@/lib/cliplink/types";
import { validateRoomCode } from "@/lib/cliplink/validation";

type RoomRouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(
  _request: Request,
  context: RoomRouteContext,
) {
  const { code } = await context.params;
  if (!validateRoomCode(code)) {
    return errorResponse(400, "invalid_room_code", "Invalid room code.");
  }

  let room;
  try {
    room = await storage.getRoom(code);
  } catch (error) {
    return storageErrorResponse(error);
  }

  if (!room) {
    return errorResponse(404, "room_not_found", "Room not found.");
  }

  const response: GetRoomResponse = {
    room: {
      code: room.code,
      createdAt: room.createdAt,
    },
    clips: room.clips,
  };

  return noStoreJson(response);
}
