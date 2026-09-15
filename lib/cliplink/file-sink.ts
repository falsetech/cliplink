import type { FileSink } from "@thebkht/rtc-file-transfer";

type SaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<FileSystemFileHandle>;

function getSaveFilePicker(): SaveFilePicker | null {
  if (typeof window === "undefined") {
    return null;
  }
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

/** File System Access is Chromium-only; everywhere else downloads stay in memory. */
export function canPickDiskSink() {
  return getSaveFilePicker() !== null;
}

/**
 * Asks where to save a download and streams it straight there, so a large file
 * never has to fit in memory.
 *
 * Must be called from the click that started the download: the picker needs
 * user activation. Throws the picker's AbortError when the user dismisses it,
 * so the caller can drop the download; any other failure returns null and the
 * caller falls back to the in-memory sink.
 */
export async function pickDiskSink(name: string): Promise<FileSink | null> {
  const picker = getSaveFilePicker();
  if (!picker) {
    return null;
  }

  let writable: FileSystemWritableFileStream;
  try {
    const handle = await picker({ suggestedName: name });
    writable = await handle.createWritable();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return null;
  }

  return {
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

type DirectoryPicker = (options?: {
  mode?: "read" | "readwrite";
}) => Promise<FileSystemDirectoryHandle>;

function getDirectoryPicker(): DirectoryPicker | null {
  if (typeof window === "undefined") {
    return null;
  }
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker })
    .showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

export function canPickDirectory() {
  return getDirectoryPicker() !== null;
}

/**
 * Asks for a folder to save a batch of downloads into. Same contract as
 * `pickDiskSink`: call it from the click, AbortError means the user dismissed
 * it, and null means fall back to saving files one by one.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = getDirectoryPicker();
  if (!picker) {
    return null;
  }
  try {
    return await picker({ mode: "readwrite" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return null;
  }
}

/**
 * Writes one file of a batch to `path/name` under the picked folder. The file
 * is only created when its first byte arrives, so a queued download that never
 * starts leaves nothing behind.
 */
export function createDirectorySink(
  root: FileSystemDirectoryHandle,
  path: string | undefined,
  name: string,
): FileSink {
  let opening: Promise<FileSystemWritableFileStream> | null = null;

  const open = () => {
    opening ??= (async () => {
      let directory = root;
      for (const segment of path ? path.split("/") : []) {
        directory = await directory.getDirectoryHandle(segment, { create: true });
      }
      const handle = await directory.getFileHandle(name, { create: true });
      return handle.createWritable();
    })();
    return opening;
  };

  return {
    write: async (chunk) => (await open()).write(chunk),
    close: async () => (await open()).close(),
    abort: async () => {
      if (opening) {
        await (await opening).abort();
      }
    },
  };
}
