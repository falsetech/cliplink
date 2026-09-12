"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";

import { FileTransfers } from "@/components/cliplink/file-transfers";
import { useFileTransfer } from "@/components/cliplink/use-file-transfer";
import {
  IconArrowUp,
  IconCopy,
  IconPaperclip,
  IconPlus,
  IconQr,
  IconTheme,
} from "@/components/cliplink/icons";
import { QrSheet } from "@/components/cliplink/qr-sheet";
import { Toasts } from "@/components/cliplink/toasts";
import { useToasts } from "@/components/cliplink/use-toasts";

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
import { haptic } from "@/lib/cliplink/haptics";
import { createRoomRequest } from "@/lib/cliplink/http";
import { buildRoomUrl, normalizeRoomCode } from "@/lib/cliplink/room-code";
import { createRandomId, getSessionSenderId } from "@/lib/cliplink/session";
import type { RoomCode, RoomStatus, SessionClip } from "@/lib/cliplink/types";
import { validateRoomCode } from "@/lib/cliplink/validation";
import { createWebSocketTransport } from "@/lib/cliplink/ws";
import { cn } from "@/lib/utils";

/** Stable no-op subscribe for the `useSyncExternalStore` hydration guard. */
const subscribeToNothing = () => () => {};

const transport = createWebSocketTransport();

// Identifies this page load for peer-to-peer signaling. Unlike the sender id it
// isn't kept in sessionStorage, so duplicated tabs don't share an identity.
const peerId = createRandomId();

/** How long the localised arrival highlight stays on the panel and new row. */
const ARRIVAL_CUE_MS = 500;
/** A destructive confirmation that never times out is a trap of its own. */
const CONFIRM_WINDOW_MS = 4000;

