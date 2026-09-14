import { Suspense } from "react";
import { redirect } from "next/navigation";

import CliplinkApp from "@/components/cliplink-app";
import { AppSkeleton } from "@/components/cliplink/app-skeleton";
import { RepoStars } from "@/components/cliplink/repo-stars";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/cliplink/room-code";

type HomeProps = {
  searchParams: Promise<{ room?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  // Rooms used to live at `/?room=CODE`. Redirecting rather than dropping the
  // link keeps already-shared ones working — and a redirect whose target has
  // no fragment of its own carries the existing one across, so the room key
  // survives the move.
  const { room } = await searchParams;
  const code = normalizeRoomCode(room);
  if (isValidRoomCode(code)) {
    redirect(`/room/${code}`);
  }

  return (
    <Suspense fallback={<AppSkeleton />}>
      <CliplinkApp repoLink={<RepoStars />} />
    </Suspense>
  );
}
