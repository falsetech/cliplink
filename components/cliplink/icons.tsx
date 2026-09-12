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
