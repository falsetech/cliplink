"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createFileTransferManager,
  resolveIceServers,
  type FileItem,
  type FileTransferManager,
  type TransferNotice,
} from "@/lib/cliplink/file-transfer";
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
  const toastRef = useRef(pushToast);

  useEffect(() => {
    toastRef.current = pushToast;
  });

  const api = useMemo(() => {
    const urls = urlsRef.current;

    function syncItems(next: FileItem[]) {
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
          sendSignal,
          onItemsChange: syncItems,
          onNotice: handleNotice,
          iceServers: resolveIceServers(),
        });
      }
      return managerRef.current;
    }

    return {
      handleSignal(from: PeerId, payload: SignalPayload) {
        getManager().handleSignal(from, payload);
      },

      announce() {
        getManager().announce();
      },

      offerFiles(files: File[]) {
        if (files.length === 0) {
          return;
        }
        const { offered, rejected } = getManager().offerFiles(files);
        for (const { name, reason } of rejected) {
          toastRef.current(`${name || "File"} ${reason}.`, "error");
        }
        if (offered > 0) {
          toastRef.current(
            `Sharing ${offered} file${offered === 1 ? "" : "s"}. Keep this tab open.`,
            "success",
          );
        }
      },

      request(id: string) {
        if (!getManager().request(id)) {
          toastRef.current("File transfer needs a live connection.", "info");
        }
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
