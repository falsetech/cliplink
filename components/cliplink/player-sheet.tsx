"use client";

import { useEffect, useRef, useState } from "react";

import { SEED_SEGMENT_BYTES, streamUrl } from "@/lib/cliplink/file-sink";
import { formatBytes } from "@/lib/cliplink/format";

import { Sheet, SheetHeader } from "./sheet";
import type { FileListItem } from "./use-file-transfer";

/**
 * How far short of the downloaded edge a seek is held, beyond the part still
 * being written. Bytes map to time only roughly: a variable bitrate puts more
 * of the file in some seconds than others.
 */
const EDGE_MARGIN_SECONDS = 2;

/** Every byte is here: a finished download, or a file held whole. */
function isComplete(item: FileListItem) {
  return item.direction === "outgoing" ? item.have === undefined : item.status === "done";
}

/**
 * How many parts of the file the worker can serve: only closed ones, so bytes
 * written into the open part don't move playback on. The whole file counts one
 * more, so finishing always does.
 */
function servableParts(bytes: number, size: number) {
  return bytes >= size ? Math.ceil(size / SEED_SEGMENT_BYTES) + 1 : Math.floor(bytes / SEED_SEGMENT_BYTES);
}

/**
 * How much of the file is written on this device, as far as the list can
 * tell. Not `bytes`: that counts what has arrived over the wire, which on a
 * slow disk runs well ahead of what is there to play.
 */
export function availableBytes(item: FileListItem) {
  if (isComplete(item)) {
    return item.size;
  }
  return item.direction === "outgoing" ? (item.have ?? 0) : (item.verifiedBytes ?? 0);
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
  /** Where to put playback back once a reload has its metadata. */
  const resumeAtRef = useRef<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  /**
   * Where playback got to when the player gave up on bytes that hadn't
   * arrived yet, and how many had. Once more are here it picks up again.
   */
  const [stalled, setStalled] = useState<{ time: number; bytes: number } | null>(null);
  const [unplayable, setUnplayable] = useState(false);

  const available = availableBytes(item);
  const complete = isComplete(item);
  const fraction = item.size > 0 ? Math.min(1, available / item.size) : 0;
  const audio = item.mime.startsWith("audio/");

  // A stall ends when the download has moved on: reload the source and go back
  // to where it stopped. The worker has already been answering with what it
  // had, so this only ever waits on bytes that genuinely weren't there.
  //
  // Where to resume lives in a ref, applied from onLoadedMetadata: a listener
  // added here would be removed by this effect's own cleanup as soon as the
  // state change below re-renders, long before the metadata arrives.
  useEffect(() => {
    const media = mediaRef.current;
    if (!stalled || !media || servableParts(available, item.size) <= servableParts(stalled.bytes, item.size)) {
      return;
    }
    resumeAtRef.current = stalled.time;
    media.load();
    // After load(): this effect exists to leave the stalled state, and does so
    // only once the reload is underway.
    setStalled(null);
  }, [available, item.size, stalled]);

  function onLoadedMetadata() {
    const media = mediaRef.current;
    const resumeAt = resumeAtRef.current;
    if (!media || resumeAt === null) {
      return;
    }
    resumeAtRef.current = null;
    media.currentTime = resumeAt;
    void media.play().catch(() => {
      // needs a tap; the controls are right there
    });
  }

  function onSeeking() {
    const media = mediaRef.current;
    if (!media || complete || !Number.isFinite(media.duration)) {
      return;
    }
    // Past what is written there is nothing to play yet: hold the seek at the
    // edge, where playback carries on as soon as the next part lands. The part
    // being written doesn't count; it can't be served until it closes.
    const servable = Math.max(0, available - SEED_SEGMENT_BYTES) / item.size;
    const limit = Math.max(0, media.duration * servable - EDGE_MARGIN_SECONDS);
    if (media.currentTime > limit) {
      media.currentTime = limit;
    }
  }

  // Run dry mid-file and the browser asks for the next bytes, is told they
  // aren't there, and goes quiet without an error. So waiting counts as a
  // stall too; playing again, on its own, ends one.
  function onWaiting() {
    const media = mediaRef.current;
    setWaiting(true);
    // Not while a reload is finding its place: the time then is 0. Complete
    // counts too: the answer it ran dry on may predate the last part.
    if (media && resumeAtRef.current === null) {
      setStalled({ time: media.currentTime, bytes: available });
    }
  }

  function onPlaying() {
    setWaiting(false);
    setStalled(null);
  }

  function onError() {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    // Complete, and failing on a fresh load, is the file: nothing more is
    // coming that would make it play.
    if (complete && resumeAtRef.current === null) {
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
          onLoadedMetadata={onLoadedMetadata}
          onWaiting={onWaiting}
          onPlaying={onPlaying}
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
          onLoadedMetadata={onLoadedMetadata}
          onWaiting={onWaiting}
          onPlaying={onPlaying}
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
