# @thebkht/rtc-file-transfer

<p>
  <a href="https://www.npmjs.com/package/@thebkht/rtc-file-transfer"><img alt="npm version: @thebkht/rtc-file-transfer" src="https://img.shields.io/npm/v/@thebkht/rtc-file-transfer.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/@thebkht/rtc-file-transfer"><img alt="npm downloads per month: @thebkht/rtc-file-transfer" src="https://img.shields.io/npm/dm/@thebkht/rtc-file-transfer.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
  <a href="https://www.npmjs.com/package/@thebkht/rtc-file-transfer"><img alt="TypeScript types included" src="https://img.shields.io/npm/types/@thebkht/rtc-file-transfer.svg?style=for-the-badge&amp;logo=typescript&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/thebkht/cliplink/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/thebkht/cliplink/ci.yml?style=for-the-badge&amp;labelColor=000000&amp;label=ci" height="28"></a>
  <a href="https://github.com/thebkht/cliplink/blob/main/packages/rtc-file-transfer/LICENSE"><img alt="License: MIT" src="https://img.shields.io/npm/l/@thebkht/rtc-file-transfer.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
</p>

Send files peer-to-peer over WebRTC data channels, with the parts that are easy to get wrong already done:

- **Backpressure, both ends.** Stops sending at a high-water mark on `bufferedAmount` and resumes on `bufferedamountlow`, so large files don't fill the send queue and kill the channel. The receiver can hold the sender back too, so a slow disk doesn't pile up in its memory.
- **Chunking.** Chunks are capped at the SCTP `maxMessageSize` the connection actually negotiated.
- **Stall detection.** A transfer that makes no progress fails with a code instead of hanging forever.
- **Integrity checks.** Every 1 MiB is verified against a SHA-256 digest before it's kept, and an offer can carry a digest of the whole file that the receiver checks at the end.
- **Resume and pause.** A download that drops part way — or that the user paused — picks up from its last verified block instead of starting over, and with a resume store it survives a reload or a crash too.
- **Stream to disk.** Downloads can write into any sink, so large files never have to fit in memory. Ready-made sinks cover a file the user picks, a folder, and the Origin Private File System, which works in every current browser.
- **Progress.** Incoming items report bytes, a smoothed transfer rate, and time left.
- **Offer / request / revoke.** Senders announce metadata and hold only a `File` reference. Receivers pull the file when they choose, and senders can withdraw an offer mid-download.
- **Untrusted peers.** Signals are validated field by field, file names are sanitized, and a sender that sends more or fewer bytes than it announced is rejected.

