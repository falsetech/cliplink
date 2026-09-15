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

import { DISK_SINK_MIN_BYTES, MAX_FILE_BYTES } from "@/lib/cliplink/constants";
import { canPickDiskSink, pickDiskSink } from "@/lib/cliplink/file-sink";
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
  const toastRef = useRef(pushToast);

  useEffect(() => {
    toastRef.current = pushToast;
  });

  const api = useMemo(() => {
    const urls = urlsRef.current;

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

    function handleNotice(notice: TransferNotice) {
      const toast = toastRef.current;
      switch (notice.type) {
        case "incoming-offer":
          toast(`${notice.item.name} is ready to download.`, "info");
          return;
        case "received": {
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
          limits: { maxFileBytes: MAX_FILE_BYTES },
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

      offerFiles(files: File[]) {
        if (files.length === 0) {
          return;
        }
        const { offered, rejected } = getManager().offerFiles(files);
        for (const rejection of rejected) {
          toastRef.current(rejectionText(rejection), "error");
        }
        if (offered > 0) {
          toastRef.current(
            `Sharing ${offered} file${offered === 1 ? "" : "s"}. Keep this tab open.`,
            "success",
          );
        }
      },

      request(id: string) {
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
