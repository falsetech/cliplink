"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_ROOM_CODE_LENGTH,
  MIN_PASSPHRASE_CHARS,
  MIN_ROOM_CODE_LENGTH,
} from "@/lib/cliplink/constants";
import { normalizePassphrase } from "@/lib/cliplink/crypto";
import { normalizeRoomCode } from "@/lib/cliplink/room-code";
import {
  validatePassphrase,
  validateRoomCode,
} from "@/lib/cliplink/validation";

import { Sheet, SheetHeader, useSheetClose } from "./sheet";

/** What the sheet asks for. At least one is set; never a passphrase for an open room. */
export type CustomRoom = {
  code?: string;
  passphrase?: string;
};

type CreateRoomSheetProps = {
  open: boolean;
  /** An end-to-end encrypted room, which can also take a passphrase. */
  privateRoom: boolean;
  isBusy: boolean;
  onClose: () => void;
  /** Resolves with what went wrong, or null once the room is open. */
  onSubmit: (room: CustomRoom) => Promise<string | null>;
};

/**
 * A private room with a code someone chose, a passphrase for its key, or
 * both. Room code plus passphrase is a room that can be reopened on any
 * device by typing two things, with no link to carry across. An open room
 * takes a code alone, and says plainly what that costs.
 *
 * Unlike the other sheets, this one stays open until the room exists: a taken
 * code is answered beside the field, with what was typed still in it.
 */
export function CreateRoomSheet({
  open,
  privateRoom,
  isBusy,
  onClose,
  onSubmit,
}: CreateRoomSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={privateRoom ? "Choose code or passphrase" : "Choose code"}
      className="max-w-lg"
    >
      <CreateRoomBody
        privateRoom={privateRoom}
        isBusy={isBusy}
        onSubmit={onSubmit}
      />
    </Sheet>
  );
}

function CreateRoomBody({
  privateRoom,
  isBusy,
  onSubmit,
}: Pick<CreateRoomSheetProps, "privateRoom" | "isBusy" | "onSubmit">) {
  const close = useSheetClose();
  const [code, setCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const codeOk = code === "" || validateRoomCode(code);
  const passphraseLength = [...normalizePassphrase(passphrase)].length;
  const passphraseOk = passphrase === "" || validatePassphrase(passphrase).ok;
  // Judged only while the field is shown: a confirmation left over from a
  // passphrase since cleared would otherwise block a room with no passphrase.
  const confirmed = passphrase === "" || confirmation === passphrase;
  const ready = privateRoom
    ? (code !== "" || passphrase !== "") && codeOk && passphraseOk && confirmed
    : code !== "" && codeOk;

  async function submit() {
    if (!ready || isBusy) {
      return;
    }
    setError(null);
    const failure = await onSubmit({
      code: code || undefined,
      passphrase: (privateRoom && passphrase) || undefined,
    });
    if (failure) {
      setError(failure);
    } else {
      close();
    }
  }

  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={privateRoom ? "Private room" : "Open room"}
        title={privateRoom ? "Choose Code or Passphrase" : "Choose Code"}
        closeLabel="Cancel creating room"
      />

      {privateRoom ? (
        <p className="m-0 text-sm text-pretty text-muted-foreground">
          Choose a code people can remember, a passphrase to use as the key, or
          both. With both, typing the code and passphrase opens the room on any
          device, with no link to send.
        </p>
      ) : (
        // Said before the field, not after: by the time someone has thought
        // of a code they like, they have stopped reading.
        <p className="m-0 text-sm text-pretty text-warning" role="note">
          In an open room the code is the key. Anyone who knows or guesses
          this code can read everything sent here — and a code you can
          remember is one someone else can guess. Turn on end-to-end
          encryption for anything private.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-code`}
          className="text-xs font-medium text-muted-foreground"
        >
          Room code
        </label>
        <Input
          id={`${id}-code`}
          aria-describedby={`${id}-code-hint`}
          className="font-mono tracking-code uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          data-autofocus
          value={code}
          maxLength={MAX_ROOM_CODE_LENGTH}
          placeholder={privateRoom ? "Random" : "Required"}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!codeOk || undefined}
          onChange={(event) => {
            setCode(normalizeRoomCode(event.target.value));
            setError(null);
          }}
          onKeyDown={submitOnEnter}
        />
        <p
          id={`${id}-code-hint`}
          className="m-0 text-xs text-pretty text-muted-foreground"
        >
          {MIN_ROOM_CODE_LENGTH} to {MAX_ROOM_CODE_LENGTH} letters and digits.
          {privateRoom
            ? " Anyone can try a code, so the room stays encrypted."
            : " Longer and less obvious is harder to guess."}
        </p>
      </div>

      {privateRoom ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${id}-passphrase`}
              className="text-xs font-medium text-muted-foreground"
            >
              Passphrase
            </label>
            <Input
              id={`${id}-passphrase`}
              aria-describedby={`${id}-passphrase-hint`}
              type="password"
              value={passphrase}
              placeholder="Generated key"
              autoComplete="new-password"
              aria-invalid={(passphrase !== "" && !passphraseOk) || undefined}
              onChange={(event) => {
                setPassphrase(event.target.value);
                setError(null);
              }}
              onKeyDown={submitOnEnter}
            />
            <p
              id={`${id}-passphrase-hint`}
              className="m-0 text-xs text-pretty text-muted-foreground"
            >
              At least {MIN_PASSPHRASE_CHARS} characters
              {passphrase ? ` (${passphraseLength} so far)` : ""}. A few unrelated
              words is better than one short, clever one: the passphrase is the
              room&rsquo;s only lock.
            </p>
          </div>

          {passphrase ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${id}-confirm`}
                className="text-xs font-medium text-muted-foreground"
              >
                Confirm passphrase
              </label>
              <Input
                id={`${id}-confirm`}
                aria-describedby={`${id}-confirm-hint`}
                type="password"
                value={confirmation}
                autoComplete="new-password"
                aria-invalid={(confirmation !== "" && !confirmed) || undefined}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError(null);
                }}
                onKeyDown={submitOnEnter}
              />
              {confirmation !== "" && !confirmed ? (
                <p id={`${id}-confirm-hint`} className="m-0 text-xs text-destructive">
                  The passphrases do not match.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="m-0 text-xs text-pretty text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button size="lg" disabled={!ready || isBusy} onClick={() => void submit()}>
        Create Room
      </Button>
    </>
  );
}
