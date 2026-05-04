// frontend/components/prematch-center.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPrematchCenter } from "@/lib/api";
import {
  formatEmptyStateCount,
  EMPTY_STATE_REGION_LINKS,
  selectSpotlightMatches,
  sortPrematchMatchesByTime,
} from "@/lib/prematch-center";
import type { PrematchCenterMatch, PrematchCenterResponse } from "@/lib/types";
import { PrematchMatchCard } from "@/components/prematch-match-card";

function SectionHeader({
  block,
  label,
  count,
  accent,
}: {
  block?: string;
  label?: string;
  count: number;
  accent: string;
}) {
  const displayLabel = block ? `▸ ${block}` : label!;
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`h-3.5 w-0.5 ${accent}`} />
      <span className="font-mono text-[11px] text-rm-metal-textMuted/90 tracking-wider">
        {displayLabel}
        <span className="text-rm-metal-textFaint/70 ml-1">· {count} 场</span>
      </span>
    </div>
  );
}

function CardGrid({ matches }: { matches: PrematchCenterMatch[] }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((match) => (
        <PrematchMatchCard key={match.id} match={match} />
      ))}
    </div>
  );
}

function isScheduled(m: PrematchCenterMatch) {
  return m.scheduleState === "scheduled" || m.scheduleState === "confirmed_unfinished";
}

