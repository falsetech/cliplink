"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which receives the OS share sheet. Nothing else
 * depends on it, so a browser without service workers, or a failed
 * registration, just means CLIPLINK can't be a share target there.
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
