"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MIN_PASSPHRASE_CHARS } from "@/lib/cliplink/constants";
import {
  looksLikeRoomKey,
  normalizePassphrase,
} from "@/lib/cliplink/crypto";
import { validatePassphrase } from "@/lib/cliplink/validation";

import { cn } from "@/lib/utils";

import { Sheet, SheetHeader, useSheetClose } from "./sheet";

type KeyPromptProps = {
  open: boolean;
  roomCode: string;
  /** Set when a key was supplied and turned out to be the wrong one. */
  mismatch: boolean;
  onClose: () => void;
  /** What was typed, as typed: a key, or a passphrase whose case matters. */
  onSubmit: (keyOrPassphrase: string) => void;
};

/**
 * Asked for when someone joins by typing the room code, which carries no key —
 * the key rides in the fragment of a shared link, and a code read aloud leaves
 * it behind. Pasting the key is the usual path; the field accepts a typed key
 * too, dashes and lowercase and all, or the passphrase the room was made with.
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
      className="max-w-lg"
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

  const isKey = looksLikeRoomKey(value);
  const complete = isKey || validatePassphrase(value).ok;

  function submit() {
    if (complete) {
      close(() => onSubmit(value));
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
        <span className="whitespace-nowrap">Copy Key</span> — or type the
        passphrase the room was made with.
      </p>

      <Textarea
        // A key reads best grouped and in capitals; a passphrase is shown as
        // typed, since its case is part of it.
        className={cn(
          "min-h-24 resize-none font-mono placeholder:font-sans placeholder:tracking-normal placeholder:normal-case md:text-sm",
          isKey && "tracking-code uppercase",
        )}
        data-autofocus
        aria-label="Room key or passphrase"
        aria-invalid={mismatch || undefined}
        placeholder="Paste the room key, or type the passphrase"
        autoComplete="off"
        autoCapitalize="off"
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
            That does not open this room. Check you copied all of the key, or
            the passphrase&rsquo;s spelling and capitals.
          </span>
        ) : (
          <span className="text-muted-foreground">
            {isKey
              ? "Room key"
              : `${[...normalizePassphrase(value)].length} characters — a passphrase has at least ${MIN_PASSPHRASE_CHARS}`}
          </span>
        )}
      </p>

      <Button size="lg" disabled={!complete} onClick={submit}>
        Unlock Room
      </Button>
    </>
  );
}
