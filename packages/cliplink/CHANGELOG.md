# Changelog

## 0.1.0

First release. The CLIPLINK room protocol, extracted from the web app so the
app and the CLI share one implementation of the encryption rather than one
each.

- **The protocol.** End-to-end encryption (HKDF from the room key, AES-GCM per
  clip), the room wire types, room codes, QR encoding, and hand-written
  validation. Wire protocol v1 is fixed: a client on any version talks to a
  room served by any other, and the tests pin ciphertexts from earlier builds.
- **Both transports.** `createHttpClient` polls, `createWebSocketTransport`
  holds a socket open, and both implement `TransportClient`, so a client writes
  its retry and backoff logic once. Each takes its origin as a parameter —
  nothing here assumes a browser, and `window` appears nowhere in it.
- **The `cliplink` CLI**, shipped in this package as a `bin`. `cliplink send`
  creates a room and prints a link and QR code for the other device;
  `cliplink recv` prints clips as they arrive. Importing the library never
  loads it, so a browser bundle pays nothing for the CLI.
- Requires Node 20.9 or newer for the library's use of Web Crypto.
