"use client";

import Image from "next/image";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";

import { FileTransfers } from "@/components/cliplink/file-transfers";
import { useFileTransfer } from "@/components/cliplink/use-file-transfer";

import {
  MAX_SESSION_HISTORY,
  POLL_INTERVAL_MS,
} from "@/lib/cliplink/constants";
import { readClipboard, writeClipboard } from "@/lib/cliplink/clipboard";
import {
  formatCharCount,
  formatHistoryTime,
  truncatePreview,
} from "@/lib/cliplink/format";
import { createRoomRequest } from "@/lib/cliplink/http";
import { buildRoomUrl, normalizeRoomCode } from "@/lib/cliplink/room-code";
import { createRandomId, getSessionSenderId } from "@/lib/cliplink/session";
import type { RoomCode, RoomStatus, SessionClip } from "@/lib/cliplink/types";
import { validateRoomCode } from "@/lib/cliplink/validation";
import { createWebSocketTransport } from "@/lib/cliplink/ws";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "info" | "error";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

const transport = createWebSocketTransport();

// Identifies this page load for peer-to-peer signaling. Unlike the sender id it
// isn't kept in sessionStorage, so duplicated tabs don't share an identity.
const peerId = createRandomId();

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function sortClipsNewestFirst(clips: SessionClip[]) {
  return [...clips].sort((left, right) => right.id - left.id);
}

function mergeHistory(current: SessionClip[], additions: SessionClip[]) {
  const seen = new Set(current.map((clip) => clip.id));
  const merged = [...current];

  for (const clip of additions) {
    if (!seen.has(clip.id)) {
      merged.push(clip);
      seen.add(clip.id);
    }
  }

  return sortClipsNewestFirst(merged).slice(0, MAX_SESSION_HISTORY);
}

function statusLabel(status: RoomStatus) {
  switch (status) {
    case "live":
      return "LIVE";
    case "syncing":
      return "SYNCING";
    case "error":
      return "ERROR";
    default:
      return "OFFLINE";
  }
}