export function PrematchCenter() {
  const [data, setData] = useState<PrematchCenterResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    getPrematchCenter()
      .then((res) => {
        if (!canceled) setData(res);
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, []);

  /* ── Error ── */
  if (error) {
    return (
      <section>
        <div className="text-rm-red p-4 bg-rm-red/5 border border-rm-red/30 font-mono text-xs">
          赛前预测数据加载失败：{error}
        </div>
      </section>
    );
  }

  /* ── Loading ── */
  if (!data) {
    return (
      <section className="flex flex-col items-center justify-center py-16 animate-pulse">
        <div className="w-8 h-8 border-4 border-rm-blue/30 border-t-rm-blue rounded-full animate-spin mb-4" />
        <span className="font-mono text-rm-blue tracking-widest uppercase text-xs">
          加载预测数据...
        </span>
      </section>
    );
  }

  const {
    targetDate,
    source,
    completedMatchCount,
    pendingMatchCount,
    nextMatch,
    allUpcomingMatches,
  } = data;
  const isProxy = source.effectiveMode === "simulation_proxy";
  const isAllDone = pendingMatchCount === 0;

  // Only show scheduled/confirmed matches — never pure simulation
  const scheduledMatches = sortPrematchMatchesByTime(allUpcomingMatches.filter(isScheduled));
  const scheduledNext = nextMatch && isScheduled(nextMatch) ? nextMatch : null;
  const scheduledOthers = scheduledNext
    ? scheduledMatches.filter((m) => m.id !== scheduledNext.id)
    : scheduledMatches;
  const scheduledCount = scheduledMatches.length;
  const spotlightMatches = selectSpotlightMatches(scheduledOthers);
  const spotlightIds = new Set(spotlightMatches.map((m) => m.id));
  const remainingScheduledMatches = scheduledOthers.filter((m) => !spotlightIds.has(m.id));

  return (
    <section>
      {/* ── Section title ── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <div className="h-4 w-0.5 bg-rm-red/60 shadow-[0_0_6px_rgba(232,48,42,0.3)]" />
          <div className="h-4 w-0.5 bg-rm-blue/60 shadow-[0_0_6px_rgba(42,159,255,0.3)]" />
        </div>
        <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight tracking-wide">
          赛前预测中心
        </h2>
      </div>

      {/* ══════════════════════════════════════
          Layer 1 — Top status bar
          ══════════════════════════════════════ */}
      <div className="relative bg-rm-metal-panel border border-rm-metal-border mb-5
        overflow-hidden"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)" }}
      >
        {/* Left accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-rm-red/60 via-rm-red/20 to-rm-blue/20 via-rm-blue/60" />

        {/* Animated scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025] overflow-hidden">
          <div className="absolute inset-0 animate-scanline"
            style={{
              backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.6) 3px, rgba(255,255,255,0.6) 4px)",
              backgroundSize: "100% 8px",
              height: "200%",
            }}
          />
        </div>

        <div className="relative px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-rm-metal-textFaint/60 tracking-[0.15em] text-[10px]">DATE</span>
            <span className="text-rm-metal-textLight font-semibold">{targetDate}</span>
          </div>

          <span className="text-rm-metal-textFaint/30 select-none">|</span>

          {isAllDone ? (
            <span className="text-rm-status-safe flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rm-status-safe shadow-[0_0_4px_rgba(0,232,120,0.6)] animate-dot-pulse" />
              全部完赛 · 已完赛 {completedMatchCount} 场
            </span>
          ) : (
            <span className="text-rm-status-warn flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rm-status-warn shadow-[0_0_4px_rgba(255,176,0,0.6)] animate-dot-pulse" />
              未赛 {pendingMatchCount} 场 / 已完赛 {completedMatchCount} 场
            </span>
          )}

          <span className="text-rm-metal-textFaint/30 select-none">|</span>

          {/* Data source status */}
          {isProxy && (
            <span className="text-rm-status-warn bg-rm-status-warn/8 px-2 py-0.5 border border-rm-status-warn/20">
              实时源不可用，当前展示模拟代理预测
            </span>
          )}
          {!isProxy && source.effectiveMode === "live" && (
            <span className="text-rm-status-safe flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rm-status-safe shadow-[0_0_4px_rgba(0,232,120,0.6)] animate-dot-pulse" />
              官方实时数据已连接
            </span>
          )}
          {!isProxy && source.effectiveMode === "sim" && (
            <span className="text-rm-status-prediction flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rm-status-prediction shadow-[0_0_4px_rgba(42,159,255,0.6)] animate-dot-pulse" />
              模拟推演模式
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════
          Empty state — all matches completed
          ══════════════════════════════════════ */}
      {isAllDone && (
        <div className="relative bg-rm-metal-panel border border-rm-metal-border
          overflow-hidden"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)" }}
        >
          {/* Top accent bar */}
          <div className="h-0.5 bg-gradient-to-r from-rm-red/50 via-rm-blue/50 to-rm-violet/50" />

          {/* Animated scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.025] overflow-hidden">
            <div className="absolute inset-0 animate-scanline"
              style={{
                backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.6) 3px, rgba(255,255,255,0.6) 4px)",
                backgroundSize: "100% 8px",
                height: "200%",
              }}
            />
          </div>

          {/* Corner rivets */}
          <div className="absolute top-4 left-4 w-1.5 h-1.5 rounded-full bg-rm-metal-textMuted/20" />
          <div className="absolute top-4 right-4 w-1.5 h-1.5 rounded-full bg-rm-metal-textMuted/20" />
          <div className="absolute bottom-4 left-4 w-1.5 h-1.5 rounded-full bg-rm-metal-textMuted/20" />
          <div className="absolute bottom-4 right-4 w-1.5 h-1.5 rounded-full bg-rm-metal-textMuted/20" />

          <div className="relative px-6 py-8 text-center space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-3 mb-1">
                <span className="h-px w-8 bg-rm-metal-textFaint/20" />
                <span className="font-mono text-[9px] text-rm-metal-textFaint/40 tracking-[0.3em] uppercase">
                  赛事完结
                </span>
                <span className="h-px w-8 bg-rm-metal-textFaint/20" />
              </div>
              <p className="font-sans text-base font-semibold text-rm-metal-textLight">
                当前接入赛程均已完赛
              </p>
              <p className="font-mono text-xs text-rm-metal-textMuted leading-relaxed max-w-lg mx-auto">
                {formatEmptyStateCount(completedMatchCount)}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {EMPTY_STATE_REGION_LINKS.map((link, i) => {
                const regionAccent = [
                  "shadow-[inset_0_1px_0_rgba(232,48,42,0.15)] hover:border-rm-red/40 hover:shadow-[0_0_20px_rgba(232,48,42,0.08)]",
                  "shadow-[inset_0_1px_0_rgba(42,159,255,0.15)] hover:border-rm-blue/40 hover:shadow-[0_0_20px_rgba(42,159,255,0.08)]",
                  "shadow-[inset_0_1px_0_rgba(139,92,246,0.15)] hover:border-rm-violet/40 hover:shadow-[0_0_20px_rgba(139,92,246,0.08)]",
                ][i];
                const dotColor = [
                  "bg-rm-red/70 shadow-[0_0_6px_rgba(232,48,42,0.5)]",
                  "bg-rm-blue/70 shadow-[0_0_6px_rgba(42,159,255,0.5)]",
                  "bg-rm-violet/70 shadow-[0_0_6px_rgba(139,92,246,0.5)]",
                ][i];

                return (
                  <Link
                    key={link.regionSlug}
                    href={link.href}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 bg-rm-metal-card border border-rm-metal-border
                      transition-all duration-200 font-mono text-xs text-rm-metal-textLight
                      hover:scale-[1.02] ${regionAccent}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          Layer 2 — Next match hero (scheduled only)
          ══════════════════════════════════════ */}
      {!isAllDone && scheduledNext && (
        <div className="mb-5">
          <PrematchMatchCard match={scheduledNext} variant="hero" />
        </div>
      )}

      {/* ══════════════════════════════════════
          Layer 3 — Scheduled match list
          ══════════════════════════════════════ */}
      {!isAllDone && scheduledOthers.length > 0 && (
        <div className="space-y-5">
          {spotlightMatches.length > 0 && (
            <div>
              <SectionHeader
                label="▸ 焦点战局"
                count={spotlightMatches.length}
                accent="bg-rm-status-warn/60"
              />
              <CardGrid matches={spotlightMatches} />
            </div>
          )}

          {(() => {
            if (remainingScheduledMatches.length === 0) return null;
            const shown = remainingScheduledMatches.slice(0, 12);
            const overflow = remainingScheduledMatches.length - shown.length;

            return (
              <div>
                <SectionHeader
                  label="▸ 其他已排期赛程"
                  count={remainingScheduledMatches.length}
                  accent="bg-rm-status-scheduled/60"
                />
                <CardGrid matches={shown} />
                {overflow > 0 && (
                  <p className="text-center mt-3 font-mono text-[10px] text-rm-metal-textFaint/50">
                    另有 {overflow} 场已排期赛程可在赛区沙盘查看
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── No scheduled matches at all ── */}
      {!isAllDone && scheduledCount === 0 && (
        <div className="bg-rm-metal-panel border border-rm-metal-border px-6 py-6 text-center space-y-4">
          <div>
            <p className="font-sans text-sm font-semibold text-rm-metal-textLight mb-1">
              暂无已排期赛程
            </p>
            <p className="font-mono text-[11px] text-rm-metal-textMuted leading-relaxed max-w-md mx-auto">
              当前 {pendingMatchCount} 场未赛均为模拟推演。待官方同步赛程后，已排期场次将在此展示。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {EMPTY_STATE_REGION_LINKS.map((link, i) => (
              <Link
                key={link.regionSlug}
                href={link.href}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rm-metal-card border border-rm-metal-border
                  hover:border-rm-metal-textMuted/30 transition-colors duration-200
                  font-mono text-[11px] text-rm-metal-textLight"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
