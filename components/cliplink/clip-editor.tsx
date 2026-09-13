"use client";

import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  RefObject,
} from "react";

import { MAX_CLIP_CHARS } from "@/lib/cliplink/constants";
import { formatCharCount } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconArrowUp, IconPaperclip } from "./icons";
import { KbdKey } from "./kbd";
import { panelAccentClass, panelSurfaceStyle, panelToolClass } from "./ui";
import type { useClipEditor } from "./use-clip-editor";

/** Past this the count stops being trivia and starts being a warning. */
const COUNT_WARNING_AT = MAX_CLIP_CHARS * 0.9;

/**
 * Silent while the box is short — "0 chars" was never worth the row. Near the
 * cap it switches to a fraction and colours, so the limit is discovered before
 * a send is rejected rather than after.
 */
function CharCount({ length }: { length: number }) {
  if (length === 0) {
    return null;
  }

  const over = length > MAX_CLIP_CHARS;
  const near = length > COUNT_WARNING_AT;

  return (
    <span
      className={cn(
        "tabular-nums",
        over && "text-danger",
        near && !over && "text-accent",
      )}
      aria-live={near ? "polite" : "off"}
    >
      {near
        ? `${length.toLocaleString()} / ${MAX_CLIP_CHARS.toLocaleString()}`
        : formatCharCount(length)}
    </span>
  );
}

type ClipEditorProps = {
  editor: ReturnType<typeof useClipEditor>;
  realtimeReady: boolean;
  /** Joined without a key: the room is there but nothing can be read or sent. */
  locked: boolean;
  dragActive: boolean;
  isBusy: boolean;
  /** Text present and within the length cap. Gates Send. */
  canSend: boolean;
  /** True while the arrival cue is lit for a clip that just landed. */
  arrival: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onFilesPicked: (files: FileList | null) => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
};

export function ClipEditor({
  editor,
  realtimeReady,
  locked,
  dragActive,
  isBusy,
  canSend,
  arrival,
  fileInputRef,
  editorRef,
  onSend,
  onFilesPicked,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
}: ClipEditorProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-surface border border-line shadow-row",
        // The compose box has no bounds of its own — it is the panel's content
        // area, edge to edge. So the panel carries the focus, which is also the
        // thing the user believes they are typing into.
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "has-[textarea:focus]:border-accent has-[textarea:focus]:ring-2 has-[textarea:focus]:ring-accent/25",
        arrival && "arrival-cue",
      )}
      style={panelSurfaceStyle}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-surface border-2 border-dashed border-accent bg-accent-dim px-4 text-center text-xs tracking-label-wide text-accent uppercase backdrop-blur-[2px]",
          "transition-opacity duration-150 ease-out",
          dragActive ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!dragActive}
      >
        {realtimeReady
          ? "Drop to share peer-to-peer"
          : "File transfer needs a live connection"}
      </div>

      <div className="flex flex-col items-stretch justify-between gap-4 border-b border-line bg-raised px-4 py-2.5 md:flex-row md:items-center">
        <span className="hidden text-2xs tracking-label-wide text-muted uppercase md:inline">
          Clipboard
        </span>
        {/* Two groups, not four peers: what puts text in the box, then what
            happens to it. Proximity is doing the explaining. */}
        <div className="flex w-full flex-wrap items-center justify-start gap-x-3 gap-y-1.5 md:w-auto md:flex-nowrap md:justify-end">
          <div className="flex items-center gap-1.5">
            <button
              className={panelToolClass}
              type="button"
              disabled={!realtimeReady}
              aria-keyshortcuts="A"
              title={
                realtimeReady
                  ? "Share files peer-to-peer. Nothing is uploaded or stored."
                  : "File transfer needs a live connection."
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclip size={12} />
              Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                onFilesPicked(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              className={panelToolClass}
              type="button"
              onClick={() => void editor.pasteFromDevice()}
            >
              Paste from device
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {editor.clearedText ? (
              <button
                className={cn(panelToolClass, "text-accent")}
                type="button"
                onClick={editor.undoClear}
              >
                Undo clear
              </button>
            ) : (
              <button
                className={panelToolClass}
                type="button"
                disabled={!editor.text}
                onClick={editor.clear}
              >
                Clear text
              </button>
            )}
            <button
              className={cn(
                panelToolClass,
                panelAccentClass,
                "min-w-20.5 px-4",
              )}
              type="button"
              onClick={onSend}
              // The shortcut already knew there was nothing to send. The button
              // did not, so clicking it just produced a toast telling you off.
              disabled={isBusy || !canSend}
            >
              Send
              <IconArrowUp size={12} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      <textarea
        ref={editorRef}
        className="min-h-50 w-full resize-y border-0 bg-transparent px-4 py-4 text-sm text-fg outline-none placeholder:text-muted md:min-h-60 md:px-5 md:py-5 md:text-base"
        value={editor.text}
        placeholder="Type or paste anything…"
        aria-label="Clip text"
        onChange={(event) => editor.change(event.target.value)}
        onKeyDown={editor.handleKeyDown}
        onPaste={onPaste}
      />

      <div className="flex flex-col gap-1 border-t border-line px-4 py-2 text-2xs tracking-label text-muted md:flex-row md:items-center md:justify-between">
        {/* Keys within a chord bind tighter than the words around them, or
            "Shift Enter" reads as two unrelated keys. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <KbdKey>Enter</KbdKey>
          <span>to send</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-0.5">
            <KbdKey>Shift</KbdKey>
            <KbdKey>Enter</KbdKey>
          </span>
          <span>for a new line</span>
          {/* A greyed button whose only explanation is a title tooltip explains
              nothing on touch and needs a hover and a wait everywhere else.
              Same wording as the drop overlay, so the two corroborate. */}
          {locked ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-accent">enter the room key to send</span>
            </>
          ) : !realtimeReady ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-accent">files need a live connection</span>
            </>
          ) : null}
        </span>
        <CharCount length={editor.text.length} />
      </div>
    </div>
  );
}
