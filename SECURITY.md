# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub Security Advisories:
[Report a vulnerability →](https://github.com/thebkht/cliplink/security/advisories/new)

Please include what you found, how to reproduce it, and what an attacker could do with it. Expect an initial response within a few days — this is a solo-maintained project, so please be patient.

## Threat model

CLIPLINK makes some deliberate tradeoffs that look like vulnerabilities but are known, documented design decisions. Please read these before reporting.

**Rooms are unauthenticated and guessable by design.** A room is a random 6-character alphanumeric code. Anyone who has the code can join, read clips, and see file offers. That is the entire product — no accounts, no install, share a code. The mitigations are ephemerality (rooms expire on a TTL) and per-IP rate limiting (60 requests/minute, enforced atomically in Redis), not secrecy of the code.

**Clip text is stored unencrypted.** Clips reach the server in plaintext and are stored in Redis in plaintext, with a TTL between 1 and 24 hours (6h default) and a cap of 50 clips per room. End-to-end encryption is on the roadmap but is **not implemented today**. Do not send secrets, credentials, or sensitive personal data through CLIPLINK.

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
