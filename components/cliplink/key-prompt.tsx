"use client";

import { useState } from "react";

import { ROOM_KEY_CHARS } from "@/lib/cliplink/constants";
import { normalizeRoomKey } from "@/lib/cliplink/crypto";

import { Sheet, useSheetClose } from "./sheet";
import { IconX } from "./icons";
import { panelSurfaceStyle, primaryButtonClass } from "./ui";

type KeyPromptProps = {
  open: boolean;
  roomCode: string;
  /** Set when a key was supplied and turned out to be the wrong one. */
  mismatch: boolean;
  onClose: () => void;
  onSubmit: (roomKey: string) => void;
};

/**
 * Asked for when someone joins by typing the six-character code, which carries
 * no key — the key rides in the fragment of a shared link, and a code read
 * aloud leaves it behind. Pasting is the expected path; the field accepts a
 * typed key too, dashes and lowercase and all.
 */
export function KeyPrompt({
  open,
  roomCode,
  mismatch,
  onClose,
  onSubmit,
}: KeyPromptProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`Room ${roomCode} key`}
      className="max-w-125"
      style={panelSurfaceStyle}
    >
      <KeyPromptBody
        roomCode={roomCode}
        mismatch={mismatch}
        onSubmit={onSubmit}
      />
    </Sheet>
  );
}

function KeyPromptBody({
  roomCode,
  mismatch,
  onSubmit,
}: Pick<KeyPromptProps, "roomCode" | "mismatch" | "onSubmit">) {
  const close = useSheetClose();
  const [value, setValue] = useState("");

  const normalized = normalizeRoomKey(value);
  const complete = normalized.length === ROOM_KEY_CHARS;

  function submit() {
    if (complete) {
      close(() => onSubmit(normalized));
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-2xs tracking-label-wide text-muted uppercase">
            Encrypted room
          </p>
          <h2 className="m-0 font-display text-2xl tracking-code text-room sm:text-3xl">
            {roomCode}
          </h2>
        </div>
        <button
          className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-control text-dim transition-colors duration-150 hover:text-fg focus-visible:text-fg active:scale-[0.96]"
          type="button"
          aria-label="Cancel joining room"
          onClick={() => close()}
        >
          <IconX size={16} />
        </button>
      </div>

      <p className="m-0 text-xs text-pretty text-dim">
        Clips in this room are encrypted, and the key never reaches the server.
        Paste the key from the other device — it is on its QR sheet, under{" "}
        <span className="whitespace-nowrap">Copy key</span>.
      </p>

      <textarea
        className="min-h-24 w-full resize-none rounded-control border border-line-strong bg-surface px-3 py-2.5 font-mono text-sm tracking-code text-fg uppercase outline-none transition-colors duration-150 placeholder:normal-case placeholder:tracking-label placeholder:text-muted focus:border-accent"
        data-autofocus
        aria-label="Room key"
        aria-invalid={mismatch || undefined}
        placeholder="Paste the room key"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter submits; the field is multi-line only so a long key wraps
          // instead of scrolling out of sight.
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />

      <p
        className="m-0 text-2xs text-pretty"
        role={mismatch ? "alert" : undefined}
      >
        {mismatch ? (
          <span className="text-danger">
            That key does not open this room. Check you copied all of it.
          </span>
        ) : (
          <span className="text-muted">
            {normalized.length}/{ROOM_KEY_CHARS} characters
          </span>
        )}
      </p>

      <button
        className={primaryButtonClass}
        type="button"
        disabled={!complete}
        onClick={submit}
      >
        Unlock Room
      </button>
    </>
  );
}
