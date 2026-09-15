import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared surface and control classes for markup that cannot be a shadcn
 * component — a list row, a link wearing a button's shape.
 */

/**
 * A list row. On phones the direction label and the row's action share the
 * first line and the content takes the full width below; from `md` it is one
 * line.
 */
export const rowClass =
  "relative grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-2xl bg-card p-3 shadow-row md:flex md:gap-4 md:px-4";

/** Translucent chrome: content scrolls beneath the header, blurred. */
export const headerSurfaceStyle = { background: "var(--chrome-bg)" };

/** The round icon buttons in the app header, for links that cannot be `<Button>`. */
export const chromeButtonClass = cn(
  buttonVariants({ variant: "secondary", size: "icon" }),
);
