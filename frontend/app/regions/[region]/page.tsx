import { RegionWorkspace } from "@/components/region-workspace";

export default async function RegionPage({ params }: { params: Promise<{ region: string }> }) {
  const { region } = await params;
  return <RegionWorkspace regionSlug={region} />;
}
