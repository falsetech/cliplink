/**
 * Getting a clip noticed when nobody is looking at the tab. A hidden or
 * unfocused page cannot write the clipboard, so an arrival there is marked
 * instead — in the tab title, on the installed app's icon, and, for a device
 * that asked for it, in a system notification.
 *
 * None of this is push. It runs in the page, so it works for as long as the
 * browser keeps the tab alive and not after.
 */

const NOTIFY_KEY = "cliplink:notify";
const NOTIFICATION_ICON = "/icon-192.png";

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export type EnableNotificationsResult = "on" | "denied" | "unsupported";

/**
 * Visible and focused, which is what the clipboard asks for. A window that is
 * on screen beside the one being typed in is visible and still cannot copy.
 */
export function isPageAttended() {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

// The title as it was before the first count went on it, so clearing restores
// whatever the page was called rather than a name assumed here.
let baseTitle: string | null = null;

export function setUnreadBadge(count: number) {
  if (typeof document === "undefined") {
    return;
  }
  baseTitle ??= document.title;
  document.title = `(${count}) ${baseTitle}`;
  // Best-effort: only an installed app has an icon to badge.
  (navigator as BadgeNavigator).setAppBadge?.(count).catch(() => {});
}

export function clearUnreadBadge() {
  if (typeof document === "undefined" || baseTitle === null) {
    return;
  }
  document.title = baseTitle;
  baseTitle = null;
  (navigator as BadgeNavigator).clearAppBadge?.().catch(() => {});
}

const listeners = new Set<() => void>();

/** For `useSyncExternalStore`, so the action's label follows the preference. */
export function subscribeToNotifications(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readPreference() {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === "on";
  } catch {
    // Storage is blocked: the preference cannot be kept, so it reads as off.
    return false;
  }
}

function writePreference(on: boolean) {
  try {
    if (on) {
      window.localStorage.setItem(NOTIFY_KEY, "on");
    } else {
      window.localStorage.removeItem(NOTIFY_KEY);
    }
  } catch {
    // Nothing to do: the next read reports off.
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Both halves have to hold. The browser's permission can be withdrawn in its
 * settings without this app hearing of it, and a granted permission is not a
 * wish to be notified — turning these off must not need a trip to settings.
 */
export function notificationsEnabled() {
  return (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    readPreference()
  );
}

/** Asks for permission, so it has to be called from a user's own action. */
export async function enableNotifications(): Promise<EnableNotificationsResult> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") {
    return "denied";
  }
  writePreference(true);
  return "on";
}

export function disableNotifications() {
  writePreference(false);
}

function notificationTag(roomCode: string) {
  return `cliplink:${roomCode}`;
}

let pageNotification: Notification | null = null;

async function serviceWorkerRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Says that a clip arrived and in which room, and nothing of what it holds:
 * the text was decrypted for this tab, and a notification is kept by the
 * system and shown on a lock screen.
 *
 * One per room, replaced as the count grows rather than stacked.
 */
export async function showClipNotification(roomCode: string, count: number) {
  if (!notificationsEnabled()) {
    return;
  }

  const title = "CLIPLINK";
  const options: NotificationOptions = {
    body:
      count === 1
        ? `Clip received in room ${roomCode}`
        : `${count} clips received in room ${roomCode}`,
    tag: notificationTag(roomCode),
    icon: NOTIFICATION_ICON,
    // The path only. The fragment carries the room key, and this is stored
    // outside the tab.
    data: { path: window.location.pathname },
  };

  try {
    // Through the worker where there is one: Android Chrome refuses the
    // constructor outright, and the worker is what hears the click.
    const registration = await serviceWorkerRegistration();
    // Looked at again while that was pending: the return already cleared the
    // notifications, and one shown now would be left behind.
    if (isPageAttended()) {
      return;
    }
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    pageNotification?.close();
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    pageNotification = notification;
  } catch {
    // Best-effort. The title and the badge still mark the arrival.
  }
}

export async function closeClipNotification(roomCode: string) {
  pageNotification?.close();
  pageNotification = null;
  try {
    const registration = await serviceWorkerRegistration();
    const shown = await registration?.getNotifications({
      tag: notificationTag(roomCode),
    });
    for (const notification of shown ?? []) {
      notification.close();
    }
  } catch {
    // Left for the user to dismiss.
  }
}
