"use client";

import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MAX_ZIP_BYTES } from "@/lib/cliplink/constants";
import {
  formatBytes,
  formatDuration,
  formatRate,
} from "@/lib/cliplink/format";
import { cn } from "@/lib/utils";

import { DirectionLabel } from "./direction-label";
import { IconChevron } from "./icons";
import { rowClass } from "./ui";
import { sharedFolder, type FileListItem } from "./use-file-transfer";

type FileTransfersProps = {
  items: FileListItem[];
  canTransfer: boolean;
  onDownload: (id: string) => void;
  onDownloadAll: (batchId: string) => void;
  onDownloadZip: (batchId: string, name: string) => void;
  onCancel: (id: string) => void;
  onSave: (id: string, name: string) => void;
  onRevoke: (id: string) => void;
  onDismiss: (id: string) => void;
};

/**
 * Row actions. Quiet by default; the one that moves bytes toward this device
 * is tinted, so a row with several actions still has an obvious first choice.
 */
function RowAction({
  primary = false,
  ...props
}: React.ComponentProps<typeof Button> & { primary?: boolean }) {
  return (
    <Button
      variant={primary ? "tinted" : "ghost"}
      size="sm"
      className={primary ? undefined : "text-muted-foreground hover:text-foreground"}
      {...props}
    />
  );
}

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
      return item.savedToSink ? `${size} · Saved to disk` : `${size} · Saved`;
    case "failed":
      return item.error ?? "Transfer failed.";
    case "revoked":
      return `${size} · No longer available`;
    default:
      return size;
  }
}

function downloadLabel(item: FileListItem) {
  if (item.status !== "failed") {
    return "Download";
  }
  if (item.resumableBytes && item.size > 0) {
    return `Resume · ${Math.floor((item.resumableBytes / item.size) * 100)}%`;
  }
  return "Retry";
}

function FileActions({
  item,
  canTransfer,
  onDownload,
  onCancel,
  onSave,
  onRevoke,
  onDismiss,
}: Omit<FileTransfersProps, "items" | "onDownloadAll" | "onDownloadZip"> & {
  item: FileListItem;
}) {
  if (item.direction === "outgoing") {
    return (
      <RowAction
        onClick={() => onRevoke(item.id)}
      >
        Stop Sharing
      </RowAction>
    );
  }

  switch (item.status) {
    case "offered":
    case "failed":
      return (
        <>
          <RowAction
            primary
            disabled={!canTransfer}
            title={canTransfer ? undefined : OFFLINE_HINT}
            onClick={() => onDownload(item.id)}
          >
            {downloadLabel(item)}
          </RowAction>
          {item.status === "failed" ? (
            <RowAction
              onClick={() => onDismiss(item.id)}
            >
              Dismiss
            </RowAction>
          ) : null}
        </>
      );
    case "connecting":
    case "transferring":
      return (
        <RowAction
          onClick={() => onCancel(item.id)}
        >
          Cancel
        </RowAction>
      );
    case "done":
      if (item.savedToSink) {
        return (
          <RowAction
            onClick={() => onDismiss(item.id)}
          >
            Dismiss
          </RowAction>
        );
      }
      return (
        <RowAction
          onClick={() => onSave(item.id, item.name)}
        >
          Save Again
        </RowAction>
      );
    default:
      return (
        <RowAction
          onClick={() => onDismiss(item.id)}
        >
          Dismiss
        </RowAction>
      );
  }
}

type Handlers = Omit<FileTransfersProps, "items">;

type Row =
  | { kind: "file"; item: FileListItem }
  | { kind: "batch"; batchId: string; items: FileListItem[] };

/**
 * Files offered together collapse into one row, placed where the newest of
 * them would be. A batch that is down to one file is just a file again.
 */
