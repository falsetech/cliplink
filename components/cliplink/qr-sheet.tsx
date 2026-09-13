"use client";

import Image from "next/image";

import { Sheet, useSheetClose } from "./sheet";
import { IconX } from "./icons";
import {
  panelSurfaceStyle,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

type QrSheetProps = {
  open: boolean;
  roomCode: string;
  qrCodeUrl: string;
  onClose: () => void;
  onCopyLink: () => void;
  onShare: () => void;
};

export function QrSheet({
  open,
  roomCode,
  qrCodeUrl,
  onClose,
  onCopyLink,
  onShare,
}: QrSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`Room ${roomCode} QR code`}
      style={panelSurfaceStyle}
    >
      <QrSheetBody
        roomCode={roomCode}
        qrCodeUrl={qrCodeUrl}
        onCopyLink={onCopyLink}
        onShare={onShare}
      />
    </Sheet>
  );
}

function QrSheetBody({
  roomCode,
  qrCodeUrl,
  onCopyLink,
  onShare,
}: Pick<QrSheetProps, "roomCode" | "qrCodeUrl" | "onCopyLink" | "onShare">) {
  const close = useSheetClose();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-2xs tracking-label-wide text-muted uppercase">
            Scan to join
          </p>
          <h2 className="m-0 font-display text-2xl tracking-code text-accent sm:text-3xl">
            {roomCode}
          </h2>
        </div>
        <button
          className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-control text-dim transition-colors duration-150 hover:text-fg focus-visible:text-fg active:scale-[0.96]"
          type="button"
          aria-label="Close QR code"
          onClick={close}
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="flex justify-center border border-image-edge bg-white p-4">
        <Image
          src={qrCodeUrl}
          alt={`QR code for room ${roomCode}`}
          width={280}
          height={280}
          unoptimized
        />
      </div>

      <p className="m-0 text-xs text-pretty text-dim">
        Scan this code or copy the link to open the room instantly on another
        device.
      </p>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          className={secondaryButtonClass}
          type="button"
          onClick={onCopyLink}
        >
          Copy Link
        </button>
        <button className={primaryButtonClass} type="button" onClick={onShare}>
          Share
        </button>
      </div>
    </>
  );
}
