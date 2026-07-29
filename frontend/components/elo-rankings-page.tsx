// frontend/components/elo-rankings-page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { FinalsEloRankings } from "@/components/finals-elo-rankings";
import { RankingsHero } from "@/components/rankings-hero";
import { ErrorPanel } from "@/components/ui/async-state";
import { getFinalEvents, getLiveState, getOverview } from "@/lib/api";
import { buildFullSeasonTrajectories } from "@/lib/elo-trajectory";
import { hasOfficialFinalMatchData, simulateFinalsLiveEvents } from "@/lib/finals-simulation";
import { DEFAULT_SEED, REGION_ORDER } from "@/lib/region-config";
import { LIVE_REFRESH_INTERVAL_MS, startRealtimePolling } from "@/lib/realtime-polling";
import { formatShortDateTimeLabel } from "@/lib/time-format";
import type { FinalEventResponse, LiveStateResponse, OverviewResponse } from "@/lib/types";

interface EloPageData {
  overview: OverviewResponse | null;
  repechage?: FinalEventResponse;
  nationals?: FinalEventResponse;
  regionLiveStates?: LiveStateResponse[];
}

export function EloRankingsPage() {
  const [data, setData] = useState<EloPageData>({ overview: null });
  const [errors, setErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const load = () => {
      Promise.allSettled([
        getOverview(signal),
        getFinalEvents("live", signal),
        ...REGION_ORDER.map((slug) => getLiveState(slug, signal)),
      ]).then((results) => {
        if (signal.aborted) return;
        const [overviewResult, finalsResult, ...liveStateResults] = results;
        const nextErrors: string[] = [];
        setData((current) => ({
          overview: overviewResult.status === "fulfilled" ? overviewResult.value : current.overview,
          repechage: finalsResult.status === "fulfilled" ? finalsResult.value.events.repechage : current.repechage,
          nationals: finalsResult.status === "fulfilled" ? finalsResult.value.events.nationals : current.nationals,
          regionLiveStates: liveStateResults
            .map((r) => (r.status === "fulfilled" ? r.value : null))
            .filter((v): v is LiveStateResponse => v !== null),
        }));
        if (overviewResult.status === "rejected") nextErrors.push("战力数据");
        if (finalsResult.status === "rejected") nextErrors.push("全国赛阶段数据");
        if (liveStateResults.every((r) => r.status === "rejected")) nextErrors.push("区域赛实时数据");
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

    const hasFinalsData =
      hasOfficialFinalMatchData(data.repechage.event) ||
      hasOfficialFinalMatchData(data.nationals.event);

    // 决赛轨迹（仅当有真实赛果时运行模拟）
    let mergedTrajectories: Record<string, number[]> = {};
    let repechageElo: Record<string, number> = {};
    let nationalsElo: Record<string, number> = {};

    if (hasFinalsData) {
      const simulation = simulateFinalsLiveEvents(
        data.repechage.event,
        data.nationals.event,
        data.overview,
        DEFAULT_SEED,
      );
      repechageElo = simulation.repechage.finalEloByTeamKey;
      nationalsElo = simulation.nationals.finalEloByTeamKey;

      // 合并复活赛与全国赛轨迹：同一队伍出现在两个赛事时，拼接而非覆盖
      for (const [teamKey, traj] of Object.entries(simulation.repechage.eloTrajectoryByTeamKey)) {
        mergedTrajectories[teamKey] = traj;
      }
      for (const [teamKey, traj] of Object.entries(simulation.nationals.eloTrajectoryByTeamKey)) {
        const existing = mergedTrajectories[teamKey];
        // 两条轨迹都以 [preseasonElo, ...] 开头，跳过全国赛的首点避免重复
        mergedTrajectories[teamKey] = existing ? [...existing, ...traj.slice(1)] : traj;
      }
    }

    // 注入区域赛逐场记录：无论决赛数据是否存在，都构建完整赛季轨迹
    const regionLedgers = (data.regionLiveStates ?? [])
      .filter((ls) => ls.available && ls.matchLedger.length > 0)
      .map((ls) => ls.matchLedger);
    const fullSeasonTrajectories =
      regionLedgers.length > 0
        ? buildFullSeasonTrajectories(data.overview, regionLedgers, mergedTrajectories)
        : mergedTrajectories;

    // 既没有决赛数据、也没有区域赛轨迹时才返回 null
    if (!hasFinalsData && Object.keys(fullSeasonTrajectories).length === 0) return null;

    return {
      repechage: repechageElo,
      nationals: nationalsElo,
      eloTrajectoryByTeamKey: fullSeasonTrajectories,
    };
  }, [data.overview, data.repechage, data.nationals, data.regionLiveStates]);

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
