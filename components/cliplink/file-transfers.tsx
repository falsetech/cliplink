"use client";

import Image from "next/image";
import type { CSSProperties } from "react";

import { formatBytes, formatHistoryTime } from "@/lib/cliplink/format";
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
  "min-h-8 rounded-[2px] border border-transparent px-2 py-1 text-[10px] text-[var(--text-muted)] transition hover:border-[var(--border-active)] hover:text-[var(--text)] focus-visible:border-[var(--border-active)] focus-visible:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-[0.55]";

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
    case "transferring":
      return `${formatBytes(item.bytes)} of ${size}`;
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
            className={cn(actionClass, "text-(--incoming-text)")}
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
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-(--text-muted)">
        <span>Files</span>
        <span className="h-px flex-1 bg-[(--border)" />
        <span className="normal-case tracking-[0.04em]">
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
            item.size > 0 ? Math.round((item.bytes / item.size) * 100) : 0;
          const showThumb =
            incoming && item.objectUrl && item.mime.startsWith("image/");

          return (
            <li
              key={item.id}
              className={cn(
                "grid animate-[fade-in_0.3s_ease] grid-cols-[48px_1fr] items-start gap-[10px] rounded-[4px] border border-[var(--border)] border-l-2 p-3 shadow-[var(--shadow)] md:flex md:items-center md:gap-3 md:px-4 md:py-3",
                incoming
                  ? "border-l-[var(--incoming-border)]"
                  : "border-l-[var(--text-muted)]",
              )}
              style={surfaceStyle}
            >
              <div className="flex min-w-[52px] flex-col gap-1 md:min-w-[64px]">
                <span
                  className={cn(
                    "text-[9px] uppercase tracking-[0.1em]",
                    incoming
                      ? "text-[var(--incoming-text)]"
                      : "text-[var(--text-muted)]",
                  )}
                >
                  {incoming ? "↓ FILE" : "↑ FILE"}
                </span>
                <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
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
                    className="h-10 w-10 flex-shrink-0 rounded-[3px] border border-[var(--border)] object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className="truncate text-[11px] leading-[1.5] text-[var(--text)] md:text-[12px]"
                    title={item.name}
                  >
                    {item.name}
                  </span>
                  <span
                    className={cn(
                      "truncate text-[10px] text-[var(--text-muted)]",
                      item.status === "failed" && "text-[var(--danger)]",
                    )}
                  >
                    {statusText(item)}
                  </span>
                  {showProgress ? (
                    <div
                      className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]"
                      role="progressbar"
                      aria-label={`Downloading ${item.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <div
                        className="h-full bg-[var(--accent)] transition-[width] duration-150"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="col-start-2 mt-1 flex gap-1 justify-self-start md:mt-0 md:flex-shrink-0">
                <FileActions item={item} {...handlers} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
