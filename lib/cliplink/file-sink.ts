import type {
  FileSink,
  ResumeProvider,
  StoredFile,
} from "@thebkht/rtc-file-transfer";
import {
  canPickFile,
  clearOpfs,
  directorySink,
  hasOpfs,
  opfsResume,
  opfsSink,
  pickFileSink,
} from "@thebkht/rtc-file-transfer/sinks";

import { ROOM_TTL_SECONDS, SEED_BUDGET_BYTES } from "./constants";
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

// -----------------------------------------------------------------------------
// The seed store
//
// Received files stay here so this device can pass them on to the rest of the
// room: the sender can close its tab, and a third device pulls from whoever is
// nearest. It doubles as the resume store, because a partial download and a
// file worth seeding are the same bytes at different points.
//
// It outlives a tab, unlike the per-tab download folders above, so the app —
// not a Web Lock — decides what stays: files from this room, young enough to
// still have a room to belong to, inside a byte budget.

const SEED_DIRECTORY = "cliplink-resume";

/** Tagged with the room, so a sweep can tell this room's files from another's. */
export function createSeedStore(tag: () => string | null): ResumeProvider {
  // The tag is read when the store is built, which is the first time a file is
  // written — by then the room is joined.
  return opfsResume({ directory: SEED_DIRECTORY, tag: tag() ?? undefined });
}

function sweepStore() {
  return opfsResume({ directory: SEED_DIRECTORY });
}

/**
 * The ceiling on what is kept, lowered on a device that hasn't the room for
 * it. `quota` is the whole origin's allowance, so half of it leaves as much
 * again for downloads in flight, zips being built, and everything else.
 */
async function seedBudget() {
  try {
    const { quota } = await navigator.storage.estimate();
    return quota && quota > 0
      ? Math.min(SEED_BUDGET_BYTES, Math.floor(quota / 2))
      : SEED_BUDGET_BYTES;
  } catch {
    return SEED_BUDGET_BYTES;
  }
}

/** Complete files this device holds for `tag`, ready to be re-offered. */
export async function heldFiles(tag: string): Promise<StoredFile[]> {
  if (!hasOpfs()) {
    return [];
  }
  try {
    const held = (await sweepStore().list?.()) ?? [];
    return held.filter(
      (entry) =>
        entry.meta.tag === tag && entry.state.verifiedBytes === entry.key.size,
    );
  } catch {
    // No private file system, or it refused: this device simply doesn't seed.
    return [];
  }
}

/**
 * Drops what is no longer worth keeping: files from another room, files older
 * than a room lives, and — oldest first — whatever is over budget. Called on
 * joining and on leaving, and every failure is silent: not seeding is a
 * smaller problem than a broken app.
 */
export async function sweepSeedStore(keepTag: string | null) {
  if (!hasOpfs()) {
    return;
  }
  try {
    const store = sweepStore();
    const held = (await store.list?.()) ?? [];
    const budget = await seedBudget();
    const oldest = Date.now() - ROOM_TTL_SECONDS * 1000;

    // Newest first, so the budget is spent on what is most likely wanted.
    const keep = held
      .filter((entry) => entry.meta.tag === keepTag && entry.meta.ts > oldest)
      .sort((left, right) => right.meta.ts - left.meta.ts);

    let kept = 0;
    const drop = held.filter((entry) => !keep.includes(entry));
    for (const entry of keep) {
      kept += entry.state.verifiedBytes;
      if (kept > budget) {
        drop.push(entry);
      }
    }
    for (const entry of drop) {
      await Promise.resolve(store.forget(entry.key)).catch(() => {});
    }
  } catch {
    // Leftovers wait for the next sweep.
  }
}
