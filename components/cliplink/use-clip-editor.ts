"use client";

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { readClipboard } from "@/lib/cliplink/clipboard";

import { clearTimer } from "./use-room-session";
import type { PushToast } from "./use-toasts";

/** How long "Undo clear" stays offered after the text is wiped. */
const UNDO_WINDOW_MS = 8000;

type ClipEditorOptions = {
  pushToast: PushToast;
  /** The textarea, owned by the caller so the view can attach it directly. */
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Called when the editor asks to commit — bare Enter, or the Send button. */
  onSubmit: () => void;
};

/**
 * The compose box: its text, the undo buffer behind "Clear text", and the
 * Enter/newline split. The undo buffer is the only piece with a lifetime, and
 * every path that changes the text on purpose drops it.
 */
export function useClipEditor({
  pushToast,
  editorRef,
  onSubmit,
}: ClipEditorOptions) {
  const [text, setText] = useState("");
  const [clearedText, setClearedText] = useState("");
  const clearedResetRef = useRef<number | null>(null);

  function clearUndoBuffer() {
    setClearedText("");
    clearTimer(clearedResetRef);
  }

  function change(nextText: string) {
    setText(nextText);
    clearUndoBuffer();
  }

  /** Wipes the editor without losing the text — see `undoClear`. */
  function clear() {
    if (!text) {
      return;
    }
    setClearedText(text);
    setText("");
    clearTimer(clearedResetRef);
    clearedResetRef.current = window.setTimeout(() => {
      setClearedText("");
      clearedResetRef.current = null;
    }, UNDO_WINDOW_MS);
  }

  function undoClear() {
    setText(clearedText);
    clearUndoBuffer();
  }

  /** Empties the editor for good, e.g. after a successful send. */
  function reset() {
    setText("");
    clearUndoBuffer();
  }

  function focus() {
    editorRef.current?.focus();
  }

  async function pasteFromDevice() {
    try {
      const pasted = await readClipboard();
      setText(pasted);
      clearUndoBuffer();
    } catch {
      pushToast(
        "Clipboard access denied. Paste manually with Ctrl/Cmd+V.",
        "info",
      );
    }
  }

  /**
   * Enter commits the clip, because sending is what this box is for. A newline
   * is still reachable with Ctrl/Cmd+Enter, and with Shift+Enter since that is
   * the muscle memory people arrive with.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd, value } = target;
      const next =
        value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd);
      setText(next);
      clearUndoBuffer();
      // Restore the caret after React has committed the new value.
      requestAnimationFrame(() => {
        target.selectionStart = selectionStart + 1;
        target.selectionEnd = selectionStart + 1;
      });
      return;
    }

    event.preventDefault();
    onSubmit();
  }

  return {
    text,
    clearedText,
    change,
    clear,
    undoClear,
    reset,
    focus,
    pasteFromDevice,
    handleKeyDown,
  };
}