function IconPlus() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5V19M5 12H19"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="9"
        width="13"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IconQr() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4H10V10H4V4ZM14 4H20V10H14V4ZM4 14H10V20H4V14ZM15 15H17V17H15V15ZM17 17H20V20H17V17ZM14 18H16V20H14V18ZM18 14H20V16H18V14ZM14 11H16V14H14V11ZM11 11H13V13H11V11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M21 11.5L12.5 20a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 0 1 5.19 5.19l-8.5 8.49a1.83 1.83 0 0 1-2.59-2.59L15.1 7.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTheme({ theme }: { theme: "dark" | "light" }) {
  if (theme === "light") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 3V5M12 19V21M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M3 12H5M19 12H21M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93M16 12A4 4 0 1 1 8 12A4 4 0 0 1 16 12Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CliplinkApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [roomCode, setRoomCode] = useState<RoomCode | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [editorText, setEditorText] = useState("");
  const [history, setHistory] = useState<SessionClip[]>([]);
  const [status, setStatus] = useState<RoomStatus>("offline");
  const [isBusy, setIsBusy] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [realtimeReady, setRealtimeReady] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const { resolvedTheme, setTheme } = useTheme();
  const files = useFileTransfer({
    peerId,
    sendSignal: transport.sendSignal,
    pushToast,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const senderIdRef = useRef("");
  const lastSeenIdRef = useRef(0);
  const roomCodeRef = useRef<RoomCode | null>(null);
  const pollingRef = useRef<number | null>(null);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const syncResetRef = useRef<number | null>(null);
  const initializedRoomRef = useRef<string | null>(null);
  const realtimeRetryRef = useRef<number | null>(null);
  const realtimeRetryCountRef = useRef(0);
  const realtimeOpenedRef = useRef(false);

  useEffect(() => {
    senderIdRef.current = getSessionSenderId();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  const joinFromSearchParams = useEffectEvent((requestedRoom: string) => {
    void joinExistingRoom(requestedRoom, true);
  });

  useEffect(() => {
    const requestedRoom = normalizeRoomCode(searchParams.get("room"));

    if (!requestedRoom || initializedRoomRef.current === requestedRoom) {
      return;
    }

    initializedRoomRef.current = requestedRoom;
    joinFromSearchParams(requestedRoom);
  }, [searchParams]);

  useEffect(() => {
    return () => {
      stopPolling();
      stopStream();
      clearSyncReset();
      clearRealtimeRetry();
      transport.disconnect();
    };
  }, []);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      roomCodeRef.current
    ) {
      event.preventDefault();
      void sendClip();
    }
  });

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // Dropping a file outside the panel would otherwise navigate away from the room.
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };
    document.addEventListener("dragover", preventFileNavigation);
    document.addEventListener("drop", preventFileNavigation);
    return () => {
      document.removeEventListener("dragover", preventFileNavigation);
      document.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  function pushToast(message: string, tone: ToastTone = "info") {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2500);
  }

  function updateUrl(code: RoomCode | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (code) {
      next.set("room", code);
    } else {
      next.delete("room");
    }

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function toggleTheme() {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  }

  function clearRealtimeRetry() {
    if (realtimeRetryRef.current) {
      window.clearTimeout(realtimeRetryRef.current);
      realtimeRetryRef.current = null;
    }
  }

  function clearSyncReset() {
    if (syncResetRef.current) {
      window.clearTimeout(syncResetRef.current);
      syncResetRef.current = null;
    }
  }

  function markSyncing() {
    clearSyncReset();
    setStatus("syncing");
    syncResetRef.current = window.setTimeout(() => {
      setStatus("live");
      syncResetRef.current = null;
    }, 600);
  }

  function triggerFlash() {
    setFlashActive(false);
    window.requestAnimationFrame(() => {
      setFlashActive(true);
      window.setTimeout(() => setFlashActive(false), 300);
    });
  }

  function stopPolling() {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function stopStream() {
    if (streamCleanupRef.current) {
      const cleanup = streamCleanupRef.current;
      streamCleanupRef.current = null;
      cleanup();
    }
  }

  function startPolling(nextRoomCode: RoomCode) {
    stopPolling();
    pollingRef.current = window.setInterval(() => {
      void pollForUpdates(nextRoomCode);
    }, POLL_INTERVAL_MS);
  }

  function scheduleRealtimeRetry(nextRoomCode: RoomCode) {
    clearRealtimeRetry();
    const attempt = realtimeRetryCountRef.current;
    const delay = Math.min(15_000, 2_000 * 2 ** attempt);
    realtimeRetryRef.current = window.setTimeout(() => {
      realtimeRetryRef.current = null;
      if (roomCodeRef.current === nextRoomCode && !streamCleanupRef.current) {
        startRealtime(nextRoomCode);
      }
    }, delay);
  }

  function applyIncomingClips(clips: SessionClip[]) {
    if (clips.length === 0) {
      return;
    }

    setHistory((current) => mergeHistory(current, clips));
    setStatus("live");
    triggerFlash();
    const latest = clips[0];
    void autoCopyIncoming(latest.text);
  }

  function startRealtime(nextRoomCode: RoomCode) {
    stopPolling();
    stopStream();
    clearRealtimeRetry();
    realtimeOpenedRef.current = false;
    const cleanup = transport.streamClips(nextRoomCode, lastSeenIdRef.current, peerId, {
      onOpen: () => {
        const hadFallback = realtimeRetryCountRef.current > 0;
        realtimeOpenedRef.current = true;
        realtimeRetryCountRef.current = 0;
        setStatus("live");
        setRealtimeReady(true);
        files.announce();
        if (hadFallback) {
          pushToast("Realtime connection restored.", "success");
        }
      },
      onClips: (clips) => {
        const incoming = clips
          .filter((clip) => clip.senderId !== senderIdRef.current)
          .map((clip) => ({
            ...clip,
            direction: "incoming" as const,
          }));

        for (const clip of clips) {
          lastSeenIdRef.current = Math.max(lastSeenIdRef.current, clip.id);
        }

        applyIncomingClips(incoming.reverse());
      },
      onSignal: (from, payload) => files.handleSignal(from, payload),
      onDisconnect: (reason) => {
        streamCleanupRef.current = null;
        setRealtimeReady(false);
        if (reason === "error" && roomCodeRef.current === nextRoomCode) {
          const hadOpened = realtimeOpenedRef.current;
          realtimeOpenedRef.current = false;
          startPolling(nextRoomCode);
          realtimeRetryCountRef.current += 1;
          scheduleRealtimeRetry(nextRoomCode);
          pushToast(
            hadOpened
              ? "Realtime connection dropped. Using polling for now."
              : "Realtime unavailable. Using polling for now.",
            "info",
          );
        }
      },
    });

    if (!cleanup) {
      startPolling(nextRoomCode);
      return;
    }

    streamCleanupRef.current = cleanup;
  }

  async function copyRoomLink(code: RoomCode) {
    try {
      const url = buildRoomUrl(code, window.location.href);
      await writeClipboard(url);
      pushToast("Room link copied!", "success");
    } catch {
      pushToast("Could not copy room link.", "error");
    }
  }

  async function shareRoom(code: RoomCode) {
    const url = buildRoomUrl(code, window.location.href);

    try {
      if (navigator.share) {
        await navigator.share({
          title: "CLIPLINK room",
          text: `Join my CLIPLINK room: ${code}`,
          url,
        });
        pushToast("Room link shared!", "success");
        return;
      }

      await writeClipboard(url);
      pushToast("Room link copied!", "success");
    } catch {
      pushToast("Could not share the room link.", "error");
    }
  }

  function openQrSheet() {
    setShowQrSheet(true);
  }

  function closeQrSheet() {
    setShowQrSheet(false);
  }

  async function autoCopyIncoming(text: string) {
    try {
      await writeClipboard(text);
      pushToast("Received clip — copied!", "success");
    } catch {
      pushToast("Received clip. Clipboard access was blocked.", "info");
    }
  }

  async function hydrateRoom(nextRoomCode: RoomCode) {
    const response = await transport.connect(nextRoomCode);
    let nextHistory = sortClipsNewestFirst(
      response.clips.map((clip) => ({
        ...clip,
        direction:
          clip.senderId === senderIdRef.current ? "outgoing" : "incoming",
      })),
    ).slice(0, MAX_SESSION_HISTORY);

    let lastSeenId = response.clips.reduce(
      (highest, clip) => Math.max(highest, clip.id),
      0,
    );

    try {
      const bootstrapDelta = await transport.pollClips(
        nextRoomCode,
        lastSeenId,
      );
      if (bootstrapDelta.clips.length > 0) {
        const additions: SessionClip[] = bootstrapDelta.clips.map((clip) => ({
          ...clip,
          direction:
            clip.senderId === senderIdRef.current ? "outgoing" : "incoming",
        }));
        nextHistory = mergeHistory(nextHistory, additions);
        lastSeenId = bootstrapDelta.clips.reduce(
          (highest, clip) => Math.max(highest, clip.id),
          lastSeenId,
        );
      }
    } catch {
      // Ignore bootstrap delta errors and fall back to the initial snapshot.
    }

    setRoomCode(nextRoomCode);
    setHistory(nextHistory);
    setStatus("live");
    setEditorText("");
    setShowQrSheet(false);
    lastSeenIdRef.current = lastSeenId;
    updateUrl(nextRoomCode);
    startRealtime(nextRoomCode);
  }

  async function createRoom() {
    setIsBusy(true);
    try {
      const response = await createRoomRequest();
      await hydrateRoom(response.code);
      pushToast("Room created!", "success");
    } catch (error) {
      setStatus("error");
      pushToast(
        error instanceof Error ? error.message : "Could not create room.",
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function joinExistingRoom(nextRoomCode: string, fromLink = false) {
    const normalized = normalizeRoomCode(nextRoomCode);
    if (!validateRoomCode(normalized)) {
      pushToast("Enter a valid 6-character room code.", "info");
      return;
    }

    setIsBusy(true);
    try {
      await hydrateRoom(normalized);
      pushToast(
        fromLink ? "Joined room from link." : "Joined room.",
        "success",
      );
    } catch (error) {
      setStatus("error");
      setRoomCode(null);
      updateUrl(null);
      pushToast(
        error instanceof Error ? error.message : "Room not found.",
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function leaveRoom() {
    files.reset();
    setRealtimeReady(false);
    stopPolling();
    stopStream();
    clearSyncReset();
    transport.disconnect();
    setRoomCode(null);
    setHistory([]);
    setEditorText("");
    setJoinCode("");
    setShowQrSheet(false);
    setStatus("offline");
    lastSeenIdRef.current = 0;
    realtimeRetryCountRef.current = 0;
    realtimeOpenedRef.current = false;
    clearRealtimeRetry();
    updateUrl(null);
    pushToast("Left room.", "info");
  }

  async function pollForUpdates(nextRoomCode: RoomCode) {
    try {
      const response = await transport.pollClips(
        nextRoomCode,
        lastSeenIdRef.current,
      );
      const incoming = response.clips.filter(
        (clip) => clip.senderId !== senderIdRef.current,
      );

      if (response.clips.length > 0) {
        lastSeenIdRef.current = response.clips.reduce(
          (highest, clip) => Math.max(highest, clip.id),
          lastSeenIdRef.current,
        );
      }

      if (incoming.length === 0) {
        return;
      }

      const additions: SessionClip[] = incoming.map((clip) => ({
        ...clip,
        direction: "incoming",
      }));

      applyIncomingClips(additions.reverse());
    } catch (error) {
      setStatus("error");
      pushToast(
        error instanceof Error ? error.message : "Polling failed.",
        "error",
      );
    }
  }

  async function sendClip() {
    if (!roomCodeRef.current) {
      return;
    }

    const text = editorText.trim();
    if (!text) {
      pushToast("Nothing to send.", "info");
      return;
    }

    setIsBusy(true);
    try {
      const response = await transport.sendClip(roomCodeRef.current, {
        text,
        senderId: senderIdRef.current,
      });

      const sessionClip: SessionClip = {
        ...response.clip,
        direction: "outgoing",
      };

      setHistory((current) => mergeHistory(current, [sessionClip]));
      setEditorText("");
      lastSeenIdRef.current = Math.max(lastSeenIdRef.current, response.clip.id);
      markSyncing();
      pushToast("Sent!", "success");
    } catch (error) {
      setStatus("error");
      pushToast(
        error instanceof Error ? error.message : "Could not send clip.",
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function pasteFromDevice() {
    try {
      const text = await readClipboard();
      setEditorText(text);
    } catch {
      pushToast(
        "Clipboard access denied. Paste manually with Ctrl/Cmd+V.",
        "info",
      );
    }
  }

  function shareFiles(list: FileList | File[] | null) {
    const selected = list ? Array.from(list) : [];
    if (selected.length === 0) {
      return;
    }
    if (!realtimeReady) {
      pushToast("File transfer needs a live connection.", "info");
      return;
    }
    files.offerFiles(selected);
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length === 0) {
      return;
    }
    event.preventDefault();
    shareFiles(pasted);
  }

  function hasDraggedFiles(event: ReactDragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = realtimeReady ? "copy" : "none";
    setDragActive(true);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    setDragActive(false);
    shareFiles(event.dataTransfer.files);
  }

  async function copyHistoryItem(text: string) {
    try {
      await writeClipboard(text);
      pushToast("Clip copied!", "success");
    } catch {
      pushToast("Could not copy clip.", "error");
    }
  }

  const joined = Boolean(roomCode);
  const roomShareUrl = roomCode
    ? buildRoomUrl(
        roomCode,
        typeof window !== "undefined" ? window.location.href : "",
      )
    : "";
  const qrCodeUrl = roomShareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(roomShareUrl)}`
    : "";
  const panelSurfaceStyle = {
    background:
      "linear-gradient(180deg, var(--surface-elevated), transparent 22%), var(--panel-fill)",
  };
  const headerSurfaceStyle = {
    background: "color-mix(in srgb, var(--bg) 82%, transparent)",
  };
  const toastSurfaceStyle = {
    background: "color-mix(in srgb, var(--surface) 96%, transparent)",
  };
  const buttonBaseClass =
    "inline-flex items-center justify-center gap-2.5 rounded-[3px] border px-6 py-3.5 text-[13px] uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none";
  const primaryButtonClass = cx(
    buttonBaseClass,
    "min-h-13.5 border-(--primary-border) bg-(--primary-bg) font-bold text-(--primary-text) hover:-translate-y-px hover:bg-(--primary-hover-bg) focus-visible:-translate-y-px focus-visible:bg-(--primary-hover-bg) sm:min-h-13 md:min-h-12",
  );
  const secondaryButtonClass = cx(
    buttonBaseClass,
    "min-h-13.5 border-(--border-active) bg-transparent text-(--text-dim) hover:border-(--accent) hover:text-(--accent) focus-visible:border-(--accent) focus-visible:text-(--accent) sm:min-h-13 md:min-h-12",
  );
  const actionButtonClass =
    "inline-flex min-h-9.5 items-center justify-center gap-1.5 rounded-xs border border-(--border-active) bg-transparent px-3.5 py-2 text-[11px] uppercase tracking-[0.08em] text-(--text-dim) transition hover:border-(--text-dim) hover:text-(--text) focus-visible:border-(--text-dim) focus-visible:text-(--text) max-[430px]:w-full";
  const panelToolClass =
    "min-h-7.5 rounded-xs border border-transparent px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-(--text-muted) transition hover:border-(--border-active) hover:text-(--text) focus-visible:border-(--border-active) focus-visible:text-(--text)";
  const panelAccentClass =
    "border-(--accent-button-border) bg-(--accent-button-bg) font-bold text-(--accent-button-text) hover:border-(--accent-button-hover-border) hover:bg-(--accent-button-hover-bg) focus-visible:border-(--accent-button-hover-border) focus-visible:bg-(--accent-button-hover-bg) hover:text-(--accent-button-text)";

  return (
    <>
      <div className="flex min-h-screen flex-col">
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b px-3.5 py-3 backdrop-blur-[14px] sm:px-5 sm:py-3.5 md:px-8 md:py-4.5"
          style={headerSurfaceStyle}
        >
          <div
            className="text-[17px] font-extrabold tracking-[-0.04em] md:text-[20px] md:tracking-[-0.03em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            CLIP
            <span className="text-(--logo-accent)">LINK</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
            <div
              className="inline-flex items-center gap-1.25 text-[9px] uppercase tracking-[0.04em] text-(--text-muted) sm:gap-1.5 sm:text-[10px] sm:tracking-[0.06em] md:gap-2 md:text-[11px] md:tracking-[0.08em]"
              aria-live="polite"
            >
              <div
                className={cn(
                  "h-1.75 w-1.75 rounded-full bg-(--text-muted) transition-[background,box-shadow] duration-200",
                  status === "live" &&
                    "bg-(--success) shadow-[0_0_10px_var(--success)]",
                  status === "syncing" &&
                    "animate-[pulse_1s_infinite] bg-(--accent) shadow-[0_0_10px_var(--accent)]",
                  status === "error" &&
                    "bg-(--danger) shadow-[0_0_10px_rgb(255_68_68/35%)]",
                )}
              />
              <span>{statusLabel(status)}</span>
            </div>
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-(--border-active) bg-white/2 p-0 text-(--text-dim) transition hover:border-(--accent) hover:text-(--text) focus-visible:border-(--accent) focus-visible:text-(--text) md:min-h-8.5 md:min-w-8.5 md:px-2.75 md:py-1.5"
              type="button"
              onClick={toggleTheme}
            >
              <IconTheme
                theme={mounted && resolvedTheme === "light" ? "light" : "dark"}
              />
            </button>
          </div>
        </header>

        <main className="flex flex-1 justify-center px-3 py-5.5 pb-12 sm:px-4 sm:py-7 sm:pb-14 md:px-6 md:py-14 md:pb-18">
          <div className="w-full max-w-190">
            {!joined ? (
              <section className="mx-auto flex max-w-180 flex-col items-center gap-5 sm:gap-6 md:gap-9">
                <div className="max-w-full text-center md:max-w-175">
                  <h1
                    className={cx(
                      "mb-4 text-[clamp(1.7rem,15vw,2.45rem)] leading-[0.98] text-(--text) sm:text-[clamp(2rem,11vw,3rem)] sm:leading-[0.96] md:text-[clamp(4.8rem,7.1vw,6.35rem)] md:leading-[0.82]",
                      mounted && resolvedTheme === "light"
                        ? "tracking-[-0.075em]"
                        : "tracking-tighter sm:tracking-[-0.06em] md:tracking-[-0.07em]",
                    )}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    <span className="block md:max-w-[6.2ch] md:mx-auto">
                      Copy here.
                    </span>
                    <em className="mt-[0.08em] block not-italic text-(--hero-highlight) sm:mt-[0.04em] md:mx-auto md:max-w-[7.3ch]">
                      Paste anywhere.
                    </em>
                  </h1>
                  <p className="m-0 text-[11px] leading-[1.75] text-(--text-dim) sm:text-[12px] md:text-[13px] md:leading-[1.8]">
                    Create a room. Share the code.
                    <br />
                    Your clipboard, synced across devices.
                  </p>
                </div>

                <div className="flex w-full max-w-full flex-col gap-3 md:max-w-170">
                  <button
                    className={primaryButtonClass}
                    onClick={() => void createRoom()}
                    disabled={isBusy}
                  >
                    <IconPlus />
                    New Room
                  </button>

                  <div className="flex w-full items-center gap-2 text-[10px] uppercase tracking-widest text-(--text-muted) sm:text-[11px] sm:gap-3">
                    <span className="h-px flex-1 bg-(--border)" />
                    <span>or join existing</span>
                    <span className="h-px flex-1 bg-(--border)" />
                  </div>

                  <div className="flex flex-col gap-2 sm:gap-2.5 md:flex-row">
                    <input
                      className="min-h-13.5 flex-1 rounded-[3px] border border-(--border-active) bg-(--surface) px-4 py-3 text-center text-[18px] font-bold uppercase tracking-[0.16em] text-(--text) outline-none transition placeholder:text-[13px] placeholder:font-normal placeholder:tracking-[0.08em] placeholder:text-(--text-muted) focus:border-(--accent) sm:min-h-13"
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={6}
                      placeholder="Enter code"
                      value={joinCode}
                      onChange={(event) =>
                        setJoinCode(normalizeRoomCode(event.target.value))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void joinExistingRoom(joinCode);
                        }
                      }}
                    />
                    <button
                      className={secondaryButtonClass}
                      onClick={() => void joinExistingRoom(joinCode)}
                      disabled={isBusy}
                    >
                      Join
                    </button>
                  </div>

                  <p className="-mt-1 max-w-160 text-center text-[10px] leading-[1.8] text-(--text-muted) md:text-[11px] md:leading-[1.7]">
                    No sign-up, no install, no saved history. Rooms expire after
                    6 hours of inactivity.
                  </p>
                </div>
              </section>
            ) : (
              <section className="flex w-full flex-col gap-4.5 md:gap-6">
                <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-start">
                  <div className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
                    <span className="text-[11px] uppercase tracking-widest text-(--text-muted)">
                      Room
                    </span>
                    <button
                      className="cursor-pointer rounded-xs border border-(--accent-dim) bg-transparent px-2.5 py-1.5 text-[16px] font-bold tracking-[0.14em] text-(--room-badge) transition hover:bg-(--accent-dim) focus-visible:bg-(--accent-dim) sm:text-[18px] md:px-3 md:text-[20px] md:tracking-[0.2em]"
                      type="button"
                      title="Copy room link"
                      onClick={() => void copyRoomLink(roomCode!)}
                    >
                      {roomCode}
                    </button>
                  </div>

                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    <button
                      className={actionButtonClass}
                      type="button"
                      onClick={() => void shareRoom(roomCode!)}
                    >
                      <IconCopy />
                      Share Link
                    </button>
                    <button
                      className={actionButtonClass}
                      type="button"
                      onClick={openQrSheet}
                    >
                      <IconQr />
                      QR
                    </button>
                    <button
                      className={cx(
                        actionButtonClass,
                        "hover:border-(--danger) hover:text-(--danger) focus-visible:border-(--danger) focus-visible:text-(--danger)",
                      )}
                      type="button"
                      onClick={leaveRoom}
                    >
                      Leave
                    </button>
                  </div>
                </div>

                <div
                  className="relative overflow-hidden rounded-sm border border-(--border) shadow-(--shadow)"
                  style={panelSurfaceStyle}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {dragActive ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm border-2 border-dashed border-(--accent) bg-(--accent-dim) px-4 text-center text-[12px] uppercase tracking-widest text-(--accent) backdrop-blur-[2px]">
                      {realtimeReady
                        ? "Drop to share peer-to-peer"
                        : "File transfer needs a live connection"}
                    </div>
                  ) : null}
                  <div className="flex flex-col items-stretch justify-between gap-4 border-b border-(--border) bg-(--surface-elevated) px-4 py-2.5 md:flex-row md:items-center">
                    <span className="hidden text-[10px] uppercase tracking-[0.12em] text-(--text-muted) md:inline">
                      Clipboard
                    </span>
                    <div className="flex w-full flex-wrap items-center justify-start gap-1.5 md:w-auto md:flex-nowrap md:justify-end">
                      <button
                        className={cn(
                          panelToolClass,
                          "inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-[0.55]",
                        )}
                        type="button"
                        disabled={!realtimeReady}
                        title={
                          realtimeReady
                            ? "Share files peer-to-peer. Nothing is uploaded or stored."
                            : "File transfer needs a live connection."
                        }
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <IconPaperclip />
                        Attach
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                          shareFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                      <button
                        className={panelToolClass}
                        type="button"
                        onClick={() => void pasteFromDevice()}
                      >
                        Paste from device
                      </button>
                      <button
                        className={panelToolClass}
                        type="button"
                        onClick={() => setEditorText("")}
                      >
                        Clear
                      </button>
                      <button
                        className={cn(
                          panelToolClass,
                          panelAccentClass,
                          "min-w-20.5 px-4",
                        )}
                        type="button"
                        onClick={() => void sendClip()}
                        disabled={isBusy}
                      >
                        Send ↑
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="min-h-50 w-full resize-y border-0 bg-transparent px-4 py-4 text-[13px] leading-[1.7] text-(--text) outline-none placeholder:text-(--text-muted) sm:min-h-50 md:min-h-60 md:px-5 md:py-5 md:text-[14px]"
                    value={editorText}
                    placeholder="Type or paste anything here, then hit Send to sync it across devices. Drop or paste files to share them peer-to-peer..."
                    onChange={(event) => setEditorText(event.target.value)}
                    onPaste={handlePaste}
                  />
                  <div className="border-t border-(--border) px-4 py-2 text-left text-[10px] tracking-[0.06em] text-(--text-muted) md:text-right md:px-4">
                    {formatCharCount(editorText.length)}
                  </div>
                </div>

                <FileTransfers
                  items={files.items}
                  canTransfer={realtimeReady}
                  surfaceStyle={panelSurfaceStyle}
                  onDownload={files.request}
                  onCancel={files.cancel}
                  onSave={files.save}
                  onRevoke={files.revoke}
                  onDismiss={files.dismiss}
                />

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-(--text-muted)">
                    <span>History</span>
                    <span className="h-px flex-1 bg-(--border)" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {history.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-(--border-active) px-8 py-8 text-center text-[12px] tracking-wider text-(--text-muted)">
                        No clips yet. Send something.
                      </div>
                    ) : (
                      history.map((clip) => (
                        <div
                          key={clip.id}
                          className={cx(
                            "grid animate-[fade-in_0.3s_ease] grid-cols-[48px_1fr] items-start gap-2.5 rounded-sm border border-(--border) p-3 shadow-(--shadow) md:flex md:items-start md:gap-3 md:px-4 md:py-3",
                            clip.direction === "incoming"
                              ? "border-l-2 border-l-(--incoming-border)"
                              : "border-l-2 border-l-(--text-muted)",
                          )}
                          style={panelSurfaceStyle}
                        >
                          <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
                            <span
                              className={cx(
                                "text-[9px] uppercase tracking-widest",
                                clip.direction === "incoming"
                                  ? "text-(--incoming-text)"
                                  : "text-(--text-muted)",
                              )}
                            >
                              {clip.direction === "incoming" ? "↓ IN" : "↑ OUT"}
                            </span>
                            <span className="text-[9px] uppercase tracking-widest text-(--text-muted)">
                              {formatHistoryTime(clip.ts)}
                            </span>
                          </div>
                          <div className="min-w-0 text-[11px] leading-normal text-(--text-dim) truncate md:text-[12px]">
                            {truncatePreview(clip.text)}
                          </div>
                          <button
                            className="col-start-2 mt-1 min-h-8 justify-self-start rounded-xs border border-transparent px-2 py-1 text-[10px] text-(--text-muted) transition hover:border-(--border-active) hover:text-(--text) focus-visible:border-(--border-active) focus-visible:text-(--text) md:mt-0 md:shrink-0"
                            type="button"
                            onClick={() => void copyHistoryItem(clip.text)}
                          >
                            copy
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      <div
        className={cx(
          "pointer-events-none fixed inset-0 z-500 bg-(--flash-bg) transition-opacity duration-150",
          flashActive ? "opacity-100 duration-0" : "opacity-0",
        )}
      />

      {joined && showQrSheet ? (
        <div
          className="fixed inset-0 z-800 flex items-end justify-center bg-black/60 p-3 backdrop-blur-[10px] sm:p-6 sm:items-center"
          role="presentation"
          onClick={closeQrSheet}
        >
          <div
            className="flex w-full max-w-105 flex-col gap-4.5 rounded-t-[18px] rounded-b-lg border border-(--border-active) p-4.5 shadow-(--shadow) sm:rounded-2xl sm:p-5"
            style={panelSurfaceStyle}
            role="dialog"
            aria-modal="true"
            aria-label="Room QR code"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col items-stretch gap-3 max-[430px]:items-stretch sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-(--text-muted)">
                  Scan to join
                </p>
                <h2 className="m-0 text-[20px] tracking-[0.14em] text-(--accent) sm:text-[24px]">
                  {roomCode}
                </h2>
              </div>
              <button
                className={actionButtonClass}
                type="button"
                onClick={closeQrSheet}
              >
                Close
              </button>
            </div>

            <div className="flex justify-center rounded-xl border border-(--border) bg-white p-4">
              <Image
                src={qrCodeUrl}
                alt={`QR code for room ${roomCode}`}
                width={280}
                height={280}
                unoptimized
              />
            </div>

            <p className="m-0 text-[12px] leading-[1.7] text-(--text-dim)">
              Scan this code or copy the link to open the room instantly on
              another device.
            </p>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <button
                className={secondaryButtonClass}
                type="button"
                onClick={() => void copyRoomLink(roomCode!)}
              >
                Copy Link
              </button>
              <button
                className={primaryButtonClass}
                type="button"
                onClick={() => void shareRoom(roomCode!)}
              >
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="fixed bottom-8 left-1/2 z-999 flex -translate-x-1/2 flex-col items-center gap-2.5"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "min-w-[min(92vw,320px)] animate-[toast-in_0.25s_cubic-bezier(0.34,1.56,0.64,1)] rounded-[3px] border px-4 py-2.5 text-[12px] tracking-[0.04em] shadow-(--shadow)",
              toast.tone === "success" &&
                "border-(--success) text-(--success)",
              toast.tone === "info" &&
                "border-(--accent) text-(--accent)",
              toast.tone === "error" &&
                "border-(--danger) text-(--danger)",
            )}
            style={toastSurfaceStyle}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
}
