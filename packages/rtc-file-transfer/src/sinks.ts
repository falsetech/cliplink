import { createRandomId } from "./defaults.ts";
import type { FileSink } from "./manager.ts";

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

function pickerFrom<T>(name: "showSaveFilePicker" | "showDirectoryPicker"): T | null {
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
export async function pickFileSink(suggestedName: string): Promise<FileSink | null> {
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

export const OPFS_DIRECTORY = "rtc-file-transfer";

export type OpfsSinkOptions = {
  /** Folder inside the origin's private file system. */
  directory?: string;
  /** The OPFS root. Defaults to `navigator.storage.getDirectory()`. */
  root?: FileSystemDirectoryHandle;
};

async function opfsDirectory(options: OpfsSinkOptions) {
  const root = options.root ?? (await navigator.storage.getDirectory());
  return root.getDirectoryHandle(options.directory ?? OPFS_DIRECTORY, { create: true });
}

/**
 * Streams into a file in the Origin Private File System, which works in every
 * current browser without a picker. `close` returns the saved file as a Blob
 * backed by disk, so `item.blob` works without holding the file in memory.
 *
 * The file stays until `clearOpfs` removes it. The Blob stops being readable
 * once it is removed, so clear only after the user has saved or dismissed it.
 */
export function opfsSink(name: string, options: OpfsSinkOptions = {}): FileSink {
  // Unique on disk, so two downloads with the same name can't collide.
  const fileName = `${createRandomId()}-${name}`;
  let handle: FileSystemFileHandle | null = null;
  return lazySink(
    async () => {
      handle = await (await opfsDirectory(options)).getFileHandle(fileName, { create: true });
      return handle.createWritable();
    },
    async () => handle!.getFile(),
    async () => {
      if (handle) {
        await (await opfsDirectory(options)).removeEntry(fileName).catch(() => {});
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
