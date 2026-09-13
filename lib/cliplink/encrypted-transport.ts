import {
  decryptClipText,
  encryptClipText,
  openSignal,
  sealSignal,
  type RoomKey,
} from "@/lib/cliplink/crypto";
import type {
  Clip,
  RoomCode,
  SealedTransport,
  TransportClient,
} from "@/lib/cliplink/types";
import { parseSignalPayload } from "@/lib/cliplink/validation";

/**
 * Shown in place of a clip that will not open. Never silently dropped: a row
 * that cannot be read is how someone learns they pasted the wrong key, and a
 * clip that vanishes teaches them nothing.
 */
export const UNDECRYPTABLE_TEXT = "[Could not decrypt this clip]";

/**
 * Thrown when the loaded key does not match the fingerprint the room was
 * created with. Checked here rather than by the caller so that no connection
 * can commit state under a key that was never going to work.
 */
export class RoomKeyMismatchError extends Error {
  constructor() {
    super("That key does not match this room.");
    this.name = "RoomKeyMismatchError";
  }
}

export type EncryptedTransport = TransportClient & {
  /** Set on join, cleared on leave. Null means nothing can be sent or read. */
  setRoomKey: (roomCode: RoomCode, key: RoomKey) => void;
  clearRoomKey: () => void;
};

/**
 * Wraps a wire transport so everything above it works in plaintext.
 *
 * Encryption belongs here rather than in the room session hook because the
 * transport is the seam the rest of the app already talks through — the retry
 * and backoff state machine above it is written once and stays written once.
 */
export function createEncryptedTransport(
  wire: SealedTransport,
): EncryptedTransport {
  let roomKey: RoomKey | null = null;
  let roomCode: RoomCode | null = null;

  // Signals seal asynchronously but must arrive in the order they were sent —
  // an ICE candidate overtaking the description it belongs to would break the
  // handshake. Chaining keeps send order without making callers await.
  let sendChain: Promise<void> = Promise.resolve();

  async function decryptClips(clips: Clip[]): Promise<Clip[]> {
    const key = roomKey;
    const code = roomCode;
    if (!key || !code) {
      return clips.map((clip) => ({ ...clip, text: UNDECRYPTABLE_TEXT }));
    }

    return Promise.all(
      clips.map(async (clip) => {
        const text = await decryptClipText(key, code, clip.text);
        return { ...clip, text: text ?? UNDECRYPTABLE_TEXT };
      }),
    );
  }

  return {
    setRoomKey(nextRoomCode, key) {
      roomCode = nextRoomCode;
      roomKey = key;
    },

    clearRoomKey() {
      roomCode = null;
      roomKey = null;
    },

    async connect(code) {
      const response = await wire.connect(code);
      const key = roomKey;
      if (key && response.room.keyCheck && response.room.keyCheck !== key.check) {
        throw new RoomKeyMismatchError();
      }
      return { ...response, clips: await decryptClips(response.clips) };
    },

    async sendClip(code, payload) {
      const key = roomKey;
      if (!key) {
        throw new Error("This room is encrypted and no key is loaded.");
      }

      const response = await wire.sendClip(code, {
        ...payload,
        text: await encryptClipText(key, code, payload.text),
      });
      // Echo back what the caller handed us rather than decrypting our own
      // ciphertext, so the sender's own history row cannot read as broken.
      return { ...response, clip: { ...response.clip, text: payload.text } };
    },

    async pollClips(code, afterId) {
      const response = await wire.pollClips(code, afterId);
      return { clips: await decryptClips(response.clips) };
    },

    streamClips(code, afterId, peerId, handlers) {
      return wire.streamClips(code, afterId, peerId, {
        onOpen: handlers.onOpen,
        onClips: (clips) => {
          void decryptClips(clips).then(handlers.onClips);
        },
        onSealedSignal: (from, sealed) => {
          const key = roomKey;
          const signalRoom = roomCode;
          if (!key || !signalRoom || !handlers.onSignal) {
            return;
          }
          void openSignal(key, signalRoom, sealed).then((payload) => {
            // Validated after decryption, which is the only place it can be:
            // the server relays a signal it cannot read, so rebuilding the
            // payload from known fields is the client's job now.
            const parsed = payload === null ? null : parseSignalPayload(payload);
            if (parsed) {
              handlers.onSignal?.(from, parsed);
            }
          });
        },
        // Arrives unsealed because the server originates it, but the rest of
        // the app has no reason to care which channel it came in on.
        onPeerLeft: (from) => handlers.onSignal?.(from, { type: "peer-left" }),
        onDisconnect: handlers.onDisconnect,
      });
    },

    sendSignal(payload, to) {
      const key = roomKey;
      const code = roomCode;
      if (!key || !code || !wire.canSend()) {
        return false;
      }

      sendChain = sendChain
        .then(async () => {
          wire.sendSealedSignal(await sealSignal(key, code, payload), to);
        })
        .catch(() => {
          // A signal that cannot be sealed is dropped. Transfers already
          // recover from a lost signal by stalling and retrying.
        });
      return true;
    },

    disconnect: wire.disconnect,
  };
}
