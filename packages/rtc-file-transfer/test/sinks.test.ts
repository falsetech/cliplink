import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPFS_DIRECTORY,
  bestSink,
  canPickDirectory,
  canPickFile,
  clearOpfs,
  directorySink,
  hasOpfs,
  opfsSink,
  pickFileSink,
  opfsResume,
  writableSink,
} from "../src/sinks.ts";
import { randomBytes } from "./fake-rtc.ts";

/** Just enough of the File System Access API for the sinks. */
class FakeWritable {
  chunks: Uint8Array[] = [];
  aborted = false;
  closed = false;
  private readonly file: FakeFile;
  private at = 0;
  constructor(file: FakeFile, keepExistingData = false) {
    this.file = file;
    this.keep = keepExistingData;
  }
  readonly keep: boolean;
  async seek(offset: number) {
    this.at = offset;
  }
  async write(chunk: Uint8Array) {
    this.chunks.push(chunk.slice());
  }
  async close() {
    // Only a closed writable reaches "disk", which is the whole point of parts.
    const existing = this.keep
      ? [(await this.file.data.slice(0, this.at)) as BlobPart]
      : [];
    this.file.data = new Blob([...existing, ...(this.chunks as BlobPart[])]);
    this.closed = true;
  }
  async abort() {
    this.aborted = true;
  }
}

class FakeFile {
  data = new Blob([]);
  writables: FakeWritable[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async createWritable(options?: { keepExistingData?: boolean }) {
    const writable = new FakeWritable(this, options?.keepExistingData === true);
    this.writables.push(writable);
    return writable;
  }
  async getFile() {
    return new File([this.data], this.name);
  }
}

class FakeDirectory {
  readonly entries = new Map<string, FakeDirectory | FakeFile>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name) ?? (options?.create ? new FakeDirectory() : undefined);
    if (!(entry instanceof FakeDirectory)) {
      throw new DOMException("missing", "NotFoundError");
    }
    this.entries.set(name, entry);
    return entry;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name) ?? (options?.create ? new FakeFile(name) : undefined);
    if (!(entry instanceof FakeFile)) {
      throw new DOMException("missing", "NotFoundError");
    }
    this.entries.set(name, entry);
    return entry;
  }
  async *keys() {
    for (const name of [...this.entries.keys()]) {
      yield name;
    }
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) {
      throw new DOMException("missing", "NotFoundError");
    }
  }
}

function asDirectory(directory: FakeDirectory) {
  return directory as unknown as FileSystemDirectoryHandle;
}

describe("sinks", () => {
  it("writes a WritableStream in order and closes it", async () => {
    const received: Uint8Array[] = [];
    let closed = false;
    const stream = new WritableStream<Uint8Array<ArrayBuffer>>({
      async write(chunk) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        received.push(chunk.slice());
      },
      close() {
        closed = true;
      },
    });
    const sink = writableSink(stream);
    const source = randomBytes(1000);
    await sink.write(source.slice(0, 400));
    await sink.write(source.slice(400));
    await sink.close();

    assert.equal(closed, true);
    assert.deepEqual(new Uint8Array(await new Blob(received as BlobPart[]).arrayBuffer()), source);
  });

  it("wraps an object with write, close and abort", async () => {
    const file = new FakeFile("x");
    const writable = await file.createWritable();
    const sink = writableSink(writable);
    await sink.write(randomBytes(10));
    await sink.abort();
    assert.equal(writable.aborted, true);
  });

  it("creates nested folders in a directory, but only once a byte arrives", async () => {
    const root = new FakeDirectory();
    const sink = directorySink(asDirectory(root), "photos/2024", "a.bin");
    assert.equal(root.entries.size, 0);

    const source = randomBytes(2048);
    await sink.write(source);
    await sink.close();

    const photos = await root.getDirectoryHandle("photos");
    const year = await photos.getDirectoryHandle("2024");
    const file = await year.getFileHandle("a.bin");
    assert.deepEqual(new Uint8Array(await file.data.arrayBuffer()), source);
  });

  it("leaves nothing behind when a directory download is aborted before it starts", async () => {
    const root = new FakeDirectory();
    const sink = directorySink(asDirectory(root), undefined, "never.bin");
    await sink.abort();
    assert.equal(root.entries.size, 0);
  });

  it("returns the saved OPFS file as a Blob, and removes it on abort", async () => {
    const root = new FakeDirectory();
    const source = randomBytes(5000);

    const kept = opfsSink("same.bin", { root: asDirectory(root) });
    await kept.write(source);
    const blob = await kept.close();
    assert.ok(blob instanceof Blob);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), source);

    const dropped = opfsSink("same.bin", { root: asDirectory(root) });
    await dropped.write(source);
    const folder = await root.getDirectoryHandle(OPFS_DIRECTORY);
    assert.equal(folder.entries.size, 2, "two downloads with one name get two files");
    await dropped.abort();
    assert.equal(folder.entries.size, 1);

    await clearOpfs({ root: asDirectory(root) });
    assert.equal(root.entries.has(OPFS_DIRECTORY), false);
  });

  it("commits in segments, resumes from the last one, and forgets when told", async () => {
    const root = new FakeDirectory();
    const segmentBytes = 4096;
    const store = opfsResume({ root: asDirectory(root), segmentBytes });
    const key = { digest: "a".repeat(64), size: 10_000, name: "big.bin" };
    const source = randomBytes(key.size);

    assert.equal(await store.load(key), null, "nothing stored yet");

    const sink = await store.open(key, { verifiedBytes: 0, blockHashes: [] });
    assert.ok(sink);
    // Two full segments plus part of a third; only the closed ones are on disk.
    await sink.write(source.slice(0, 9000));
    await store.checkpoint(key, { verifiedBytes: 9000, blockHashes: ["b".repeat(64)] });

    const stored = await store.load(key);
    assert.equal(stored?.verifiedBytes, 2 * segmentBytes, "only closed parts count");

    // A reload: reopen where the store says, and finish the file.
    const resumed = await store.open(key, stored!);
    assert.ok(resumed);
    await resumed.write(source.slice(stored!.verifiedBytes));
    const blob = await resumed.close();
    assert.ok(blob instanceof Blob);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), source);

    await store.forget(key);
    assert.equal(root.entries.has(OPFS_DIRECTORY), true);
    assert.equal(await store.load(key), null);
  });

  it("reports nothing available outside a browser", async () => {
    assert.equal(canPickFile(), false);
    assert.equal(canPickDirectory(), false);
    assert.equal(hasOpfs(), false);
    assert.equal(await pickFileSink("a.bin"), null);
    assert.equal(await bestSink({ name: "a.bin" }), undefined);
  });
});