function groupRows(items: FileListItem[]): Row[] {
  const batches = new Map<string, FileListItem[]>();
  for (const item of items) {
    if (item.batchId) {
      const key = `${item.peerId}:${item.batchId}`;
      batches.set(key, [...(batches.get(key) ?? []), item]);
    }
  }

  const rows: Row[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = item.batchId && `${item.peerId}:${item.batchId}`;
    const batch = key ? batches.get(key) : undefined;
    if (!key || !batch || batch.length < 2) {
      rows.push({ kind: "file", item });
    } else if (!placed.has(key)) {
      placed.add(key);
      rows.push({ kind: "batch", batchId: item.batchId!, items: batch });
    }
  }
  return rows;
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      {/*
        scaleX rather than width: this runs against a WebRTC byte
        counter, and width forces layout on every chunk.
      */}
      <div
        className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${percent / 100})` }}
      />
    </div>
  );
}

function isActive(item: FileListItem) {
  return item.status === "connecting" || item.status === "transferring";
}

function FileRow({
  item,
  nested = false,
  ...handlers
}: Handlers & { item: FileListItem; nested?: boolean }) {
  const incoming = item.direction === "incoming";
  const showProgress = incoming && isActive(item);
  const percent =
    item.size > 0 ? Math.min(100, Math.round((item.bytes / item.size) * 100)) : 0;
  const showThumb = incoming && item.objectUrl && item.mime.startsWith("image/");

  return (
    <li className={cn(rowClass, nested && "shadow-none")}>
      <DirectionLabel incoming={incoming} label="File" ts={item.ts} />

      <div className="col-span-2 flex min-w-0 flex-1 items-center gap-3 md:col-span-1">
        {showThumb ? (
          <Image
            src={item.objectUrl!}
            alt=""
            width={40}
            height={40}
            unoptimized
            // A pure-neutral edge; a tinted one picks up the surface
            // beneath it and reads as dirt on the image.
            className="size-10 shrink-0 rounded-lg border border-image-edge object-cover"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm text-foreground" title={item.name}>
            {nested && item.path ? (
              <span className="text-muted-foreground">{item.path}/</span>
            ) : null}
            {item.name}
          </span>
          <span
            className={cn(
              "truncate text-xs text-muted-foreground tabular-nums",
              item.status === "failed" && "text-destructive",
            )}
          >
            {statusText(item)}
          </span>
          {showProgress ? (
            <ProgressBar percent={percent} label={`Downloading ${item.name}`} />
          ) : null}
        </div>
      </div>

      <div className="col-start-2 row-start-1 flex gap-1 justify-self-end md:shrink-0">
        <FileActions item={item} {...handlers} />
      </div>
    </li>
  );
}

function batchStatus(items: FileListItem[], incoming: boolean) {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const parts = [`${items.length} files`, formatBytes(total)];

  if (!incoming) {
    const sending = items.reduce((sum, item) => sum + item.activeTransfers, 0);
    if (sending > 0) {
      parts.push(`Sending ${sending}`);
    }
    return parts.join(" · ");
  }

  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const active = items.filter(isActive).length;
  if (done > 0 || active > 0) {
    parts.push(`${done} of ${items.length} saved`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return parts.join(" · ");
}

function BatchRow({
  batchId,
  items,
  ...handlers
}: Handlers & { batchId: string; items: FileListItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const first = items[0];
  const incoming = first.direction === "incoming";
  const folder = sharedFolder(items.map((item) => item.path));
  const title = folder ?? `${items.length} files`;

  const total = items.reduce((sum, item) => sum + item.size, 0);
  const received = items.reduce(
    (sum, item) => sum + (item.status === "done" ? item.size : item.bytes),
    0,
  );
  const anyActive = incoming && items.some(isActive);
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const downloadable = items.filter(
    (item) => item.status === "offered" || item.status === "failed",
  ).length;
  const finished = items.every((item) => !isActive(item) && item.status !== "offered");
  const zippable = items.some((item) => item.blob) || downloadable > 0;
  const canZip = incoming && zippable && total <= MAX_ZIP_BYTES && !anyActive;

  return (
    <li className="flex flex-col gap-2">
      <div className={rowClass}>
        <DirectionLabel incoming={incoming} label={folder ? "Folder" : "Files"} ts={first.ts} />

        <div className="col-span-2 flex min-w-0 flex-1 flex-col gap-1 md:col-span-1">
          <button
            className="group -my-1.5 -ml-2 flex min-h-10 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left transition-colors duration-100 ease-out hover:bg-muted focus-visible:bg-muted active:bg-accent"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span
              className={cn(
                "shrink-0 text-muted-foreground transition-[rotate,color] duration-200 ease-out group-hover:text-foreground",
                expanded && "rotate-90",
              )}
            >
              <IconChevron size={14} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-foreground" title={title}>
                {title}
              </span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {batchStatus(items, incoming)}
              </span>
            </span>
          </button>
          {anyActive ? (
            <ProgressBar percent={percent} label={`Downloading ${title}`} />
          ) : null}
        </div>

        <div className="col-start-2 row-start-1 flex flex-wrap justify-end gap-1 md:shrink-0">
          {!incoming ? (
            <RowAction
              onClick={() => items.forEach((item) => handlers.onRevoke(item.id))}
            >
              Stop Sharing
            </RowAction>
          ) : downloadable > 0 ? (
            <RowAction
              primary
              disabled={!handlers.canTransfer}
              title={handlers.canTransfer ? undefined : OFFLINE_HINT}
              onClick={() => handlers.onDownloadAll(batchId)}
            >
              {downloadable === items.length ? "Download All" : `Download ${downloadable}`}
            </RowAction>
          ) : null}
          {canZip ? (
            <RowAction
              disabled={downloadable > 0 && !handlers.canTransfer}
              title={
                downloadable > 0 && !handlers.canTransfer
                  ? OFFLINE_HINT
                  : "Save the group as one zip. The files are held in memory until it's saved."
              }
              onClick={() => handlers.onDownloadZip(batchId, folder ?? "cliplink-files")}
            >
              Zip
            </RowAction>
          ) : null}
          {incoming && finished ? (
            <RowAction
              onClick={() => items.forEach((item) => handlers.onDismiss(item.id))}
            >
              Dismiss
            </RowAction>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <ul className="m-0 ml-4 flex list-none flex-col gap-2 border-l border-border p-0 pl-3">
          {items.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              nested
              {...handlers}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FileTransfers({ items, ...handlers }: FileTransfersProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="m-0 text-lg font-semibold text-foreground">Files</h2>
        <span className="text-xs text-muted-foreground">
          Peer-to-peer · never stored
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {groupRows(items).map((row) =>
          row.kind === "file" ? (
            <FileRow
              key={row.item.id}
              item={row.item}
              {...handlers}
            />
          ) : (
            <BatchRow
              key={`${row.items[0].peerId}:${row.batchId}`}
              batchId={row.batchId}
              items={row.items}
              {...handlers}
            />
          ),
        )}
      </ul>
    </section>
  );
}
