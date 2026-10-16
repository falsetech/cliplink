/**
 * Re-exported from `@thebkht/cliplink`, which the CLI shares. The app keeps
 * importing from `@/lib/cliplink/...`, so the move is invisible above this line.
 */
export {
  decryptClipText,
  deriveOpenRoomKey,
  deriveRoomKeyFromPassphrase,
  encryptClipText,
  formatRoomKey,
  generateRoomKey,
  importRoomKey,
  looksLikeRoomKey,
  normalizePassphrase,
  normalizeRoomKey,
  resolveRoomSecret,
  openSignal,
  sealSignal,
  type RoomKey,
} from "@thebkht/cliplink";
