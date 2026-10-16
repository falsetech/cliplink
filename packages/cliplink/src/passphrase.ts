import { MAX_PASSPHRASE_CHARS, MIN_PASSPHRASE_CHARS } from "./protocol.ts";

/**
 * What the KDF sees of a passphrase. NFC, because the same word typed on two
 * keyboards can arrive as different code points; trimmed at the ends, because
 * a paste picks up a newline. Nothing else: case and inner spaces are the
 * passphrase's own.
 *
 * A module of its own, below both `crypto.ts` and `validation.ts`, so that the
 * rule is written once and each can import it.
 */
export function normalizePassphrase(passphrase: string) {
  return passphrase.normalize("NFC").trim();
}

/**
 * Whether a passphrase is long enough to become a room key. Measured after the
 * same normalization the KDF applies, and in characters rather than UTF-16
 * units, so the count a person sees is the count that is checked.
 */
export function validatePassphrase(passphrase: string) {
  const { length } = [...normalizePassphrase(passphrase)];
  if (length < MIN_PASSPHRASE_CHARS) {
    return {
      ok: false as const,
      message: `A passphrase needs at least ${MIN_PASSPHRASE_CHARS} characters.`,
    };
  }

  if (length > MAX_PASSPHRASE_CHARS) {
    return {
      ok: false as const,
      message: `A passphrase can be at most ${MAX_PASSPHRASE_CHARS} characters.`,
    };
  }

  return { ok: true as const };
}
