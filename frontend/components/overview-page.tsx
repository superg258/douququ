// frontend/components/overview-page.tsx
import { OverviewHero } from "@/components/overview-hero";
import { TodayScheduleStrip } from "@/components/today-schedule-strip";
import { FinalsOverviewSection } from "@/components/finals-overview-section";
import { FinalsRecapSection } from "@/components/finals-recap-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  return (
    <div className="space-y-10">
      <OverviewHero />
      <TodayScheduleStrip />
      <FinalsOverviewSection />
      <FinalsRecapSection />
      <OverviewFooter />
    </div>
  );
}
