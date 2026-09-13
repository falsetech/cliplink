"use client";

import { useEffect, useRef } from "react";

import {
  isApplePlatform,
  isEditableTarget,
  matchesChord,
} from "@/lib/cliplink/shortcuts";

import type { RoomAction } from "./room-actions";

type ShortcutsConfig = {
  actions: RoomAction[];
  /** False on the landing screen, where there is no room to act on. */
  active: boolean;
  /** True while a sheet is open; the sheet owns the keyboard until it closes. */
  blocked: boolean;
  /** `1`–`9`: copy that history row. */
  onDigit: (index: number) => void;
  /** Escape outside a sheet: cancel a pending confirm, else leave the editor. */
  onEscape: () => void;
  /** A printable key pressed with nothing focused, so typing starts the clip. */
  onTypeahead: () => void;
};

/**
 * One document-level keydown listener for the whole app.
 *
 * Bare-letter bindings only fire when focus is outside a text field, which is
 * what makes them safe to use next to a compose box. Modifier chords opt in
 * with `allowInEditor`.
 */
export function useShortcuts(config: ShortcutsConfig) {
  // The listener attaches once; the config is read fresh on every keystroke.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    const apple = isApplePlatform();

    function onKeyDown(event: KeyboardEvent) {
      const { actions, active, blocked, onDigit, onEscape, onTypeahead } =
        configRef.current;

      // A composing IME sends Enter to commit a candidate. Safari does not
      // always set `isComposing`, hence the keyCode check as well.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
        return;
      }
      // A sheet registers its own Escape and focus trap while it is open.
      if (blocked) {
        return;
      }

      const editable = isEditableTarget(event.target);

      for (const action of actions) {
        if (!action.chord || action.handledLocally) {
          continue;
        }
        if (editable && !action.allowInEditor) {
          continue;
        }
        const chords = action.aliases
          ? [action.chord, ...action.aliases]
          : [action.chord];
        if (!chords.some((chord) => matchesChord(event, chord, apple))) {
          continue;
        }
        // A matched-but-disabled action swallows nothing: the key keeps
        // whatever meaning the browser gave it.
        if (!action.enabled) {
          return;
        }
        event.preventDefault();
        action.perform();
        return;
      }

      if (!active) {
        return;
      }

      if (event.key === "Escape") {
        onEscape();
        return;
      }

      if (editable || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        onDigit(Number(event.key) - 1);
        return;
      }

      // Typing with nothing focused should start a clip rather than vanish.
      // The key is deliberately not consumed — focus moves synchronously, so
      // the character lands in the textarea on its own.
      if (event.key.length === 1) {
        onTypeahead();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
