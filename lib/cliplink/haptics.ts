/**
 * Haptic feedback for commit moments only — a clip leaving the device and a
 * clip arriving on it. Firing on every interaction trains people to ignore it.
 *
 * Callers fire this on the same frame as the visual cue; a haptic that lags its
 * animation reads as a second, unrelated event.
 */

type HapticKind = "commit" | "arrive" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  commit: 8,
  arrive: [0, 14],
  error: [0, 20, 60, 20],
};

let reducedMotion: MediaQueryList | null = null;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotion.matches;
}

export function haptic(kind: HapticKind) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  if (prefersReducedMotion()) {
    return;
  }

  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Vibration is best-effort; a blocked or unsupported call is never fatal.
  }
}
