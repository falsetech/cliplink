import { REPO_URL } from "@/lib/cliplink/github";
import { cn } from "@/lib/utils";

import { IconGitHub, IconStar } from "./icons";
import { chromeButtonClass } from "./ui";

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
      className={cn(
        chromeButtonClass,
        stars !== null && "w-auto gap-1.5 px-3 text-xs tabular-nums text-muted-foreground hover:text-foreground pointer-coarse:w-auto",
      )}
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
