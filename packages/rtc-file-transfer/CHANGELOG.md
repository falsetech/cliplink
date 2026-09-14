# Changelog

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
