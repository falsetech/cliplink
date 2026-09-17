/**
 * The environment as this CLI reads it: names to values, nothing more.
 *
 * Deliberately not `NodeJS.ProcessEnv`. That type is open to augmentation, and
 * the Next app in this repo augments it to require `NODE_ENV` — which would
 * make every small literal in a test fail to type-check against a CLI that
 * never reads it.
 */
export type Env = Record<string, string | undefined>;
