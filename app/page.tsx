import { Suspense } from "react";

import CliplinkApp from "@/components/cliplink-app";
import { AppSkeleton } from "@/components/cliplink/app-skeleton";

export default function Home() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <CliplinkApp />
    </Suspense>
  );
}
