"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getFinalEvents, getOverview } from "@/lib/api";
import { buildFinalsPredictionRecap } from "@/lib/finals-recap";
import type { FinalsPredictionRecap } from "@/lib/finals-recap";
import { hasOfficialFinalMatchData, simulateFinalsLiveEvents } from "@/lib/finals-simulation";
import { DEFAULT_SEED } from "@/lib/region-config";
import { LIVE_REFRESH_INTERVAL_MS, startRealtimePolling } from "@/lib/realtime-polling";
import type { FinalEventResponse, FinalEventSlug, OverviewResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<FinalEventSlug, string> = {
  repechage: "复活赛",
  nationals: "全国赛",
};

function pct(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function MetricCard({ label, value, tone = "text-rm-metal-textLight" }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="relative overflow-hidden border border-rm-metal-border bg-rm-metal-card px-3 py-2"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
    >
      <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">{label}</div>
      <div className={cn("font-mono text-lg font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function FinalsRecapSection() {
  const [recap, setRecap] = useState<FinalsPredictionRecap | null>(null);

  useEffect(() => {
    let canceled = false;
    const load = () => {
      Promise.allSettled([getOverview(), getFinalEvents("live")]).then((results) => {
        if (canceled) return;
        const [overviewResult, finalsResult] = results;
        if (overviewResult.status !== "fulfilled" || finalsResult.status !== "fulfilled") return;
        const overview: OverviewResponse = overviewResult.value;
        const events: Partial<Record<FinalEventSlug, FinalEventResponse>> = finalsResult.value.events;
        if (!events.repechage || !events.nationals) return;
        const repechage = events.repechage.event;
        const nationals = events.nationals.event;
        if (!hasOfficialFinalMatchData(repechage) && !hasOfficialFinalMatchData(nationals)) {
          setRecap(buildFinalsPredictionRecap(null, { repechage, nationals }));
          return;
        }
        const simulation = simulateFinalsLiveEvents(repechage, nationals, overview, DEFAULT_SEED);
        setRecap(buildFinalsPredictionRecap(simulation, { repechage, nationals }));
      });
    };
    const stopPolling = startRealtimePolling(load, LIVE_REFRESH_INTERVAL_MS, { pauseWhenHidden: true });
    return () => {
      canceled = true;
      stopPolling();
    };
  }, []);

  if (!recap) return null;
  const { summary } = recap;

  return (
    <section aria-labelledby="finals-recap-heading" className="space-y-4">
      {/* Section header */}
      <div
        className="relative overflow-hidden border border-rm-metal-border bg-rm-metal-panel"
        style={{
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)",
          background: "radial-gradient(ellipse at 0% 50%, rgba(168,85,247,0.05) 0%, transparent 70%)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <span className="h-5 w-1 rounded-full bg-rm-status-deviation/70 shadow-[0_0_8px_rgba(168,85,247,0.3)]" />
          <h2 id="finals-recap-heading" className="font-sans text-sm font-semibold tracking-wide text-rm-metal-textLight">
            模型战绩复盘
          </h2>
          <span className="ml-auto font-mono text-[10px] text-rm-metal-textFaint">
            仅统计复活赛 / 全国赛真实赛果 · 区域赛历史已归零
          </span>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid gap-2 sm:grid-cols-4">
        <MetricCard label="已复盘场次" value={`${summary.completedMatches} 场`} />
        <MetricCard label="胜负预测命中率" value={pct(summary.winnerHitRate)} tone="text-rm-status-safe" />
        <MetricCard label="比分预测命中率" value={pct(summary.scorelineHitRate)} tone="text-rm-blue" />
        <MetricCard
          label="爆冷偏离场次"
          value={`${summary.upsetMisses} 场`}
          tone={summary.upsetMisses > 0 ? "text-rm-status-upset" : "text-rm-metal-textLight"}
        />
      </div>

      {/* Per-event breakdown */}
      <div className="grid gap-2 md:grid-cols-2">
        {(["repechage", "nationals"] as FinalEventSlug[]).map((eventSlug) => {
          const group = recap.byEvent[eventSlug];
          return (
            <div
              key={eventSlug}
              className="border border-rm-metal-border bg-rm-metal-panel px-3 py-2"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
            >
              <div className="font-sans text-sm font-semibold text-rm-metal-textLight">{EVENT_LABELS[eventSlug]}</div>
              <div className="mt-1 font-mono text-[11px] text-rm-metal-textMuted">
                已复盘 {group.completedMatches} 场 · 胜负命中 {pct(group.winnerHitRate)} · 比分命中 {pct(group.scorelineHitRate)} · 爆冷 {group.upsetMisses} 场
              </div>
            </div>
          );
        })}
      </div>

      {summary.completedMatches === 0 ? (
        <div className="border border-rm-metal-border/70 bg-rm-metal-panel/60 px-4 py-3 font-mono text-[11px] text-rm-metal-textFaint">
          复活赛开赛后，每一场真实赛果都会与赛前预测自动比对并累计到这里。
        </div>
      ) : null}

      {/* Notable deviation matches */}
      {recap.notableMatches.length > 0 ? (
        <div className="space-y-2">
          <div
            className="relative overflow-hidden border border-rm-metal-border bg-rm-metal-panel px-4 py-2"
            style={{
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
              background: "radial-gradient(ellipse at 0% 50%, rgba(232,48,42,0.04) 0%, transparent 70%)",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-0.5 bg-rm-status-upset/50" />
              <span className="font-mono text-[10px] tracking-widest text-rm-metal-textFaint">预测偏离场次</span>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {recap.notableMatches.map((match) => {
              const isUpset = match.deviationType === "upset_miss";
              return (
                <Link
                  key={match.id}
                  href={`/forecast-center?event=${match.eventSlug}&mode=live`}
                  className="group relative overflow-hidden border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-colors hover:border-rm-status-deviation/40"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">
                      {EVENT_LABELS[match.eventSlug]} · {match.stage}
                    </span>
                    <span className={cn(
                      "border px-1.5 py-0.5 font-mono text-[9px]",
                      isUpset
                        ? "border-rm-status-upset/40 bg-rm-status-upset/10 text-rm-status-upset"
                        : "border-rm-status-warn/40 bg-rm-status-warn/10 text-rm-status-warn",
                    )}>
                      {isUpset ? "爆冷" : "比分偏离"}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs font-semibold text-rm-metal-textLight">
                    <span>{match.redCollegeName}</span>
                    <span className="mx-2 font-mono text-[10px] text-rm-metal-textFaint">vs</span>
                    <span>{match.blueCollegeName}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-rm-metal-textMuted">
                    预测 {match.predictedWinnerName} {match.predictedScoreline}
                    <span className="mx-1.5 text-rm-metal-textFaint">→</span>
                    实际 {match.actualWinnerName} {match.actualScoreline}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
