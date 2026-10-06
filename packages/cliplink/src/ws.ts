import { createHttpClient, resolveBaseUrl } from "./http.ts";
import { SOCKET_HANDOFF_CLOSE_CODE } from "./protocol.ts";
import type {
  RoomCode,
  SealedTransport,
  TransportOptions,
  WsClientMessage,
  WsServerMessage,
} from "./types.ts";

/**
 * `WebSocket.OPEN` as the spec fixes it. Read from the constant rather than the
 * constructor because the constructor may be an injected one — Node's `ws`, a
 * test double — and only the numeric value is guaranteed across them.
 */
const OPEN = 1;

/** `https:` → `wss:`, `http:` → `ws:`, for the socket URL under the same origin. */
function toSocketOrigin(baseUrl: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export function createWebSocketTransport(
  options: TransportOptions,
): SealedTransport {
  const http = createHttpClient(options);

  let socketCleanup: (() => void) | null = null;
  let activeSocket: WebSocket | null = null;

  return {
    connect: http.connectRoom,
    sendClip: http.sendClipRequest,
    pollClips: http.pollClipsRequest,

    streamClips(roomCode: RoomCode, afterId, peerId, handlers) {
      // Resolved here rather than at construction: a browser transport is built
      // at module scope, which is also evaluated during server rendering.
      const SocketImpl = options.WebSocket ?? globalThis.WebSocket;
      if (typeof SocketImpl === "undefined") {
        return null;
      }

      socketCleanup?.();

      /**
       * One socket of this stream. Usually the only one; during a handoff, the
       * old one and its replacement are both open for as long as it takes the
       * replacement to say it is ready.
       */
      type Line = {
        socket: WebSocket;
        ready: boolean;
        detach: () => void;
      };

      let current: Line | null = null;
      let replacement: Line | null = null;
      let isClosed = false;
      let opened = false;
      // Both sockets carry the room's clips while they overlap, and the
      // replacement's backlog starts from here, so this is what keeps a clip
      // from being reported twice.
      let lastClipId = afterId;

      const retire = (line: Line, code?: number) => {
        line.detach();
        line.socket.close(code);
      };

      const fail = () => {
        if (isClosed) {
          return;
        }
        isClosed = true;
        for (const line of [current, replacement]) {
          if (line) {
            retire(line);
          }
        }
        current = null;
        replacement = null;
        activeSocket = null;
        handlers.onDisconnect("error");
      };

      const promote = (line: Line) => {
        const previous = current;
        current = line;
        replacement = null;
        activeSocket = line.socket;
        if (previous) {
          retire(previous, SOCKET_HANDOFF_CLOSE_CODE);
        }
      };

      const dial = (after: number): Line => {
        const params = new URLSearchParams({
          after: String(after),
          peer: peerId,
        });
        const socketUrl = toSocketOrigin(resolveBaseUrl(options.baseUrl));
        socketUrl.pathname = `/rooms/${roomCode}/socket`;
        socketUrl.search = params.toString();

        const socket = new SocketImpl(socketUrl.toString());
        const line: Line = { socket, ready: false, detach: () => {} };

        // A replacement that cannot open is dropped quietly: the socket it was
        // meant to replace is still up, and when that one goes, it goes the
        // way any socket does.
        const lose = () => {
          if (line === replacement) {
            replacement = null;
            retire(line);
            return;
          }
          fail();
        };

        const handleMessage = (event: MessageEvent<string>) => {
          let message: WsServerMessage;
          try {
            // Node's `ws` may hand over a Buffer where a browser gives a string.
            message = JSON.parse(String(event.data)) as WsServerMessage;
          } catch {
            lose();
            return;
          }

          if (message.type === "error") {
            lose();
            return;
          }
          if (message.type === "clip") {
            if (message.clip.id > lastClipId) {
              lastClipId = message.clip.id;
              handlers.onClips([message.clip]);
            }
            return;
          }
          if (message.type === "ready") {
            line.ready = true;
            if (line === replacement) {
              promote(line);
            }
            if (!opened) {
              opened = true;
              handlers.onOpen?.();
            }
            return;
          }
          // Until it is ready, a replacement's signals are also reaching the
          // socket it replaces, which is the one they are taken from.
          if (line !== current) {
            return;
          }
          if (message.type === "reconnect") {
            replacement ??= dial(lastClipId);
            return;
          }
          if (message.type === "signal") {
            handlers.onSealedSignal?.(message.from, message.sealed);
            return;
          }
          if (message.type === "peer-left") {
            handlers.onPeerLeft?.(message.from);
          }
        };

        const handleLoss = () => {
          if (line === current && replacement) {
            // The server closed the old socket before the new one was ready.
            // The new one takes over unready; its backlog covers the clips,
            // and anything it relays from here on has nowhere else to come
            // from.
            const next = replacement;
            current.detach();
            current = next;
            replacement = null;
            activeSocket = next.socket;
            return;
          }
          lose();
        };

        socket.addEventListener("message", handleMessage);
        socket.addEventListener("error", handleLoss);
        socket.addEventListener("close", handleLoss);
        line.detach = () => {
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("error", handleLoss);
          socket.removeEventListener("close", handleLoss);
        };
        return line;
      };

      current = dial(afterId);
      activeSocket = current.socket;

      socketCleanup = () => {
        isClosed = true;
        for (const line of [current, replacement]) {
          if (line) {
            retire(line);
          }
        }
        current = null;
        replacement = null;
        activeSocket = null;
        socketCleanup = null;
      };

      return () => {
        socketCleanup?.();
        handlers.onDisconnect("closed");
      };
    },

    canSend() {
      return activeSocket?.readyState === OPEN;
    },

    sendSealedSignal(sealed, to) {
      if (!activeSocket || activeSocket.readyState !== OPEN) {
        return false;
      }
      const message: WsClientMessage = { type: "signal", to, sealed };
      activeSocket.send(JSON.stringify(message));
      return true;
    },

    disconnect() {
      socketCleanup?.();
    },
  };
}
