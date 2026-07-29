import { Suspense } from "react";

import { CanvasExportPage } from "@/components/canvas-export-page";

export default function CanvasExportRoute() {
  return (
    <Suspense fallback={null}>
      <CanvasExportPage />
    </Suspense>
  );
}
