// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useState } from "react";

import { FinalsEloRankings } from "@/components/finals-elo-rankings";
import { RankingsHero } from "@/components/rankings-hero";
import { ErrorPanel } from "@/components/ui/async-state";
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
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      getOverview(),
      getFinalEvent("repechage"),
      getFinalEvent("nationals"),
    ])
      .then(([overview, repechage, nationals]) => {
        if (signal.aborted) return;
        setData({ overview, repechage, nationals });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  const handleRetry = () => {
    setData(null);
    setError(null);
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="min-h-screen">
      <RankingsHero
        generatedLabel={
          data
            ? formatShortDateTimeLabel(data.overview.generatedAt)
            : "同步中..."
        }
      />

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 py-8">
        {error ? (
          <ErrorPanel
            message={`数据加载失败：${error}`}
            onRetry={handleRetry}
          />
        ) : !data ? (
          <div
            role="status"
            aria-label="加载中"
            className="flex flex-col items-center justify-center py-20 text-rm-metal-textMuted"
          >
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
      </div>
    </div>
  );
}
