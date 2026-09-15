"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_ICE_SERVERS,
  createFileTransferManager,
  type FileItem,
  type FileTransferManager,
  type OfferRejection,
  type TransferNotice,
} from "@thebkht/rtc-file-transfer";

import {
  DISK_SINK_MIN_BYTES,
  MAX_FILE_BYTES,
  MAX_FILE_ITEMS,
  MAX_FILES_PER_SHARE,
} from "@/lib/cliplink/constants";
import type { ShareEntry } from "@/lib/cliplink/dropped-files";
import {
  canPickDiskSink,
  createDirectorySink,
  pickDiskSink,
  pickDirectory,
} from "@/lib/cliplink/file-sink";
import type { PeerId, SignalPayload } from "@/lib/cliplink/types";

export type FileListItem = FileItem & {
  /** Object URL for a completed incoming file (download + image thumbnail). */
  objectUrl?: string;
};

type ToastTone = "success" | "info" | "error";

type UseFileTransferOptions = {
  peerId: PeerId;
  sendSignal: (payload: SignalPayload, to?: PeerId) => boolean;
  pushToast: (message: string, tone?: ToastTone) => void;
};

/** Reads `NEXT_PUBLIC_ICE_SERVERS` (JSON array) so a TURN relay can be added without code changes. */
function resolveIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) {
    return DEFAULT_ICE_SERVERS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as RTCIceServer[])
      : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

function rejectionText({ file, code, limit }: OfferRejection) {
  const name = file.name || "File";
  return code === "empty"
    ? `${name} is empty.`
    : `${name} is over the ${limit / (1024 * 1024)} MB limit.`;
}

/** How many files of a batch download at once. */
const BATCH_CONCURRENCY = 2;

/** One file waiting in, or running from, a "Download all". */
type QueuedDownload = {
  id: string;
  batchId: string;
  /** Folder to write into, or null to download into memory and save. */
  root: FileSystemDirectoryHandle | null;
};

/** Progress of one "Download all", reported once it finishes. */
type BatchRun = { remaining: number; saved: number; failed: number };

type DownloadQueue = {
  waiting: QueuedDownload[];
  active: Map<string, QueuedDownload>;
  runs: Map<string, BatchRun>;
};

/** The one folder every entry sits under, if there is one: what the batch is called. */
export function sharedFolder(paths: Array<string | undefined>) {
  const tops = new Set(paths.map((path) => path?.split("/")[0]));
  const [top] = tops;
  return tops.size === 1 && top ? top : undefined;
}

