// frontend/components/prematch-center.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPrematchCenter } from "@/lib/api";
import {
  formatEmptyStateCount,
  EMPTY_STATE_REGION_LINKS,
  getNoScheduledStateCopy,
  getPrematchTimelineDisplayLabel,
  isOfficialPrematchSchedule,
  isPrematchCompleteState,
  selectSpotlightMatches,
  shouldUseAnimatedPrematchEmptyShell,
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
    completedMatchCount,
    pendingMatchCount,
    officialPlaceholderMatchCount = 0,
    nextMatch,
    nextActionMatch,
    allUpcomingMatches,
  } = data;
  const isAllDone = isPrematchCompleteState(data);

  const scheduledMatches = sortPrematchMatchesByTime(allUpcomingMatches.filter(isOfficialPrematchSchedule));
  const actionMatch = nextActionMatch ?? nextMatch;
  const scheduledNext =
    actionMatch && isOfficialPrematchSchedule(actionMatch) && actionMatch.timelineState !== "overdue_unresolved" ? actionMatch : null;
  const scheduledOthers = scheduledNext
    ? scheduledMatches.filter((m) => m.id !== scheduledNext.id)
    : scheduledMatches;
  const scheduledCount = scheduledMatches.length;
  const spotlightMatches = selectSpotlightMatches(scheduledOthers);
  const noScheduledCopy = getNoScheduledStateCopy(pendingMatchCount, officialPlaceholderMatchCount);
  const showAnimatedEmptyShell = shouldUseAnimatedPrematchEmptyShell({
    completedMatchCount,
    pendingMatchCount,
    officialPlaceholderMatchCount,
    scheduledMatchCount: scheduledCount,
  });
  const summaryEmptyStateLabel = isAllDone ? "赛事完结" : "赛程待同步";
  const summaryEmptyStateTitle = isAllDone ? "已接入赛区赛程完赛，后续赛区待同步" : noScheduledCopy.title;
  const summaryEmptyStateDescription = isAllDone
    ? formatEmptyStateCount(completedMatchCount)
    : noScheduledCopy.description;

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
        <Link
          href="/forecast-center"
          className="ml-auto font-sans text-sm font-semibold transition-all duration-200 flex items-center gap-1.5 px-3 py-1.5 border rounded-sm border-rm-blue/50 bg-rm-blue/12 text-rm-blue hover:bg-rm-blue/22 hover:shadow-[0_0_16px_rgba(42,159,255,0.3)]"
        >
          进入实时预测中心
        </Link>
      </div>

      {/* ══════════════════════════════════════
          Empty state — completed or waiting for official schedule
          ══════════════════════════════════════ */}
      {showAnimatedEmptyShell && (
        <div className="relative bg-rm-metal-panel border border-rm-metal-border
          overflow-hidden"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)" }}
        >
          {/* Top accent bar */}
          <div className="h-0.5 bg-gradient-to-r from-rm-red/50 via-rm-blue/50 to-rm-violet/50" />

          {/* Animated scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.025] overflow-hidden">
            <div className="absolute inset-0 animate-scanline-slow"
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
                  {summaryEmptyStateLabel}
                </span>
                <span className="h-px w-8 bg-rm-metal-textFaint/20" />
              </div>
              <p className="font-sans text-base font-semibold text-rm-metal-textLight">
                {summaryEmptyStateTitle}
              </p>
              <p className="font-mono text-xs text-rm-metal-textMuted leading-relaxed max-w-lg mx-auto">
                {summaryEmptyStateDescription}
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
      {!showAnimatedEmptyShell && scheduledNext && (
        <div className="mb-5">
          {scheduledNext.timelineState && (
            <div className="mb-2 font-mono text-[10px] tracking-widest text-rm-status-warn">
              {getPrematchTimelineDisplayLabel(scheduledNext)}
            </div>
          )}
          <PrematchMatchCard match={scheduledNext} variant="hero" />
        </div>
      )}

      {/* ══════════════════════════════════════
          Layer 3 — Spotlight matches
          ══════════════════════════════════════ */}
      {!showAnimatedEmptyShell && scheduledOthers.length > 0 && spotlightMatches.length > 0 && (
        <div>
          <SectionHeader
            label="▸ 焦点战局"
            count={spotlightMatches.length}
            accent="bg-rm-status-warn/60"
          />
          <CardGrid matches={spotlightMatches} />
        </div>
      )}

      {/* ── No scheduled matches at all ── */}
      {!showAnimatedEmptyShell && scheduledCount === 0 && (
        <div className="bg-rm-metal-panel border border-rm-metal-border px-6 py-6 text-center space-y-4">
          <div>
            <p className="font-sans text-sm font-semibold text-rm-metal-textLight mb-1">
              {noScheduledCopy.title}
            </p>
            <p className="font-mono text-[11px] text-rm-metal-textMuted leading-relaxed max-w-md mx-auto">
              {noScheduledCopy.description}
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
