import { createRandomId } from "./defaults.ts";
import { BLOCK_BYTES } from "./protocol.ts";
import type {
  FileSink,
  ResumeKey,
  ResumeProvider,
  ResumeState,
  StoredFile,
  StoredMeta,
} from "./manager.ts";

/**
 * Ready-made `FileSink`s, so a download can stream to disk instead of memory.
 *
 * | Sink | Where the bytes go | Browsers |
 * | --- | --- | --- |
 * | `pickFileSink` | A file the user picks | Chromium |
 * | `directorySink` | A file inside a folder the user picked | Chromium |
 * | `opfsSink` | The Origin Private File System | Chromium, Firefox 111+, Safari 26+ |
 * | `writableSink` | Any `WritableStream` or `FileSystemWritableFileStream` | Everywhere |
 *
 * `bestSink` picks the first of these the browser supports.
 */

type SaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<FileSystemFileHandle>;

type DirectoryPicker = (options?: {
  mode?: "read" | "readwrite";
}) => Promise<FileSystemDirectoryHandle>;

/** What a sink needs from a stream; `FileSystemWritableFileStream` fits. */
export type WritableTarget =
  | {
      write(chunk: Uint8Array<ArrayBuffer>): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }
  | WritableStream<Uint8Array<ArrayBuffer>>;

function pickerFrom<T>(
  name: "showSaveFilePicker" | "showDirectoryPicker",
): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const picker = (window as unknown as Record<string, unknown>)[name];
  return typeof picker === "function" ? (picker.bind(window) as T) : null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** `showSaveFilePicker` exists. Chromium only. */
export function canPickFile() {
  return pickerFrom<SaveFilePicker>("showSaveFilePicker") !== null;
}

/** `showDirectoryPicker` exists. Chromium only. */
export function canPickDirectory() {
  return pickerFrom<DirectoryPicker>("showDirectoryPicker") !== null;
}

/** The Origin Private File System can be written to with a stream. */
export function hasOpfs() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    typeof FileSystemFileHandle.prototype.createWritable === "function"
  );
}

/**
 * Wraps a writable stream, such as the one from
 * `FileSystemFileHandle.createWritable()`.
 */
export function writableSink(target: WritableTarget): FileSink {
  if (target instanceof WritableStream) {
    const writer = target.getWriter();
    return {
      write: (chunk) => writer.write(chunk),
      close: () => writer.close(),
      abort: () => writer.abort(),
    };
  }
  return {
    write: (chunk) => target.write(chunk),
    close: () => target.close(),
    abort: () => target.abort(),
  };
}

/**
 * Opens a writable on first use, so a download that is queued and never starts
 * creates nothing. `onClose` decides what `close` returns.
 */
function lazySink(
  open: () => Promise<FileSystemWritableFileStream>,
  onClose?: () => Promise<Blob>,
  onAbort?: () => Promise<void>,
): FileSink {
  let opening: Promise<FileSystemWritableFileStream> | null = null;
  const writable = () => {
    opening ??= open();
    return opening;
  };
  return {
    write: async (chunk) => (await writable()).write(chunk),
    close: async () => {
      await (await writable()).close();
      return onClose?.();
    },
    abort: async () => {
      if (opening) {
        await (await opening).abort().catch(() => {});
      }
      await onAbort?.();
    },
  };
}

/**
 * Asks the user where to save the file, then streams it there.
 *
 * Call it from the click that started the download: the picker needs user
 * activation. Rejects with the picker's `AbortError` when the user dismisses
 * it, so the download can be dropped. Resolves null when the picker isn't
 * available or fails in any other way.
 */
