"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";

import { ClipEditor } from "@/components/cliplink/clip-editor";
import { CommandPalette } from "@/components/cliplink/command-palette";
import { FileTransfers } from "@/components/cliplink/file-transfers";
import { HistoryList } from "@/components/cliplink/history-list";
import { IconTheme } from "@/components/cliplink/icons";
import { KeyPrompt } from "@/components/cliplink/key-prompt";
import { LandingView } from "@/components/cliplink/landing-view";
import { QrSheet } from "@/components/cliplink/qr-sheet";
import { createRoomActions } from "@/components/cliplink/room-actions";
import { RoomHeader } from "@/components/cliplink/room-header";
import { ShortcutsSheet } from "@/components/cliplink/shortcuts-sheet";
import { Toasts } from "@/components/cliplink/toasts";
import {
  chromeButtonClass,
  headerSurfaceStyle,
  panelSurfaceStyle,
} from "@/components/cliplink/ui";
import { useClipEditor } from "@/components/cliplink/use-clip-editor";
import { useRoomExpiry } from "@/components/cliplink/use-room-expiry";
import { useFileTransfer } from "@/components/cliplink/use-file-transfer";
import {
  clearTimer,
  peerId,
  transport,
  useRoomSession,
} from "@/components/cliplink/use-room-session";
import { usePresence } from "@/components/cliplink/use-presence";
import { useShortcuts } from "@/components/cliplink/use-shortcuts";
import { useToasts } from "@/components/cliplink/use-toasts";

import { writeClipboard } from "@/lib/cliplink/clipboard";
import { MAX_CLIP_CHARS } from "@/lib/cliplink/constants";
import {
  formatRoomKey,
  generateRoomKey,
  importRoomKey,
  type RoomKey,
} from "@/lib/cliplink/crypto";
import { RoomKeyMismatchError } from "@/lib/cliplink/encrypted-transport";
import { createRoomRequest } from "@/lib/cliplink/http";
import {
  buildRoomUrl,
  normalizeRoomCode,
  parseRoomKeyFromHash,
  roomKeyFragment,
} from "@/lib/cliplink/room-code";
import { getSessionSenderId } from "@/lib/cliplink/session";
import type { RoomCode, RoomStatus } from "@/lib/cliplink/types";
import { validateRoomCode } from "@/lib/cliplink/validation";
import { cn } from "@/lib/utils";

/** Stable no-op subscribe for the `useSyncExternalStore` hydration guard. */
const subscribeToNothing = () => () => {};

/** A destructive confirmation that never times out is a trap of its own. */
const CONFIRM_WINDOW_MS = 4000;

type StatusTone = "idle" | "good" | "busy" | "warn" | "bad";

/**
 * One source for the word and the colour, so they cannot disagree. Polling had
 * been reading as LIVE-green while the label said the connection was degraded
 * — the dot said everything was fine and the word said it was not.
 */
function statusFor(
  status: RoomStatus,
  realtimeReady: boolean,
): { label: string; tone: StatusTone } {
  switch (status) {
    case "live":
      return realtimeReady
        ? { label: "LIVE", tone: "good" }
        : { label: "POLLING", tone: "warn" };
    case "syncing":
      return { label: "SYNCING", tone: "busy" };
    case "error":
      return { label: "ERROR", tone: "bad" };
    default:
      return { label: "OFFLINE", tone: "idle" };
  }
}

const DOT_TONE: Record<StatusTone, string> = {
  idle: "",
  good: "bg-success text-success after:opacity-100",
  // Steady, not pulsing: polling is a settled state, not work in progress.
  warn: "bg-accent text-accent after:opacity-100",
  busy: "animate-[pulse_1s_ease-in-out_infinite] bg-accent text-accent after:opacity-100",
  bad: "bg-danger text-danger after:opacity-100",
};

