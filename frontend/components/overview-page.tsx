// frontend/components/overview-page.tsx
"use client";

import { useEffect, useState } from "react";
import { getOverview } from "@/lib/api";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import type { OverviewDashboard } from "@/lib/types";

import { OverviewHero } from "@/components/overview-hero";
import { RegionCardGrid } from "@/components/region-card-grid";
import { ComparisonSection } from "@/components/comparison-section";
import { OverviewFooter } from "@/components/overview-footer";

export function OverviewPage() {
  const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    getOverview()
      .then((res) => {
        if (!canceled) setDashboard(buildOverviewDashboard(res));
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
        <OverviewHero generatedLabel={dashboard.generatedLabel} />
        <RegionCardGrid regions={dashboard.regions} />
        <ComparisonSection strengths={dashboard.regionStrength} />
        <OverviewFooter />
      </div>
    </div>
  );
}
