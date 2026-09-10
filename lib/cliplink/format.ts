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

export function truncatePreview(text: string, maxLength = 120) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
