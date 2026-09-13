/**
 * Keyboard chord matching and rendering. Framework-free and DOM-only, so the
 * shortcut hook, the help sheet and the command palette all agree on what a
 * binding means and how it should be drawn.
 */

export type Chord = {
  /** Compared case-insensitively against `KeyboardEvent.key`. */
  key: string;
  /** Command on Apple platforms, Control everywhere else. */
  mod?: boolean;
  /**
   * `undefined` means "don't care" — used for keys that already require Shift
   * on most layouts, like `?`, where demanding `shiftKey === false` would mean
   * the binding could never fire.
   */
  shift?: boolean;
  alt?: boolean;
};

/** Keys that are typed with Shift on common layouts, so Shift is not checked. */
const SHIFTED_SYMBOLS = /^[^a-z0-9]$/i;

/**
 * Parses `"mod+shift+c"`, `"escape"`, `"?"`. Order does not matter; the last
 * segment is the key.
 */
export function parseChord(spec: string): Chord {
  const parts = spec.split("+").map((part) => part.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());

  const explicitShift = modifiers.includes("shift");

  return {
    key,
    mod: modifiers.includes("mod"),
    alt: modifiers.includes("alt"),
    shift: explicitShift
      ? true
      : key.length === 1 && SHIFTED_SYMBOLS.test(key)
        ? undefined
        : false,
  };
}

export function isApplePlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Modifiers must match exactly, so `Mod+Shift+C` never fires on a bare
 * `Mod+C`. The one exception is a `shift` of `undefined` — see `Chord`.
 */
export function matchesChord(
  event: KeyboardEvent,
  chord: Chord,
  apple = isApplePlatform(),
) {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) {
    return false;
  }

  const wantsMod = chord.mod === true;
  const primary = apple ? event.metaKey : event.ctrlKey;
  const secondary = apple ? event.ctrlKey : event.metaKey;
  if (primary !== wantsMod || secondary) {
    return false;
  }

  if (chord.shift !== undefined && event.shiftKey !== chord.shift) {
    return false;
  }

  return event.altKey === (chord.alt === true);
}

const APPLE_GLYPHS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  Backspace: "⌫",
  Enter: "↩",
  Escape: "Esc",
};

const PC_LABELS: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  Escape: "Esc",
};

/** Returns the chord as display tokens, e.g. `["⌘", "⇧", "C"]`. */
export function formatChord(chord: Chord, apple: boolean): string[] {
  const labels = apple ? APPLE_GLYPHS : PC_LABELS;
  const tokens: string[] = [];

  if (chord.mod) {
    tokens.push(labels.mod);
  }
  if (chord.shift === true) {
    tokens.push(labels.shift);
  }
  if (chord.alt) {
    tokens.push(labels.alt);
  }

  tokens.push(
    labels[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key),
  );

  return tokens;
}

/** The `aria-keyshortcuts` spelling of a chord, e.g. `"Meta+Shift+C"`. */
export function ariaKeyshortcuts(chord: Chord, apple: boolean) {
  const tokens: string[] = [];
  if (chord.mod) {
    tokens.push(apple ? "Meta" : "Control");
  }
  if (chord.shift === true) {
    tokens.push("Shift");
  }
  if (chord.alt) {
    tokens.push("Alt");
  }
  tokens.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return tokens.join("+");
}

/**
 * True for anything that swallows typing. Bare-letter shortcuts check this so
 * that typing "e" into the compose box does not also trigger an action.
 */
export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.getAttribute("role") === "textbox") {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
