import { Suspense } from "react";
import { redirect } from "next/navigation";

import CliplinkApp from "@/components/cliplink-app";
import { AppSkeleton } from "@/components/cliplink/app-skeleton";
import { RepoStars } from "@/components/cliplink/repo-stars";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/cliplink/room-code";

type RoomPageProps = {
  params: Promise<{ code: string }>;
};

/**
 * The room lives at a path so it can be linked to, bookmarked and shared as a
 * place rather than a query on the landing page.
 *
 * The room *key* is never part of this — it belongs in the fragment, which the
 * browser does not transmit. A key in the path or the query string would be
 * sent to the server on every navigation and written to its access logs, which
 * is exactly the disclosure the whole design exists to prevent.
 */
export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params;
  const normalized = normalizeRoomCode(code);
  // Nothing here can be a room, so there is nothing to show and no error worth
  // a page of its own — the entry point is where a code gets typed.
  if (!isValidRoomCode(normalized)) {
    redirect("/");
  }

  return (
    <Suspense fallback={<AppSkeleton />}>
      <CliplinkApp initialRoomCode={normalized} repoLink={<RepoStars />} />
    </Suspense>
  );
}
