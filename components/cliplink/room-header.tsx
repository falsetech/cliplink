"use client";

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
};

export function RoomHeader({
  roomCode,
  qrOpen,
  confirmingLeave,
  onCopyLink,
  onShare,
  onOpenQr,
  onLeave,
}: RoomHeaderProps) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-start">
      <div className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <span className="text-2xs tracking-label-wide text-muted uppercase">
          Room
        </span>
        <button
          className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-accent-dim bg-transparent px-2.5 text-lg font-bold tracking-code text-room tabular-nums transition-[background-color,scale] duration-150 ease-out hover:bg-accent-dim focus-visible:bg-accent-dim active:scale-[0.96] md:min-h-10 md:px-3 md:text-xl"
          type="button"
          aria-label={`Copy invite link for room ${roomCode}`}
          aria-keyshortcuts="L"
          onClick={onCopyLink}
        >
          {roomCode}
        </button>
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
              ? "border-danger text-danger"
              : "hover:border-danger hover:text-danger focus-visible:border-danger focus-visible:text-danger",
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
