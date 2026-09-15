"use client";

import { useState } from "react";

import { ROOM_TTL_SECONDS } from "@/lib/cliplink/constants";
import { normalizeRoomCode } from "@/lib/cliplink/room-code";

import { IconPlus } from "./icons";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

type LandingViewProps = {
  joinCode: string;
  isBusy: boolean;
  onJoinCodeChange: (code: string) => void;
  onCreate: (privateRoom: boolean) => void;
  onJoin: () => void;
};

export function LandingView({
  joinCode,
  isBusy,
  onJoinCodeChange,
  onCreate,
  onJoin,
}: LandingViewProps) {
  // Default to the private room. The safer of two choices should be the one
  // taken by someone who does not read the options.
  const [privateRoom, setPrivateRoom] = useState(true);
  return (
    <section className="mx-auto flex max-w-180 flex-col items-center gap-5 sm:gap-6 md:gap-9">
      <div className="max-w-full text-center md:max-w-175">
        <h1 className="font-display mb-4 text-[clamp(1.7rem,15vw,2.45rem)] leading-[0.98] tracking-display text-foreground sm:text-[clamp(2rem,11vw,3rem)] sm:leading-[0.96] md:text-[clamp(4.8rem,7.1vw,6.35rem)] md:leading-[0.82]">
          <span className="block text-balance md:mx-auto md:max-w-[6.2ch]">
            Copy here.
          </span>
          <span className="mt-[0.08em] block text-balance text-link sm:mt-[0.04em] md:mx-auto md:max-w-[7.3ch]">
            Paste anywhere.
          </span>
        </h1>
        <p className="m-0 text-2xs text-pretty text-muted-foreground sm:text-xs md:text-sm">
          Create a room. Share the code. Your clipboard, synced across devices.
        </p>
      </div>

      <div className="flex w-full max-w-full flex-col gap-3 md:max-w-170">
        <button
          className={primaryButtonClass}
          onClick={() => onCreate(privateRoom)}
          disabled={isBusy}
        >
          <IconPlus size={14} weight="bold" />
          New Room
        </button>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left transition-colors duration-150 hover:border-input">
          <input
            className="mt-0.5 size-4 shrink-0 accent-primary"
            type="checkbox"
            checked={privateRoom}
            onChange={(event) => setPrivateRoom(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-2xs text-foreground">
              End-to-end encrypt this room
            </span>
            <span className="mt-0.5 block text-2xs text-pretty text-muted-foreground">
              {privateRoom
                ? "A key is created on this device and never sent. Share the link, or the code and key separately. Not even we can read it."
                : "The code alone opens the room — nothing extra to share. Still encrypted in transit and at rest, but the key comes from the code, so the server can read it."}
            </span>
          </span>
        </label>

        <div className="flex w-full items-center gap-2 text-2xs text-muted-foreground uppercase sm:gap-3">
          <span className="h-px flex-1 bg-border" />
          <span>or join existing</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex flex-col gap-2 sm:gap-2.5 md:flex-row">
          <input
            className="min-h-12 flex-1 rounded-lg border border-input bg-card px-4 py-3 text-center text-xl font-bold tracking-code text-foreground uppercase tabular-nums outline-none transition-colors duration-150 placeholder:text-sm placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground focus:border-primary"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            placeholder="Enter code"
            aria-label="Room code"
            value={joinCode}
            onChange={(event) =>
              onJoinCodeChange(normalizeRoomCode(event.target.value))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onJoin();
              }
            }}
          />
          <button
            className={secondaryButtonClass}
            onClick={onJoin}
            disabled={isBusy}
          >
            Join
          </button>
        </div>

        <p className="-mt-1 max-w-160 text-center text-2xs text-pretty text-muted-foreground">
          No sign-up, no install, no saved history. Rooms expire after{" "}
          {ROOM_TTL_SECONDS / 3600} hours of inactivity.
        </p>
      </div>
    </section>
  );
}
