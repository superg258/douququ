import type { Metadata } from "next";
import { Suspense } from "react";

import { PageLoadingFallback } from "@/components/page-loading-fallback";
import { TeamProfilePage } from "@/components/team-profile-page";

interface PageProps {
  params: Promise<{ teamKey: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const decoded = decodeURIComponent(params.teamKey);
  const collegeName = decoded.split("::")[0]?.trim() || "队伍档案";
  return { title: `${collegeName} · 队伍档案 · RMUC 2026` };
}

export default async function TeamProfileRoute(props: PageProps) {
  const params = await props.params;
  return (
    <Suspense fallback={<PageLoadingFallback label="正在加载队伍档案..." />}>
      <TeamProfilePage encodedTeamKey={params.teamKey} />
    </Suspense>
  );
}
