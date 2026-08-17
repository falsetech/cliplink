import {
  connectRoom,
  pollClipsRequest,
  sendClipRequest,
} from "@/lib/cliplink/http";
import type { RoomCode, TransportClient, WsServerMessage } from "@/lib/cliplink/types";

export function createWebSocketTransport(): TransportClient {
  let socketCleanup: (() => void) | null = null;

  return {
    connect: connectRoom,
    sendClip: sendClipRequest,
    pollClips: pollClipsRequest,

    streamClips(roomCode: RoomCode, afterId, handlers) {
      if (typeof window === "undefined" || typeof WebSocket === "undefined") {
        return null;
      }

      socketCleanup?.();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/rooms/${roomCode}/socket?after=${encodeURIComponent(String(afterId))}`,
      );
      let isClosed = false;

      const fail = () => {
        if (isClosed) {
          return;
        }
        isClosed = true;
        socket.close();
        handlers.onDisconnect("error");
      };

      const handleMessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as WsServerMessage;
          if (message.type === "ready") {
            handlers.onOpen?.();
            return;
          }
          if (message.type === "clip") {
            handlers.onClips([message.clip]);
            return;
          }
          if (message.type === "error") {
            fail();
          }
        } catch {
          fail();
        }
      };

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", fail);
      socket.addEventListener("close", fail);

      socketCleanup = () => {
        isClosed = true;
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        socket.close();
        socketCleanup = null;
      };

      return () => {
        socketCleanup?.();
        handlers.onDisconnect("closed");
      };
    },

    disconnect() {
      socketCleanup?.();
    },
  };
}
