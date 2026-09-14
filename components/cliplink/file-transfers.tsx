"use client";

import Image from "next/image";
import type { CSSProperties } from "react";

import {
  formatBytes,
  formatDuration,
  formatHistoryTime,
  formatRate,
} from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import type { FileListItem } from "./use-file-transfer";

type FileTransfersProps = {
  items: FileListItem[];
  canTransfer: boolean;
  surfaceStyle: CSSProperties;
  onDownload: (id: string) => void;
  onCancel: (id: string) => void;
  onSave: (id: string, name: string) => void;
  onRevoke: (id: string) => void;
  onDismiss: (id: string) => void;
};

const actionClass =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-transparent px-2 text-2xs text-muted transition-[color,border-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 md:min-h-10";

const OFFLINE_HINT = "File transfer needs a live connection.";

function statusText(item: FileListItem) {
  const size = formatBytes(item.size);

  if (item.direction === "outgoing") {
    const parts = [size, "Available while this tab is open"];
    if (item.activeTransfers > 0) {
      parts.push(`Sending to ${item.activeTransfers}`);
    }
    if (item.completedTransfers > 0) {
      parts.push(`Sent ${item.completedTransfers}×`);
    }
    return parts.join(" · ");
  }

  switch (item.status) {
    case "connecting":
      return `${size} · Connecting…`;
    case "transferring": {
      const parts = [`${formatBytes(item.bytes)} of ${size}`];
      if (item.bytesPerSecond) {
        parts.push(formatRate(item.bytesPerSecond));
      }
      if (item.etaMs !== undefined) {
        parts.push(`${formatDuration(item.etaMs)} left`);
      }
      return parts.join(" · ");
    }
    case "done":
      return `${size} · Saved`;
    case "failed":
      return item.error ?? "Transfer failed.";
    case "revoked":
      return `${size} · No longer available`;
    default:
      return size;
  }
}

function FileActions({
  item,
  canTransfer,
  onDownload,
  onCancel,
  onSave,
  onRevoke,
  onDismiss,
}: Omit<FileTransfersProps, "items" | "surfaceStyle"> & {
  item: FileListItem;
}) {
  if (item.direction === "outgoing") {
    return (
      <button
        className={actionClass}
        type="button"
        onClick={() => onRevoke(item.id)}
      >
        stop sharing
      </button>
    );
  }

  switch (item.status) {
    case "offered":
    case "failed":
      return (
        <>
          <button
            className={cn(actionClass, "text-incoming")}
            type="button"
            disabled={!canTransfer}
            title={canTransfer ? undefined : OFFLINE_HINT}
            onClick={() => onDownload(item.id)}
          >
            {item.status === "failed" ? "retry" : "download"}
          </button>
          {item.status === "failed" ? (
            <button
              className={actionClass}
              type="button"
              onClick={() => onDismiss(item.id)}
            >
              dismiss
            </button>
          ) : null}
        </>
      );
    case "connecting":
    case "transferring":
      return (
        <button
          className={actionClass}
          type="button"
          onClick={() => onCancel(item.id)}
        >
          cancel
        </button>
      );
    case "done":
      return (
        <button
          className={actionClass}
          type="button"
          onClick={() => onSave(item.id, item.name)}
        >
          save again
        </button>
      );
    default:
      return (
        <button
          className={actionClass}
          type="button"
          onClick={() => onDismiss(item.id)}
        >
          dismiss
        </button>
      );
  }
}

export function FileTransfers({
  items,
  surfaceStyle,
  ...handlers
}: FileTransfersProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-2xs tracking-label-wide text-muted uppercase">
        <span>Files</span>
        <span className="h-px flex-1 bg-line" />
        <span className="tracking-label normal-case">
          peer-to-peer · never stored
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((item) => {
          const incoming = item.direction === "incoming";
          const showProgress =
            incoming &&
            (item.status === "connecting" || item.status === "transferring");
          const percent =
            item.size > 0
              ? Math.min(100, Math.round((item.bytes / item.size) * 100))
              : 0;
          const showThumb =
            incoming && item.objectUrl && item.mime.startsWith("image/");

          return (
            <li
              key={item.id}
              className={cn(
                "grid grid-cols-[48px_1fr] items-start gap-2.5 rounded-surface border border-line border-l-2 p-3 shadow-row md:flex md:items-center md:gap-3 md:px-4 md:py-3",
                incoming ? "border-l-incoming-line" : "border-l-muted",
              )}
              style={surfaceStyle}
            >
              <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
                <span
                  className={cn(
                    "text-2xs tracking-label uppercase",
                    incoming ? "text-incoming" : "text-muted",
                  )}
                >
                  {incoming ? "↓ FILE" : "↑ FILE"}
                </span>
                <span className="text-2xs tracking-label text-muted uppercase tabular-nums">
                  {formatHistoryTime(item.ts)}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                {showThumb ? (
                  <Image
                    src={item.objectUrl!}
                    alt=""
                    width={40}
                    height={40}
                    unoptimized
                    // A pure-neutral edge; a tinted one picks up the surface
                    // beneath it and reads as dirt on the image.
                    className="h-10 w-10 shrink-0 rounded-none border border-image-edge object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-2xs text-fg md:text-xs" title={item.name}>
                    {item.name}
                  </span>
                  <span
                    className={cn(
                      "truncate text-2xs text-muted tabular-nums",
                      item.status === "failed" && "text-danger",
                    )}
                  >
                    {statusText(item)}
                  </span>
                  {showProgress ? (
                    <div
                      className="h-0.75 w-full overflow-hidden rounded-full bg-line"
                      role="progressbar"
                      aria-label={`Downloading ${item.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      {/*
                        scaleX rather than width: this runs against a WebRTC byte
                        counter, and width forces layout on every chunk.
                      */}
                      <div
                        className="h-full w-full origin-left bg-accent transition-transform duration-150 ease-out"
                        style={{ transform: `scaleX(${percent / 100})` }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="col-start-2 mt-1 flex gap-1 justify-self-start md:mt-0 md:shrink-0">
                <FileActions item={item} {...handlers} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
