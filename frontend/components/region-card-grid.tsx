// frontend/components/region-card-grid.tsx
import type { RegionDashboardCard } from "@/lib/types";
import { RegionCard } from "@/components/region-card";

export function RegionCardGrid({ regions }: { regions: RegionDashboardCard[] }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <div className="h-4 w-0.5 bg-rm-red/60 shadow-[0_0_6px_rgba(232,48,42,0.3)]" />
          <div className="h-4 w-0.5 bg-rm-blue/60 shadow-[0_0_6px_rgba(42,159,255,0.3)]" />
        </div>
        <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight tracking-wide">
          赛区推演概览
        </h2>
      </div>
      <div
        className="grid gap-5 lg:gap-y-0 lg:grid-cols-3"
        style={{ gridTemplateRows: "repeat(8, auto)" }}
      >
        {regions.map((region) => (
          <RegionCard key={region.regionSlug} region={region} />
        ))}
      </div>
    </section>
  );
}
