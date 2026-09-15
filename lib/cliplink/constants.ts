export const ROOM_CODE_LENGTH = 6;
export const ROOM_TTL_SECONDS = 60 * 60 * 6;
export const MIN_ROOM_TTL_SECONDS = 60 * 60;
export const MAX_ROOM_TTL_SECONDS = 60 * 60 * 24;
export const MAX_ROOM_CLIPS = 50;
export const MAX_SESSION_HISTORY = 20;
export const POLL_INTERVAL_MS = 1500;
export const MAX_CLIP_CHARS = 20_000;
/**
 * The server sees only ciphertext, so it caps that instead. Sized from the
 * worst case the client can legitimately produce: MAX_CLIP_CHARS of 4-byte
 * UTF-8, plus nonce and tag, base64'd. The plaintext limit is still the real
 * one and is enforced in the editor, where the text is legible.
 */
export const MAX_CLIP_CIPHERTEXT_CHARS = 110_000;
/** Characters in a serialized room key — 32 bytes at 5 bits per character. */
export const ROOM_KEY_CHARS = 52;
/** Characters in the key's fingerprint — 8 bytes at 5 bits per character. */
export const ROOM_KEY_CHECK_CHARS = 13;
/**
 * Rate limits, as a burst and a regeneration rate rather than a quota per
 * window. A window resets on the clock, so a caller can spend the whole
 * allowance at the end of one window and the whole of the next allowance a
 * second later — twice the intended rate, in two seconds, while never breaking
 * the stated limit. A bucket has no reset to wait for: capacity comes back
 * continuously, so the burst is bounded and so is the sustained rate.
 */
export const CLIP_RATE_LIMIT = {
  /** A full bucket, and so the largest burst a single caller can spend. */
  burst: 60,
  refillTokens: 1,
  refillSeconds: 1,
} as const;

/** Tighter: creating rooms is cheap for the caller and costs the server a key. */
export const ROOM_CREATE_RATE_LIMIT = {
  burst: 10,
  refillTokens: 1,
  refillSeconds: 10,
} as const;

// Peer-to-peer file transfer. Files never touch the server; only signaling does.
// Chunking, buffer, and stall tuning live in @thebkht/rtc-file-transfer.
export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_FILE_NAME_CHARS = 255;
/**
 * Files in one share. Each is its own offer signal, and a late joiner's hello
 * is answered with all of them, so this keeps a full folder well inside
 * SIGNAL_RATE_MAX_MESSAGES.
 */
export const MAX_FILES_PER_SHARE = 50;
/** File rows a receiver keeps before evicting idle ones, so two full shares fit. */
export const MAX_FILE_ITEMS = 100;
/**
 * Largest group that can be downloaded as one zip. Every file is held in memory
 * until the archive is saved, so this is bounded by what a phone can hold, well
 * below ZIP's own 4 GiB limit.
 */
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
/**
 * Downloads this large stream to disk: a picked file in Chromium, the private
 * file system elsewhere.
 */
export const DISK_SINK_MIN_BYTES = 64 * 1024 * 1024;
// Sealing inflates a signal by base64's 4/3 plus a nonce and a tag, and an SDP
// offer already approached the old 16 KB ceiling. Left there, the socket's
// maxPayload would have dropped large offers with no error to see.
export const MAX_SIGNAL_BYTES = 24 * 1024;
export const SIGNAL_RATE_WINDOW_MS = 10_000;
export const SIGNAL_RATE_MAX_MESSAGES = 200;
