import { createRandomId } from "@/lib/cliplink/session";
import { normalizeDeviceName } from "@/lib/cliplink/validation";

const NAME_KEY = "cliplink:device-name";
const SECRET_KEY = "cliplink:device-secret";

/** What the server render and a browser with no usable user agent both show. */
const FALLBACK_NAME = "Browser";

/** Stands in for the stored secret when storage is blocked: one tab's worth. */
let memorySecret: string | null = null;

const listeners = new Set<() => void>();

/** For `useSyncExternalStore`, so every place the name is shown follows a rename. */
export function subscribeToDeviceName(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * "Chrome on Mac" — enough to tell two devices in a room apart without asking
 * anyone to type anything. Coarse on purpose: this is a label, and a full user
 * agent in a room's history would be a fingerprint.
 */
function defaultDeviceName() {
  const agent = navigator.userAgent;
  const browser = /Edg(e|A|iOS)?\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(agent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : FALLBACK_NAME;
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux/.test(agent)
              ? "Linux"
              : null;
  return system ? `${browser} on ${system}` : browser;
}

/** The name this device sends with its clips: the one chosen, or the default. */
export function getDeviceName() {
  if (typeof window === "undefined") {
    return FALLBACK_NAME;
  }

  try {
    const stored = normalizeDeviceName(window.localStorage.getItem(NAME_KEY));
    if (stored) {
      return stored;
    }
  } catch {
    // Storage is blocked: the default is all there is.
  }
  return defaultDeviceName();
}

/** An empty name goes back to the default rather than sending a blank. */
export function setDeviceName(value: string) {
  const name = normalizeDeviceName(value);
  try {
    if (name && name !== defaultDeviceName()) {
      window.localStorage.setItem(NAME_KEY, name);
    } else {
      window.localStorage.removeItem(NAME_KEY);
    }
  } catch {
    // Nothing to do: the next read reports the default.
  }
  for (const listener of listeners) {
    listener();
  }
}

function deviceSecret() {
  try {
    const existing = window.localStorage.getItem(SECRET_KEY);
    if (existing) {
      return existing;
    }
    const next = createRandomId();
    window.localStorage.setItem(SECRET_KEY, next);
    return next;
  } catch {
    memorySecret ??= createRandomId();
    return memorySecret;
  }
}

/**
 * The mark this browser puts on a clip it sends, so the clip still reads as
 * sent after a reload or in a second tab.
 *
 * A hash of a secret that never leaves this browser with the room and the
 * clip's own text — not an id. Everyone in the room can read a clip's mark,
 * so an id would be theirs to copy onto a clip of their own, which this
 * device would then file as something it had sent and never announce. A mark
 * is only good for the text it was made for, and only this browser can make
 * one. It differs from clip to clip, so it does not link them either.
 */
export async function ownClipMark(roomCode: string, text: string) {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `cliplink:device:${deviceSecret()}:${roomCode}:${text}`,
      ),
    );
    return Array.from(new Uint8Array(digest).subarray(0, 16), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    // No WebCrypto, so no room either; direction falls back to the sender id.
    return null;
  }
}
