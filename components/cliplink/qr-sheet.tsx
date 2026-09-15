"use client";

import { Button } from "@/components/ui/button";

import { QrCode } from "./qr-code";
import { Sheet, SheetHeader } from "./sheet";

type QrSheetProps = {
  open: boolean;
  roomCode: string;
  /** The full room URL, key fragment included — encoded on this device. */
  shareUrl: string;
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
  shareUrl,
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
    >
      <QrSheetBody
        roomCode={roomCode}
        shareUrl={shareUrl}
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
  shareUrl,
  roomKey,
  onCopyLink,
  onCopyKey,
  onShare,
}: Pick<
  QrSheetProps,
  "roomCode" | "shareUrl" | "roomKey" | "onCopyLink" | "onCopyKey" | "onShare"
>) {
  return (
    <>
      <SheetHeader
        eyebrow="Scan to join"
        title={roomCode}
        titleClassName="font-mono tracking-code text-link"
        closeLabel="Close QR code"
      />

      <div className="flex justify-center rounded-2xl border border-image-edge bg-white p-3">
        <QrCode
          value={shareUrl}
          label={`QR code for room ${roomCode}`}
          size={264}
        />
      </div>

      <p className="m-0 text-sm text-pretty text-muted-foreground">
        Scan this code or copy the link to open the room on another device. The
        code is drawn on this device, so the key it carries never leaves it.
      </p>

      <div className="flex items-center gap-3 rounded-2xl bg-muted p-3 pl-4">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-medium text-muted-foreground">
            Room key
          </p>
          <p className="m-0 font-mono text-xs break-all text-foreground select-all">
            {roomKey}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onCopyKey}>
          Copy Key
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="sm:flex-1" variant="secondary" size="lg" onClick={onCopyLink}>
          Copy Link
        </Button>
        <Button className="sm:flex-1" size="lg" onClick={onShare}>
          Share
        </Button>
      </div>
    </>
  );
}
