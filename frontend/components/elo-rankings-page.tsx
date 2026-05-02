// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getOverview } from "@/lib/api";
import { buildEloRankingsDashboard } from "@/lib/overview-builders";
import type { OverviewResponse } from "@/lib/types";

import { RankingsHero } from "@/components/rankings-hero";
import { RankingsColumns } from "@/components/rankings-columns";

export function EloRankingsPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, []);

  const dashboard = useMemo(
    () => (data ? buildEloRankingsDashboard(data) : null),
    [data],
  );

  return (
    <div className="min-h-screen">
      <RankingsHero generatedLabel={dashboard?.generatedLabel ?? "同步中..."} />

      <main className="relative z-10 max-w-[1600px] mx-auto px-4 py-8">
        {error ? (
          <div className="p-4 bg-rm-red/5 border border-rm-red/30 text-rm-red font-mono text-sm mb-8">
            数据加载失败：{error}
          </div>
        ) : !dashboard ? (
          <div className="flex flex-col items-center justify-center py-20 text-rm-metal-textMuted">
            <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
            <span className="font-machine tracking-widest uppercase text-xs">
              加载战力数据...
            </span>
          </div>
        ) : (
          <RankingsColumns sections={dashboard.sections} />
        )}
      </main>
    </div>
  );
}
