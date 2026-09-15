import { formatBytes, truncatePreview } from "./format";
import type { RoomCode } from "./types";

/** Text and files handed to CLIPLINK by the OS share sheet. */
export type PendingShare = { text: string; files: File[] };

/** Must match public/sw.js. */
const SHARE_CACHE = "cliplink-share-v1";
const SHARE_META = "/share-target/meta";
const SHARE_FILE = "/share-target/file/";

type ShareMeta = {
  title: string;
  text: string;
  url: string;
  files: { name: string; type: string; lastModified: number }[];
};

function isShareMeta(value: unknown): value is ShareMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const meta = value as Record<string, unknown>;
  return (
    typeof meta.title === "string" &&
    typeof meta.text === "string" &&
    typeof meta.url === "string" &&
    Array.isArray(meta.files)
  );
}

/**
 * Targets disagree on where a shared link goes: some send it as `url`, some
 * inside `text`, some in both. Keep each piece once. The title is only used
 * when nothing else came, since it usually repeats the page's own heading.
 */
export function composeShareText({ title, text, url }: Pick<ShareMeta, "title" | "text" | "url">) {
  const parts = [text.trim()];
  const link = url.trim();
  if (link && !parts[0].includes(link)) {
    parts.push(link);
  }
  const body = parts.filter(Boolean).join("\n");
  return body || title.trim();
}

async function readCachedShare(): Promise<PendingShare | null> {
  if (typeof caches === "undefined") {
    return null;
  }
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaResponse = await cache.match(SHARE_META);
    if (!metaResponse) {
      return null;
    }
    const meta: unknown = await metaResponse.json();
    if (!isShareMeta(meta)) {
      await caches.delete(SHARE_CACHE);
      return null;
    }

    const files: File[] = [];
    for (const [index, entry] of meta.files.entries()) {
      const response = await cache.match(SHARE_FILE + index);
      if (response) {
        const blob = await response.blob();
        files.push(
          new File([blob], entry.name || "file", {
            type: entry.type,
            lastModified: entry.lastModified,
          }),
        );
      }
    }
    // The Files above are copies read into memory, so the cached bytes can go.
    await caches.delete(SHARE_CACHE);

    const share = { text: composeShareText(meta), files };
    return share.text || share.files.length > 0 ? share : null;
  } catch {
    return null;
  }
}

let claim: Promise<PendingShare | null> | null = null;

/**
 * Reads the share the service worker parked, then deletes it so it is claimed
 * once. Null when there is none, or when Cache Storage is unavailable.
 *
 * Repeat calls in the same page load get the same answer, so an effect that
 * runs twice (React's development re-run) doesn't find the cache already empty.
 */
export function claimCachedShare() {
  claim ??= readCachedShare();
  return claim;
}

let held: PendingShare | null = null;

/**
 * Holds a share across the client-side navigation from /share into the room
 * that was created or joined for it. Module state rather than storage: File
 * objects don't serialize, and a share that outlives the tab shouldn't exist.
 */
export function holdShare(share: PendingShare | null) {
  held = share;
}

export function takeHeldShare() {
  const share = held;
  held = null;
  return share;
}

export function describeShare(share: PendingShare) {
  if (share.files.length > 0) {
    const bytes = share.files.reduce((total, file) => total + file.size, 0);
    const count =
      share.files.length === 1 ? share.files[0].name : `${share.files.length} files`;
    return `${count} · ${formatBytes(bytes)}${share.text ? " + text" : ""}`;
  }
  return truncatePreview(share.text, 80);
}

/**
 * Same-origin tabs coordinate over this channel: the share page asks which
 * tabs are in a room, and hands the share to the one the user picks. Room
 * codes cross it, never room keys.
 */
export const SHARE_CHANNEL = "cliplink:share";

export type ShareMessage =
  | { type: "probe" }
  | { type: "here"; tabId: string; code: RoomCode }
  | { type: "deliver"; tabId: string; share: PendingShare }
  | { type: "delivered"; tabId: string };

export function isShareMessage(value: unknown): value is ShareMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "probe":
      return true;
    case "here":
      return typeof message.tabId === "string" && typeof message.code === "string";
    case "deliver": {
      const share = message.share as Record<string, unknown> | null;
      return (
        typeof message.tabId === "string" &&
        typeof share === "object" &&
        share !== null &&
        typeof share.text === "string" &&
        Array.isArray(share.files) &&
        share.files.every((file) => file instanceof File)
      );
    }
    case "delivered":
      return typeof message.tabId === "string";
    default:
      return false;
  }
}
