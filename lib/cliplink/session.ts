const SENDER_KEY = "cliplink:sender-id";

function createSenderId() {
  const prefix = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${prefix}${suffix}`;
}

/**
 * Random id for peers, offers, and transfers. `crypto.randomUUID` only exists
 * in secure contexts, so plain-http LAN testing falls back to Math.random.
 */
export function createRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const suffix = Array.from({ length: 3 }, () =>
    Math.random().toString(36).slice(2, 10),
  ).join("");
  return `${Date.now().toString(36)}${suffix}`;
}

export function getSessionSenderId() {
  if (typeof window === "undefined") {
    return createSenderId();
  }

  const existing = window.sessionStorage.getItem(SENDER_KEY);
  if (existing) {
    return existing;
  }

  const next = createSenderId();
  window.sessionStorage.setItem(SENDER_KEY, next);
  return next;
}
