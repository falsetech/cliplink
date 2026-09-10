export const ROOM_CODE_LENGTH = 6;
export const ROOM_TTL_SECONDS = 60 * 60 * 6;
export const MIN_ROOM_TTL_SECONDS = 60 * 60;
export const MAX_ROOM_TTL_SECONDS = 60 * 60 * 24;
export const MAX_ROOM_CLIPS = 50;
export const MAX_SESSION_HISTORY = 20;
export const POLL_INTERVAL_MS = 1500;
export const MAX_CLIP_CHARS = 20_000;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 60;

// Peer-to-peer file transfer. Files never touch the server; only signaling does.
export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_FILE_NAME_CHARS = 255;
export const FILE_CHUNK_BYTES = 64 * 1024;
export const FILE_BUFFER_HIGH_BYTES = 4 * 1024 * 1024;
export const FILE_BUFFER_LOW_BYTES = 1024 * 1024;
export const TRANSFER_STALL_MS = 20_000;
export const MAX_SESSION_FILES = 20;
export const MAX_SIGNAL_BYTES = 16 * 1024;
export const SIGNAL_RATE_WINDOW_MS = 10_000;
export const SIGNAL_RATE_MAX_MESSAGES = 200;
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
