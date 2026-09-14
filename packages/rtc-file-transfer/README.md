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
- **Offer / request / revoke.** Senders announce metadata and hold only a `File` reference. Receivers pull the file when they choose, and senders can withdraw an offer mid-download.
- **Untrusted peers.** Signals are validated field by field, file names are sanitized, and a sender that sends more or fewer bytes than it announced is rejected.

It has zero dependencies, is framework-agnostic ESM, and works with your own signaling: WebSocket, Socket.IO, Supabase Realtime, `BroadcastChannel`, or anything else that moves JSON between peers. File bytes never pass through your server.

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
    if (notice.type === "received") saveBlob(notice.item.blob!, notice.item.name);
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

## API

### `createFileTransferManager(options)`

| Option | |
| --- | --- |
| `peerId` | This peer's id. |
| `sendSignal(payload, to?)` | Deliver a signal. Return `false` if it can't be sent. |
| `onItemsChange(items)` | Called with a fresh snapshot whenever state changes. Progress updates are coalesced to every 100 ms. |
| `onNotice(notice)` | `incoming-offer`, `received`, or `failed` with a `code`. |
| `iceServers` | Defaults to public Google and Cloudflare STUN servers. Add a TURN server for restrictive networks. |
| `limits` | Any of `maxFileBytes` (500 MB), `chunkBytes` (64 KB), `bufferHighBytes` (4 MB), `bufferLowBytes` (1 MB), `stallMs` (20 s), `maxItems` (20). |
| `createId` | Id generator for offers and transfers. |
| `createPeerConnection` | For environments without a global `RTCPeerConnection`, such as Node with a WebRTC polyfill. |

The manager returns `handleSignal`, `announce`, `offerFiles`, `request`, `cancel`, `revoke`, `dismiss` and `dispose`.

While an incoming item is `transferring`, it also carries `bytesPerSecond` (a smoothed rate) and `etaMs`. Both are cleared when the transfer ends.

`offerFiles` returns `{ offered, rejected }`. Each rejection is `{ file, code: "empty" | "too-large", limit }`.

### Failure codes

`stalled` · `nat` · `read-error` · `negotiation` · `incomplete` · `overflow` · `canceled` · `revoked` · `sender-left` · `closed` · `remote-canceled`

Each failure notice also carries an English `message`. Use the `code` to show your own wording.

### `parseFileSignal(input, limits?)`

Returns a signal rebuilt from known fields only, or `null` if the input isn't valid. Run everything that arrives from another peer through it.

## Protocol

Protocol v1 is a set of small JSON messages (`hello`, `file-offer`, `file-revoke`, `file-request`, `rtc-description`, `rtc-candidate` and `transfer-cancel`), plus a per-transfer ordered data channel. On that channel, binary chunks are followed by the string `"done"`, and the receiver answers with `"ack"`. Each download gets its own `RTCPeerConnection`, so one slow receiver never holds up another.

## Why not simple-peer or PeerJS?

Both give you a connection and a channel. Neither gives you file semantics: you still have to write chunking, flow control against `bufferedAmount`, completion and integrity checks, stall handling, and offer/withdraw state. This package covers only that layer, and you can use it next to either library.

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