export async function pickFileSink(
  suggestedName: string,
): Promise<FileSink | null> {
  const picker = pickerFrom<SaveFilePicker>("showSaveFilePicker");
  if (!picker) {
    return null;
  }
  try {
    const handle = await picker({ suggestedName });
    return writableSink(await handle.createWritable());
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Asks the user for a folder to save a group of downloads into. Same contract
 * as `pickFileSink`: `AbortError` when dismissed, null when unavailable.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = pickerFrom<DirectoryPicker>("showDirectoryPicker");
  if (!picker) {
    return null;
  }
  try {
    return await picker({ mode: "readwrite" });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Writes `path/name` under `root`, creating folders as needed. Pass an incoming
 * item's `path` and `name`; the manager has already sanitized both. Nothing is
 * created until the first byte arrives.
 */
export function directorySink(
  root: FileSystemDirectoryHandle,
  path: string | undefined,
  name: string,
): FileSink {
  return lazySink(async () => {
    let directory = root;
    for (const segment of path ? path.split("/") : []) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    const handle = await directory.getFileHandle(name, { create: true });
    return handle.createWritable();
  });
}

export { prefixRange, type PrefixRange } from "./range.ts";

export const OPFS_DIRECTORY = "rtc-file-transfer";

export type OpfsSinkOptions = {
  /** Folder inside the origin's private file system. */
  directory?: string;
  /** The OPFS root. Defaults to `navigator.storage.getDirectory()`. */
  root?: FileSystemDirectoryHandle;
};

async function opfsDirectory(options: OpfsSinkOptions) {
  const root = options.root ?? (await navigator.storage.getDirectory());
  return root.getDirectoryHandle(options.directory ?? OPFS_DIRECTORY, {
    create: true,
  });
}

/**
 * Streams into a file in the Origin Private File System, which works in every
 * current browser without a picker. `close` returns the saved file as a Blob
 * backed by disk, so `item.blob` works without holding the file in memory.
 *
 * The file stays until `clearOpfs` removes it. The Blob stops being readable
 * once it is removed, so clear only after the user has saved or dismissed it.
 */
export function opfsSink(
  name: string,
  options: OpfsSinkOptions = {},
): FileSink {
  // Unique on disk, so two downloads with the same name can't collide.
  const fileName = `${createRandomId()}-${name}`;
  let handle: FileSystemFileHandle | null = null;
  return lazySink(
    async () => {
      handle = await (
        await opfsDirectory(options)
      ).getFileHandle(fileName, { create: true });
      return handle.createWritable();
    },
    async () => handle!.getFile(),
    async () => {
      if (handle) {
        await (await opfsDirectory(options))
          .removeEntry(fileName)
          .catch(() => {});
      }
    },
  );
}

/** Deletes every file `opfsSink` wrote into `directory`. */
export async function clearOpfs(options: OpfsSinkOptions = {}) {
  const root = options.root ?? (await navigator.storage.getDirectory());
  await root
    .removeEntry(options.directory ?? OPFS_DIRECTORY, { recursive: true })
    .catch(() => {
      // nothing written yet
    });
}

/**
 * The best sink this browser has for a download: a file the user picks, then
 * the Origin Private File System. Resolves undefined when neither exists, so
 * the download falls back to memory.
 *
 * Call it from the click that started the download. Rejects with `AbortError`
 * when the user dismisses the picker.
 */
export async function bestSink(
  item: { name: string },
  options: OpfsSinkOptions & { picker?: boolean } = {},
): Promise<FileSink | undefined> {
  if (options.picker !== false) {
    const picked = await pickFileSink(item.name);
    if (picked) {
      return picked;
    }
  }
  return hasOpfs() ? opfsSink(item.name, options) : undefined;
}

// -----------------------------------------------------------------------------
// Resuming after a reload

/**
 * How much is written before a part file is closed. `createWritable` only
 * commits on `close`, so this is also how much a reload can lose: at most one
 * segment is fetched again. A multiple of the manager's 1 MiB block.
 */
const DEFAULT_SEGMENT_BYTES = 64 * 1024 * 1024;

export type ResumeOptions = OpfsSinkOptions & {
  /** Bytes per part file. Smaller means less to refetch, and more files. */
  segmentBytes?: number;
  /**
   * Recorded with every file this store writes, and returned by `list`.
   * Opaque here: the application decides what it means — a room code, an
   * account, a session — and which tags are still worth keeping.
   */
  tag?: string;
};

const STATE_FILE = "state.json";
const PART_PREFIX = "part-";

function partName(index: number) {
  return `${PART_PREFIX}${String(index).padStart(5, "0")}`;
}

type StoredState = ResumeState & {
  size: number;
  segmentBytes: number;
  /**
   * What the file is, so `list` can rebuild an offer from it. Optional
   * because states written before seeding existed carry none; those still
   * resume, they just can't be re-offered.
   */
  meta?: StoredMeta;
};

function isStoredMeta(value: unknown): value is StoredMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const meta = value as Record<string, unknown>;
  return (
    typeof meta.name === "string" &&
    meta.name.length > 0 &&
    typeof meta.mime === "string" &&
    typeof meta.ts === "number" &&
    (meta.path === undefined || typeof meta.path === "string") &&
    (meta.tag === undefined || typeof meta.tag === "string")
  );
}

function isStoredState(value: unknown): value is StoredState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    typeof state.verifiedBytes === "number" &&
    typeof state.size === "number" &&
    typeof state.segmentBytes === "number" &&
    Array.isArray(state.blockHashes) &&
    state.blockHashes.every((hash) => typeof hash === "string") &&
    (state.meta === undefined || isStoredMeta(state.meta))
  );
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Keeps partial downloads in the Origin Private File System, so they survive a
 * reload or a crash and not just a dropped connection.
 *
 * ```ts
 * const files = createFileTransferManager({ ..., resume: opfsResume() });
 * ```
 *
 * Each file gets a folder named after its digest, holding fixed-size part
 * files. A part is closed as soon as it fills, because that is when the bytes
 * actually reach disk, so a reload replays at most one segment. `close`
 * returns the whole file as a Blob made of those parts, which stays backed by
 * disk rather than memory.
 *
 * It needs offers that carry a `digest` (`offerFiles(entries, { digest: true })`),
 * since that is what identifies a file across page loads.
 */
export function opfsResume(options: ResumeOptions = {}): ResumeProvider {
  const SEGMENT_BYTES = options.segmentBytes ?? DEFAULT_SEGMENT_BYTES;
  async function folderFor(key: ResumeKey, create: boolean) {
    const root = await opfsDirectory(options);
    return root.getDirectoryHandle(key.digest, { create });
  }

  async function readState(key: ResumeKey): Promise<StoredState | null> {
    try {
      const folder = await folderFor(key, false);
      const handle = await folder.getFileHandle(STATE_FILE);
      const parsed: unknown = JSON.parse(await (await handle.getFile()).text());
      return isStoredState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function writeState(key: ResumeKey, state: StoredState) {
    const folder = await folderFor(key, true);
    const handle = await folder.getFileHandle(STATE_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new TextEncoder().encode(JSON.stringify(state)));
    await writable.close();
  }

  /** Bytes committed for each download, so a checkpoint never claims more. */
  const committed = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();

  function metaFor(key: ResumeKey): StoredMeta {
    return {
      name: key.name,
      mime: key.mime ?? "",
      ...(key.path !== undefined && { path: key.path }),
      ...(options.tag !== undefined && { tag: options.tag }),
      ts: Date.now(),
    };
  }

  /** One state write per file at a time, in the order they were asked for. */
  function queueState(key: ResumeKey, verified: number, blockHashes: string[]) {
    const previous = pending.get(key.digest) ?? Promise.resolve();
    const next = previous
      .then(() =>
        writeState(key, {
          verifiedBytes: verified,
          blockHashes: blockHashes.slice(0, Math.ceil(verified / BLOCK_BYTES)),
          size: key.size,
          segmentBytes: SEGMENT_BYTES,
          meta: metaFor(key),
        }),
      )
      .catch(() => {});
    pending.set(key.digest, next);
    return next;
  }

  return {
    async load(key) {
      const state = await readState(key);
      if (
        !state ||
        state.size !== key.size ||
        state.verifiedBytes <= 0 ||
        // Written with other part sizes: appending would number the new parts
        // from a different stride and leave a gap, and `close` stops at the
        // first missing part. `read` still works — the parts are whole — but
        // a download has to start over.
        state.segmentBytes !== SEGMENT_BYTES
      ) {
        return null;
      }
      return {
        verifiedBytes: state.verifiedBytes,
        blockHashes: state.blockHashes,
      };
    },

    async open(key, state) {
      const folder = await folderFor(key, true);
      const from = state.verifiedBytes;
      let index = Math.floor(from / SEGMENT_BYTES);
      const inPart = from % SEGMENT_BYTES;
      committed.set(key.digest, from - inPart);

      // A part that only partly survived is rewritten from its start.
      for await (const name of (
        folder as unknown as { keys(): AsyncIterable<string> }
      ).keys()) {
        const partIndex = name.startsWith(PART_PREFIX)
          ? Number(name.slice(PART_PREFIX.length))
          : -1;
        if (partIndex > index || (partIndex === index && inPart === 0)) {
          await folder.removeEntry(name).catch(() => {});
        }
      }

      let writable: FileSystemWritableFileStream | null = null;
      let written = inPart;

      const openPart = async () => {
        const handle = await folder.getFileHandle(partName(index), {
          create: true,
        });
        const stream = await handle.createWritable({
          keepExistingData: written > 0,
        });
        if (written > 0) {
          await stream.seek(written);
        }
        return stream;
      };

      const closePart = async () => {
        if (writable) {
          await writable.close();
          writable = null;
          committed.set(key.digest, index * SEGMENT_BYTES + written);
        }
      };

      return {
        async write(chunk) {
          let offset = 0;
          while (offset < chunk.byteLength) {
            writable ??= await openPart();
            const room = SEGMENT_BYTES - written;
            const slice = chunk.subarray(
              offset,
              offset + Math.min(room, chunk.byteLength - offset),
            );
            await writable.write(slice);
            written += slice.byteLength;
            offset += slice.byteLength;
            if (written >= SEGMENT_BYTES) {
              // Full: closing is what puts it on disk, so a reload finds it.
              await closePart();
              index += 1;
              written = 0;
            }
          }
        },
        async close() {
          await closePart();
          await (pending.get(key.digest) ?? Promise.resolve());
          const parts: File[] = [];
          for (let part = 0; ; part += 1) {
            try {
              parts.push(
                await (await folder.getFileHandle(partName(part))).getFile(),
              );
            } catch {
              break;
            }
          }
          committed.delete(key.digest);
          return new Blob(parts, { type: "application/octet-stream" });
        },
        async abort() {
          // Keep what is on disk: the manager decides whether to forget it.
          if (writable) {
            await writable.close().catch(() => {});
            writable = null;
          }
        },
      };
    },

    checkpoint(key, state) {
      const durable = committed.get(key.digest) ?? 0;
      const verified = Math.min(state.verifiedBytes, durable);
      if (verified <= 0) {
        return;
      }
      // Only for blocks that are already on disk.
      return queueState(key, verified, state.blockHashes);
    },

    /**
     * The whole file, after `close`: every part is closed by then, so there is
     * no open segment to clamp to. Queued behind any checkpoint still in
     * flight, so a stale one can't land after it and claim less.
     */
    keep(key, state) {
      committed.delete(key.digest);
      const verified = Math.min(state.verifiedBytes, key.size);
      return verified > 0 ? queueState(key, verified, state.blockHashes) : undefined;
    },

    /**
     * Every file this store still holds, complete or not. A folder whose
     * `state.json` predates seeding carries no `meta`, so there is no honest
     * way to re-offer it; it is left out rather than offered under a guess.
     */
    async list() {
      const root = await opfsDirectory(options).catch(() => null);
      if (!root) {
        return [];
      }
      const held: StoredFile[] = [];
      for await (const digest of (
        root as unknown as { keys(): AsyncIterable<string> }
      ).keys()) {
        if (!DIGEST_PATTERN.test(digest)) {
          continue;
        }
        const state = await readState({ digest, size: 0, name: "" });
        if (!state?.meta || state.verifiedBytes <= 0) {
          continue;
        }
        held.push({
          key: {
            digest,
            size: state.size,
            name: state.meta.name,
            mime: state.meta.mime,
            ...(state.meta.path !== undefined && { path: state.meta.path }),
          },
          state: {
            verifiedBytes: state.verifiedBytes,
            blockHashes: state.blockHashes,
          },
          meta: state.meta,
        });
      }
      return held;
    },

    /**
     * What is on disk for this file, as a Blob — the same parts `close`
     * assembles, cut to the verified prefix so a partial file never hands out
     * bytes that were never checked.
     */
    async read(key) {
      const state = await readState(key);
      if (!state || state.verifiedBytes <= 0) {
        return null;
      }
      const folder = await folderFor(key, false).catch(() => null);
      if (!folder) {
        return null;
      }
      const parts: File[] = [];
      for (let part = 0; ; part += 1) {
        try {
          parts.push(await (await folder.getFileHandle(partName(part))).getFile());
        } catch {
          break;
        }
      }
      const type = state.meta?.mime || key.mime || "application/octet-stream";
      return new Blob(parts, { type }).slice(0, state.verifiedBytes, type);
    },

    async forget(key) {
      committed.delete(key.digest);
      await (pending.get(key.digest) ?? Promise.resolve());
      pending.delete(key.digest);
      const root = await opfsDirectory(options).catch(() => null);
      await root?.removeEntry(key.digest, { recursive: true }).catch(() => {});
    },
  };
}
