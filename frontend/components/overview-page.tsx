// frontend/components/overview-page.tsx
import { OverviewHero } from "@/components/overview-hero";
import { FinalsOverviewSection } from "@/components/finals-overview-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-screen-2xl mx-auto px-4 py-8 space-y-10">
        <OverviewHero
          serviceGeneratedLabel="官方赛程已接入"
          nextMatchHref="/forecast-center?event=repechage&view=matches"
          ctaLabel="查看复活赛赛程"
        />
        <FinalsOverviewSection />
        <OverviewFooter />
      </div>
    </div>
  );
}
