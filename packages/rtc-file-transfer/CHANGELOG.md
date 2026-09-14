# Changelog

## Unreleased

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
