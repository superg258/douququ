import { Suspense } from "react";

import { CanvasExportPage } from "@/components/canvas-export-page";
import { PageLoadingFallback } from "@/components/page-loading-fallback";

export default function CanvasExportRoute() {
  return (
    <Suspense fallback={<PageLoadingFallback label="正在准备导出画布..." />}>
      <CanvasExportPage />
    </Suspense>
  );
}
