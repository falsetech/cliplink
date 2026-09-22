import type { WsServerMessage } from "../src/types.ts";

/**
 * Shared fakes for the tests that drive the transports and the CLI.
 *
 * Hand-rolled on purpose, like `transport.test.ts`'s own `FakeSocket`: the
 * surface these code paths touch is small, and a fake this size can be read
 * in full, which a mocking library's configuration cannot.
 */

// Captured at import, before any test enables `mock.timers`. Tests that fake
// the clock still need a real one to wait on the real work — WebCrypto
// finishes on a thread pool, on its own schedule, whatever the fake clock says.
const realSetTimeout = globalThis.setTimeout;

/** Lets real, asynchronous work finish, so a test can assert something did *not* happen. */
export function settle(ms = 25) {
  return new Promise<void>((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

/**
 * Waits for `condition` to hold, yielding to the event loop between checks.
 * Prefer this to `settle` whenever there is something to wait *for*: it
 * returns the moment the work lands rather than after a guess.
 */
export async function waitFor(condition: () => boolean, what: string, timeoutMs = 2_000) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/**
 * Enough of the WebSocket surface for the transport to drive, remembering
 * every instance so a test can watch a reconnect open a second socket.
 */
export class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];

  static reset() {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) {
      throw new Error("No socket has been opened.");
    }
    return socket;
  }

  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  emit(type: string, event: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  deliver(message: WsServerMessage) {
    this.emit("message", { data: JSON.stringify(message) });
  }

  /** The server's `ready`: the upgrade completed and clips will follow. */
  ready() {
    this.readyState = FakeSocket.OPEN;
    this.deliver({ type: "ready" });
  }

  /** The connection failing, as the transport reports it: an `error` event. */
  fail() {
    this.emit("error", {});
  }
}
