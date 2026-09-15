"use client";

import type { RoomCode } from "@/lib/cliplink/types";
import { cn } from "@/lib/utils";

import { actionButtonClass, panelAccentClass, panelSurfaceStyle } from "./ui";

export type ShareState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | { phase: "ready"; summary: string }
  | { phase: "delivered"; code: RoomCode };

type ShareBannerProps = {
  state: ShareState;
  /** Rooms open in other tabs of this browser, in the order they answered. */
  rooms: RoomCode[];
  onSendToRoom: (code: RoomCode) => void;
};

/**
 * Sits above the landing view on /share. The quickest path is a room already
 * open in another tab; creating or joining one below also works, and the share
 * follows into it.
 */
export function ShareBanner({ state, rooms, onSendToRoom }: ShareBannerProps) {
  if (state.phase === "loading") {
    return null;
  }

  return (
    <section
      className="mx-auto mb-5 flex w-full max-w-170 flex-col gap-3 rounded-surface border border-line p-4 md:mb-9"
      style={panelSurfaceStyle}
      aria-live="polite"
    >
      <p className="m-0 text-2xs tracking-label-wide text-muted uppercase">
        Shared to CLIPLINK
      </p>
      <p className="m-0 text-sm text-pretty wrap-break-word text-fg">
        {bannerText(state)}
      </p>

      {state.phase === "ready" ? (
        rooms.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rooms.map((code) => (
              <button
                key={code}
                type="button"
                className={cn(actionButtonClass, panelAccentClass)}
                onClick={() => onSendToRoom(code)}
              >
                Send to room {code}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-2xs text-pretty text-muted">
            Create a room or join one below, and this comes along.
          </p>
        )
      ) : null}
    </section>
  );
}

function bannerText(state: Exclude<ShareState, { phase: "loading" }>) {
  switch (state.phase) {
    case "error":
      return state.message;
    case "empty":
      return "Nothing arrived with this share. Try sharing again.";
    case "ready":
      return state.summary;
    case "delivered":
      return `Sent to room ${state.code}. You can close this tab.`;
  }
}
