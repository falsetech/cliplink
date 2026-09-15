"use client";

import { useMemo } from "react";

import { encodeQr } from "@/lib/cliplink/qr";

/** Modules of clear space the specification requires on every side. */
const QUIET_ZONE = 4;

type QrCodeProps = {
  /** The text to encode — for a room, the full URL including its key fragment. */
  value: string;
  /** Rendered edge length in pixels, quiet zone included. */
  size?: number;
  label: string;
};

/**
 * Draws a QR code from modules computed on this device.
 *
 * Rendered as one SVG path rather than an image so it stays crisp at any size
 * and, more to the point, needs no network request: the previous QR came from
 * a third-party service with the URL in the query string, which would now hand
 * that service the room key.
 *
 * Fixed dark-on-white regardless of theme. Scanners expect that polarity, and
 * a QR is a machine-readable target before it is a design element.
 */
export function QrCode({ value, size = 280, label }: QrCodeProps) {
  const symbol = useMemo(() => {
    try {
      return encodeQr(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!symbol) {
    return (
      <p className="m-0 px-4 py-8 text-center text-xs text-pretty text-muted-foreground">
        This room link is too long to render as a QR code. Copy the link
        instead.
      </p>
    );
  }

  const extent = symbol.size + QUIET_ZONE * 2;
  let path = "";
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (symbol.modules[y][x]) {
        path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      // Whole-pixel module edges; a resampled QR is a harder QR to read.
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
