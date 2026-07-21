import type { Metadata } from "next";
import { Suspense } from "react";

import { EloRankingsPage } from "@/components/elo-rankings-page";

export const metadata: Metadata = {
  title: "Elo 战力榜 · RMUC 2026",
};

export default function EloPage() {
  return (
    <Suspense fallback={null}>
      <EloRankingsPage />
    </Suspense>
  );
}
