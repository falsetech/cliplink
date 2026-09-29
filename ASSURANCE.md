# Security assurance case

This is the argument for why CLIPLINK meets its security requirements. It is
also a map of where each claim is enforced, so a reviewer can check it.
[SECURITY.md](SECURITY.md) is the user-facing half: what to expect, and how to
report a problem. When the two disagree, fix whichever is wrong.

## Security requirements

1. **Confidentiality of private rooms.** Nobody without the room key can read clip text, file names, file sizes or WebRTC session descriptions, and that includes the server operator.
2. **Integrity.** A tampered clip or signaling message is rejected, not shown. A ciphertext cannot be moved from one room into another.
3. **No file bytes on the server.** Files travel peer to peer and are never relayed, buffered or stored server-side.
4. **Bounded resources.** One client cannot make the server hold unbounded data or keep a room alive forever.
5. **No execution of untrusted input.** Clip text and file metadata are rendered as data, never as markup or code.

Open rooms deliberately give up requirement 1 with respect to the operator, since their key is derived from the room code. SECURITY.md says so to users.

## Threat model and trust boundaries

```
 browser / CLI  ──TLS──▶  Next.js routes + WebSocket  ──TLS──▶  Redis (Upstash)
   (trusted:               (untrusted for content:               (untrusted:
    holds the key)          sees ciphertext, codes,               stores ciphertext
                            peer IDs, sizes, timing)              and metadata)
 browser ◀──── WebRTC data channel (DTLS) ────▶ browser
```

- **Boundary 1 — the device.** The key is generated with `crypto.getRandomValues`, kept in memory, and carried only in the URL fragment, which browsers never send to the server. Everything past this boundary sees only ciphertext.
- **Boundary 2 — the server.** Every request is untrusted input. The server authenticates nobody (rooms are capability-by-code) and can read nothing in a private room.
- **Boundary 3 — the peer.** The other device holds the key, so it is trusted with the content but not with the protocol. Every signal it sends is parsed and bounded before use.

Attackers considered: another client in the same room, a client guessing codes, a network attacker, and a compromised or curious server or storage operator. Out of scope: a compromised device, and a malicious browser or extension.

## How each requirement is met

| Requirement | Mechanism | Where |
| --- | --- | --- |
| 1 | AES-GCM-256 through Web Crypto, with subkeys for clips and for signaling derived by HKDF-SHA-256. The key never enters a path, query string or request body. The server holds only a one-way key fingerprint. | `packages/cliplink/src/crypto.ts` |
| 2 | GCM authentication with the room code as additional data, and a fresh random 96-bit IV per message. Ciphertexts from earlier builds are pinned by tests, so the format cannot drift unnoticed. | `packages/cliplink/src/crypto.ts`, `packages/cliplink/test/crypto.test.ts` |
| 3 | The socket route relays signaling envelopes only, capped by `maxPayload` at `MAX_SIGNAL_BYTES` (24 KiB). File bytes move over a WebRTC data channel between peers. | `app/rooms/[code]/socket/route.ts`, `packages/rtc-file-transfer` |
| 4 | Server-side validation of every field (room code, IDs, ciphertext shape and size, TTL bounds). Token-bucket rate limits per IP. Room TTL between 1 and 24 hours, refreshed only on write. | `packages/cliplink/src/validation.ts`, `packages/cliplink/src/protocol.ts`, `lib/cliplink/rate-limit.ts`, `lib/cliplink/storage.ts` |
| 5 | React renders clip text as text. No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the app or packages. Incoming signals are rebuilt from known fields only by `parseFileSignal`. | `components/`, `packages/rtc-file-transfer/src/parse.ts` |

## Secure design principles applied

- **Economy of mechanism.** There is one implementation of the crypto, the wire types and the transports, shared by the app and the CLI. See [`@thebkht/cliplink`](packages/cliplink).
- **Fail-safe defaults.** A room joined without its key opens locked: content is unreadable and sending is disabled. Malformed input is rejected, not repaired.
- **Complete mediation.** Every clip and every socket message passes the validators on every request. Nothing is trusted because of an earlier check.
- **Least privilege.** CI tokens are read-only by default. The job that publishes to npm cannot write to the repository, and the job that creates releases cannot publish.
- **Separation of privilege.** Publishing needs a pushed tag and a human approval on the `npm-publish` environment.
- **Minimal data.** No accounts, no plaintext, no file bytes, and data expires by TTL.
- **Least common mechanism.** Rate-limit buckets and pub/sub channels are keyed per room and per IP.
- **Open design.** The protocol and the threat model are public, and security does not depend on keeping the design secret.

## Common weaknesses countered

| Weakness (CWE / OWASP) | Countermeasure |
| --- | --- |
| Injection, XSS (CWE-79) | React escaping; no raw HTML; strict ciphertext pattern `^v1\.[A-Za-z0-9_-]+$` on the server |
| SSRF (CWE-918) | The server's one outbound fetch goes to a fixed URL; no user-controlled URL is ever fetched |
| Weak randomness (CWE-330) | Keys, IVs and room codes come from the CSPRNG; `Math.random` is used only for non-secret transfer IDs when `randomUUID` is unavailable |
| Broken crypto (CWE-327) | Only published primitives through Web Crypto; no custom crypto, MD5, SHA-1 or ECB |
| Key exposure in logs (CWE-532) | The key lives only in the URL fragment and is never in a request line |
| Resource exhaustion (CWE-400) | Payload caps, rate limits and TTL bounds, as above |
| Cross-room replay | The room code is GCM additional data |
| Supply chain | Lockfile installs, actions pinned by SHA, Dependabot with a 3-day cooldown, dependency review on PRs, npm provenance, signed release tarballs |

## Known limits

These are accepted and documented rather than countered:
- The rate limiter fails open when Redis is unreachable, choosing availability over strict limiting.
- A malicious server can replay or reorder signaling messages.
- WebRTC shows each peer the other's IP address.
- Open rooms are not end-to-end encrypted.
- There is no Content-Security-Policy header yet.

## Verification

- **Tests:** the package test suites pin the crypto format, validation and protocol compatibility (`pnpm -F @thebkht/cliplink test`, `pnpm -F @thebkht/rtc-file-transfer test`). `packages/cliplink/test/validation.fuzz.test.ts` fuzzes the validators.
- **Static analysis:** CodeQL runs on every push and pull request.
- **Supply chain:** OpenSSF Scorecard runs weekly.
