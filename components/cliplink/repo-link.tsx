import { REPO_URL } from "@/lib/cliplink/github";

import { IconGitHub, IconStar } from "./icons";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type RepoLinkProps = {
  /** Null while loading or when GitHub could not be reached. */
  stars: number | null;
};

export function RepoLink({ stars }: RepoLinkProps) {
  return (
    <a
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-input bg-muted px-3 text-2xs text-muted-foreground tabular-nums transition-[color,border-color,scale] duration-150 ease-out hover:border-primary hover:text-foreground focus-visible:border-primary focus-visible:text-foreground active:scale-[0.96] md:min-h-10 md:min-w-10"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        stars === null
          ? "CLIPLINK on GitHub"
          : `CLIPLINK on GitHub, ${stars.toLocaleString("en")} stars`
      }
    >
      <IconGitHub size={16} />
      {stars !== null ? (
        // The count streams in after the link, so it fades in rather than popping.
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-0.5 transition-opacity duration-200 ease-out starting:opacity-0"
        >
          <IconStar size={10} />
          {compact.format(stars)}
        </span>
      ) : null}
    </a>
  );
}
