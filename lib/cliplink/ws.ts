import { createWebSocketTransport as createTransport } from "@thebkht/cliplink";
import type { SealedTransport } from "@thebkht/cliplink";

import { browserOrigin } from "./origin";

/** The package's transport, bound to the origin serving this tab. */
export function createWebSocketTransport(): SealedTransport {
  return createTransport({ baseUrl: browserOrigin });
}
