import { cn } from "@/lib/utils";

/**
 * Shared control classes. These lived inside `CliplinkApp` and were passed into
 * `QrSheet` as props purely because of where they were declared — every sheet
 * carried three class-string props it had no opinion about. Module constants
 * let each component import what it renders.
 *
 * Transitions name their properties: the bare `transition` utility also spans
 * `filter` and `backdrop-filter`, which is expensive on blurred chrome and
 * wanted by none of these controls.
 */
export const buttonBaseClass =
  "inline-flex items-center justify-center gap-2 rounded-control border px-6 py-3.5 text-sm tracking-label uppercase transition-[color,background-color,border-color,translate,scale] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100";

export const primaryButtonClass = cn(
  buttonBaseClass,
  "min-h-12 border-(--primary-border) bg-(--primary-bg) font-bold text-(--primary-text) hover:-translate-y-px hover:bg-(--primary-hover-bg) focus-visible:-translate-y-px focus-visible:bg-(--primary-hover-bg)",
);

export const secondaryButtonClass = cn(
  buttonBaseClass,
  "min-h-12 border-line-strong bg-transparent text-dim hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent",
);

// 44px on touch, 40px once a precise pointer is available.
export const actionButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-3.5 py-2 text-2xs tracking-label text-dim uppercase transition-[color,border-color,scale] duration-150 ease-out active:scale-[0.96] md:min-h-10 max-[430px]:w-full";

export const panelToolClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-transparent px-3 py-1 text-2xs tracking-label text-muted uppercase transition-[color,border-color,background-color,scale] duration-150 ease-out hover:border-line-strong hover:text-fg focus-visible:border-line-strong focus-visible:text-fg active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 md:min-h-10";

export const panelAccentClass =
  "border-(--accent-button-border) bg-(--accent-button-bg) font-bold text-(--accent-button-text) hover:border-(--accent-button-hover-border) hover:bg-(--accent-button-hover-bg) hover:text-(--accent-button-text) focus-visible:border-(--accent-button-hover-border) focus-visible:bg-(--accent-button-hover-bg)";

export const rowClass =
  "relative grid grid-cols-[48px_1fr] items-start gap-2.5 rounded-surface border border-line p-3 shadow-row md:flex md:items-start md:gap-3 md:px-4 md:py-3";

/** The panel gradient. Inline because it mixes two custom properties. */
export const panelSurfaceStyle = {
  background:
    "linear-gradient(180deg, var(--surface-elevated), transparent 22%), var(--panel-fill)",
};

export const headerSurfaceStyle = { background: "var(--chrome-bg)" };
