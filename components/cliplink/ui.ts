import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared control classes, built on the shadcn button variants so a control
 * that cannot be a `<Button>` — a link, a label — still wears the same shape.
 * Module constants let each component import what it renders rather than
 * receive class strings it has no opinion about.
 */
export const primaryButtonClass = cn(buttonVariants({ size: "lg" }));

export const secondaryButtonClass = cn(
  buttonVariants({ variant: "secondary", size: "lg" }),
);

export const actionButtonClass = cn(
  buttonVariants({ variant: "secondary", size: "sm" }),
  "max-[430px]:flex-1",
);

export const panelToolClass = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "text-muted-foreground hover:text-foreground",
);

export const panelAccentClass =
  "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground disabled:hover:bg-primary";

/**
 * A list row. On phones the direction label and the row's action share the
 * first line and the content takes the full width below; from `md` it is one
 * line.
 */
export const rowClass =
  "relative grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-2xl bg-card p-3 shadow-row md:flex md:gap-4 md:px-4";

/** Solid card surface for sheets and panels. */
export const panelSurfaceStyle = { background: "var(--card)" };

/** Translucent chrome: content scrolls beneath the header, blurred. */
export const headerSurfaceStyle = { background: "var(--chrome-bg)" };

/** The round icon buttons in the app header. */
export const chromeButtonClass = cn(
  buttonVariants({ variant: "secondary", size: "icon" }),
);
