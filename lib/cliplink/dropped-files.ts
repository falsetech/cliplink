/** A file to share, and the folder it sits in when it came from one. */
export type ShareEntry = { file: File; path?: string };

/** `photos/2024/a.jpg` → `photos/2024`; a bare name has no folder. */
function folderOf(fullPath: string) {
  const segments = fullPath.split("/").filter(Boolean);
  segments.pop();
  return segments.length > 0 ? segments.join("/") : undefined;
}

/** From a file input, including a folder picked with `webkitdirectory`. */
export function entriesFromFileList(list: FileList | File[]): ShareEntry[] {
  return Array.from(list, (file) => ({
    file,
    path: folderOf(file.webkitRelativePath ?? ""),
  }));
}

function readFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) =>
    reader.readEntries(resolve, reject),
  );
}

async function walk(entry: FileSystemEntry, out: ShareEntry[], limit: number) {
  // Dotfiles are OS litter (.DS_Store), not something anyone meant to send.
  if (out.length > limit || entry.name.startsWith(".")) {
    return;
  }
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    out.push({ file, path: folderOf(entry.fullPath) });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back a page at a time, and an empty page at the end.
    for (let page = await readEntries(reader); page.length > 0; page = await readEntries(reader)) {
      for (const child of page) {
        await walk(child, out, limit);
        if (out.length > limit) {
          return;
        }
      }
    }
  }
}

/**
 * Everything dropped, with dropped folders walked recursively.
 *
 * Call it synchronously from the drop handler: the entries are taken before it
 * returns, because a DataTransfer is emptied once its event ends. Stops after
 * `limit + 1` files, which is enough to tell a folder is too big without
 * reading all of it.
 */
export function entriesFromDataTransfer(
  dataTransfer: DataTransfer,
  limit: number,
): Promise<ShareEntry[]> {
  const roots = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry());
  if (roots.length === 0 || roots.some((root) => root === null)) {
    return Promise.resolve(entriesFromFileList(dataTransfer.files));
  }

  return (async () => {
    const out: ShareEntry[] = [];
    for (const root of roots) {
      await walk(root!, out, limit);
    }
    return out;
  })();
}
