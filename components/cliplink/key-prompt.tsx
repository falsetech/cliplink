"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ROOM_KEY_CHARS } from "@/lib/cliplink/constants";
import { normalizeRoomKey } from "@/lib/cliplink/crypto";

import { Sheet, SheetHeader, useSheetClose } from "./sheet";

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
      <SheetHeader
        eyebrow="Encrypted room"
        title={roomCode}
        titleClassName="font-mono tracking-code text-link"
        closeLabel="Cancel joining room"
      />

      <p className="m-0 text-sm text-pretty text-muted-foreground">
        Clips in this room are encrypted, and the key never reaches the server.
        Paste the key from the other device — it is on its QR sheet, under{" "}
        <span className="whitespace-nowrap">Copy Key</span>.
      </p>

      <Textarea
        className="min-h-24 resize-none font-mono tracking-code uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case md:text-sm"
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
        className="-mt-2 m-0 text-xs text-pretty"
        role={mismatch ? "alert" : undefined}
      >
        {mismatch ? (
          <span className="text-destructive">
            That key does not open this room. Check you copied all of it.
          </span>
        ) : (
          <span className="text-muted-foreground">
            {normalized.length}/{ROOM_KEY_CHARS} characters
          </span>
        )}
      </p>

      <Button size="lg" disabled={!complete} onClick={submit}>
        Unlock Room
      </Button>
    </>
  );
}
