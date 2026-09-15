"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ROOM_TTL_SECONDS } from "@/lib/cliplink/constants";
import { normalizeRoomCode } from "@/lib/cliplink/room-code";
import { validateRoomCode } from "@/lib/cliplink/validation";

import { IconPlus } from "./icons";

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
  const encryptId = useId();
  // Validated inline: Join stays quiet until there is a whole code to join,
  // then takes the filled style, as Send does once there is text to send.
  const codeComplete = validateRoomCode(joinCode);

  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-8 md:gap-10">
      <div className="text-center">
        <h1 className="mb-3 text-5xl leading-[1.05] font-bold tracking-display text-balance text-foreground md:text-7xl">
          Copy here.
          <span className="block text-link">Paste anywhere.</span>
        </h1>
        <p className="m-0 text-base text-balance text-muted-foreground md:text-lg">
          Create a room. Share the code. Your clipboard, synced across devices.
        </p>
      </div>

      <div className="flex w-full flex-col gap-4">
        {/* A grouped list, as in Settings: the choice sits with the action it
            changes, so the toggle reads as part of creating the room. The
            radius is near-concentric with the pill inside it: 24px + 8px padding. */}
        <div className="overflow-hidden rounded-4xl bg-card shadow-row">
          <div className="flex items-center gap-4 px-5 pt-4 pb-3.5">
            <label htmlFor={encryptId} className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-sm font-medium text-foreground">
                End-to-end encrypt
              </span>
              <span className="mt-0.5 block text-xs text-pretty text-muted-foreground">
                {privateRoom
                  ? "A key is created on this device and never sent. Share the link, or the code and key separately. Not even we can read it."
                  : "The code alone opens the room — nothing extra to share. Still encrypted in transit and at rest, but the key comes from the code, so the server can read it."}
              </span>
            </label>
            <Switch
              id={encryptId}
              checked={privateRoom}
              onCheckedChange={setPrivateRoom}
            />
          </div>
          <Separator className="ml-5 w-auto" />
          <div className="p-2">
            <Button
              className="w-full"
              size="lg"
              onClick={() => onCreate(privateRoom)}
              disabled={isBusy}
            >
              <IconPlus size={16} weight="bold" />
              New Room
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" />
          <span>or join an existing room</span>
          <Separator className="flex-1" />
        </div>

        <div className="flex gap-2">
          <Input
            className="h-12 flex-1 rounded-full bg-card px-5 text-center font-mono text-xl font-semibold tracking-code uppercase tabular-nums shadow-row placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:normal-case pointer-coarse:h-12 md:text-xl"
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
          <Button
            variant={codeComplete ? "default" : "secondary"}
            size="lg"
            className="min-w-24"
            onClick={onJoin}
            disabled={isBusy || !codeComplete}
          >
            Join
          </Button>
        </div>

        <p className="m-0 text-center text-xs text-pretty text-muted-foreground">
          No sign-up, no install, no saved history. Rooms expire after{" "}
          {ROOM_TTL_SECONDS / 3600} hours of inactivity.
        </p>
      </div>
    </section>
  );
}
