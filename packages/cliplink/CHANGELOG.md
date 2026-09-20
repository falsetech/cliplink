# Changelog

## 0.1.1

- **Room codes now come from the CSPRNG.** `generateRoomCode` drew from `Math.random`, whose output is predictable from a handful of earlier draws. A room code is the room's only identifier, and for a room opened by its code alone it is the whole of the key material, since `deriveOpenRoomKey` takes nothing else. The format is unchanged, so this is not a wire change and existing codes still resolve.
- `--ttl` is checked against the 3600–86400 the help text advertises before the request goes out, through the `validateRoomTtl` the server already uses. `--ttl` alongside a room named by `CLIPLINK_ROOM` now says so, rather than reporting that "this run joins one" when the command line shows no room at all.
- `resolveBaseUrl` is exported, for anyone implementing `TransportClient` against a lazy origin.
- The package ships its own `LICENSE`. There was none, so the tarball carried no licence text and both `README.md` and `CLI.md` linked above the package root to a file that was not there.

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
- Requires Node 22 or newer, and has no third-party dependencies. The CLI talks
  to a room over Node's own `WebSocket` global rather than carrying `ws`, and
  the library uses Web Crypto, which is global from the same versions.
