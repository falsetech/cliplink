"use client";

import { formatCountdown } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconCopy, IconQr } from "./icons";
import { actionButtonClass } from "./ui";

type RoomHeaderProps = {
  roomCode: string;
  qrOpen: boolean;
  confirmingLeave: boolean;
  onCopyLink: () => void;
  onShare: () => void;
  onOpenQr: () => void;
  onLeave: () => void;
  /** Milliseconds until the room expires, or null when unknown. */
  expiresIn: number | null;
  /** Devices in the room, including this one. */
  deviceCount: number;
};

export function RoomHeader({
  roomCode,
  qrOpen,
  confirmingLeave,
  onCopyLink,
  onShare,
  onOpenQr,
  onLeave,
  expiresIn,
  deviceCount,
}: RoomHeaderProps) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-start">
      <div className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <span className="text-2xs text-muted-foreground uppercase">
          Room
        </span>
        <button
          className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-primary/30 bg-transparent px-2.5 text-lg font-bold tracking-code text-link tabular-nums transition-[background-color,scale] duration-150 ease-out hover:bg-primary/10 focus-visible:bg-primary/10 active:scale-[0.96] md:min-h-10 md:px-3 md:text-xl"
          type="button"
          aria-label={`Copy invite link for room ${roomCode}`}
          aria-keyshortcuts="L"
          onClick={onCopyLink}
        >
          {roomCode}
        </button>

        {/* Status, not a section label, so it does not wear the uppercase
            tracking the labels use — and "5h 57m" uppercased to "5H 57M" read
            as initials rather than units. */}
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          {deviceCount > 1 ? <span>{deviceCount} devices</span> : null}
          {deviceCount > 1 && expiresIn !== null ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {expiresIn !== null ? (
            // aria-live is off on purpose: a countdown that announces itself
            // every tick is hostile to a screen reader.
            <span aria-live="off" className="tabular-nums">
              {expiresIn === 0
                ? "expired"
                : `expires in ${formatCountdown(expiresIn)}`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        <button className={actionButtonClass} type="button" onClick={onShare}>
          <IconCopy size={12} />
          Share Link
        </button>
        <button
          className={actionButtonClass}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={qrOpen}
          aria-keyshortcuts="Q"
          onClick={onOpenQr}
        >
          <IconQr size={12} />
          QR
        </button>
        <button
          className={cn(
            actionButtonClass,
            confirmingLeave
              ? "border-destructive text-destructive"
              : "hover:border-destructive hover:text-destructive focus-visible:border-destructive focus-visible:text-destructive",
          )}
          type="button"
          aria-keyshortcuts="X"
          onClick={onLeave}
        >
          {confirmingLeave ? "Confirm leave" : "Leave"}
        </button>
      </div>
    </div>
  );
}