function saveFile(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Owns the peer-to-peer file transfer manager for the current room and exposes
 * its items as React state. Returned callbacks are stable across renders so
 * they can be captured by the realtime transport handlers.
 */
export function useFileTransfer({ peerId, sendSignal, pushToast }: UseFileTransferOptions) {
  const [items, setItems] = useState<FileListItem[]>([]);

  const managerRef = useRef<FileTransferManager | null>(null);
  const urlsRef = useRef(new Map<string, string>());
  const latestRef = useRef<FileItem[]>([]);
  const queueRef = useRef<DownloadQueue>({
    waiting: [],
    active: new Map(),
    runs: new Map(),
  });
  /** Batches already announced, so a folder of 50 files makes one toast. */
  const announcedRef = useRef(new Set<string>());
  const toastRef = useRef(pushToast);

  useEffect(() => {
    toastRef.current = pushToast;
  });

  const api = useMemo(() => {
    const urls = urlsRef.current;
    const queue = queueRef.current;
    const announced = announcedRef.current;

    function syncItems(next: FileItem[]) {
      latestRef.current = next;
      const alive = new Set<string>();
      for (const item of next) {
        if (item.blob) {
          alive.add(item.id);
          if (!urls.has(item.id)) {
            urls.set(item.id, URL.createObjectURL(item.blob));
          }
        }
      }
      for (const [id, url] of urls) {
        if (!alive.has(id)) {
          URL.revokeObjectURL(url);
          urls.delete(id);
        }
      }
      setItems(next.map((item) => ({ ...item, objectUrl: urls.get(item.id) })));
    }

    function startDownload(id: string, root: FileSystemDirectoryHandle | null) {
      const item = latestRef.current.find((candidate) => candidate.id === id);
      if (!item) {
        return false;
      }
      // A resumable download keeps writing into the sink it already has.
      const sink =
        root && item.resumableBytes === undefined
          ? createDirectorySink(root, item.path, item.name)
          : undefined;
      return getManager().request(id, sink ? { sink } : {});
    }

    function pumpQueue() {
      while (queue.active.size < BATCH_CONCURRENCY && queue.waiting.length > 0) {
        const next = queue.waiting.shift()!;
        queue.active.set(next.id, next);
        if (!startDownload(next.id, next.root)) {
          settleQueued(next.id, false);
        }
      }
    }

    function settleQueued(id: string, saved: boolean) {
      const entry = queue.active.get(id);
      if (!entry) {
        return;
      }
      queue.active.delete(id);
      const run = queue.runs.get(entry.batchId);
      if (run) {
        run.remaining -= 1;
        run[saved ? "saved" : "failed"] += 1;
        if (run.remaining === 0) {
          queue.runs.delete(entry.batchId);
          const toast = toastRef.current;
          if (run.failed === 0) {
            toast(`Saved ${run.saved} file${run.saved === 1 ? "" : "s"}.`, "success");
          } else {
            toast(`Saved ${run.saved}, ${run.failed} failed. Retry them from the list.`, "error");
          }
        }
      }
      pumpQueue();
    }

    function handleNotice(notice: TransferNotice) {
      const toast = toastRef.current;
      const queued = queue.active.has(notice.item.id);
      switch (notice.type) {
        case "incoming-offer": {
          const { batchId } = notice.item;
          if (!batchId) {
            toast(`${notice.item.name} is ready to download.`, "info");
          } else if (!announced.has(batchId)) {
            announced.add(batchId);
            const folder = notice.item.path?.split("/")[0];
            toast(
              folder ? `The ${folder} folder is being shared.` : "Files are being shared.",
              "info",
            );
          }
          return;
        }
        case "received": {
          if (queued) {
            // A "Download all" reports once, when the last file lands.
            if (!notice.item.savedToSink) {
              const url = urls.get(notice.item.id);
              if (url) {
                saveFile(url, notice.item.name);
              }
            }
            settleQueued(notice.item.id, true);
            return;
          }
          if (notice.item.savedToSink) {
            toast(`Saved ${notice.item.name}.`, "success");
            return;
          }
          const url = urls.get(notice.item.id);
          if (url) {
            saveFile(url, notice.item.name);
          }
          toast(`Received ${notice.item.name}.`, "success");
          return;
        }
        case "failed":
          if (queued) {
            settleQueued(notice.item.id, false);
            return;
          }
          toast(notice.message, "error");
          return;
      }
    }

    function getManager() {
      if (!managerRef.current) {
        managerRef.current = createFileTransferManager({
          peerId,
          // hello-ack is presence, not file transfer, and never reaches here.
          sendSignal,
          onItemsChange: syncItems,
          onNotice: handleNotice,
          iceServers: resolveIceServers(),
          limits: { maxFileBytes: MAX_FILE_BYTES, maxItems: MAX_FILE_ITEMS },
        });
      }
      return managerRef.current;
    }

    return {
      handleSignal(from: PeerId, payload: SignalPayload) {
        if (payload.type !== "hello-ack") {
          getManager().handleSignal(from, payload);
        }
      },

      announce() {
        getManager().announce();
      },

      offerFiles(entries: ShareEntry[]) {
        if (entries.length === 0) {
          return;
        }
        if (entries.length > MAX_FILES_PER_SHARE) {
          toastRef.current(
            `Share up to ${MAX_FILES_PER_SHARE} files at a time.`,
            "error",
          );
          return;
        }
        const { offered, rejected } = getManager().offerFiles(entries, {
          batch: entries.length > 1,
        });
        // Each rejection is its own toast only while there are few of them.
        if (rejected.length > 3) {
          toastRef.current(`${rejected.length} files are empty or too large to share.`, "error");
        } else {
          for (const rejection of rejected) {
            toastRef.current(rejectionText(rejection), "error");
          }
        }
        if (offered > 0) {
          const folder = sharedFolder(entries.map((entry) => entry.path));
          const what = folder
            ? `${folder} (${offered} file${offered === 1 ? "" : "s"})`
            : `${offered} file${offered === 1 ? "" : "s"}`;
          toastRef.current(`Sharing ${what}. Keep this tab open.`, "success");
        }
      },

      /**
       * Downloads every file of a batch that can still be downloaded, a couple
       * at a time. Where the browser can write to a folder it asks for one
       * first, so the batch keeps its structure on disk.
       */
      downloadAll(batchId: string) {
        const ids = latestRef.current
          .filter(
            (item) =>
              item.batchId === batchId &&
              item.direction === "incoming" &&
              (item.status === "offered" || item.status === "failed") &&
              !queue.active.has(item.id) &&
              !queue.waiting.some((entry) => entry.id === item.id),
          )
          .map((item) => item.id);
        if (ids.length === 0) {
          return;
        }

        const enqueue = (root: FileSystemDirectoryHandle | null) => {
          const run = queue.runs.get(batchId) ?? { remaining: 0, saved: 0, failed: 0 };
          run.remaining += ids.length;
          queue.runs.set(batchId, run);
          queue.waiting.push(...ids.map((id) => ({ id, batchId, root })));
          pumpQueue();
        };

        // The picker opens synchronously inside this click, while it still
        // counts as user activation.
        pickDirectory().then(enqueue, () => {
          // Dismissed the folder dialog: no download.
        });
      },

      request(id: string) {
        // Started by hand, so it is no longer the queue's to start or report.
        const waiting = queue.waiting.findIndex((entry) => entry.id === id);
        if (waiting !== -1) {
          const [entry] = queue.waiting.splice(waiting, 1);
          const run = queue.runs.get(entry.batchId);
          if (run) {
            run.remaining -= 1;
            if (run.remaining === 0) {
              queue.runs.delete(entry.batchId);
            }
          }
        }

        const notifyOffline = (started: boolean) => {
          if (!started) {
            toastRef.current("File transfer needs a live connection.", "info");
          }
        };

        const item = latestRef.current.find((candidate) => candidate.id === id);
        if (
          !item ||
          // A resumable download keeps writing into the sink it already has.
          item.resumableBytes !== undefined ||
          item.size < DISK_SINK_MIN_BYTES ||
          !canPickDiskSink()
        ) {
          notifyOffline(getManager().request(id));
          return;
        }

        // The picker opens synchronously inside this click, while it still
        // counts as user activation.
        pickDiskSink(item.name).then(
          (sink) => {
            notifyOffline(getManager().request(id, sink ? { sink } : {}));
          },
          () => {
            // Dismissed the save dialog: no download.
          },
        );
      },

      cancel(id: string) {
        const waiting = queue.waiting.findIndex((entry) => entry.id === id);
        if (waiting !== -1) {
          const [entry] = queue.waiting.splice(waiting, 1);
          queue.active.set(entry.id, entry);
          settleQueued(entry.id, false);
          return;
        }
        managerRef.current?.cancel(id);
      },

      revoke(id: string) {
        managerRef.current?.revoke(id);
      },

      dismiss(id: string) {
        managerRef.current?.dismiss(id);
      },

      save(id: string, name: string) {
        const url = urls.get(id);
        if (url) {
          saveFile(url, name);
        }
      },

      /** Drops every offer, transfer, and in-memory file (on leaving the room). */
      reset() {
        queue.waiting = [];
        queue.active.clear();
        queue.runs.clear();
        announced.clear();
        managerRef.current?.dispose();
        managerRef.current = null;
        for (const url of urls.values()) {
          URL.revokeObjectURL(url);
        }
        urls.clear();
        setItems([]);
      },
    };
  }, [peerId, sendSignal]);

  useEffect(() => {
    return () => api.reset();
  }, [api]);

  return { items, ...api };
}
