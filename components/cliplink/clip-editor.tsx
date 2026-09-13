"use client";

import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  RefObject,
} from "react";

import { formatCharCount } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconArrowUp, IconPaperclip } from "./icons";
import { KbdKey } from "./kbd";
import { panelAccentClass, panelSurfaceStyle, panelToolClass } from "./ui";
import type { useClipEditor } from "./use-clip-editor";

type ClipEditorProps = {
  editor: ReturnType<typeof useClipEditor>;
  realtimeReady: boolean;
  dragActive: boolean;
  isBusy: boolean;
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
  dragActive,
  isBusy,
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
        <div className="flex w-full flex-wrap items-center justify-start gap-1.5 md:w-auto md:flex-nowrap md:justify-end">
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
            className={cn(panelToolClass, panelAccentClass, "min-w-20.5 px-4")}
            type="button"
            onClick={onSend}
            disabled={isBusy}
          >
            Send
            <IconArrowUp size={12} weight="bold" />
          </button>
        </div>
      </div>

      <textarea
        ref={editorRef}
        className="min-h-50 w-full resize-y border-0 bg-transparent px-4 py-4 text-sm text-fg outline-none placeholder:text-muted md:min-h-60 md:px-5 md:py-5 md:text-base"
        value={editor.text}
        placeholder="Type or paste anything here, then hit Send to sync it across devices. Drop or paste files to share them peer-to-peer..."
        aria-label="Clip text"
        onChange={(event) => editor.change(event.target.value)}
        onKeyDown={editor.handleKeyDown}
        onPaste={onPaste}
      />

      <div className="flex flex-col gap-1 border-t border-line px-4 py-2 text-2xs tracking-label text-muted md:flex-row md:items-center md:justify-between">
        <span className="flex flex-wrap items-center gap-1">
          <KbdKey>Enter</KbdKey> to send
          <span className="text-muted">·</span>
          <KbdKey>Shift</KbdKey>
          <KbdKey>Enter</KbdKey> for a new line
        </span>
        <span className="tabular-nums">{formatCharCount(editor.text.length)}</span>
      </div>
    </div>
  );
}
