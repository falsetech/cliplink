"use client";

import { toast } from "sonner";

export type ToastTone = "success" | "info" | "error";

export type PushToast = (
  message: string,
  tone?: ToastTone,
  options?: { unprompted?: boolean },
) => void;

const DISMISS_AFTER_MS = 2500;

/**
 * The app's toast call, backed by Sonner. The signature is unchanged so the
 * hooks that report through it do not need to know what renders the result.
 *
 * `unprompted` is still accepted: Sonner's own entrance is soft enough for
 * both kinds of arrival, so it no longer changes the motion.
 */
const push: PushToast = (message, tone = "info") => {
  switch (tone) {
    case "success":
      toast.success(message, { duration: DISMISS_AFTER_MS });
      return;
    case "error":
      // Errors stay until acknowledged. A failed send that vanishes in 2.5s
      // is a failure the user never sees.
      toast.error(message, { duration: Infinity, closeButton: true });
      return;
    default:
      toast.info(message, { duration: DISMISS_AFTER_MS });
  }
};

export function useToasts() {
  return { push };
}