function clearTimer(ref: React.RefObject<number | null>) {
  if (ref.current) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
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
  const [arrivalId, setArrivalId] = useState<number | null>(null);
  const [enteringIds, setEnteringIds] = useState<Set<number>>(new Set());
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [clearedText, setClearedText] = useState("");
  // Hydration guard for theme-dependent rendering: false on the server and on
  // the first client render, true thereafter.
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [scrolled, setScrolled] = useState(false);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const { resolvedTheme, setTheme } = useTheme();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const files = useFileTransfer({
    peerId,
    sendSignal: transport.sendSignal,
    pushToast,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);

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
  const arrivalResetRef = useRef<number | null>(null);
  const confirmResetRef = useRef<number | null>(null);
  const clearedResetRef = useRef<number | null>(null);

  useEffect(() => {
    senderIdRef.current = getSessionSenderId();
  }, []);

  // The header's edge treatment appears only once content is actually beneath
  // it. A sentinel costs nothing; a scroll listener would run on every frame.
  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
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
    const timers = [
      syncResetRef,
      realtimeRetryRef,
      arrivalResetRef,
      confirmResetRef,
      clearedResetRef,
    ];
    const polling = pollingRef;
    const stream = streamCleanupRef;

    return () => {
      if (polling.current) {
        window.clearInterval(polling.current);
        polling.current = null;
      }
      stream.current?.();
      stream.current = null;
      for (const timer of timers) {
        clearTimer(timer);
      }
      transport.disconnect();
    };
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
    clearTimer(realtimeRetryRef);
  }

  function clearSyncReset() {
    clearTimer(syncResetRef);
  }

  function clearUndoBuffer() {
    setClearedText("");
    clearTimer(clearedResetRef);
  }

  function markSyncing() {
    clearSyncReset();
    setStatus("syncing");
    syncResetRef.current = window.setTimeout(() => {
      setStatus("live");
      syncResetRef.current = null;
    }, 600);
  }

  /**
   * Highlights the panel and the row that just landed. This replaces a
   * full-viewport flash: an abrupt whole-screen brightness jump on every
   * incoming message is a photosensitivity risk, and it drew the eye away from
   * the thing that actually changed.
   */
  function markArrival(clipId: number) {
    clearTimer(arrivalResetRef);
    // Clearing for a frame first restarts the animation. Without it a second
    // clip arriving inside the cue window leaves the class already applied, so
    // the panel never flashes again and the arrival goes unmarked.
    setArrivalId(null);
    window.requestAnimationFrame(() => {
      setArrivalId(clipId);
      arrivalResetRef.current = window.setTimeout(() => {
        setArrivalId(null);
        arrivalResetRef.current = null;
      }, ARRIVAL_CUE_MS);
    });
  }

  function markEntering(ids: number[]) {
    setEnteringIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        next.add(id);
      }
      return next;
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
    markEntering(clips.map((clip) => clip.id));
    let latest = clips[0];
    for (const clip of clips) {
      if (clip.id > latest.id) {
        latest = clip;
      }
    }
    markArrival(latest.id);
    haptic("arrive");
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
          pushToast("Realtime connection restored.", "success", {
            unprompted: true,
          });
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
            { unprompted: true },
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
        return;
      }

      await writeClipboard(url);
      pushToast("Room link copied!", "success");
    } catch {
      pushToast("Could not share the room link.", "error");
    }
  }

  async function autoCopyIncoming(text: string) {
    try {
      await writeClipboard(text);
      pushToast("Received clip — copied!", "success", { unprompted: true });
    } catch {
      pushToast("Received clip. Clipboard access was blocked.", "info", {
        unprompted: true,
      });
    }
  }

  async function hydrateRoom(nextRoomCode: RoomCode) {
    // Claimed up front, because hydrating writes ?room= to the URL and the
    // searchParams effect would otherwise read that back as a fresh link and
    // join the room a second time — two connects, two sockets, two toasts.
    initializedRoomRef.current = nextRoomCode;
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
    clearUndoBuffer();
    setShowQrSheet(false);
    // Rows present at hydration are not arrivals, so they must not animate in.
    setEnteringIds(new Set());
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
      initializedRoomRef.current = null;
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
      initializedRoomRef.current = null;
      updateUrl(null);
      pushToast(
        error instanceof Error ? error.message : "Room not found.",
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Leaving discards the room and its history with no way back, so it asks
   * once. The confirmation lapses on its own rather than sticking around as a
   * second thing to dismiss.
   */
  function requestLeave() {
    if (!confirmingLeave) {
      setConfirmingLeave(true);
      clearTimer(confirmResetRef);
      confirmResetRef.current = window.setTimeout(() => {
        setConfirmingLeave(false);
        confirmResetRef.current = null;
      }, CONFIRM_WINDOW_MS);
      return;
    }

    clearTimer(confirmResetRef);
    setConfirmingLeave(false);
    leaveRoom();
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
    clearUndoBuffer();
    setJoinCode("");
    setShowQrSheet(false);
    setStatus("offline");
    setEnteringIds(new Set());
    initializedRoomRef.current = null;
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
      markEntering([response.clip.id]);
      setEditorText("");
      clearUndoBuffer();
      lastSeenIdRef.current = Math.max(lastSeenIdRef.current, response.clip.id);
      markSyncing();
      // The new history row and the status dot already confirm the send, so the
      // haptic is the only extra channel it needs.
      haptic("commit");
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
      clearUndoBuffer();
    } catch {
      pushToast(
        "Clipboard access denied. Paste manually with Ctrl/Cmd+V.",
        "info",
      );
    }
  }

  /**
   * Enter commits the clip, because sending is what this box is for. A newline
   * is still reachable with Ctrl/Cmd+Enter, and with Shift+Enter since that is
   * the muscle memory people arrive with.
   */
  function handleEditorKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd, value } = target;
      const next =
        value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd);
      setEditorText(next);
      clearUndoBuffer();
      // Restore the caret after React has committed the new value.
      requestAnimationFrame(() => {
        target.selectionStart = selectionStart + 1;
        target.selectionEnd = selectionStart + 1;
      });
      return;
    }

    event.preventDefault();
    void sendClip();
  }

  function clearEditor() {
    if (!editorText) {
      return;
    }
    setClearedText(editorText);
    setEditorText("");
    clearTimer(clearedResetRef);
    clearedResetRef.current = window.setTimeout(() => {
      setClearedText("");
      clearedResetRef.current = null;
    }, CONFIRM_WINDOW_MS * 2);
  }

  function undoClear() {
    setEditorText(clearedText);
    clearUndoBuffer();
  }

  function handleEditorChange(nextText: string) {
    setEditorText(nextText);
    clearUndoBuffer();
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
  const headerSurfaceStyle = { background: "var(--chrome-bg)" };

  // Transitions name their properties: the bare `transition` utility also spans
  // `filter` and `backdrop-filter`, which is expensive on blurred chrome and
  // wanted by none of these controls.
  const buttonBaseClass =
    "inline-flex items-center justify-center gap-2 rounded-control border px-6 py-3.5 text-sm tracking-label uppercase transition-[color,background-color,border-color,translate,scale] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100";
  const primaryButtonClass = cn(
    buttonBaseClass,
    "min-h-12 border-(--primary-border) bg-(--primary-bg) font-bold text-(--primary-text) hover:-translate-y-px hover:bg-(--primary-hover-bg) focus-visible:-translate-y-px focus-visible:bg-(--primary-hover-bg)",
  );
  const secondaryButtonClass = cn(
    buttonBaseClass,
    "min-h-12 border-line-strong bg-transparent text-dim hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent",
  );
  // 44px on touch, 40px once a precise pointer is available.
  const actionButtonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-3.5 py-2 text-2xs tracking-label text-dim uppercase transition-[color,border-color,scale] duration-150 ease-out active:scale-[0.96] md:min-h-10 max-[430px]:w-full";
  const panelToolClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-transparent px-3 py-1 text-2xs tracking-label text-muted uppercase transition-[color,border-color,background-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 md:min-h-10";
  const panelAccentClass =
    "border-(--accent-button-border) bg-(--accent-button-bg) font-bold text-(--accent-button-text) hover:border-(--accent-button-hover-border) hover:bg-(--accent-button-hover-bg) hover:text-(--accent-button-text) focus-visible:border-(--accent-button-hover-border) focus-visible:bg-(--accent-button-hover-bg)";
  const rowClass =
    "relative grid grid-cols-[48px_1fr] items-start gap-2.5 rounded-surface border border-line p-3 shadow-row md:flex md:items-start md:gap-3 md:px-4 md:py-3";

  return (
    <>
      <div className="flex min-h-screen flex-col">
        <header
          data-scrolled={scrolled}
          className="sticky top-0 z-30 flex items-center justify-between px-3.5 py-3 backdrop-blur-(--chrome-blur) after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-page-top after:to-transparent after:opacity-0 after:transition-opacity after:duration-200 after:content-[''] data-[scrolled=true]:after:opacity-70 sm:px-5 sm:py-3.5 md:px-8 md:py-4.5"
          style={headerSurfaceStyle}
        >
          <div className="font-display text-xl font-extrabold tracking-display md:text-2xl">
            CLIP
            <span className="text-logo">LINK</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3">
            <div
              className="inline-flex items-center gap-1.5 text-2xs tracking-label text-muted uppercase md:gap-2"
              aria-live="polite"
            >
              <span
                className={cn(
                  "relative h-1.75 w-1.75 rounded-full bg-muted transition-colors duration-200",
                  // The glow is an opacity-animated pseudo-element rather than a
                  // transitioned box-shadow, which the compositor cannot handle.
                  "after:absolute after:inset-0 after:rounded-full after:opacity-0 after:shadow-[0_0_10px_currentColor] after:transition-opacity after:duration-200 after:content-['']",
                  status === "live" && "bg-success text-success after:opacity-100",
                  status === "syncing" &&
                    "animate-[pulse_1s_ease-in-out_infinite] bg-accent text-accent after:opacity-100",
                  status === "error" && "bg-danger text-danger after:opacity-100",
                )}
              />
              <span>{statusLabel(status)}</span>
            </div>
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong bg-white/2 p-0 text-dim transition-[color,border-color,scale] duration-150 ease-out hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:text-fg active:scale-[0.96] md:min-h-10 md:min-w-10"
              type="button"
              aria-label={
                mounted && resolvedTheme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              onClick={toggleTheme}
            >
              <IconTheme
                size={16}
                theme={mounted && resolvedTheme === "light" ? "light" : "dark"}
              />
            </button>
          </div>
        </header>

        <div ref={scrollSentinelRef} aria-hidden="true" className="h-px" />

        <main className="flex flex-1 justify-center px-3 py-5.5 pb-12 sm:px-4 sm:py-7 sm:pb-14 md:px-6 md:py-14 md:pb-18">
          <div className="w-full max-w-190">
            {!joined ? (
              <section className="mx-auto flex max-w-180 flex-col items-center gap-5 sm:gap-6 md:gap-9">
                <div className="max-w-full text-center md:max-w-175">
                  <h1 className="font-display mb-4 text-[clamp(1.7rem,15vw,2.45rem)] leading-[0.98] tracking-display text-fg sm:text-[clamp(2rem,11vw,3rem)] sm:leading-[0.96] md:text-[clamp(4.8rem,7.1vw,6.35rem)] md:leading-[0.82]">
                    <span className="block text-balance md:mx-auto md:max-w-[6.2ch]">
                      Copy here.
                    </span>
                    <span className="mt-[0.08em] block text-balance text-hero sm:mt-[0.04em] md:mx-auto md:max-w-[7.3ch]">
                      Paste anywhere.
                    </span>
                  </h1>
                  <p className="m-0 text-2xs text-pretty text-dim sm:text-xs md:text-sm">
                    Create a room. Share the code. Your clipboard, synced across
                    devices.
                  </p>
                </div>

                <div className="flex w-full max-w-full flex-col gap-3 md:max-w-170">
                  <button
                    className={primaryButtonClass}
                    onClick={() => void createRoom()}
                    disabled={isBusy}
                  >
                    <IconPlus size={14} weight="bold" />
                    New Room
                  </button>

                  <div className="flex w-full items-center gap-2 text-2xs tracking-label-wide text-muted uppercase sm:gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <span>or join existing</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>

                  <div className="flex flex-col gap-2 sm:gap-2.5 md:flex-row">
                    <input
                      className="min-h-12 flex-1 rounded-control border border-line-strong bg-surface px-4 py-3 text-center text-xl font-bold tracking-code text-fg uppercase tabular-nums outline-none transition-colors duration-150 placeholder:text-sm placeholder:font-normal placeholder:tracking-label placeholder:text-muted focus:border-accent"
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={6}
                      placeholder="Enter code"
                      aria-label="Room code"
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

                  <p className="-mt-1 max-w-160 text-center text-2xs text-pretty text-muted">
                    No sign-up, no install, no saved history. Rooms expire after
                    6 hours of inactivity.
                  </p>
                </div>
              </section>
            ) : (
              <section className="flex w-full flex-col gap-4.5 md:gap-6">
                <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-start">
                  <div className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
                    <span className="text-2xs tracking-label-wide text-muted uppercase">
                      Room
                    </span>
                    <button
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-accent-dim bg-transparent px-2.5 text-lg font-bold tracking-code text-room tabular-nums transition-[background-color,scale] duration-150 ease-out hover:bg-accent-dim focus-visible:bg-accent-dim active:scale-[0.96] md:min-h-10 md:px-3 md:text-xl"
                      type="button"
                      aria-label={`Copy invite link for room ${roomCode}`}
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
                      <IconCopy size={12} />
                      Share Link
                    </button>
                    <button
                      ref={qrTriggerRef}
                      className={actionButtonClass}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={showQrSheet}
                      onClick={() => setShowQrSheet(true)}
                    >
                      <IconQr size={12} />
                      QR
                    </button>
                    <button
                      className={cn(
                        actionButtonClass,
                        confirmingLeave
                          ? "border-danger text-danger"
                          : "hover:border-danger hover:text-danger focus-visible:border-danger focus-visible:text-danger",
                      )}
                      type="button"
                      onClick={requestLeave}
                    >
                      {confirmingLeave ? "Confirm leave" : "Leave"}
                    </button>
                  </div>
                </div>

                <div
                  className={cn(
                    "relative overflow-hidden rounded-surface border border-line shadow-row",
                    arrivalId !== null && "arrival-cue",
                  )}
                  style={panelSurfaceStyle}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-surface border-2 border-dashed border-accent bg-accent-dim px-4 text-center text-xs tracking-label-wide text-accent uppercase backdrop-blur-[2px]",
                      "transition-opacity duration-150 ease-out",
                      dragActive ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden={!dragActive}
                  >
                    {realtimeReady
                      ? "Drop to share peer-to-peer"
                      : "File transfer needs a live connection"}
                  </div>
                  <div className="flex flex-col items-stretch justify-between gap-4 border-b border-line bg-raised px-4 py-2.5 md:flex-row md:items-center">
                    <span className="hidden text-2xs tracking-label-wide text-muted uppercase md:inline">
                      Clipboard
                    </span>
                    <div className="flex w-full flex-wrap items-center justify-start gap-1.5 md:w-auto md:flex-nowrap md:justify-end">
                      <button
                        className={panelToolClass}
                        type="button"
                        disabled={!realtimeReady}
                        title={
                          realtimeReady
                            ? "Share files peer-to-peer. Nothing is uploaded or stored."
                            : "File transfer needs a live connection."
                        }
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <IconPaperclip size={12} />
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
                      {clearedText ? (
                        <button
                          className={cn(panelToolClass, "text-accent")}
                          type="button"
                          onClick={undoClear}
                        >
                          Undo clear
                        </button>
                      ) : (
                        <button
                          className={panelToolClass}
                          type="button"
                          disabled={!editorText}
                          onClick={clearEditor}
                        >
                          Clear text
                        </button>
                      )}
                      <button
                        className={cn(panelToolClass, panelAccentClass, "min-w-20.5 px-4")}
                        type="button"
                        onClick={() => void sendClip()}
                        disabled={isBusy}
                      >
                        Send
                        <IconArrowUp size={12} weight="bold" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="min-h-50 w-full resize-y border-0 bg-transparent px-4 py-4 text-sm text-fg outline-none placeholder:text-muted md:min-h-60 md:px-5 md:py-5 md:text-base"
                    value={editorText}
                    placeholder="Type or paste anything here, then hit Send to sync it across devices. Drop or paste files to share them peer-to-peer..."
                    aria-label="Clip text"
                    onChange={(event) => handleEditorChange(event.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    onPaste={handlePaste}
                  />
                  <div className="flex flex-col gap-1 border-t border-line px-4 py-2 text-2xs tracking-label text-muted md:flex-row md:items-center md:justify-between">
                    <span>
                      <kbd className="font-mono">Enter</kbd> to send ·{" "}
                      <kbd className="font-mono">Ctrl</kbd>+
                      <kbd className="font-mono">Enter</kbd> for a new line
                    </span>
                    <span className="tabular-nums">
                      {formatCharCount(editorText.length)}
                    </span>
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
                  <div className="flex items-center gap-2 text-2xs tracking-label-wide text-muted uppercase">
                    <span>History</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {history.length === 0 ? (
                      <div className="rounded-surface border border-dashed border-line-strong px-8 py-8 text-center text-xs tracking-label text-muted">
                        No clips yet. Send something.
                      </div>
                    ) : (
                      history.map((clip) => (
                        // The grid wrapper lets a new row open the list rather
                        // than teleporting every row beneath it down.
                        <div
                          key={clip.id}
                          className={cn(
                            "grid grid-rows-[1fr]",
                            enteringIds.has(clip.id) &&
                              "animate-[row-enter_260ms_var(--ease-out-quint)_both]",
                          )}
                        >
                          <div className="overflow-hidden">
                            <div
                              className={cn(
                                rowClass,
                                clip.direction === "incoming"
                                  ? "border-l-2 border-l-incoming-line"
                                  : "border-l-2 border-l-muted",
                                arrivalId === clip.id && "arrival-cue",
                              )}
                              style={panelSurfaceStyle}
                            >
                              <div className="flex min-w-13 flex-col gap-1 md:min-w-16">
                                <span
                                  className={cn(
                                    "text-2xs tracking-label uppercase",
                                    clip.direction === "incoming"
                                      ? "text-incoming"
                                      : "text-muted",
                                  )}
                                >
                                  {clip.direction === "incoming" ? "↓ IN" : "↑ OUT"}
                                </span>
                                <span className="text-2xs tracking-label text-muted uppercase tabular-nums">
                                  {formatHistoryTime(clip.ts)}
                                </span>
                              </div>
                              <div className="min-w-0 truncate text-2xs text-dim md:text-xs">
                                {truncatePreview(clip.text)}
                              </div>
                              <button
                                className="col-start-2 mt-1 inline-flex min-h-11 items-center justify-self-start rounded-control border border-transparent px-2 text-2xs text-muted transition-[color,border-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] md:mt-0 md:min-h-10 md:shrink-0"
                                type="button"
                                aria-label="Copy this clip"
                                onClick={() => void copyHistoryItem(clip.text)}
                              >
                                copy
                              </button>
                            </div>
                          </div>
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

      {joined ? (
        <QrSheet
          open={showQrSheet}
          roomCode={roomCode!}
          qrCodeUrl={qrCodeUrl}
          onClose={() => setShowQrSheet(false)}
          onCopyLink={() => void copyRoomLink(roomCode!)}
          onShare={() => void shareRoom(roomCode!)}
          primaryButtonClass={primaryButtonClass}
          secondaryButtonClass={secondaryButtonClass}
          surfaceStyle={panelSurfaceStyle}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