It has zero dependencies, is framework-agnostic ESM, and works with your own signaling: WebSocket, Socket.IO, Supabase Realtime, `BroadcastChannel`, or anything else that moves JSON between peers — with [adapters](#signaling-adapters) ready for most of them. File bytes never pass through your server.

Extracted from [CLIPLINK](https://cliplink.thebkht.com) ([source](https://github.com/thebkht/cliplink)), where it runs in production. Try a transfer there between two devices to see it working.

For a page you can read end to end, [`examples/two-tabs.html`](https://github.com/thebkht/cliplink/blob/main/packages/rtc-file-transfer/examples/two-tabs.html) is a whole client — offers, downloads, pause, resume across a reload — in one static file with no build step. Serve the folder and open it in two tabs.

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

```ts
// simple-peer: one connection you already have
import SimplePeer from "simple-peer";
import { simplePeerSignaling } from "@thebkht/rtc-file-transfer/adapters";

const peer = new SimplePeer({ initiator, trickle: true });
const signaling = simplePeerSignaling(peer, "the-other-peer");
const files = createFileTransferManager({ peerId: myId, sendSignal: signaling.sendSignal, ... });
signaling.connect(files);
```

```ts
// PeerJS: many connections, tracked for you
import Peer from "peerjs";
import { peerJsSignaling } from "@thebkht/rtc-file-transfer/adapters";

const peer = new Peer(myId);
const signaling = peerJsSignaling(peer);
const files = createFileTransferManager({ peerId: myId, sendSignal: signaling.sendSignal, ... });
signaling.connect(files);
signaling.connectTo("their-id"); // or let them connect to you
```

```ts
// Trystero: a room, with its own joins and leaves
import { joinRoom } from "trystero";
import { trysteroSignaling } from "@thebkht/rtc-file-transfer/adapters";

const room = joinRoom({ appId: "my-app" }, "room-code");
const signaling = trysteroSignaling(room, myId);
const files = createFileTransferManager({ peerId: myId, sendSignal: signaling.sendSignal, ... });
signaling.connect(files);
```

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
| `limits` | Any of `maxFileBytes` (64 GiB), `maxMemoryBytes` (500 MB), `chunkBytes` (64 KB), `bufferHighBytes` (4 MB), `bufferLowBytes` (1 MB), `windowBytes` (16 MB), `stallMs` (20 s), `maxItems` (20). |
| `createId` | Id generator for offers and transfers. |
| `capabilities` | Protocol features to advertise: `blocks`, `resume` and `flow`. Defaults to all of them where `crypto.subtle` exists. Pass `[]` to behave exactly like a v1 peer. |
| `createPeerConnection` | For environments without a global `RTCPeerConnection`, such as Node with a WebRTC polyfill. |
| `resume` | A `ResumeProvider` that keeps partial downloads across page loads. `opfsResume()` from `/sinks` is one. |

The manager returns `handleSignal`, `announce`, `offerFiles`, `request`, `pause`, `resume`, `cancel`, `revoke`, `dismiss` and `dispose`.

`offerFiles(entries, { batch?, digest? })` takes `File`s or `{ file, path }` entries, where `path` is the folder a file sits in (`photos/2024`). With `batch: true`, every file in the call shares one `batchId`, so a receiver can show them as a group.

With `digest: true`, each file is hashed in the background and the offer is re-announced carrying a `digest` of the whole file. The file is offered straight away either way, and `item.hashedBytes` reports how far the hashing has got. See [Verifying the whole file](#verifying-the-whole-file). Incoming items carry `path` (sanitized, and dropped if it tries to climb out with `..`) and `batchId`.

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

To write your own, implement `write`, `close` and `abort`. Writes are serialized. `close` runs once every byte has arrived; return a `Blob` from it to expose one as `item.blob`, or return nothing and the item gets `savedToSink: true`. `abort` runs if the download fails or never starts, and a sink that throws fails the transfer with `write-error`. With `flow` on both sides the sink sets the pace, so a slow disk can't pile up in memory; against a peer without it, bytes that arrive faster than the sink writes them still queue.

### Verifying the whole file

Block hashes ride the data channel next to the bytes they cover, so they catch corruption but not a sender that lies about both. An offer's `digest` closes that: it is the SHA-256 of the file's block digests joined together, it travels over your signaling layer rather than the data channel, and the receiver checks it once every block has arrived. A mismatch fails with `digest-mismatch` and keeps nothing, since the bytes aren't the ones that were offered.

```ts
files.offerFiles([...input.files!], { digest: true });
```

It needs `blocks` on both sides. Only trust it as far as you trust your signaling: a sender that controls both paths can still make them agree. The first digest an offer arrives with is the one that is kept, so a later re-announce can't swap it.

### Surviving a reload

A dropped connection is one thing; a closed tab is another. Pass a `ResumeProvider` and a partial download outlives the page:

```ts
import { opfsResume } from "@thebkht/rtc-file-transfer/sinks";

const files = createFileTransferManager({ ..., resume: opfsResume() });
// The sender has to hash, so the offer carries an identity to resume against.
files.offerFiles([...input.files!], { digest: true });
```

On the next load the offer comes back, the manager asks the store what it has, and the item shows `resumableBytes` before anything is requested. `request` then continues into the same file. The store also supplies the sink for a fresh download, so nothing else is needed for a file with a digest.

`opfsResume()` writes fixed-size part files, closing each as it fills, because that is when bytes actually reach disk — so a reload replays at most one segment (64 MB by default; `segmentBytes` changes it). `close` returns the finished file as a Blob made of those parts, still backed by disk. A completed, revoked or dismissed file is deleted.

Write your own by implementing `load`, `open`, `checkpoint` and `forget`. The one rule: `checkpoint` must report only what is durably written, because that is exactly what the next load resumes from.

### Pausing and resuming

`pause(id)` stops an incoming download and keeps every verified block; the item goes to `paused` with no failure notice, and `resume(id)` — the same thing as calling `request` again — continues from there into the same sink. It needs `blocks` and `resume` on both sides, and returns false otherwise, so the UI can offer `cancel` instead.

When both peers support `resume`, a download that fails part way (`stalled`, `nat`, `negotiation`, `closed`, `corrupt`, `sender-left`, or `remote-canceled`) keeps what it has verified. The item shows `resumableBytes`, and calling `request(id)` again picks up from there, writing into the same sink. A new sink passed then is aborted. The kept sink is released when the item is dismissed, or when the sender revokes the offer or leaves.

### Failure codes

`stalled` · `nat` · `read-error` · `negotiation` · `incomplete` · `overflow` · `canceled` · `revoked` · `sender-left` · `closed` · `write-error` · `corrupt` · `digest-mismatch` · `needs-sink` · `paused` · `remote-canceled`

`paused` only appears on the wire, as the reason the sender is told; the paused item itself carries no error.

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
- With `flow` (which also requires `blocks`), the receiver answers each verified block with `{"t":"credit","b":<bytes committed>}`, and the sender stops once it is `windowBytes` ahead of that. Peers without it ignore the message and rely on `bufferedAmount` alone.

`file-offer` can also carry `path`, `batchId` and `digest`. These aren't capabilities: older peers drop them on receipt, showing loose files and skipping the whole-file check.

## Browser support

The transfer path itself works wherever data channels do. What changes between browsers is where received bytes can go.

| What it needs | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| Data channels, `bufferedAmount`, `bufferedamountlow` | 57 | 44 | 11 |
| `RTCSctpTransport.maxMessageSize` (chunk sizing) | 76 | 113 | 15.4 |
| Block hashes, whole-file digest (`crypto.subtle`) | yes, secure contexts | yes | yes |
| OPFS sink and `opfsResume()` (`FileSystemWritableFileStream`) | 86 | 111 | 26 |
| Save picker (`showSaveFilePicker`) | 86 | no | no |

Where `maxMessageSize` is missing, chunks stay at `limits.chunkBytes` (64 KB), which every implementation accepts; without a picker, `bestSink` uses OPFS; without either, downloads are assembled in memory and files over `maxMemoryBytes` are refused. Support data: [MDN browser-compat-data](https://github.com/mdn/browser-compat-data), checked 2026-09-15.

## Limits

Worth knowing before you pick this:

- **NAT traversal.** The defaults are STUN only. Behind symmetric NAT a connection needs a TURN relay, which you supply through `iceServers` and pay bandwidth for.
- **The tab has to stay open.** Closing or reloading a page closes its peer connections. Resume survives that only with a `ResumeProvider`, and only on the receiving side; the sender has to still be there, holding the same file.
- **Mobile backgrounding.** A hidden page can be frozen or discarded, which stops a transfer. Desktop Chrome exempts pages with an open data channel from intensive throttling, so the stall timer keeps working there.
- **Throughput is SCTP's.** One congestion window per association, and a user-space stack on both ends. This package can't make a data channel faster than the browser makes it.
- **Integrity is not authenticity.** Block hashes ride the same channel as the bytes. A `digest` moves the check onto your signaling path, so it is only as good as your trust in that path. See [Verifying the whole file](#verifying-the-whole-file).
- **No room auth or encryption beyond DTLS.** Who may join, and who may offer what, belongs to your signaling layer.
- **Node** needs a WebRTC implementation passed through `createPeerConnection`.

The threat model and how to report a vulnerability are in [SECURITY.md](https://github.com/thebkht/cliplink/blob/main/packages/rtc-file-transfer/SECURITY.md), which ships inside the package too.

## Compared with

Every cell was checked against that package's README or its published source on 2026-09-15; the full workings are in [the market research note](https://github.com/thebkht/cliplink/blob/main/docs/research/2026-09-15-rtc-file-transfer-market.md). ✅ yes · ⚠️ partial · ❌ no.

| | **this** | openrtc-file-transfer | simple-peer-files | filetransfer (otalk) | filepizza-client | trystero | peerjs | simple-peer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Offer / request / revoke | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ❌ | ❌ | ❌ |
| Backpressure on `bufferedAmount` | ✅ | — | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |
| Receiver can slow the sender | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Chunk capped at negotiated `maxMessageSize` | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Stall detection | ✅ | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| Integrity check | ✅ per 1 MiB | ✅ optional | ❌ | ⚠️ whole-file SHA-1 | ❌ | ❌ | ❌ | ❌ |
| Resume after a drop | ✅ verified | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Resume after a reload | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Stream into a sink | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Folders and batches | ✅ | ❌ | ⚠️ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Validates untrusted peers | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ |
| Bring your own signaling | ✅ | ❌ | ⚠️ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Runtime dependencies | 0 | 0 (peer: openrtc) | 4 | 3 | 0 | 1 | 4 | 7 |
| License | MIT | PolyForm Shield | MPL-2.0 | MIT | MIT | MIT | MIT | MIT |

The short version: **simple-peer and PeerJS aren't competitors**, they're the layer underneath. They give you a connection and a channel; chunking, flow control, completion, integrity, resume, stall handling and offer state are still yours to write. Use this on top of either — see the [adapters](#signaling-adapters).

The one library that matches on resume, integrity and streaming to disk together is `openrtc-file-transfer`, which is PolyForm Shield licensed and requires the OpenRTC runtime.

## Stability

1.0.0 is a commitment, in two parts.

**The API follows semver.** Anything documented here — exported functions and types, option names, `FileItem` fields, notice types, failure codes — changes only in a major. New failure codes and new `FileItem` fields can appear in a minor, so handle unknown `code` values by falling back to a generic message rather than asserting exhaustively.

**The wire protocol is versioned separately, and v1 is permanent.** Every release speaks v1, so a peer on any version can send to and receive from a peer on any other — a case the test suite covers by pairing a fully featured manager with one created as `capabilities: []`. Features are added as capabilities, never as changes to existing messages:

- A new feature gets a `Capability` name, advertised in `file-offer.caps` and `file-request.caps`, and is used only when both peers list it.
- New message fields are optional, and peers that don't know them drop them on receipt (`parseFileSignal` keeps known fields only).
- An existing field never changes meaning, and no message becomes mandatory.

A protocol v2 would be a different `hello`, negotiated, with v1 still spoken. There are no plans for one.

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
