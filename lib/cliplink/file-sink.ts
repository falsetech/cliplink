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
