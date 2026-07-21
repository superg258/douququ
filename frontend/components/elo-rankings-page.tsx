// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { FinalsEloRankings } from "@/components/finals-elo-rankings";
import { RankingsHero } from "@/components/rankings-hero";
import { ErrorPanel } from "@/components/ui/async-state";
import { getFinalEvent, getOverview } from "@/lib/api";
import { hasOfficialFinalMatchData, simulateFinalsLiveEvents } from "@/lib/finals-simulation";
import { DEFAULT_SEED } from "@/lib/region-config";
import { LIVE_REFRESH_INTERVAL_MS, startRealtimePolling } from "@/lib/realtime-polling";
import { formatShortDateTimeLabel } from "@/lib/time-format";
import type { FinalEventResponse, OverviewResponse } from "@/lib/types";

interface EloPageData {
  overview: OverviewResponse | null;
  repechage?: FinalEventResponse;
  nationals?: FinalEventResponse;
}

export function EloRankingsPage() {
  const [data, setData] = useState<EloPageData>({ overview: null });
  const [errors, setErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const load = () => {
      Promise.allSettled([getOverview(), getFinalEvent("repechage"), getFinalEvent("nationals")]).then((results) => {
        if (signal.aborted) return;
        const [overviewResult, repechageResult, nationalsResult] = results;
        const nextErrors: string[] = [];
        setData((current) => ({
          overview: overviewResult.status === "fulfilled" ? overviewResult.value : current.overview,
          repechage: repechageResult.status === "fulfilled" ? repechageResult.value : current.repechage,
          nationals: nationalsResult.status === "fulfilled" ? nationalsResult.value : current.nationals,
        }));
        if (overviewResult.status === "rejected") nextErrors.push("战力数据");
        if (repechageResult.status === "rejected") nextErrors.push("复活赛名单");
        if (nationalsResult.status === "rejected") nextErrors.push("全国赛名单");
        setErrors(nextErrors);
      });
    };
    const stopPolling = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });

    return () => {
      controller.abort();
      stopPolling();
    };
  }, [reloadKey]);

  const handleRetry = () => {
    setErrors([]);
    setReloadKey((key) => key + 1);
  };

  // 实时 Elo：吸收已完成赛果后的赛事 Elo，优先于 overview 静态值
  const liveEloByEventSlug = useMemo(() => {
    if (!data.overview || !data.repechage || !data.nationals) return null;
    if (!hasOfficialFinalMatchData(data.repechage.event) && !hasOfficialFinalMatchData(data.nationals.event)) return null;
    const simulation = simulateFinalsLiveEvents(
      data.repechage.event,
      data.nationals.event,
      data.overview,
      DEFAULT_SEED,
    );
    return {
      repechage: simulation.repechage.finalEloByTeamKey,
      nationals: simulation.nationals.finalEloByTeamKey,
      repechageQualifierTeamKeys: simulation.repechage.qualifierTeamKeys,
      eloTrajectoryByTeamKey: {
        ...simulation.repechage.eloTrajectoryByTeamKey,
        ...simulation.nationals.eloTrajectoryByTeamKey,
      } as Record<string, number[]>,
    };
  }, [data.overview, data.repechage, data.nationals]);

  const canRender = Boolean(data.overview && (data.repechage || data.nationals));

  return (
    <div className="min-h-screen">
      <RankingsHero
        generatedLabel={
          data.overview
            ? formatShortDateTimeLabel(data.overview.generatedAt)
            : "同步中..."
        }
      />

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 py-8">
        {!canRender && errors.length ? (
          <ErrorPanel
            message={`数据加载失败：${errors.join("、")}`}
            onRetry={handleRetry}
          />
        ) : !canRender ? (
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
            overview={data.overview!}
            repechage={data.repechage}
            nationals={data.nationals}
            finalEloByTeamKey={
              liveEloByEventSlug
                ? { ...liveEloByEventSlug.repechage, ...liveEloByEventSlug.nationals }
                : null
            }
            repechageQualifierTeamKeys={liveEloByEventSlug?.repechageQualifierTeamKeys}
            eloTrajectoryByTeamKey={liveEloByEventSlug?.eloTrajectoryByTeamKey ?? null}
          />
        )}
        {canRender && errors.length ? (
          <div className="mt-4 border border-rm-status-warn/35 bg-rm-status-warn/5 px-4 py-3 text-xs text-rm-status-warn">
            {errors.join("、")}暂不可用，其余榜单已正常显示。
            <button type="button" onClick={handleRetry} className="ml-3 underline underline-offset-2">重试</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
