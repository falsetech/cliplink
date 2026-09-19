/**
 * Re-exported from `@thebkht/cliplink`, which the CLI shares. The app keeps
 * importing from `@/lib/cliplink/...`, so the move is invisible above this line.
 */
export {
  decryptClipText,
  deriveOpenRoomKey,
  encryptClipText,
  formatRoomKey,
  generateRoomKey,
  importRoomKey,
  normalizeRoomKey,
  openSignal,
  sealSignal,
  type RoomKey,
} from "@thebkht/cliplink";
