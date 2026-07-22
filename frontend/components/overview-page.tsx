// frontend/components/overview-page.tsx
import { OverviewHero } from "@/components/overview-hero";
import { FinalsOverviewSection } from "@/components/finals-overview-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  return (
    <div className="space-y-10">
      <OverviewHero />
      <FinalsOverviewSection />
      <OverviewFooter />
    </div>
  );
}