export default function CliplinkApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [joinCode, setJoinCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // The room being joined by code alone, waiting on a key the link never
  // carried. `mismatch` distinguishes "we need a key" from "that one is wrong".
  const [keyPrompt, setKeyPrompt] = useState<{
    code: RoomCode;
    mismatch: boolean;
  } | null>(null);
  // The serialized key, for the surfaces that display it. State rather than a
  // ref because it is rendered — and it is already in the address bar, so this
  // is no wider an exposure than the fragment it came from.
  const [roomKeyEncoded, setRoomKeyEncoded] = useState<string | null>(null);

  // Hydration guard for theme-dependent rendering: false on the server and on
  // the first client render, true thereafter.
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const { resolvedTheme, setTheme } = useTheme();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const senderIdRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const confirmResetRef = useRef<number | null>(null);

  const files = useFileTransfer({
    peerId,
    // The transport's own method, not a wrapper: useFileTransfer memoises on
    // this identity, and a fresh closure each render resets the manager in a
    // loop.
    sendSignal: transport.sendSignal,
    pushToast,
  });

  const presence = usePresence({ sendSignal: transport.sendSignal });

  const room = useRoomSession({
    pushToast,
    senderIdRef,
    onRealtimeOpen: () => files.announce(),
    onRealtimeClose: () => presence.reset(),
    onSignal: (from, payload) => {
      presence.handleSignal(from, payload);
      files.handleSignal(from, payload);
    },
  });

  const editor = useClipEditor({
    pushToast,
    editorRef,
    onSubmit: () => void sendClip(),
  });

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

  const joinFromSearchParams = useEffectEvent((requestedRoom: string) => {
    void joinExistingRoom(requestedRoom, true);
  });

  useEffect(() => {
    const requestedRoom = normalizeRoomCode(searchParams.get("room"));

    if (!requestedRoom || room.initializedRoomRef.current === requestedRoom) {
      return;
    }

    room.initializedRoomRef.current = requestedRoom;
    joinFromSearchParams(requestedRoom);
  }, [searchParams, room.initializedRoomRef]);

  useEffect(() => {
    const confirmReset = confirmResetRef;
    return () => clearTimer(confirmReset);
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

  function updateUrl(code: RoomCode | null, encodedKey: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (code) {
      next.set("room", code);
    } else {
      next.delete("room");
    }

    const query = next.toString();
    // The fragment has to be restated on every replace, or the router drops it
    // — and the fragment is where the room key lives, so losing it locks the
    // tab out of its own room on the next navigation. Passed in rather than
    // read from state, because the first call comes before that state settles.
    const fragment = code ? roomKeyFragment(encodedKey) : "";
    router.replace(`${pathname}${query ? `?${query}` : ""}${fragment}`, {
      scroll: false,
    });
  }

  function toggleTheme() {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  }

  function closeOverlays() {
    setShowQrSheet(false);
    setShowShortcuts(false);
    setShowPalette(false);
  }

  async function hydrateRoom(nextRoomCode: RoomCode, key: RoomKey) {
    try {
      await room.hydrate(nextRoomCode, key);
    } catch (error) {
      setRoomKeyEncoded(null);
      throw error;
    }
    setRoomKeyEncoded(key.encoded);
    editor.reset();
    closeOverlays();
    setKeyPrompt(null);
    updateUrl(nextRoomCode, key.encoded);
  }

  async function createRoom() {
    setIsBusy(true);
    try {
      // Generated here and never sent. The server gets its fingerprint, which
      // is enough to tell a joiner their key is wrong and nothing more.
      const key = await generateRoomKey();
      const response = await createRoomRequest(key.check);
      await hydrateRoom(response.code, key);
      pushToast("Room created!", "success");
    } catch (error) {
      room.fail();
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

    // A shared link carries the key in its fragment; a code read aloud or typed
    // in does not. Without one there is nothing to decrypt with, so ask.
    const fragmentKey =
      typeof window === "undefined"
        ? null
        : parseRoomKeyFromHash(window.location.hash);
    const key = fragmentKey ? await importRoomKey(fragmentKey) : null;
    if (!key) {
      setKeyPrompt({ code: normalized, mismatch: false });
      return;
    }

    await joinWithKey(normalized, key, fromLink);
  }

  async function joinWithKey(
    normalized: RoomCode,
    key: RoomKey,
    fromLink: boolean,
  ) {
    setIsBusy(true);
    try {
      await hydrateRoom(normalized, key);
      pushToast(fromLink ? "Joined room from link." : "Joined room.", "success");
    } catch (error) {
      room.fail();
      room.setRoomCode(null);
      if (error instanceof RoomKeyMismatchError) {
        // The room is real and reachable; only the key is wrong. Keeping the
        // prompt up is more use than dropping them back to the landing page.
        setKeyPrompt({ code: normalized, mismatch: true });
        return;
      }
      updateUrl(null, null);
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
    room.leave();
    editor.reset();
    setJoinCode("");
    closeOverlays();
    setKeyPrompt(null);
    // Cleared before the URL is rewritten, so the fragment goes with it and
    // the key is not left sitting in the address bar of a room we have left.
    setRoomKeyEncoded(null);
    updateUrl(null, null);
    pushToast("Left room.", "info");
  }

  async function sendClip() {
    const text = editor.text.trim();
    // Silent: the Send button and the shortcut are both disabled in this
    // state, and an empty box does not need to be told it is empty.
    if (!text || text.length > MAX_CLIP_CHARS) {
      return;
    }

    setIsBusy(true);
    try {
      if (await room.send(text)) {
        editor.reset();
      }
    } finally {
      setIsBusy(false);
    }
  }

  function roomUrl(code: RoomCode, withKey: boolean) {
    return buildRoomUrl(
      code,
      window.location.href,
      withKey ? (roomKeyEncoded ?? undefined) : undefined,
    );
  }

  async function copyRoomLink(code: RoomCode) {
    try {
      await writeClipboard(roomUrl(code, true));
      pushToast("Room link copied!", "success");
    } catch {
      pushToast("Could not copy room link.", "error");
    }
  }

  /**
   * The link without its key, for sending the two through different channels.
   * A link that carries the key hands the whole room to whatever app forwards
   * it; split them and no single channel has both halves.
   */
  async function copyRoomLinkWithoutKey(code: RoomCode) {
    try {
      await writeClipboard(roomUrl(code, false));
      pushToast("Link copied without the key — send the key separately.", "success");
    } catch {
      pushToast("Could not copy room link.", "error");
    }
  }

  /** For the device that has to read a key out to one joining by code. */
  async function copyRoomKey() {
    if (!roomKeyEncoded) {
      return;
    }
    try {
      await writeClipboard(formatRoomKey(roomKeyEncoded));
      pushToast("Room key copied — share it only with people you trust.", "success");
    } catch {
      pushToast("Could not copy room key.", "error");
    }
  }

  async function submitRoomKey(encoded: string) {
    const key = await importRoomKey(encoded);
    if (!key) {
      setKeyPrompt((current) =>
        current ? { ...current, mismatch: true } : current,
      );
      return;
    }
    await joinWithKey(keyPrompt?.code ?? "", key, false);
  }

  async function shareRoom(code: RoomCode) {
    const url = roomUrl(code, true);

    if (navigator.share) {
      try {
        await navigator.share({
          title: "CLIPLINK room",
          // The link lives in `text`, not in the `url` field. Several targets
          // — Telegram among them — forward only `text`, which turned the
          // share into a room code with no way to reach it. Targets that build
          // a rich preview find the URL in the body just as well.
          text: `Join my CLIPLINK room ${code}\n${url}`,
        });
        return;
      } catch (error) {
        // Dismissing the share sheet rejects with AbortError. Deciding not to
        // share is not a failure, and saying so is a scold for using the
        // cancel button as intended.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Anything else: fall through and put the link on the clipboard, which
        // is the outcome the user was after either way.
      }
    }

    try {
      await writeClipboard(url);
      pushToast("Room link copied!", "success");
    } catch {
      pushToast("Could not share the room link.", "error");
    }
  }

  async function copyHistoryItem(text: string) {
    try {
      await writeClipboard(text);
      pushToast("Clip copied!", "success");
    } catch {
      pushToast("Could not copy clip.", "error");
    }
  }

  function shareFiles(list: FileList | File[] | null) {
    const selected = list ? Array.from(list) : [];
    if (selected.length === 0) {
      return;
    }
    if (!room.realtimeReady) {
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
    event.dataTransfer.dropEffect = room.realtimeReady ? "copy" : "none";
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

  const roomCode = room.roomCode;
  const joined = Boolean(roomCode);
  const latestIncoming = room.history.find(
    (clip) => clip.direction === "incoming",
  );
  const sheetOpen = showQrSheet || showShortcuts || showPalette;
  const expiresIn = useRoomExpiry(room.expiresAt);
  const status = statusFor(room.status, room.realtimeReady);
  const trimmedLength = editor.text.trim().length;
  const canSend = trimmedLength > 0 && trimmedLength <= MAX_CLIP_CHARS;

  const actions = createRoomActions({
    joined,
    realtimeReady: room.realtimeReady,
    hasText: Boolean(editor.text.trim()),
    canSend,
    hasUndo: Boolean(editor.clearedText),
    hasIncoming: Boolean(latestIncoming),
    send: () => void sendClip(),
    copyRoomLink: () => void copyRoomLink(roomCode!),
    copyRoomKey: () => void copyRoomKey(),
    copyRoomLinkWithoutKey: () => void copyRoomLinkWithoutKey(roomCode!),
    shareRoom: () => void shareRoom(roomCode!),
    openQr: () => setShowQrSheet(true),
    leave: requestLeave,
    attach: () => fileInputRef.current?.click(),
    pasteFromDevice: () => void editor.pasteFromDevice(),
    clearEditor: editor.clear,
    undoClear: editor.undoClear,
    copyLatestIncoming: () =>
      void copyHistoryItem(latestIncoming?.text ?? ""),
    focusEditor: () => editor.focus(),
    toggleTheme,
    openShortcuts: () => setShowShortcuts(true),
    openPalette: () => setShowPalette(true),
  });

  useShortcuts({
    actions,
    active: joined,
    blocked: sheetOpen,
    onDigit: (index) => {
      const clip = room.history[index];
      if (clip) {
        void copyHistoryItem(clip.text);
      }
    },
    // Escape unwinds the most recent thing the user started, innermost first.
    // Sheets are excluded here because each one handles its own Escape.
    onEscape: () => {
      if (confirmingLeave) {
        clearTimer(confirmResetRef);
        setConfirmingLeave(false);
        return;
      }
      editor.blur();
    },
    onTypeahead: () => editor.focus(),
  });

  // Deliberately keyless. The QR image is rendered by a third-party service
  // from whatever is put in this query string, so anything encoded here is
  // handed to that service — and the one thing that must never leave this
  // device is the key. Scanning therefore lands on the room and then asks for
  // the key, the same as typing the code does.
  const qrPayloadUrl = roomCode
    ? buildRoomUrl(
        roomCode,
        typeof window !== "undefined" ? window.location.href : "",
      )
    : "";
  const qrCodeUrl = qrPayloadUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(qrPayloadUrl)}`
    : "";

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
            {/* There is nothing to be connected to before a room exists, and
                "OFFLINE" on the landing screen reads as a fault when none has
                happened. */}
            {joined ? (
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
                    DOT_TONE[status.tone],
                  )}
                />
                <span>{status.label}</span>
              </div>
            ) : null}
            {joined ? (
              <button
                className={chromeButtonClass}
                type="button"
                aria-label="Keyboard shortcuts"
                aria-keyshortcuts="?"
                onClick={() => setShowShortcuts(true)}
              >
                <span aria-hidden="true" className="font-mono text-sm">
                  ?
                </span>
              </button>
            ) : null}
            <button
              className={chromeButtonClass}
              type="button"
              aria-label={
                mounted && resolvedTheme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              aria-keyshortcuts="T"
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
              <LandingView
                joinCode={joinCode}
                isBusy={isBusy}
                onJoinCodeChange={setJoinCode}
                onCreate={() => void createRoom()}
                onJoin={() => void joinExistingRoom(joinCode)}
              />
            ) : (
              <section className="flex w-full flex-col gap-4.5 md:gap-6">
                <RoomHeader
                  roomCode={roomCode!}
                  qrOpen={showQrSheet}
                  confirmingLeave={confirmingLeave}
                  onCopyLink={() => void copyRoomLink(roomCode!)}
                  onShare={() => void shareRoom(roomCode!)}
                  onOpenQr={() => setShowQrSheet(true)}
                  onLeave={requestLeave}
                  expiresIn={expiresIn}
                  deviceCount={presence.deviceCount}
                />

                <ClipEditor
                  editor={editor}
                  realtimeReady={room.realtimeReady}
                  dragActive={dragActive}
                  isBusy={isBusy}
                  canSend={canSend}
                  arrival={room.arrivalId !== null}
                  fileInputRef={fileInputRef}
                  editorRef={editorRef}
                  onSend={() => void sendClip()}
                  onFilesPicked={shareFiles}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onPaste={handlePaste}
                />

                <FileTransfers
                  items={files.items}
                  canTransfer={room.realtimeReady}
                  surfaceStyle={panelSurfaceStyle}
                  onDownload={files.request}
                  onCancel={files.cancel}
                  onSave={files.save}
                  onRevoke={files.revoke}
                  onDismiss={files.dismiss}
                />

                <HistoryList
                  history={room.history}
                  arrivalId={room.arrivalId}
                  enteringIds={room.enteringIds}
                  onCopy={(text) => void copyHistoryItem(text)}
                />
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
          roomKey={formatRoomKey(roomKeyEncoded ?? "")}
          onClose={() => setShowQrSheet(false)}
          onCopyLink={() => void copyRoomLink(roomCode!)}
          onCopyKey={() => void copyRoomKey()}
          onShare={() => void shareRoom(roomCode!)}
        />
      ) : null}

      <KeyPrompt
        open={keyPrompt !== null}
        roomCode={keyPrompt?.code ?? ""}
        mismatch={keyPrompt?.mismatch ?? false}
        onClose={() => setKeyPrompt(null)}
        onSubmit={(value) => void submitRoomKey(value)}
      />

      <ShortcutsSheet
        open={showShortcuts}
        actions={actions}
        onClose={() => setShowShortcuts(false)}
      />

      {joined ? (
        <CommandPalette
          open={showPalette}
          actions={actions}
          onClose={() => setShowPalette(false)}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
