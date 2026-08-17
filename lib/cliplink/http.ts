import type {
  ApiError,
  CreateClipRequest,
  CreateClipResponse,
  CreateRoomResponse,
  GetRoomResponse,
  PollClipsResponse,
  RoomCode,
} from "@/lib/cliplink/types";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ApiError;

  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(error.details ?? error.error);
  }

  return payload as T;
}

export async function connectRoom(roomCode: RoomCode): Promise<GetRoomResponse> {
  const response = await fetch(`/rooms/${roomCode}`, {
    cache: "no-store",
  });
  return parseResponse<GetRoomResponse>(response);
}

export async function sendClipRequest(
  roomCode: RoomCode,
  payload: CreateClipRequest,
): Promise<CreateClipResponse> {
  const response = await fetch(`/rooms/${roomCode}/clips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse<CreateClipResponse>(response);
}

export async function pollClipsRequest(
  roomCode: RoomCode,
  afterId: number,
): Promise<PollClipsResponse> {
  const response = await fetch(`/rooms/${roomCode}/clips?after=${afterId}`, {
    cache: "no-store",
  });
  return parseResponse<PollClipsResponse>(response);
}

export async function createRoomRequest() {
  const response = await fetch("/rooms", {
    method: "POST",
  });
  return parseResponse<CreateRoomResponse>(response);
}
