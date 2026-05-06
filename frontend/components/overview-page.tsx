// frontend/components/overview-page.tsx
"use client";

import { useEffect, useState } from "react";
import { getOverview, getPrematchCenter } from "@/lib/api";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import { buildRegionHref } from "@/lib/region-config";
import { sortPrematchMatchesByTime } from "@/lib/prematch-center";
import type { OverviewDashboard, PrematchCenterMatch, RegionSlug } from "@/lib/types";

import { OverviewHero } from "@/components/overview-hero";
import { PrematchCenter } from "@/components/prematch-center";
import { OverviewModelRecap } from "@/components/overview-model-recap";
import { RegionCardGrid } from "@/components/region-card-grid";
import { ComparisonSection } from "@/components/comparison-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
  const [nextMatchHref, setNextMatchHref] = useState<string | null>(null);
  const [regionEntryHrefs, setRegionEntryHrefs] = useState<Record<string, string | null>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    Promise.all([getOverview(), getPrematchCenter()])
      .then(([overviewRes, prematchRes]) => {
        if (!canceled) {
          setDashboard(buildOverviewDashboard(overviewRes));
          const next = prematchRes.nextActionMatch ?? prematchRes.nextMatch;
          if (next) {
            const mode = next.dataSource === "simulation" ? "sim" : "live";
            setNextMatchHref(buildRegionHref(next.regionSlug, next.workspaceView, { seed: next.seed, mode }));
          }
          // Per-region next-match hrefs for region card entry buttons
          const hrefs: Record<string, string | null> = {};
          const scheduled = sortPrematchMatchesByTime(
            prematchRes.allUpcomingMatches.filter(
              (m: PrematchCenterMatch) =>
                m.scheduleState === "scheduled" || m.scheduleState === "confirmed_unfinished"
            )
          );
          for (const slug of ["south_region", "east_region", "north_region"] as RegionSlug[]) {
            const match = scheduled.find((m: PrematchCenterMatch) => m.regionSlug === slug);
            if (match) {
              const mode = match.dataSource === "simulation" ? "sim" : "live";
              hrefs[slug] = buildRegionHref(match.regionSlug, match.workspaceView, { seed: match.seed, mode });
            } else {
              hrefs[slug] = null;
            }
          }
          setRegionEntryHrefs(hrefs);
        }
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { canceled = true; };
  }, []);

  if (error) {
    return (
      <div className="text-rm-red p-4 bg-rm-red/5 border border-rm-red/30 font-mono text-sm">
        数据加载失败：{error}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse">
        <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
        <span className="font-machine text-rm-blue tracking-widest uppercase text-xs">
          加载赛事数据...
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-screen-2xl mx-auto px-4 py-8 space-y-10">
        <OverviewHero generatedLabel={dashboard.generatedLabel} nextMatchHref={nextMatchHref} />
        <PrematchCenter />
        <OverviewModelRecap />
        <RegionCardGrid regions={dashboard.regions} regionEntryHrefs={regionEntryHrefs} />
        <ComparisonSection strengths={dashboard.regionStrength} />
        <OverviewFooter />
      </div>
    </div>
  );
}
