import { Suspense } from "react";

import { getRepoStars } from "@/lib/cliplink/github";

import { RepoLink } from "./repo-link";

async function RepoStarsLoaded() {
  return <RepoLink stars={await getRepoStars()} />;
}

/**
 * Server-rendered and streamed: the link is usable immediately, and the count
 * fills in when GitHub answers, so the header never waits on a third party.
 */
export function RepoStars() {
  return (
    <Suspense fallback={<RepoLink stars={null} />}>
      <RepoStarsLoaded />
    </Suspense>
  );
}
