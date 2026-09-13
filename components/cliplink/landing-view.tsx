"use client";

import { normalizeRoomCode } from "@/lib/cliplink/room-code";

import { IconPlus } from "./icons";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

type LandingViewProps = {
  joinCode: string;
  isBusy: boolean;
  onJoinCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
};

export function LandingView({
  joinCode,
  isBusy,
  onJoinCodeChange,
  onCreate,
  onJoin,
}: LandingViewProps) {
  return (
    <section className="mx-auto flex max-w-180 flex-col items-center gap-5 sm:gap-6 md:gap-9">
      <div className="max-w-full text-center md:max-w-175">
        <h1 className="font-display mb-4 text-[clamp(1.7rem,15vw,2.45rem)] leading-[0.98] tracking-display text-fg sm:text-[clamp(2rem,11vw,3rem)] sm:leading-[0.96] md:text-[clamp(4.8rem,7.1vw,6.35rem)] md:leading-[0.82]">
          <span className="block text-balance md:mx-auto md:max-w-[6.2ch]">
            Copy here.
          </span>
          <span className="mt-[0.08em] block text-balance text-hero sm:mt-[0.04em] md:mx-auto md:max-w-[7.3ch]">
            Paste anywhere.
          </span>
        </h1>
        <p className="m-0 text-2xs text-pretty text-dim sm:text-xs md:text-sm">
          Create a room. Share the code. Your clipboard, synced across devices.
        </p>
      </div>

      <div className="flex w-full max-w-full flex-col gap-3 md:max-w-170">
        <button className={primaryButtonClass} onClick={onCreate} disabled={isBusy}>
          <IconPlus size={14} weight="bold" />
          New Room
        </button>

        <div className="flex w-full items-center gap-2 text-2xs tracking-label-wide text-muted uppercase sm:gap-3">
          <span className="h-px flex-1 bg-line" />
          <span>or join existing</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-2 sm:gap-2.5 md:flex-row">
          <input
            className="min-h-12 flex-1 rounded-control border border-line-strong bg-surface px-4 py-3 text-center text-xl font-bold tracking-code text-fg uppercase tabular-nums outline-none transition-colors duration-150 placeholder:text-sm placeholder:font-normal placeholder:tracking-label placeholder:text-muted focus:border-accent"
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

        <p className="-mt-1 max-w-160 text-center text-2xs text-pretty text-muted">
          No sign-up, no install, no saved history. Rooms expire after 6 hours of
          inactivity.
        </p>
      </div>
    </section>
  );
}
