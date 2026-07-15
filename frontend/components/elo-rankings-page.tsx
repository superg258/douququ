// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useState } from "react";

import { FinalsEloRankings } from "@/components/finals-elo-rankings";
import { RankingsHero } from "@/components/rankings-hero";
import { getFinalEvent, getOverview } from "@/lib/api";
import { formatShortDateTimeLabel } from "@/lib/time-format";
import type { FinalEventResponse, OverviewResponse } from "@/lib/types";

interface EloPageData {
  overview: OverviewResponse;
  repechage: FinalEventResponse;
  nationals: FinalEventResponse;
}

export function EloRankingsPage() {
  const [data, setData] = useState<EloPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    Promise.all([
      getOverview(),
      getFinalEvent("repechage"),
      getFinalEvent("nationals"),
    ])
      .then(([overview, repechage, nationals]) => {
        if (canceled) return;
        setData({ overview, repechage, nationals });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (canceled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <RankingsHero
        generatedLabel={
          data
            ? formatShortDateTimeLabel(data.overview.generatedAt)
            : "同步中..."
        }
      />

      <main className="relative z-10 max-w-[1600px] mx-auto px-4 py-8">
        {error ? (
          <div className="p-4 bg-rm-red/5 border border-rm-red/30 text-rm-red font-mono text-sm mb-8">
            数据加载失败：{error}
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center py-20 text-rm-metal-textMuted">
            <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
            <span className="font-machine tracking-widest uppercase text-xs">
              加载战力数据...
            </span>
          </div>
        ) : (
          <FinalsEloRankings
            overview={data.overview}
            repechage={data.repechage}
            nationals={data.nationals}
          />
        )}
      </main>
    </div>
  );
}
