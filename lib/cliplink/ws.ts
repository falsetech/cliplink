import {
  connectRoom,
  pollClipsRequest,
  sendClipRequest,
} from "@/lib/cliplink/http";
import type {
  RoomCode,
  TransportClient,
  WsClientMessage,
  WsServerMessage,
} from "@/lib/cliplink/types";

export function createWebSocketTransport(): TransportClient {
  let socketCleanup: (() => void) | null = null;
  let activeSocket: WebSocket | null = null;

  return {
    connect: connectRoom,
    sendClip: sendClipRequest,
    pollClips: pollClipsRequest,

    streamClips(roomCode: RoomCode, afterId, peerId, handlers) {
      if (typeof window === "undefined" || typeof WebSocket === "undefined") {
        return null;
      }

      socketCleanup?.();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        after: String(afterId),
        peer: peerId,
      });
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/rooms/${roomCode}/socket?${params}`,
      );
      activeSocket = socket;
      let isClosed = false;

      const fail = () => {
        if (isClosed) {
          return;
        }
        isClosed = true;
        if (activeSocket === socket) {
          activeSocket = null;
        }
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
          if (message.type === "signal") {
            handlers.onSignal?.(message.from, message.payload);
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
        if (activeSocket === socket) {
          activeSocket = null;
        }
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

    sendSignal(payload, to) {
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        return false;
      }
      const message: WsClientMessage = { type: "signal", to, payload };
      activeSocket.send(JSON.stringify(message));
      return true;
    },

    disconnect() {
      socketCleanup?.();
    },
  };
}
