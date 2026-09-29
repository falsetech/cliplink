"use client";

import { useEffect, useRef, useState } from "react";

import { SEED_SEGMENT_BYTES, streamUrl } from "@/lib/cliplink/file-sink";
import { formatBytes } from "@/lib/cliplink/format";

import { Sheet, SheetHeader } from "./sheet";
import type { FileListItem } from "./use-file-transfer";

/**
 * How far short of the downloaded edge a seek is held. Bytes map to time only
 * roughly — a variable bitrate puts more of the file in some seconds than
 * others — and the last part is the one still being written.
 */
const EDGE_MARGIN_SECONDS = 2;

/** How much of the file is on this device, as far as the list can tell. */
export function availableBytes(item: FileListItem) {
  if (item.direction === "outgoing") {
    return item.have ?? item.size;
  }
  return item.status === "done" ? item.size : item.bytes;
}

/** Enough has arrived for the first part to be on disk, which is what plays. */
export function readyToPlay(item: FileListItem) {
  return availableBytes(item) >= Math.min(item.size, SEED_SEGMENT_BYTES);
}

type PlayerSheetProps = {
  /** The live item, so progress keeps arriving while it plays. */
  item: FileListItem | null;
  onClose: () => void;
};

export function PlayerSheet({ item, onClose }: PlayerSheetProps) {
  return (
    <Sheet
      open={item !== null}
      label={item ? `Playing ${item.name}` : "Player"}
      onClose={onClose}
      className="max-w-2xl"
    >
      {item?.digest ? <PlayerBody key={item.digest} item={item} /> : null}
    </Sheet>
  );
}

function PlayerBody({ item }: { item: FileListItem }) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [waiting, setWaiting] = useState(false);
  /**
   * Where playback got to when the player gave up on bytes that hadn't
   * arrived yet, and how many had. Once more are here it picks up again.
   */
  const [stalled, setStalled] = useState<{ time: number; bytes: number } | null>(null);
  const [unplayable, setUnplayable] = useState(false);

  const available = availableBytes(item);
  const complete = available >= item.size;
  const fraction = item.size > 0 ? Math.min(1, available / item.size) : 0;
  const audio = item.mime.startsWith("audio/");

  // A stall ends when the download has moved on: reload the source and go back
  // to where it stopped. The worker has already been answering with what it
  // had, so this only ever waits on bytes that genuinely weren't there.
  useEffect(() => {
    const media = mediaRef.current;
    if (!stalled || !media || available <= stalled.bytes) {
      return;
    }
    const resumeAt = stalled.time;
    const restore = () => {
      media.currentTime = resumeAt;
      void media.play().catch(() => {
        // needs a tap; the controls are right there
      });
    };
    media.addEventListener("loadedmetadata", restore, { once: true });
    media.load();
    // After load(): this effect exists to leave the stalled state, and does so
    // only once the reload is underway.
    setStalled(null);
    return () => media.removeEventListener("loadedmetadata", restore);
  }, [available, stalled]);

  function onSeeking() {
    const media = mediaRef.current;
    if (!media || complete || !Number.isFinite(media.duration)) {
      return;
    }
    // Past what has arrived there is nothing to play yet: hold the seek at the
    // edge, where playback carries on as soon as the next part lands.
    const limit = Math.max(0, media.duration * fraction - EDGE_MARGIN_SECONDS);
    if (media.currentTime > limit) {
      media.currentTime = limit;
    }
  }

  function onError() {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    if (complete) {
      setUnplayable(true);
      return;
    }
    setStalled({ time: media.currentTime, bytes: available });
  }

  const status = unplayable
    ? "This file can't be played here. Save it and open it instead."
    : complete
      ? formatBytes(item.size)
      : stalled || waiting
        ? `Waiting for more of the file · ${formatBytes(available)} of ${formatBytes(item.size)}`
        : `${formatBytes(available)} of ${formatBytes(item.size)} downloaded · plays as it arrives`;

  return (
    <>
      <SheetHeader
        eyebrow={audio ? "Audio" : "Video"}
        title={item.name}
        titleClassName="truncate text-lg"
        closeLabel="Close player"
      />

      {audio ? (
        <audio
          ref={mediaRef}
          src={streamUrl(item.digest!)}
          controls
          preload="metadata"
          className="w-full"
          onSeeking={onSeeking}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onError={onError}
        />
      ) : (
        <video
          ref={mediaRef}
          src={streamUrl(item.digest!)}
          controls
          playsInline
          preload="metadata"
          className="max-h-[60vh] w-full rounded-xl bg-black"
          onSeeking={onSeeking}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onError={onError}
        />
      )}

      <div className="flex flex-col gap-1.5">
        {complete ? null : (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Downloaded so far"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
          >
            {/* The furthest a seek can go: everything left of it is playable. */}
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-150 ease-out"
              style={{ transform: `scaleX(${fraction})` }}
            />
          </div>
        )}
        <p
          className="m-0 text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {status}
        </p>
      </div>
    </>
  );
}
