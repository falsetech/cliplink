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
  /** Already grouped for reading; the room key this device generated. */
  roomKey: string;
  onClose: () => void;
  onCopyLink: () => void;
  onCopyKey: () => void;
  onShare: () => void;
};

export function QrSheet({
  open,
  roomCode,
  qrCodeUrl,
  roomKey,
  onClose,
  onCopyLink,
  onCopyKey,
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
        roomKey={roomKey}
        onCopyLink={onCopyLink}
        onCopyKey={onCopyKey}
        onShare={onShare}
      />
    </Sheet>
  );
}

function QrSheetBody({
  roomCode,
  qrCodeUrl,
  roomKey,
  onCopyLink,
  onCopyKey,
  onShare,
}: Pick<
  QrSheetProps,
  "roomCode" | "qrCodeUrl" | "roomKey" | "onCopyLink" | "onCopyKey" | "onShare"
>) {
  const close = useSheetClose();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-2xs tracking-label-wide text-muted uppercase">
            Scan to join
          </p>
          <h2 className="m-0 font-display text-2xl tracking-code text-room sm:text-3xl">
            {roomCode}
          </h2>
        </div>
        <button
          className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-control text-dim transition-colors duration-150 hover:text-fg focus-visible:text-fg active:scale-[0.96]"
          type="button"
          aria-label="Close QR code"
          onClick={() => close()}
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="flex justify-center rounded-surface border border-image-edge bg-white p-4">
        <Image
          src={qrCodeUrl}
          alt={`QR code for room ${roomCode}`}
          width={280}
          height={280}
          unoptimized
        />
      </div>

      <p className="m-0 text-xs text-pretty text-dim">
        The link carries the key and opens the room straight away. The QR code
        does not — scanning it asks for the key, because the image is drawn by
        an outside service and the key must not reach one.
      </p>

      <div className="flex flex-col gap-2 rounded-surface border border-line bg-surface p-3">
        <p className="m-0 text-2xs tracking-label-wide text-muted uppercase">
          Room key
        </p>
        <p className="m-0 font-mono text-2xs leading-relaxed break-all text-dim select-all">
          {roomKey}
        </p>
        <button
          className={secondaryButtonClass}
          type="button"
          onClick={onCopyKey}
        >
          Copy Key
        </button>
      </div>

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
