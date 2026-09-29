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

  it("lists and reads what it holds, so a seeder can re-offer it", async () => {
    const root = new FakeDirectory();
    const segmentBytes = 4096;
    const store = opfsResume({ root: asDirectory(root), segmentBytes, tag: "ROOM01" });
    const key = {
      digest: "c".repeat(64),
      size: 8192,
      name: "held.bin",
      mime: "video/mp4",
      path: "clips",
    };
    const source = randomBytes(key.size);

    assert.deepEqual(await store.list!(), [], "nothing held yet");
    assert.equal(await store.read!(key), null, "nothing to read yet");

    const sink = await store.open(key, { verifiedBytes: 0, blockHashes: [] });
    await sink!.write(source);
    await store.checkpoint(key, {
      verifiedBytes: key.size,
      blockHashes: [`${"d".repeat(64)}`],
    });

    const held = await store.list!();
    assert.equal(held.length, 1);
    assert.equal(held[0].key.digest, key.digest);
    assert.equal(held[0].key.size, key.size);
    assert.equal(held[0].key.name, "held.bin");
    assert.equal(held[0].state.verifiedBytes, key.size);
    assert.equal(held[0].meta.mime, "video/mp4");
    assert.equal(held[0].meta.path, "clips");
    assert.equal(held[0].meta.tag, "ROOM01");
    assert.ok(held[0].meta.ts > 0, "records when it was stored");

    const blob = await store.read!(held[0].key);
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, "video/mp4");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), source);
  });

  it("reads only the verified prefix, and skips folders it can't rebuild an offer from", async () => {
    const root = new FakeDirectory();
    const segmentBytes = 4096;
    const store = opfsResume({ root: asDirectory(root), segmentBytes });
    const key = { digest: "e".repeat(64), size: 10_000, name: "part.bin", mime: "" };
    const source = randomBytes(key.size);

    const sink = await store.open(key, { verifiedBytes: 0, blockHashes: [] });
    await sink!.write(source.slice(0, 9000));
    await store.checkpoint(key, { verifiedBytes: 9000, blockHashes: [] });

    // Two segments are closed; the third is still open, so 8192 is what is there.
    const blob = await store.read!(key);
    assert.equal(blob!.size, 2 * segmentBytes);
    assert.deepEqual(
      new Uint8Array(await blob!.arrayBuffer()),
      source.slice(0, 2 * segmentBytes),
    );
    assert.equal(blob!.type, "application/octet-stream", "no mime means a generic blob");

    // A state.json from a build before seeding carries no meta: unusable as an
    // offer, so it is left out rather than re-offered with a guessed name.
    const folder = await (
      await root.getDirectoryHandle(OPFS_DIRECTORY)
    ).getDirectoryHandle(key.digest);
    const state = await folder.getFileHandle("state.json");
    const writable = await state.createWritable();
    await writable.write(
      new TextEncoder().encode(
        JSON.stringify({ verifiedBytes: 9000, blockHashes: [], size: key.size, segmentBytes }),
      ),
    );
    await writable.close();
    assert.deepEqual(await store.list!(), []);
    assert.equal((await store.load(key))?.verifiedBytes, 9000, "but it still resumes");
  });

  it("won't resume a file stored with a different part size", async () => {
    const root = new FakeDirectory();
    const key = { digest: "f".repeat(64), size: 12_288, name: "layout.bin" };
    const source = randomBytes(key.size);
    const before = opfsResume({ root: asDirectory(root), segmentBytes: 8192 });
    const sink = await before.open(key, { verifiedBytes: 0, blockHashes: [] });
    await sink!.write(source.slice(0, 8192));
    await before.checkpoint(key, { verifiedBytes: 8192, blockHashes: [] });
    assert.equal((await before.load(key))?.verifiedBytes, 8192);

    // Appending 4 KiB parts after an 8 KiB one would leave a gap in the part
    // numbering, and the file would be read back short. Start over instead.
    const after = opfsResume({ root: asDirectory(root), segmentBytes: 4096 });
    assert.equal(await after.load(key), null);
    // What is there is still whole, so it can still be read and served.
    const blob = await after.read!(key);
    assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), source.slice(0, 8192));
  });

  it("reports nothing available outside a browser", async () => {
    assert.equal(canPickFile(), false);
    assert.equal(canPickDirectory(), false);
    assert.equal(hasOpfs(), false);
    assert.equal(await pickFileSink("a.bin"), null);
    assert.equal(await bestSink({ name: "a.bin" }), undefined);
  });
});
