"use client";

import { cn } from "@/lib/utils";

import type { ToastItem } from "./use-toasts";

const TONE_CLASS = {
  success: "border-success text-success",
  info: "border-accent text-accent",
  error: "border-danger text-danger",
} as const;

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed bottom-8 left-1/2 z-90 flex -translate-x-1/2 flex-col items-center gap-2.5"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          data-state={toast.exiting ? "exiting" : "entering"}
          data-arrival={toast.unprompted ? "true" : undefined}
          data-motion="transform"
          onClick={() => onDismiss(toast.id)}
          className={cn(
            "pointer-events-auto min-w-[min(92vw,320px)] rounded-control border px-4 py-3 text-left text-xs shadow-toast backdrop-blur-(--toast-blur)",
            "bg-(--toast-bg) transition-opacity duration-150 hover:opacity-80",
            "data-[state=entering]:animate-[toast-in-soft_240ms_var(--ease-out-quint)_both]",
            "data-[state=entering]:data-[arrival=true]:animate-[toast-in-arrival_280ms_cubic-bezier(0.34,1.56,0.64,1)_both]",
            "data-[state=exiting]:animate-[toast-out_200ms_var(--ease-out-quint)_both]",
            TONE_CLASS[toast.tone],
          )}
        >
          {toast.message}
          {toast.tone === "error" ? (
            <span className="mt-1 block text-2xs tracking-label text-text-muted uppercase">
              Tap to dismiss
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
