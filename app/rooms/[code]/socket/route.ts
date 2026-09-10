import { experimental_upgradeWebSocket } from "@vercel/functions";

import {
  MAX_SIGNAL_BYTES,
  SIGNAL_RATE_MAX_MESSAGES,
  SIGNAL_RATE_WINDOW_MS,
} from "@/lib/cliplink/constants";
import { publishSignal, subscribeRoom } from "@/lib/cliplink/pubsub";
import { storage } from "@/lib/cliplink/storage";
import type { Clip, WsServerMessage } from "@/lib/cliplink/types";
import {
  parseClientMessage,
  validatePeerId,
  validateRoomCode,
} from "@/lib/cliplink/validation";

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

  // Peers without a valid id still receive clips; they just can't signal.
  const peerParam = url.searchParams.get("peer");
  const peerId = validatePeerId(peerParam) ? peerParam : null;

  return experimental_upgradeWebSocket(
    (ws) => {
      let closed = false;
      let lastSentId = initialAfterId;
      let backlogFlushed = false;
      const buffered: Clip[] = [];
      let signalWindowStart = Date.now();
      let signalCount = 0;

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
      const unsubscribe = subscribeRoom(code, {
        onClip: (clip) => {
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
        },
        onSignal: (envelope) => {
          if (!peerId || envelope.from === peerId) {
            return;
          }
          if (envelope.to !== undefined && envelope.to !== peerId) {
            return;
          }
          send({ type: "signal", from: envelope.from, payload: envelope.payload });
        },
      });

      const allowSignal = () => {
        const now = Date.now();
        if (now - signalWindowStart >= SIGNAL_RATE_WINDOW_MS) {
          signalWindowStart = now;
          signalCount = 0;
        }
        signalCount += 1;
        return signalCount <= SIGNAL_RATE_MAX_MESSAGES;
      };

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        if (closed || !peerId || isBinary || !Buffer.isBuffer(data) || !allowSignal()) {
          return;
        }

        const message = parseClientMessage(data.toString("utf8"));
        if (!message) {
          return;
        }

        void publishSignal(code, {
          from: peerId,
          to: message.to,
          payload: message.payload,
        });
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
        if (peerId) {
          // Lets other peers drop this peer's file offers even if the tab crashed.
          void publishSignal(code, { from: peerId, payload: { type: "peer-left" } });
        }
      });
    },
    { maxPayload: MAX_SIGNAL_BYTES },
  );
}
