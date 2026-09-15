import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BLOCK_BYTES, sanitizeFileName, type FileItem } from "../src/index.ts";
import { FakeSignaling, randomBytes, waitFor, type TestPeer } from "./fake-rtc.ts";

let bus: FakeSignaling;

afterEach(() => bus?.dispose());

function incoming(peer: TestPeer) {
  return peer.items.filter((item) => item.direction === "incoming");
}

function outgoing(peer: TestPeer): FileItem {
  const item = peer.items.find((candidate) => candidate.direction === "outgoing");
  assert.ok(item, "expected an outgoing item");
  return item;
}

function failure(peer: TestPeer) {
  const notice = peer.notices.find((candidate) => candidate.type === "failed");
  return notice?.type === "failed" ? notice : undefined;
}

async function offerAndRequest(bytes: Uint8Array<ArrayBuffer>, name = "data.bin") {
  const [alice, bob] = [bus.peers.get("peer-alice")!, bus.peers.get("peer-bob00")!];
  alice.manager.offerFiles([new File([bytes], name)]);
  await waitFor(() => incoming(bob).length === 1);
  assert.equal(bob.manager.request(incoming(bob)[0].id), true);
  return { alice, bob };
}

describe("file transfer", () => {
  it("delivers a file byte for byte and settles both sides", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    const source = randomBytes(300 * 1024 + 17);

    const { alice, bob } = await offerAndRequest(source);
    assert.equal(bob.notices[0]?.type, "incoming-offer");
    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));

    const item = incoming(bob)[0];
    assert.equal(item.status, "done");
    assert.equal(item.bytes, source.byteLength);
    assert.deepEqual(new Uint8Array(await item.blob!.arrayBuffer()), source);

    await waitFor(() => outgoing(alice).completedTransfers === 1);
    assert.equal(outgoing(alice).activeTransfers, 0);
  });

  it("stops sending above the high-water mark until the channel drains", async () => {
    const limits = { chunkBytes: 1024, bufferHighBytes: 4096, bufferLowBytes: 1024 };
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits });
    bus.addPeer("peer-bob00", { limits });
    const source = randomBytes(64 * 1024);

    const { bob } = await offerAndRequest(source);
    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));

    assert.ok(
      bus.net.maxBuffered <= limits.bufferHighBytes + limits.chunkBytes,
      `buffered ${bus.net.maxBuffered} bytes`,
    );
    assert.ok(bus.net.lowEvents > 0, "expected the sender to wait for bufferedamountlow");
    assert.deepEqual(new Uint8Array(await incoming(bob)[0].blob!.arrayBuffer()), source);
  });

  it("reports a receive rate and ETA mid-transfer, and clears them when done", async () => {
    const limits = { chunkBytes: 1024, bufferHighBytes: 4096, bufferLowBytes: 1024 };
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits });
    bus.addPeer("peer-bob00", { limits });

    const { bob } = await offerAndRequest(randomBytes(512 * 1024));
    await waitFor(() => incoming(bob)[0]?.status === "transferring");
    // Hold the network long enough that the next chunk closes a rate sample.
    bus.net.setFlowing(false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Let exactly one flush through, then hold again so the transfer is still
    // running when the coalesced progress emit fires.
    bus.net.setFlowing(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    bus.net.setFlowing(false);

    await waitFor(() => (incoming(bob)[0]?.bytesPerSecond ?? 0) > 0);
    const item = incoming(bob)[0];
    assert.equal(item.status, "transferring");
    assert.ok((item.etaMs ?? 0) > 0, "expected an ETA alongside the rate");

    bus.net.setFlowing(true);
    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));
    assert.equal(incoming(bob)[0].bytesPerSecond, undefined);
    assert.equal(incoming(bob)[0].etaMs, undefined);
  });

  it("streams into a custom sink and settles without a blob", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    const source = randomBytes(200 * 1024 + 3);
    const written: Uint8Array<ArrayBuffer>[] = [];
    let closed = false;
    let aborted = false;

    alice.manager.offerFiles([new File([source], "disk.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    const sink = {
      async write(chunk: Uint8Array<ArrayBuffer>) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        written.push(chunk.slice());
      },
      close() {
        closed = true;
      },
      abort() {
        aborted = true;
      },
    };
    assert.equal(bob.manager.request(incoming(bob)[0].id, { sink }), true);

    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));
    const item = incoming(bob)[0];
    assert.equal(item.status, "done");
    assert.equal(item.savedToSink, true);
    assert.equal(item.blob, undefined);
    assert.equal(closed, true);
    assert.equal(aborted, false);
    assert.deepEqual(new Uint8Array(await new Blob(written).arrayBuffer()), source);
    await waitFor(() => outgoing(alice).completedTransfers === 1);
  });

  it("fails with write-error when the sink throws, and releases the sender", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    let aborted = false;

    alice.manager.offerFiles([new File([randomBytes(64 * 1024)], "full.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: {
        write() {
          throw new Error("disk full");
        },
        close() {},
        abort() {
          aborted = true;
        },
      },
    });

    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "write-error");
    await waitFor(() => aborted);
    await waitFor(() => outgoing(alice).activeTransfers === 0);
    assert.equal(outgoing(alice).completedTransfers, 0);
  });

  it("waits out a sink that is slow to close without calling it a stall", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice", { limits: { stallMs: 50 } });
    const bob = bus.addPeer("peer-bob00", { limits: { stallMs: 50 } });

    alice.manager.offerFiles([new File([randomBytes(8 * 1024)], "slow.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: {
        write() {},
        close: () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
        abort() {},
      },
    });

    await waitFor(() => incoming(bob)[0]?.status === "done");
    assert.equal(failure(bob), undefined);
    await waitFor(() => outgoing(alice).completedTransfers === 1);
  });

  it("does not count a delivery whose slow commit then fails", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice", { limits: { stallMs: 50 } });
    const bob = bus.addPeer("peer-bob00", { limits: { stallMs: 50 } });

    alice.manager.offerFiles([new File([randomBytes(8 * 1024)], "doomed.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: {
        write() {},
        close: () =>
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("quota")), 200)),
        abort() {},
      },
    });

    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "write-error");
    await waitFor(() => outgoing(alice).activeTransfers === 0);
    assert.equal(outgoing(alice).completedTransfers, 0);
  });

  it("aborts a sink that is still closing when the receiver cancels", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    let closing = false;
    let aborted = false;

    alice.manager.offerFiles([new File([randomBytes(8 * 1024)], "a.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: {
        write() {},
        close: () => {
          closing = true;
          return new Promise<void>((resolve) => setTimeout(resolve, 200));
        },
        abort: () => void (aborted = true),
      },
    });

    await waitFor(() => closing);
    bob.manager.cancel(incoming(bob)[0].id);
    await waitFor(() => aborted);
    assert.equal(failure(bob)?.code, "canceled");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(incoming(bob)[0].status, "failed");
    assert.equal(bob.notices.some((notice) => notice.type === "received"), false);
  });

  it("aborts the sink when the receiver cancels", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    bus.net.setFlowing(false);
    let aborted = false;

    alice.manager.offerFiles([new File([randomBytes(4096)], "a.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: { write() {}, close() {}, abort: () => void (aborted = true) },
    });
    bob.manager.cancel(incoming(bob)[0].id);
    await waitFor(() => aborted);
  });

  it("rejects empty and oversized files with codes", () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice", { limits: { maxFileBytes: 10 } });
    const result = alice.manager.offerFiles([
      new File([], "empty.txt"),
      new File([randomBytes(11)], "big.bin"),
      new File([randomBytes(10)], "ok.bin"),
    ]);
    assert.equal(result.offered, 1);
    assert.deepEqual(
      result.rejected.map(({ file, code, limit }) => [file.name, code, limit]),
      [
        ["empty.txt", "empty", 0],
        ["big.bin", "too-large", 10],
      ],
    );
  });

  it("fails a stalled transfer", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits: { stallMs: 50 } });
    bus.addPeer("peer-bob00", { limits: { stallMs: 50 } });
    bus.net.setFlowing(false);

    const { bob } = await offerAndRequest(randomBytes(4096));
    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "stalled");
    assert.equal(incoming(bob)[0].status, "failed");
    assert.equal(incoming(bob)[0].errorCode, "stalled");
  });

  it("fails when the sender sends more than it announced", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    bus.transform = (payload) =>
      payload.type === "file-offer" ? { ...payload, size: payload.size - 10 } : payload;

    const { bob } = await offerAndRequest(randomBytes(4096));
    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "overflow");
  });

  it("fails when the sender finishes short of what it announced", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    bus.transform = (payload) =>
      payload.type === "file-offer" ? { ...payload, size: payload.size + 10 } : payload;

    const { bob } = await offerAndRequest(randomBytes(4096));
    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "incomplete");
  });

  it("cuts off a download when the sender revokes mid-transfer", async () => {
    const limits = { chunkBytes: 1024, bufferHighBytes: 4096, bufferLowBytes: 1024 };
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits });
    bus.addPeer("peer-bob00", { limits });

    const { alice, bob } = await offerAndRequest(randomBytes(1024 * 1024));
    await waitFor(() => incoming(bob)[0]?.status === "transferring");
    bus.net.setFlowing(false);
    alice.manager.revoke(outgoing(alice).id);
    bus.net.setFlowing(true);

    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "revoked");
    assert.equal(alice.items.length, 0);
  });

  it("lets the receiver cancel, and releases the sender", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    bus.net.setFlowing(false);

    const { alice, bob } = await offerAndRequest(randomBytes(4096));
    await waitFor(() => outgoing(alice).activeTransfers === 1);
    bob.manager.cancel(incoming(bob)[0].id);

    assert.equal(failure(bob)?.code, "canceled");
    await waitFor(() => outgoing(alice).activeTransfers === 0);
    assert.equal(outgoing(alice).completedTransfers, 0);
  });

  it("reports a connection ICE could not establish", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    bus.net.setFlowing(false);

    const { bob } = await offerAndRequest(randomBytes(4096));
    bob.pcs()[0].failConnection();
    assert.equal(failure(bob)?.code, "nat");
  });

  it("revokes idle offers from a peer that left", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    alice.manager.offerFiles([new File([randomBytes(10)], "a.bin")]);
    await waitFor(() => incoming(bob).length === 1);

    bob.manager.handleSignal("peer-alice", { type: "peer-left" });
    assert.equal(incoming(bob)[0].status, "revoked");

    // Re-announcing after a reconnect restores the offer.
    alice.manager.announce();
    await waitFor(() => incoming(bob)[0].status === "offered");
  });

  it("answers hello with open offers for late joiners", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    alice.manager.offerFiles([new File([randomBytes(10)], "a.bin")]);
    const carol = bus.addPeer("peer-carol");
    carol.manager.announce();
    await waitFor(() => incoming(carol).length === 1);
  });

  it("evicts the oldest idle incoming items beyond maxItems", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00", { limits: { maxItems: 2 } });
    for (const name of ["1.bin", "2.bin", "3.bin"]) {
      alice.manager.offerFiles([new File([randomBytes(10)], name)]);
      await waitFor(() => bob.notices.filter((n) => n.type === "incoming-offer").length >= Number(name[0]));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.deepEqual(
      incoming(bob).map((item) => item.name),
      ["3.bin", "2.bin"],
    );
  });

  it("returns false from request when signaling is down", async () => {
    bus = new FakeSignaling();
    const alice = bus.addPeer("peer-alice");
    const bob = bus.addPeer("peer-bob00");
    alice.manager.offerFiles([new File([randomBytes(10)], "a.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bus.connected = false;
    assert.equal(bob.manager.request(incoming(bob)[0].id), false);
    assert.equal(incoming(bob)[0].status, "offered");
  });
});

describe("verified blocks and resume", () => {
  const MB = BLOCK_BYTES;

  it("verifies blocks when both peers support them", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    const source = randomBytes(2 * MB + 123);

    const { bob } = await offerAndRequest(source);
    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));
    assert.deepEqual(new Uint8Array(await incoming(bob)[0].blob!.arrayBuffer()), source);
    assert.equal(bus.net.strings.filter((message) => message.startsWith("{")).length, 3);
  });

  for (const [label, aliceCaps, bobCaps] of [
    ["a v1 receiver", undefined, []],
    ["a v1 sender", [], undefined],
  ] as const) {
    it(`falls back to plain v1 with ${label}`, async () => {
      bus = new FakeSignaling();
      bus.addPeer("peer-alice", { capabilities: aliceCaps && [...aliceCaps] });
      bus.addPeer("peer-bob00", { capabilities: bobCaps && [...bobCaps] });
      const source = randomBytes(MB + 5);

      const { bob } = await offerAndRequest(source);
      await waitFor(() => bob.notices.some((notice) => notice.type === "received"));
      assert.deepEqual(new Uint8Array(await incoming(bob)[0].blob!.arrayBuffer()), source);
      assert.deepEqual([...new Set(bus.net.strings)].sort(), ["ack", "done"]);
    });
  }

  it("fails a corrupted block, and a retry delivers the file intact", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice");
    bus.addPeer("peer-bob00");
    const source = randomBytes(MB + 77);
    bus.net.corruptNext = true;

    const { bob } = await offerAndRequest(source);
    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "corrupt");
    assert.equal(incoming(bob)[0].resumableBytes, 0);

    assert.equal(bob.manager.request(incoming(bob)[0].id), true);
    await waitFor(() => bob.notices.some((notice) => notice.type === "received"));
    assert.deepEqual(new Uint8Array(await incoming(bob)[0].blob!.arrayBuffer()), source);
  });

  it("resumes a stalled download from its last verified block, into the same sink", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits: { stallMs: 100 } });
    bus.addPeer("peer-bob00", { limits: { stallMs: 100 } });
    const offsets: Array<number | undefined> = [];
    bus.transform = (payload) => {
      if (payload.type === "file-request") {
        offsets.push(payload.offset);
      }
      return payload;
    };
    const source = randomBytes(3 * MB + 999);
    const written: Uint8Array<ArrayBuffer>[] = [];
    let closes = 0;
    let aborts = 0;
    const sink = {
      write: (chunk: Uint8Array<ArrayBuffer>) => void written.push(chunk.slice()),
      close: () => void (closes += 1),
      abort: () => void (aborts += 1),
    };

    bus.net.pauseAfterBytes = 2 * MB + 4096;
    const [alice, bob] = [bus.peers.get("peer-alice")!, bus.peers.get("peer-bob00")!];
    alice.manager.offerFiles([new File([source], "big.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, { sink });

    await waitFor(() => failure(bob) !== undefined);
    assert.equal(failure(bob)?.code, "stalled");
    assert.equal(incoming(bob)[0].resumableBytes, 2 * MB);
    assert.equal(aborts, 0);

    bus.net.setFlowing(true);
    // A new sink is ignored (and aborted) while the old one can resume.
    let ignoredAborted = false;
    bob.manager.request(incoming(bob)[0].id, {
      sink: { write() {}, close() {}, abort: () => void (ignoredAborted = true) },
    });
    await waitFor(() => incoming(bob)[0].status === "done", 5_000);

    assert.equal(ignoredAborted, true);
    assert.deepEqual(offsets, [undefined, 2 * MB]);
    assert.equal(closes, 1);
    assert.equal(aborts, 0);
    assert.deepEqual(new Uint8Array(await new Blob(written).arrayBuffer()), source);
    assert.equal(incoming(bob)[0].savedToSink, true);
  });

  for (const how of ["revoke", "peer-left"] as const) {
    it(`releases a resumable download when the offer ends by ${how}`, async () => {
      bus = new FakeSignaling();
      bus.addPeer("peer-alice", { limits: { stallMs: 100 } });
      bus.addPeer("peer-bob00", { limits: { stallMs: 100 } });
      bus.net.pauseAfterBytes = MB + 1;
      let aborted = false;

      const [alice, bob] = [bus.peers.get("peer-alice")!, bus.peers.get("peer-bob00")!];
      alice.manager.offerFiles([new File([randomBytes(2 * MB)], "a.bin")]);
      await waitFor(() => incoming(bob).length === 1);
      bob.manager.request(incoming(bob)[0].id, {
        sink: { write() {}, close() {}, abort: () => void (aborted = true) },
      });
      await waitFor(() => failure(bob) !== undefined);
      assert.equal(incoming(bob)[0].resumableBytes, MB);

      if (how === "revoke") {
        alice.manager.revoke(outgoing(alice).id);
      } else {
        bob.manager.handleSignal("peer-alice", { type: "peer-left" });
      }
      await waitFor(() => incoming(bob)[0]?.status === "revoked");
      await waitFor(() => aborted);
      assert.equal(incoming(bob)[0].resumableBytes, undefined);
    });
  }

  it("releases a resumable download when it is dismissed", async () => {
    bus = new FakeSignaling();
    bus.addPeer("peer-alice", { limits: { stallMs: 100 } });
    bus.addPeer("peer-bob00", { limits: { stallMs: 100 } });
    bus.net.pauseAfterBytes = MB + 1;
    let aborted = false;

    const [alice, bob] = [bus.peers.get("peer-alice")!, bus.peers.get("peer-bob00")!];
    alice.manager.offerFiles([new File([randomBytes(2 * MB)], "a.bin")]);
    await waitFor(() => incoming(bob).length === 1);
    bob.manager.request(incoming(bob)[0].id, {
      sink: { write() {}, close() {}, abort: () => void (aborted = true) },
    });
    await waitFor(() => failure(bob) !== undefined);
    assert.equal(incoming(bob)[0].resumableBytes, MB);

    bob.manager.dismiss(incoming(bob)[0].id);
    await waitFor(() => aborted);
  });
});

describe("sanitizeFileName", () => {
  it("replaces separators and control characters", () => {
    assert.equal(sanitizeFileName("../etc/passwd"), ".._etc_passwd");
    assert.equal(sanitizeFileName("a\\b c"), "a_b_c_");
    assert.equal(sanitizeFileName("   "), "file");
    assert.equal(sanitizeFileName("résumé 📄.pdf"), "résumé 📄.pdf");
  });
});
