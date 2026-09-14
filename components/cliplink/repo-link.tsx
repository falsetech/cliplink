import { REPO_URL } from "@/lib/cliplink/github";

import { IconGitHub } from "./icons";

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
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-white/2 px-3 text-2xs text-dim tabular-nums transition-[color,border-color,scale] duration-150 ease-out hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:text-fg active:scale-[0.96] md:min-h-10 md:min-w-10"
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
      {stars !== null ? <span aria-hidden="true">★ {compact.format(stars)}</span> : null}
    </a>
  );
}
