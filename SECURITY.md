# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub Security Advisories:
[Report a vulnerability →](https://github.com/thebkht/cliplink/security/advisories/new)

Please include what you found, how to reproduce it, and what an attacker could do with it. Expect an initial response within a few days — this is a solo-maintained project, so please be patient.

## Threat model

CLIPLINK makes some deliberate tradeoffs that look like vulnerabilities but are known, documented design decisions. Please read these before reporting.

**Rooms are unauthenticated by design, but not readable by code alone.** A room is a random 6-character alphanumeric code. Anyone with the code can join the room, see that clips exist and see file offers arrive — but not read any of it without the room key, which is separate and never reaches the server. No accounts, no install, share a code. Ephemerality (rooms expire on a TTL) and per-IP rate limiting (a 60-token bucket refilling at 1/second, shared across instances through Redis) are the other mitigations.

**Clips and file signaling are end-to-end encrypted.** AES-GCM-256, with the key generated in the browser at room creation and never transmitted: it travels in the URL fragment, which browsers do not send to the server, or is read out and typed in. The 32 bytes of key material feed HKDF, giving separate subkeys for clips and for signaling. The room code is additional data on every message, so a ciphertext lifted from one room cannot be replayed into another.

**What the server can still see.** Encryption is not invisibility. The server holds, and an attacker who takes it would hold: the room code, clip IDs and timestamps, sender IDs, the size of each ciphertext, peer IDs, and the timing and volume of traffic. It also holds a one-way fingerprint of the room key, which lets it tell a joiner their key is wrong without being any closer to holding the key. It does **not** hold clip text, file names, file sizes, or SDP.

**The QR code does not carry the key.** The QR image is rendered by a third-party service from a URL passed in a query string, so the key is deliberately excluded — sending it there would hand the key to that service. Scanning opens the room and then asks for the key. A shared *link* does carry the key in its fragment; when that matters, "copy link without key" sends the two halves through different channels.

**Encryption is confidentiality and integrity, not a transcript.** Each message is independently sealed. Replay and reordering of signaling messages by a malicious server are not prevented. Clip IDs are server-assigned.

**A lost key is a lost room.** There is no recovery, by design — nobody who could perform a recovery exists.

**Files are peer-to-peer and never stored.** File transfer runs over WebRTC data channels directly between browsers. The server relays signaling messages only — it never sees, buffers, or stores file bytes. A file offer exists only while the sender's tab is open. Note that WebRTC exposes peer IP addresses to the other party, as it does in any WebRTC application.

**Rate limiting fails open.** If Redis is unreachable, requests are allowed through rather than rejected. This is a deliberate availability choice for an ephemeral, low-stakes service.

## What we do want to hear about

- Cross-room data leakage — any way to read clips, files, or signaling from a room you do not have the code for
- Room code predictability beyond brute force against the rate limiter
- XSS, injection, or SSRF in the app or API routes
- Ways to bypass the rate limiter, or to make a room outlive its TTL
- Signaling-channel abuse: forging, replaying, or hijacking a peer's WebRTC negotiation
- Anything that turns the server into a relay for file bytes or arbitrary traffic
- Dependency vulnerabilities that are actually reachable from this code

## Supported versions

Only the latest `main` and the currently deployed version are supported. There are no backports.
