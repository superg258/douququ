import type { Metadata } from "next";
import { Suspense } from "react";

import { EloRankingsPage } from "@/components/elo-rankings-page";
import { PageLoadingFallback } from "@/components/page-loading-fallback";

export const metadata: Metadata = {
  title: "Elo 战力榜 · RMUC 2026",
};

export default function EloPage() {
  return (
    <Suspense fallback={<PageLoadingFallback label="正在加载 Elo 战力榜..." />}>
      <EloRankingsPage />
    </Suspense>
  );
}
