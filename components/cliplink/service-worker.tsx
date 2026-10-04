"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which receives the OS share sheet and shows clip
 * notifications. Neither is load-bearing: a browser without service workers,
 * or a failed registration, means CLIPLINK can't be a share target there, and
 * notifications fall back to the page's own.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // not a share target on this device
      });
  }, []);

  return null;
}
