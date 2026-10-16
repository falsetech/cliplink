import {
  createHttpClient,
  createKeyedRoom as createKeyedRoomVia,
  createOpenRoom as createOpenRoomVia,
  type CreateKeyedRoomOptions,
  type CreateOpenRoomOptions,
} from "@thebkht/cliplink";

import { browserOrigin } from "./origin";

/**
 * The room API bound to the origin serving this tab. The package takes an
 * origin because a CLI has to name one; the browser's is simply where the page
 * came from, so binding it here keeps every call site unchanged.
 */
const client = createHttpClient({ baseUrl: browserOrigin });

export const connectRoom = client.connectRoom;
export const sendClipRequest = client.sendClipRequest;
export const pollClipsRequest = client.pollClipsRequest;
export const createRoomRequest = client.createRoomRequest;

/**
 * Creates an end-to-end encrypted room here: generated or chosen code,
 * generated or passphrase key. See `createKeyedRoom` in the package, which the
 * CLI creates its rooms through too.
 */
export function createKeyedRoom(options: Omit<CreateKeyedRoomOptions, "http"> = {}) {
  return createKeyedRoomVia({ http: client, ...options });
}

/** Creates an open room here, under a chosen code or one the server picks. */
export function createOpenRoom(options: Omit<CreateOpenRoomOptions, "http"> = {}) {
  return createOpenRoomVia({ http: client, ...options });
}
