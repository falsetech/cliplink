"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "success" | "info" | "error";

export type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  /** Arrivals the user did not initiate earn an overshoot on entry. */
  unprompted: boolean;
  exiting: boolean;
};

export type PushToast = (
  message: string,
  tone?: ToastTone,
  options?: { unprompted?: boolean },
) => void;

/** Beyond this the column stops being readable and starts being noise. */
const MAX_VISIBLE = 3;
const DISMISS_AFTER_MS = 2500;
/** Must match the toast-out animation in globals.css. */
const EXIT_MS = 200;

let nextId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const remove = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((current) =>
        current.map((toast) =>
          toast.id === id ? { ...toast, exiting: true } : toast,
        ),
      );
      const timer = window.setTimeout(() => remove(id), EXIT_MS);
      timers.current.set(id, timer);
    },
    [clearTimer, remove],
  );

  const push = useCallback<PushToast>(
    (message, tone = "info", options) => {
      const id = (nextId += 1);
      const item: ToastItem = {
        id,
        message,
        tone,
        unprompted: options?.unprompted ?? false,
        exiting: false,
      };

      setToasts((current) => {
        const live = current.filter((toast) => !toast.exiting);
        const overflow = live.slice(0, Math.max(0, live.length + 1 - MAX_VISIBLE));
        if (overflow.length === 0) {
          return [...current, item];
        }
        // Retire the oldest rather than letting the column grow without bound.
        const retiring = new Set(overflow.map((toast) => toast.id));
        for (const toast of overflow) {
          clearTimer(toast.id);
          const timer = window.setTimeout(() => remove(toast.id), EXIT_MS);
          timers.current.set(toast.id, timer);
        }
        return [
          ...current.map((toast) =>
            retiring.has(toast.id) ? { ...toast, exiting: true } : toast,
          ),
          item,
        ];
      });

      // Errors stay until acknowledged. A failed send that vanishes in 2.5s is
      // a failure the user never sees.
      if (tone !== "error") {
        const timer = window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
        timers.current.set(id, timer);
      }
    },
    [clearTimer, dismiss, remove],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        window.clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
