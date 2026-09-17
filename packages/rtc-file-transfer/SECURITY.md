# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub Security Advisories:
[Report a vulnerability →](https://github.com/thebkht/cliplink/security/advisories/new)

Include what you found, how to reproduce it, and what an attacker could do with it. Expect an initial response within a few days — this is a solo-maintained project.

## Supported versions

The latest published version is supported. There are no backports. The wire protocol is versioned separately from the package: v1 is permanent, so a fix never requires peers to upgrade in lockstep.

## Supply chain

- **Zero runtime dependencies.** The published tarball contains `dist/` and nothing else executable, and there are no install scripts.
- **Published from CI with provenance.** Releases go out from a tag-triggered GitHub Actions workflow using npm trusted publishing (OIDC), so every version carries a provenance attestation linking it to the commit and workflow that built it. Verify with `npm audit signatures`.
- The only dev dependency is TypeScript.

## Threat model

This library moves bytes between two browsers. It assumes the peer on the other end is hostile and the signaling layer is yours.

**Peers are untrusted.** Everything arriving from another peer goes through `parseFileSignal`, which rebuilds a signal from known fields only and drops the rest. File names are sanitized, relative paths that try to climb out with `..` are rejected, and a sender that delivers more or fewer bytes than it announced fails the transfer. Limits (`maxFileBytes`, `maxItems`, `maxMemoryBytes`) cap what a peer can make a receiver allocate. `peer-left` is rejected when it arrives from a peer, so nobody can claim someone else has gone.

**Integrity is not authenticity.** Per-block SHA-256 catches corruption and bugs, but the hashes ride the same data channel as the bytes, so a sender that lies about both is not caught. An offer's `digest` moves that check onto your signaling path, which makes it as trustworthy as that path is — and no more.

**Transport security is DTLS's.** WebRTC data channels are encrypted and integrity-protected by DTLS. This library adds no encryption of its own, and no notion of identity, rooms, passwords, or who is allowed to offer what. All of that belongs to the signaling layer you supply.

**WebRTC exposes IP addresses** to the peer on the other end, as it does in any WebRTC application. With a TURN relay the peers see the relay instead.

**Sinks write where you point them.** `directorySink` writes inside a directory the user picked, under a sanitized path. A sink of your own is your responsibility; a name from a peer is attacker-controlled input.

## What we want to hear about

- A signal that gets past `parseFileSignal` and reaches the manager with unexpected shape or type
- A path or file name that escapes its intended directory
- A way to make a receiver allocate or write beyond its configured limits
- Bytes accepted as valid that do not match a verified block hash or an offer digest
- A way for a third peer to hijack, forge, or resume another pair's transfer
