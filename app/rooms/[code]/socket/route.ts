import { experimental_upgradeWebSocket } from "@vercel/functions";

import { subscribeRoom } from "@/lib/cliplink/pubsub";
import { storage } from "@/lib/cliplink/storage";
import type { Clip, WsServerMessage } from "@/lib/cliplink/types";
import { validateRoomCode } from "@/lib/cliplink/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!validateRoomCode(code)) {
    return new Response("Invalid room code", { status: 400 });
  }

  const url = new URL(request.url);
  const afterParam = Number(url.searchParams.get("after") ?? "0");
  const initialAfterId =
    Number.isFinite(afterParam) && afterParam >= 0 ? afterParam : 0;

  return experimental_upgradeWebSocket((ws) => {
    let closed = false;
    let lastSentId = initialAfterId;
    let backlogFlushed = false;
    const buffered: Clip[] = [];

    const send = (message: WsServerMessage) => {
      if (closed) {
        return;
      }
      ws.send(JSON.stringify(message));
    };

    const sendClip = (clip: Clip) => {
      send({ type: "clip", clip });
      if (clip.id > lastSentId) {
        lastSentId = clip.id;
      }
    };

    // Subscribe before reading backlog so no clip published mid-fetch is lost.
    const unsubscribe = subscribeRoom(code, (clip) => {
      if (closed) {
        return;
      }
      if (!backlogFlushed) {
        buffered.push(clip);
        return;
      }
      if (clip.id > lastSentId) {
        sendClip(clip);
      }
    });

    void (async () => {
      try {
        const backlog = await storage.getClipsAfter(code, initialAfterId);
        if (!backlog) {
          send({ type: "error", reason: "room_not_found" });
          closed = true;
          ws.close();
          return;
        }

        for (const clip of backlog) {
          sendClip(clip);
        }

        backlogFlushed = true;
        for (const clip of buffered) {
          if (clip.id > lastSentId) {
            sendClip(clip);
          }
        }
        buffered.length = 0;

        send({ type: "ready" });
      } catch (error) {
        console.error("WebSocket backlog fetch failed", error);
        send({ type: "error", reason: "internal_error" });
        closed = true;
        ws.close();
      }
    })();

    ws.on("close", () => {
      closed = true;
      unsubscribe();
    });
  });
}
