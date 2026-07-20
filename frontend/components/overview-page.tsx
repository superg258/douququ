// frontend/components/overview-page.tsx
import { OverviewHero } from "@/components/overview-hero";
import { FinalsOverviewSection } from "@/components/finals-overview-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-screen-2xl mx-auto px-4 py-8 space-y-10">
        <OverviewHero
          serviceGeneratedLabel="赛程已同步"
          nextMatchHref="/forecast-center?event=repechage&mode=live"
          ctaLabel="进入复活赛对阵图"
        />
        <FinalsOverviewSection />
        <OverviewFooter />
      </div>
    </div>
  );
}
