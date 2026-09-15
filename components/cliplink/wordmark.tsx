/**
 * The CLIPLINK wordmark, shared by the header and its pre-hydration skeleton.
 *
 * All capitals track open, not tight. Caps have no ascenders or descenders to
 * separate them, so the negative tracking that suits a lowercase headline
 * packs them into a block — and the P ran into the L exactly where the colour
 * changes. Semibold rather than bold, for the same reason: at this size the
 * heavier cut closes the counters of the C and P.
 */
export function Wordmark() {
  return (
    <div className="text-lg font-semibold tracking-wide md:text-xl">
      CLIP
      <span className="text-link">LINK</span>
    </div>
  );
}
