"use client";

import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { MAX_CLIP_CHARS } from "@/lib/cliplink/constants";
import { formatCharCount } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconArrowUp, IconPaperclip } from "./icons";
import { useApplePlatform } from "./kbd";
import type { useClipEditor } from "./use-clip-editor";

/** Secondary tools recede until hovered; Send is the one filled control. */
const toolClass = "text-muted-foreground hover:text-foreground";

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
        over && "text-destructive",
        near && !over && "text-warning",
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
  folderInputRef: RefObject<HTMLInputElement | null>;
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
  folderInputRef,
  editorRef,
  onSend,
  onFilesPicked,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
}: ClipEditorProps) {
  // Apple keyboards label the key Return.
  const enterKey = useApplePlatform() ? "Return" : "Enter";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-card shadow-row",
        // The compose box has no bounds of its own — it is the card's content
        // area, edge to edge. So the card carries the focus, which is also the
        // thing the user believes they are typing into.
        "transition-shadow duration-150 ease-out",
        "has-[textarea:focus]:ring-2 has-[textarea:focus]:ring-primary/35",
        arrival && "arrival-cue",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-card/85 px-4 text-center text-sm font-medium text-link backdrop-blur-sm",
          "transition-[opacity,scale] duration-150 ease-out",
          dragActive ? "scale-100 opacity-100" : "scale-[0.98] opacity-0",
        )}
        aria-hidden={!dragActive}
      >
        {realtimeReady
          ? "Drop to share peer-to-peer"
          : "File transfer needs a live connection"}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 md:pl-4">
        <span className="hidden text-sm font-semibold text-foreground md:inline">
          Clipboard
        </span>
        {/* Two groups, not four peers: what puts text in the box, then what
            happens to it. Proximity is doing the explaining. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 md:w-auto md:justify-end">
          <div className="flex items-center gap-1">
            <Button
              className={toolClass}
              variant="ghost"
              size="sm"
              disabled={!realtimeReady}
              aria-keyshortcuts="A"
              title={
                realtimeReady
                  ? "Share files peer-to-peer. Nothing is uploaded or stored."
                  : "File transfer needs a live connection."
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclip size={14} />
              Attach
            </Button>
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
            {/* Reached from the F shortcut and the palette. Each picked file
                carries its path within the folder in webkitRelativePath. */}
            <input
              ref={folderInputRef}
              type="file"
              hidden
              {...{ webkitdirectory: "" }}
              onChange={(event) => {
                onFilesPicked(event.target.files);
                event.target.value = "";
              }}
            />
            <Button
              className={toolClass}
              variant="ghost"
              size="sm"
              onClick={() => void editor.pasteFromDevice()}
            >
              Paste
            </Button>
          </div>

          <div className="flex items-center gap-1">
            {editor.clearedText ? (
              <Button variant="ghost" size="sm" className="text-link" onClick={editor.undoClear}>
                Undo Clear
              </Button>
            ) : (
              <Button
                className={toolClass}
                variant="ghost"
                size="sm"
                disabled={!editor.text}
                onClick={editor.clear}
              >
                Clear
              </Button>
            )}
            <Button
              size="sm"
              className="min-w-20 font-semibold"
              onClick={onSend}
              // The shortcut already knew there was nothing to send. The button
              // did not, so clicking it just produced a toast telling you off.
              disabled={isBusy || !canSend}
            >
              Send
              <IconArrowUp size={14} weight="bold" />
            </Button>
          </div>
        </div>
      </div>

      {/* Grows with its content, as a Messages compose field does, rather
          than offering a resize grip. Capped so Send stays in view. */}
      <textarea
        ref={editorRef}
        className="field-sizing-content max-h-[60vh] min-h-50 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground md:min-h-60 md:px-5 md:py-4"
        value={editor.text}
        placeholder="Type or paste anything…"
        aria-label="Clip text"
        onChange={(event) => editor.change(event.target.value)}
        onKeyDown={editor.handleKeyDown}
        onPaste={onPaste}
      />

      <div className="mx-4 flex flex-col gap-1 border-t border-border py-2.5 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
        {/* Keys within a chord bind tighter than the words around them, or
            "Shift Enter" reads as two unrelated keys. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Kbd>{enterKey}</Kbd>
          <span>to send</span>
          <span aria-hidden="true">·</span>
          <KbdGroup>
            <Kbd>Shift</Kbd>
            <Kbd>{enterKey}</Kbd>
          </KbdGroup>
          <span>for a new line</span>
          {/* A greyed button whose only explanation is a title tooltip explains
              nothing on touch and needs a hover and a wait everywhere else.
              Same wording as the drop overlay, so the two corroborate. */}
          {locked ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-warning">Enter the room key to send</span>
            </>
          ) : !realtimeReady ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-warning">Files need a live connection</span>
            </>
          ) : null}
        </span>
        <CharCount length={editor.text.length} />
      </div>
    </div>
  );
}
