# Changelog

## 0.9.0

- New capability `flow`: the receiver credits the sender with what its sink has committed, and the sender stops once it is `windowBytes` (16 MB) ahead. Memory is now bounded at both ends, so a slow disk can't pile up in the receiver's. Requires `blocks`; peers without it fall back to `bufferedAmount` alone.
- `pause(id)` and `resume(id)`: pause an incoming download and keep every verified block. The item's status becomes `paused`, with no failure notice, and resuming continues into the same sink. Needs `blocks` and `resume` on both sides; `pause` returns false otherwise.
- New limit `windowBytes`, new status `paused`, new failure code `paused` (sent to the sender as the reason; the paused item carries no error).

## 0.8.0

- `offerFiles(entries, { digest: true })` hashes each file in the background and re-announces the offer with a `digest`: the SHA-256 of its block digests joined together. `FileItem.hashedBytes` reports progress.
- Receivers check that digest once every block has arrived, and fail with the new code `digest-mismatch` if it doesn't match. Since the digest travels over signaling and the bytes over the data channel, it catches a sender that lies on one path.
- The digest is an optional `file-offer` field, so v1 peers drop it and behave exactly as before. An offer keeps the first digest it arrives with.

## 0.7.0

- `@thebkht/rtc-file-transfer/adapters`: signaling adapters for transports you already have — `webSocketSignaling`, `broadcastChannelSignaling`, `supabaseSignaling`, `trysteroSignaling`, `peerJsSignaling` and `simplePeerSignaling`. Each validates inbound signals with `parseFileSignal`, drops signals meant for another peer, reports departures where the transport knows about them, and announces once it is ready. The library types are structural, so there are still no dependencies.

## 0.6.0

- `@thebkht/rtc-file-transfer/sinks`: ready-made sinks for a file the user picks (`pickFileSink`), a folder (`pickDirectory`, `directorySink`), the Origin Private File System (`opfsSink`, `clearOpfs`), and any writable stream (`writableSink`), plus `bestSink` and the `canPickFile`, `canPickDirectory` and `hasOpfs` checks. OPFS brings streaming to disk to Firefox and Safari.
- New limit `maxMemoryBytes` (500 MB): `request` without a sink refuses a larger file, returning `false` with the new failure code `needs-sink`.
- The `maxFileBytes` default rises from 500 MB to 64 GiB, now that large files have somewhere to go. Receivers on 0.5.0 or older still ignore offers over 500 MB.

## 0.5.0

- Folders: `offerFiles` accepts `{ file, path }` entries and a `batch` option. Offers carry optional `path` and `batchId` fields, which older receivers drop, so they see loose files.
- `sanitizeRelativePath` export, and a `maxPathChars` parse limit (1024).

## 0.4.0

- Capability negotiation on top of protocol v1 through optional `caps` fields, fully compatible with older peers.
- `blocks`: every 1 MiB is verified against a SHA-256 digest sent in-band. A mismatch fails with the new code `corrupt`.
- `resume`: a download that fails part way keeps its verified bytes (`FileItem.resumableBytes`), and `request` continues from there into the same sink.
- New `capabilities` option, and `BLOCK_BYTES`, `CAPABILITIES`, and `Capability` exports.

## 0.3.0

- `request(id, { sink })` streams a download into a `FileSink` (for example a file on disk) instead of memory. New `FileItem.savedToSink` and failure code `write-error`.
- A sender that has sent every byte waits up to two minutes for the receiver to commit the file instead of reporting a stall, and counts the delivery only once the receiver acknowledges it.
- Canceling while a sink is still closing aborts the sink.

## 0.2.0

- `FileItem.bytesPerSecond` and `FileItem.etaMs` on incoming items while they transfer.

## 0.1.1

- README: npm badges, a link to the source repository, and contributing steps.
- First release published from CI through npm trusted publishing, with provenance.

## 0.1.0

- First release, extracted from [cliplink](https://github.com/thebkht/cliplink).
- `createFileTransferManager` with configurable `limits`, `createId`, and `createPeerConnection`.
- Machine-readable `FailureCode` on failure notices and `OfferRejection` codes.
- `parseFileSignal` for validating signals received from untrusted peers.
- Wire protocol v1.
