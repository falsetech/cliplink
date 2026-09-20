import { createHttpClient } from "@thebkht/cliplink";

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
