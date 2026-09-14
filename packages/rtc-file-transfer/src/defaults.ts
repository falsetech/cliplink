export type TransferLimits = {
  /** Largest file that may be offered or accepted. */
  maxFileBytes: number;
  /** Upper bound on a chunk; lowered further to the channel's max message size. */
  chunkBytes: number;
  /** Stop sending while the channel has this much queued. */
  bufferHighBytes: number;
  /** Resume sending once the queue drains below this. */
  bufferLowBytes: number;
  /** Fail a transfer that makes no progress for this long. */
  stallMs: number;
  /** Idle incoming items beyond this count are evicted, oldest first. */
  maxItems: number;
};

export const DEFAULT_LIMITS: TransferLimits = {
  maxFileBytes: 500 * 1024 * 1024,
  chunkBytes: 64 * 1024,
  bufferHighBytes: 4 * 1024 * 1024,
  bufferLowBytes: 1024 * 1024,
  stallMs: 20_000,
  maxItems: 20,
};

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/**
 * `crypto.randomUUID` only exists in secure contexts, so plain-http LAN
 * testing falls back to Math.random.
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
