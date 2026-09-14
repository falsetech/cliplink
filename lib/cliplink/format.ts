export function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function formatCharCount(length: number) {
  return `${length.toLocaleString()} char${length === 1 ? "" : "s"}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Transfer rate, e.g. `3.1 MB/s`. */
export function formatRate(bytesPerSecond: number) {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** Rough duration for a transfer ETA, e.g. `22s`, `4m`, or `1h 5m`. */
export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function truncatePreview(text: string, maxLength = 120) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export type ClipKind = { kind: "url"; url: string } | { kind: "text" };

/**
 * Classifies a clip so the UI can offer more than "copy".
 *
 * Only a clip that is entirely one http(s) URL counts. Other schemes are
 * rejected on purpose: a `javascript:` or `data:` clip rendered as a link
 * would turn a received clip into something clickable that runs.
 */
export function detectClipKind(text: string): ClipKind {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return { kind: "text" };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { kind: "url", url: parsed.href };
    }
  } catch {
    // Not a URL, which is the common case.
  }

  return { kind: "text" };
}

/** Compact remaining-time label, e.g. `5h 42m` or `4m 12s`. */
export function formatCountdown(msRemaining: number) {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
