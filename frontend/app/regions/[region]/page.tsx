import { Suspense } from "react";
import type { Metadata } from "next";

import { RegionWorkspace } from "@/components/region-workspace";
import { REGION_LABELS } from "@/lib/region-config";
import type { RegionSlug } from "@/lib/types";

interface PageProps {
  params: Promise<{ region: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const regionLabel = REGION_LABELS[params.region as RegionSlug];

  return {
    title: regionLabel ? `${regionLabel} · 赛区工作区 · RMUC 2026` : "赛区工作区 · RMUC 2026",
  };
}

export default async function RegionPage(props: PageProps) {
  const params = await props.params;
  const regionSlug = (params.region as RegionSlug) || "north_region";

  return (
    <Suspense fallback={null}>
      <RegionWorkspace
        regionSlug={regionSlug}
      />
    </Suspense>
  );
}
