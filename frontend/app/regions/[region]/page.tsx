import { RegionWorkspace } from "@/components/region-workspace";
import type { RegionSlug } from "@/lib/types";

interface PageProps {
  params: Promise<{ region: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function RegionPage(props: PageProps) {
  const params = await props.params;
  const regionSlug = (params.region as RegionSlug) || "north_region";

  return (
    <RegionWorkspace
      regionSlug={regionSlug}
    />
  );
}
