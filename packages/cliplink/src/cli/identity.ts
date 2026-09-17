import { randomUUID } from "node:crypto";

/**
 * Who the server thinks sent a clip. Random per run and never persisted: it
 * exists so a client can tell its own clips from everyone else's, and a stable
 * one would be an identifier for a product that has none.
 */
export function createRandomSenderId() {
  return `cli${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

/** Peer id for the room socket, subject to the same reasoning. */
export function createRandomPeerId() {
  return `peer${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
