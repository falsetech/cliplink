/** Replaces path separators and control characters in peer-supplied names. */
export function sanitizeFileName(name: string) {
  const cleaned = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return char === "/" || char === "\\" || code < 32 || code === 127 ? "_" : char;
  })
    .join("")
    .trim();
  return cleaned || "file";
}

const MAX_PATH_DEPTH = 32;

/**
 * Normalizes a peer-supplied folder path to `/`-separated, sanitized segments,
 * or returns undefined if there is no usable path. Any `..` segment rejects
 * the whole path rather than being cleaned up, since a path that tries to
 * climb out was never an honest one.
 */
export function sanitizeRelativePath(path: string): string | undefined {
  const segments = path
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.length > MAX_PATH_DEPTH) {
    return undefined;
  }
  if (segments.includes("..")) {
    return undefined;
  }
  return segments.map(sanitizeFileName).join("/");
}
