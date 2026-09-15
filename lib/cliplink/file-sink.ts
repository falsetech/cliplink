import type { FileSink } from "@thebkht/rtc-file-transfer";
import {
  canPickFile,
  clearOpfs,
  directorySink,
  hasOpfs,
  opfsSink,
  pickFileSink,
} from "@thebkht/rtc-file-transfer/sinks";

import { createRandomId } from "./session";

export { canPickDirectory, pickDirectory } from "@thebkht/rtc-file-transfer/sinks";

/** Writes one file of a batch to `path/name` under the picked folder. */
export const createDirectorySink = directorySink;

/**
 * Each tab keeps its OPFS downloads in a folder of its own, held under a Web
 * Lock for the tab's lifetime. A tab can't clean up when it is closed, so the
 * next tab to start removes every folder whose lock nobody holds any more.
 */
const OPFS_PREFIX = "cliplink-";
const opfsDirectory = `${OPFS_PREFIX}${createRandomId()}`;
let opfsClaimed = false;

function claimOpfsDirectory() {
  if (opfsClaimed || typeof navigator === "undefined" || !navigator.locks) {
    return;
  }
  opfsClaimed = true;
  void navigator.locks
    .request(opfsDirectory, () => new Promise<never>(() => {}))
    .catch(() => {});
  void removeAbandonedOpfsDirectories();
}

async function removeAbandonedOpfsDirectories() {
  try {
    const held = new Set(
      ((await navigator.locks.query()).held ?? []).map((lock) => lock.name),
    );
    const root = await navigator.storage.getDirectory();
    const names = (root as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const name of names) {
      if (name.startsWith(OPFS_PREFIX) && name !== opfsDirectory && !held.has(name)) {
        await root.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
  } catch {
    // leftovers wait for the next tab
  }
}

/** Large downloads can stream to disk: a picked file, or the private file system. */
export function canPickDiskSink() {
  return canPickFile() || hasOpfs();
}

/**
 * Streams a large download to disk so it never has to fit in memory: into a
 * file the user picks where the browser allows it (Chromium), otherwise into
 * the origin's private file system (Firefox, Safari), which then saves like a
 * normal download.
 *
 * Must be called from the click that started the download: the picker needs
 * user activation. Throws the picker's AbortError when the user dismisses it,
 * so the caller can drop the download; null means fall back to memory.
 */
export async function pickDiskSink(name: string): Promise<FileSink | null> {
  if (canPickFile()) {
    return pickFileSink(name);
  }
  if (!hasOpfs()) {
    return null;
  }
  claimOpfsDirectory();
  return opfsSink(name, { directory: opfsDirectory });
}

/** Deletes this tab's OPFS downloads, e.g. on leaving the room. */
export function releaseDiskFiles() {
  if (opfsClaimed) {
    void clearOpfs({ directory: opfsDirectory });
  }
}
