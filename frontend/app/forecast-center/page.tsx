import { Suspense } from "react";
import type { Metadata } from "next";

import { ForecastCenterPage } from "@/components/forecast-center-page";
import { PageLoadingFallback } from "@/components/page-loading-fallback";

export const metadata: Metadata = {
  title: "实时预测中心 · RMUC 2026",
};

export default function ForecastCenterRoute() {
  return (
    <Suspense fallback={<PageLoadingFallback label="正在加载预测中心..." />}>
      <ForecastCenterPage />
    </Suspense>
  );
}
