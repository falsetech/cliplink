"use client";

import { Button } from "@/components/ui/button";
import type { RoomCode } from "@/lib/cliplink/types";

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
      className="mx-auto mb-8 flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-card p-4 shadow-row md:mb-10"
      aria-live="polite"
    >
      <p className="m-0 text-xs font-medium text-muted-foreground">
        Shared to CLIPLINK
      </p>
      <p className="m-0 text-base text-pretty wrap-break-word text-foreground">
        {bannerText(state)}
      </p>

      {state.phase === "ready" ? (
        rooms.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {rooms.map((code) => (
              <Button key={code} size="sm" onClick={() => onSendToRoom(code)}>
                Send to Room {code}
              </Button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-xs text-pretty text-muted-foreground">
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
