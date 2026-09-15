import type { Metadata } from "next";
import { Suspense } from "react";

import CliplinkApp from "@/components/cliplink-app";
import { AppSkeleton } from "@/components/cliplink/app-skeleton";
import { RepoStars } from "@/components/cliplink/repo-stars";

export const metadata: Metadata = {
  robots: { index: false },
};

type SharePageProps = {
  searchParams: Promise<{ error?: string }>;
};

/**
 * Where the OS share sheet lands, by way of the service worker's redirect. The
 * shared content itself never comes through here: the worker keeps it on the
 * device and the client reads it back.
 */
export default async function SharePage({ searchParams }: SharePageProps) {
  const { error } = await searchParams;
  return (
    <Suspense fallback={<AppSkeleton />}>
      <CliplinkApp repoLink={<RepoStars />} share={{ error }} />
    </Suspense>
  );
}
