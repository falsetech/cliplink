"use client";

import { Button } from "@/components/ui/button";
import { formatCountdown } from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { IconCopy, IconQr } from "./icons";

/** On narrow phones the three actions share the row evenly. */
const actionFlex = "max-[430px]:flex-1";


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
    <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-center">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="tinted"
          className="px-3.5 font-mono text-lg font-semibold tracking-code tabular-nums"
          aria-label={`Copy invite link for room ${roomCode}`}
          aria-keyshortcuts="L"
          onClick={onCopyLink}
        >
          {roomCode}
        </Button>

        {/* Status, not a label: "5h 57m" stays lowercase so it reads as
            units rather than initials. */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {deviceCount > 1 ? <span>{deviceCount} devices</span> : null}
          {deviceCount > 1 && expiresIn !== null ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {expiresIn !== null ? (
            // aria-live is off on purpose: a countdown that announces itself
            // every tick is hostile to a screen reader.
            <span aria-live="off" className="tabular-nums">
              {expiresIn === 0
                ? "Expired"
                : `Expires in ${formatCountdown(expiresIn)}`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className={actionFlex} variant="secondary" size="default" onClick={onShare}>
          <IconCopy size={14} />
          Share Link
        </Button>
        <Button
          className={actionFlex}
          variant="secondary"
          size="default"
          aria-haspopup="dialog"
          aria-expanded={qrOpen}
          aria-keyshortcuts="Q"
          onClick={onOpenQr}
        >
          <IconQr size={14} />
          QR Code
        </Button>
        <Button
          className={cn(
            actionFlex,
            !confirmingLeave && "hover:bg-destructive/12 hover:text-destructive",
          )}
          variant={confirmingLeave ? "destructive" : "secondary"}
          size="default"
          aria-keyshortcuts="X"
          onClick={onLeave}
        >
          {confirmingLeave ? "Confirm Leave" : "Leave"}
        </Button>
      </div>
    </div>
  );
}
