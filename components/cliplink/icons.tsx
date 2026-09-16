/**
 * One icon set, one optical weight.
 *
 * Every glyph is drawn in a 24-unit viewBox but rendered much smaller, so a
 * fixed `strokeWidth` produces a different stroke on screen at every size — the
 * set previously ranged from 0.83px to 1.46px, and the thin end rasterised grey
 * rather than coloured. `strokeWidth` is therefore derived from the render size
 * so the on-screen stroke is constant, and matched to the weight of the text
 * the icon sits beside.
 */

type IconWeight = "regular" | "bold";

type IconProps = {
  /** Rendered size in px. */
  size?: number;
  /** `regular` tracks 400-weight text at 1.5px; `bold` tracks 600+ at 2px. */
  weight?: IconWeight;
};

const VIEWBOX = 24;
const STROKE_PX: Record<IconWeight, number> = { regular: 1.5, bold: 2 };

function strokeWidthFor(size: number, weight: IconWeight) {
  return (STROKE_PX[weight] * VIEWBOX) / size;
}

function Svg({
  size = 14,
  weight = "regular",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidthFor(size, weight)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** A brand mark, so it is filled and not drawn in the stroke set's weight. */
export function IconGitHub({ size = 14 }: Pick<IconProps, "size">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Filled, so a 10px star keeps its shape instead of thinning to an outline. */
export function IconStar({ size = 14 }: Pick<IconProps, "size">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M12 2.5a1 1 0 0 1 .9.56l2.52 5.1 5.63.82a1 1 0 0 1 .55 1.7l-4.07 3.97.96 5.6a1 1 0 0 1-1.45 1.06L12 18.66l-5.04 2.65a1 1 0 0 1-1.45-1.06l.96-5.6-4.07-3.97a1 1 0 0 1 .55-1.7l5.63-.82 2.52-5.1A1 1 0 0 1 12 2.5Z" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

/** Outline, like the rest of the set — fill is reserved for active states. */
export function IconQr(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3M20 14h1M14 17v4M17 20h4M20 17v0" />
    </Svg>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 11.5L12.5 20a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 0 1 5.19 5.19l-8.5 8.49a1.83 1.83 0 0 1-2.59-2.59L15.1 7.1" />
    </Svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </Svg>
  );
}

/** Points right when closed; the caller rotates it to point down when open. */
export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function IconTheme({ theme, ...props }: IconProps & { theme: "dark" | "light" }) {
  if (theme === "light") {
    return (
      <Svg {...props}>
        <path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        <circle cx="12" cy="12" r="4" />
      </Svg>
    );
  }

  return (
    <Svg {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </Svg>
  );
}
