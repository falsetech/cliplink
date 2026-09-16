# @thebkht/rtc-file-transfer

[![npm version](https://img.shields.io/npm/v/@thebkht/rtc-file-transfer.svg)](https://www.npmjs.com/package/@thebkht/rtc-file-transfer)
[![npm downloads](https://img.shields.io/npm/dm/@thebkht/rtc-file-transfer.svg)](https://www.npmjs.com/package/@thebkht/rtc-file-transfer)
[![types](https://img.shields.io/npm/types/@thebkht/rtc-file-transfer.svg)](https://www.npmjs.com/package/@thebkht/rtc-file-transfer)
[![license](https://img.shields.io/npm/l/@thebkht/rtc-file-transfer.svg)](https://github.com/thebkht/cliplink/blob/main/packages/rtc-file-transfer/LICENSE)
[![CI](https://github.com/thebkht/cliplink/actions/workflows/ci.yml/badge.svg)](https://github.com/thebkht/cliplink/actions/workflows/ci.yml)

Send files peer-to-peer over WebRTC data channels, with the parts that are easy to get wrong already done:

- **Backpressure.** Stops sending at a high-water mark on `bufferedAmount` and resumes on `bufferedamountlow`, so large files don't fill the send queue and kill the channel.
- **Chunking.** Chunks are capped at the SCTP `maxMessageSize` the connection actually negotiated.
- **Stall detection.** A transfer that makes no progress fails with a code instead of hanging forever.
- **Integrity checks.** Every 1 MiB is verified against a SHA-256 digest before it's kept.
- **Resume.** A download that drops part way picks up from its last verified block instead of starting over.
- **Stream to disk.** Downloads can write into any sink, so large files never have to fit in memory. Ready-made sinks cover a file the user picks, a folder, and the Origin Private File System, which works in every current browser.
- **Progress.** Incoming items report bytes, a smoothed transfer rate, and time left.
- **Offer / request / revoke.** Senders announce metadata and hold only a `File` reference. Receivers pull the file when they choose, and senders can withdraw an offer mid-download.
- **Untrusted peers.** Signals are validated field by field, file names are sanitized, and a sender that sends more or fewer bytes than it announced is rejected.

It has zero dependencies, is framework-agnostic ESM, and works with your own signaling: WebSocket, Socket.IO, Supabase Realtime, `BroadcastChannel`, or anything else that moves JSON between peers — with [adapters](#signaling-adapters) ready for most of them. File bytes never pass through your server.

Extracted from [CLIPLINK](https://cliplink.thebkht.com) ([source](https://github.com/thebkht/cliplink)), where it runs in production. Try a transfer there between two devices to see it working.

## Install

```sh
npm install @thebkht/rtc-file-transfer
```

## Usage

```ts
import { createFileTransferManager, parseFileSignal } from "@thebkht/rtc-file-transfer";

const socket = new WebSocket("wss://example.com/signal");
const myId = crypto.randomUUID();

const files = createFileTransferManager({
  peerId: myId,
  // Deliver to one peer, or to everyone when `to` is undefined.
  sendSignal: (payload, to) => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ from: myId, to, payload }));
    return true;
  },
  onItemsChange: (items) => render(items),
  onNotice: (notice) => {
    // `blob` is set unless the download went into a sink of your own.
    if (notice.type === "received" && notice.item.blob) saveBlob(notice.item.blob, notice.item.name);
    if (notice.type === "failed") console.warn(notice.code, notice.message);
  },
});

socket.addEventListener("open", () => files.announce());
socket.addEventListener("message", (event) => {
  const { from, to, payload } = JSON.parse(event.data);
  if (to && to !== myId) return;
  const signal = parseFileSignal(payload); // peers are untrusted
  if (signal) files.handleSignal(from, signal);
});

// Sender
input.addEventListener("change", () => files.offerFiles([...input.files!]));

// Receiver: once an item with direction "incoming" shows up
files.request(item.id);
```

When your signaling layer sees a peer disconnect, tell the manager with `files.handleSignal(peerId, { type: "peer-left" })`. `parseFileSignal` always rejects `peer-left` coming from a peer, so a peer can't claim that someone else left.

## Signaling adapters

`@thebkht/rtc-file-transfer/adapters` wires the manager to a transport you already have, so the snippet above becomes:

```ts
import { webSocketSignaling } from "@thebkht/rtc-file-transfer/adapters";

const signaling = webSocketSignaling(socket, myId);
const files = createFileTransferManager({ peerId: myId, sendSignal: signaling.sendSignal, ... });
const detach = signaling.connect(files);
```

`connect` validates every inbound signal with `parseFileSignal`, ignores signals addressed to another peer, calls `announce()` once the transport is ready, and returns a function that stops it all.

| Adapter | Notes |
| --- | --- |
| `webSocketSignaling(socket, peerId)` | Messages are `{"rtc-file-transfer":{from,to,payload}}`, so they can share a socket with your own traffic. Your server knows about disconnects; this doesn't, so send `peer-left` yourself. |
| `broadcastChannelSignaling(channel, peerId)` | Tabs of one origin. A tab says goodbye when it detaches or the page goes away. |
| `supabaseSignaling(channel, peerId)` | Broadcast events on a subscribed Realtime channel. |
| `trysteroSignaling(room, peerId)` | Its own Trystero action, using Trystero's own routing, joins and leaves. |
| `peerJsSignaling(peer)` | Tracks data connections; `connectTo(id)` opens one. The sender is the connection it arrived on, never the envelope. |
| `simplePeerSignaling(peer, remoteId)` | One connection, alongside your own messages on it. |

They work next to simple-peer and PeerJS rather than replacing them: those give you a connection, this gives you file semantics on top.

Anything else still works the way the example above does — an adapter is a convenience, not a requirement.

## API

### `createFileTransferManager(options)`

| Option | |
| --- | --- |
| `peerId` | This peer's id. |
| `sendSignal(payload, to?)` | Deliver a signal. Return `false` if it can't be sent. |
| `onItemsChange(items)` | Called with a fresh snapshot whenever state changes. Progress updates are coalesced to every 100 ms. |
| `onNotice(notice)` | `incoming-offer`, `received`, or `failed` with a `code`. |
| `iceServers` | Defaults to public Google and Cloudflare STUN servers. Add a TURN server for restrictive networks. |
| `limits` | Any of `maxFileBytes` (64 GiB), `maxMemoryBytes` (500 MB), `chunkBytes` (64 KB), `bufferHighBytes` (4 MB), `bufferLowBytes` (1 MB), `stallMs` (20 s), `maxItems` (20). |
| `createId` | Id generator for offers and transfers. |
| `capabilities` | Protocol features to advertise: `blocks` and `resume`. Defaults to both where `crypto.subtle` exists. Pass `[]` to behave exactly like a v1 peer. |
| `createPeerConnection` | For environments without a global `RTCPeerConnection`, such as Node with a WebRTC polyfill. |

The manager returns `handleSignal`, `announce`, `offerFiles`, `request`, `cancel`, `revoke`, `dismiss` and `dispose`.

`offerFiles(entries, { batch? })` takes `File`s or `{ file, path }` entries, where `path` is the folder a file sits in (`photos/2024`). With `batch: true`, every file in the call shares one `batchId`, so a receiver can show them as a group. Incoming items carry `path` (sanitized, and dropped if it tries to climb out with `..`) and `batchId`.

`offerFiles` returns `{ offered, rejected }`. Each rejection is `{ file, code: "empty" | "too-large", limit }`.

While an incoming item is `transferring`, it also carries `bytesPerSecond` (a smoothed rate) and `etaMs`. Both are cleared when the transfer ends.

### Where received bytes go

`request(id, { sink })` streams a download into a `FileSink` instead of memory. Without a sink, the download is assembled in memory as a `Blob`, and files over `limits.maxMemoryBytes` are refused: `request` returns `false` with a `needs-sink` failure notice.

`@thebkht/rtc-file-transfer/sinks` has sinks ready to use:

```ts
import { bestSink } from "@thebkht/rtc-file-transfer/sinks";

// Inside the click handler: the save picker needs user activation.
button.addEventListener("click", async () => {
  const sink = await bestSink(item); // rejects with AbortError if the picker is dismissed
  files.request(item.id, { sink });
});
```

| Sink | Where the bytes go | Browsers |
| --- | --- | --- |
| `pickFileSink(name)` | A file the user picks with `showSaveFilePicker` | Chromium |
| `directorySink(root, path, name)` | `path/name` inside a folder from `pickDirectory()` | Chromium |
| `opfsSink(name)` | The Origin Private File System. `close` returns a disk-backed `Blob` as `item.blob` | Chromium, Firefox 111+, Safari 26+ |
| `writableSink(stream)` | Any `WritableStream` or `FileSystemWritableFileStream` | Everywhere |

`bestSink(item)` tries the picker, then OPFS, and resolves `undefined` when neither exists. OPFS files stay until `clearOpfs()` removes them; remove them only after the user has saved the Blob, since it stops being readable once its file is gone. `canPickFile`, `canPickDirectory` and `hasOpfs` report what the browser supports.

To write your own, implement `write`, `close` and `abort`. Writes are serialized. `close` runs once every byte has arrived; return a `Blob` from it to expose one as `item.blob`, or return nothing and the item gets `savedToSink: true`. `abort` runs if the download fails or never starts, and a sink that throws fails the transfer with `write-error`. The receiver can't slow the sender down, so bytes that arrive faster than the sink writes them queue in memory.

### Resuming

When both peers support `resume`, a download that fails part way (`stalled`, `nat`, `negotiation`, `closed`, `corrupt`, `sender-left`, or `remote-canceled`) keeps what it has verified. The item shows `resumableBytes`, and calling `request(id)` again picks up from there, writing into the same sink. A new sink passed then is aborted. The kept sink is released when the item is dismissed, or when the sender revokes the offer or leaves.

### Failure codes

`stalled` · `nat` · `read-error` · `negotiation` · `incomplete` · `overflow` · `canceled` · `revoked` · `sender-left` · `closed` · `write-error` · `corrupt` · `needs-sink` · `remote-canceled`

Each failure notice also carries an English `message`. Use the `code` to show your own wording.

### `parseFileSignal(input, limits?)`

Returns a signal rebuilt from known fields only, or `null` if the input isn't valid. Run everything that arrives from another peer through it.

## Protocol

Protocol v1 is a set of small JSON messages (`hello`, `file-offer`, `file-revoke`, `file-request`, `rtc-description`, `rtc-candidate` and `transfer-cancel`), plus a per-transfer ordered data channel. On that channel, binary chunks are followed by the string `"done"`, and the receiver answers with `"ack"`. Each download gets its own `RTCPeerConnection`, so one slow receiver never holds up another.

### Capabilities

Newer peers negotiate optional features through fields that v1 peers never send and drop on receipt, so any pair of versions interoperates:

- `file-offer.caps` lists what the sender supports, and `file-request.caps` lists what the receiver supports. A feature is used only when both lists include it.
- With `blocks`, the sender follows every `BLOCK_BYTES` (1 MiB) of data with the string `{"t":"block","i":<index>,"h":"<sha256 hex>"}`. The receiver checks each block before writing it to the sink.
- With `resume` (which requires `blocks`), `file-request.offset` asks the sender to start at a block boundary.

`file-offer` can also carry `path` and `batchId`. These aren't capabilities: they're display metadata, and an older receiver simply shows loose files.

## Why not simple-peer or PeerJS?

Both give you a connection and a channel. Neither gives you file semantics: you still have to write chunking, flow control against `bufferedAmount`, completion and integrity checks, resume, stall handling, and offer/withdraw state. This package covers only that layer, and you can use it next to either library.

## Contributing

Issues and pull requests go to [thebkht/cliplink](https://github.com/thebkht/cliplink/issues). The package lives in `packages/rtc-file-transfer`:

```sh
pnpm install
pnpm -F @thebkht/rtc-file-transfer test
pnpm -F @thebkht/rtc-file-transfer build
```

The tests use Node's built-in test runner against an in-memory WebRTC fake, so they need no browser. Changes to the wire protocol must stay compatible with v1 peers. See the [changelog](https://github.com/thebkht/cliplink/blob/main/packages/rtc-file-transfer/CHANGELOG.md) for release history.

## License

MIT
