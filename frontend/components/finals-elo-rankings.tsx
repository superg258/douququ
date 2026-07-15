"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { buildTeamHref } from "@/lib/team-profile";
import { formatShortDateTimeLabel } from "@/lib/time-format";
import type {
  FinalEventResponse,
  FinalEventSlug,
  OverviewResponse,
  OverviewTeam,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface FinalsEloRankingRow {
  eventRank: number;
  globalRank: number;
  schoolKey: string;
  teamKey: string;
  collegeName: string;
  teamName: string;
  currentElo: number;
  seasonDelta: number;
  sourceLabel: string;
}

interface FinalsEloRankingSection {
  slug: FinalEventSlug;
  label: string;
  eyebrow: string;
  statusLabel: string;
  expectedCount: number;
  unmatchedCount: number;
  verifiedAt: string;
  generatedAt: string;
  rows: FinalsEloRankingRow[];
}

const EVENT_META: Record<
  FinalEventSlug,
  {
    label: string;
    tone: "amber" | "blue";
  }
> = {
  repechage: { label: "复活赛", tone: "amber" },
  nationals: { label: "全国赛", tone: "blue" },
};

const TONE_STYLES = {
  amber: {
    accent: "text-rm-status-warn",
    softBorder: "border-rm-status-warn/25",
    badge: "border-rm-status-warn/40 bg-rm-status-warn/10 text-rm-status-warn",
    topBar: "bg-gradient-to-r from-rm-status-warn via-rm-status-warn/35 to-transparent",
    header:
      "bg-[radial-gradient(circle_at_15%_0%,rgba(255,176,0,0.13),transparent_42%)]",
    rowHover: "hover:border-rm-status-warn/45 hover:bg-rm-status-warn/[0.035]",
  },
  blue: {
    accent: "text-rm-blue",
    softBorder: "border-rm-blue/25",
    badge: "border-rm-blue/40 bg-rm-blue/10 text-rm-blue",
    topBar: "bg-gradient-to-r from-rm-blue via-rm-blue/35 to-transparent",
    header:
      "bg-[radial-gradient(circle_at_15%_0%,rgba(42,159,255,0.14),transparent_42%)]",
    rowHover: "hover:border-rm-blue/45 hover:bg-rm-blue/[0.035]",
  },
} as const;

function getCurrentElo(team: OverviewTeam) {
  return team.currentElo ?? team.mu0;
}

function getSeasonDelta(team: OverviewTeam) {
  const currentElo = getCurrentElo(team);
  return team.eloDeltaFromPreseason ?? currentElo - (team.preseasonElo ?? team.mu0);
}

function buildTeamIndex(overview: OverviewResponse) {
  const index = new Map<string, OverviewTeam>();

  for (const region of overview.regions) {
    for (const team of region.teams) {
      const teamKey = team.teamKey.trim();
      if (!teamKey) continue;

      const existing = index.get(teamKey);
      if (!existing || getCurrentElo(team) > getCurrentElo(existing)) {
        index.set(teamKey, team);
      }
    }
  }

  return index;
}

function buildRankingSection(
  overview: OverviewResponse,
  response: FinalEventResponse,
  teamIndex: Map<string, OverviewTeam>,
): FinalsEloRankingSection {
  const { event } = response;
  const confirmedParticipants = event.participants.filter(
    (participant) => participant.status === "confirmed",
  );
  const rows: Omit<FinalsEloRankingRow, "eventRank">[] = [];

  for (const participant of confirmedParticipants) {
    const schoolKey = participant.schoolKey.trim();
    const teamKey = participant.teamKey.trim();
    if (!schoolKey || !teamKey) continue;

    const team = teamIndex.get(teamKey);
    if (!team) continue;

    rows.push({
      globalRank: team.eloGlobalRank,
      schoolKey,
      teamKey: team.teamKey,
      collegeName: participant.collegeName,
      teamName: participant.teamName,
      currentElo: getCurrentElo(team),
      seasonDelta: getSeasonDelta(team),
      sourceLabel: participant.drawTier,
    });
  }

  rows.sort((left, right) => {
    if (right.currentElo !== left.currentElo) {
      return right.currentElo - left.currentElo;
    }
    if (left.globalRank !== right.globalRank) {
      return left.globalRank - right.globalRank;
    }
    return left.schoolKey.localeCompare(right.schoolKey);
  });

  const rankedRows = rows.map((row, index) => ({
    ...row,
    eventRank: index + 1,
  }));
  const meta = EVENT_META[event.slug];
  const eventSummary = [
    `${event.confirmedParticipantCount} 支${event.slug === "nationals" ? "当前已确认" : ""}队伍`,
    `${event.formalMatchCount} 场正式比赛`,
    event.advancementSlots ? `${event.advancementSlots} 张全国赛门票` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  return {
    slug: event.slug,
    label: meta.label,
    eyebrow: eventSummary,
    statusLabel: event.statusLabel,
    expectedCount: event.confirmedParticipantCount,
    unmatchedCount: Math.max(confirmedParticipants.length - rankedRows.length, 0),
    verifiedAt: response.verifiedAt,
    generatedAt: overview.generatedAt,
    rows: rankedRows,
  };
}

function signedDelta(value: number) {
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatVerifiedAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function RankingRow({
  row,
  tone,
}: {
  row: FinalsEloRankingRow;
  tone: "amber" | "blue";
}) {
  const styles = TONE_STYLES[tone];
  const isTopThree = row.eventRank <= 3;

  return (
    <Link
      href={buildTeamHref(row.teamKey)}
      className={cn(
        "group grid grid-cols-[3.4rem_minmax(0,1fr)_5.25rem] gap-3 border border-rm-metal-border bg-rm-metal-panel/78 px-3 py-3 transition-colors",
        styles.rowHover,
      )}
    >
      <div className="flex items-center gap-2 border-r border-rm-metal-border/65 pr-3">
        <div className="min-w-[1.75rem] text-center">
          <span
            className={cn(
              "block font-mono text-lg font-black tabular-nums",
              isTopThree ? styles.accent : "text-rm-metal-textLight",
            )}
          >
            {String(row.eventRank).padStart(2, "0")}
          </span>
          <span className="block text-[7px] tracking-widest text-rm-metal-textFaint">
            赛事
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3
            className={cn(
              "truncate text-sm tracking-wide text-rm-metal-textLight",
              isTopThree ? "font-black" : "font-bold",
            )}
            title={row.collegeName}
          >
            {row.collegeName}
          </h3>
          <span className="shrink-0 font-mono text-[9px] text-rm-metal-textFaint">
            全局 #{row.globalRank}
          </span>
        </div>
        <p
          className="mt-0.5 truncate text-[10px] tracking-wider text-rm-metal-textMuted"
          title={row.teamName}
        >
          {row.teamName}
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "max-w-full truncate border px-2 py-0.5 font-mono text-[8px]",
              styles.badge,
            )}
            title={row.sourceLabel}
          >
            {row.sourceLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end justify-center text-right">
        <span className="text-[8px] uppercase tracking-[0.16em] text-rm-metal-textFaint">
          Elo
        </span>
        <strong
          className={cn(
            "mt-0.5 font-mono text-base font-black tabular-nums",
            isTopThree ? styles.accent : "text-rm-metal-textLight",
          )}
        >
          {row.currentElo.toFixed(1)}
        </strong>
        <span
          className={cn(
            "mt-1 font-mono text-[9px] tabular-nums",
            row.seasonDelta > 0.05
              ? "text-rm-status-safe"
              : row.seasonDelta < -0.05
                ? "text-rm-red"
                : "text-rm-metal-textFaint",
          )}
        >
          赛季 {signedDelta(row.seasonDelta)}
        </span>
      </div>
    </Link>
  );
}

function RankingSectionCard({
  section,
  instance,
}: {
  section: FinalsEloRankingSection;
  instance: "mobile" | "desktop";
}) {
  const { tone } = EVENT_META[section.slug];
  const styles = TONE_STYLES[tone];
  const leader = section.rows[0] ?? null;
  const sectionId = `elo-${instance}-${section.slug}`;
  const titleId = `${sectionId}-title`;

  return (
    <section
      id={sectionId}
      aria-labelledby={titleId}
      className="overflow-hidden border border-rm-metal-border bg-rm-metal-card"
    >
      <div className={cn("h-0.5 w-full", styles.topBar)} />
      <header className={cn("border-b border-rm-metal-border p-4 md:p-5", styles.header)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={cn("font-mono text-[9px] font-bold uppercase tracking-[0.24em]", styles.accent)}>
              Event Elo Ranking
            </p>
            <h2
              id={titleId}
              className="mt-1 font-machine text-xl font-black tracking-widest text-white md:text-2xl"
            >
              {section.label}战力榜
            </h2>
          </div>
          <span className={cn("border px-2.5 py-1 font-mono text-[10px] font-bold", styles.badge)}>
            {section.expectedCount} 支参赛队
          </span>
        </div>

        <p className="mt-3 text-xs leading-5 text-rm-metal-text">{section.eyebrow}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-rm-metal-border/70 pt-4">
          <div>
            <span className="block font-mono text-[8px] uppercase tracking-[0.18em] text-rm-metal-textFaint">
              当前榜首
            </span>
            <strong className="mt-1 block truncate text-xs text-rm-metal-textLight" title={leader?.collegeName}>
              {leader?.collegeName ?? "等待数据关联"}
            </strong>
          </div>
          <div className="text-right">
            <span className="block font-mono text-[8px] uppercase tracking-[0.18em] text-rm-metal-textFaint">
              数据更新时间
            </span>
            <strong className={cn("mt-1 block font-mono text-xs", styles.accent)}>
              {formatShortDateTimeLabel(section.generatedAt)}
            </strong>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[8px] text-rm-metal-textFaint">
          <span>{section.statusLabel}</span>
          <span>名单核对 {formatVerifiedAt(section.verifiedAt)}</span>
        </div>
      </header>

      <div className="grid grid-cols-[3.4rem_minmax(0,1fr)_5.25rem] gap-3 border-b border-rm-metal-border/70 bg-black/20 px-3 py-2 font-mono text-[8px] uppercase tracking-[0.16em] text-rm-metal-textFaint">
        <span>赛事排名</span>
        <span>队伍 · 全局排名 · 梯队/来源</span>
        <span className="text-right">Elo · 赛季变化</span>
      </div>

      {section.rows.length ? (
        <div className="space-y-1.5 p-2">
          {section.rows.map((row) => (
            <RankingRow key={row.schoolKey} row={row} tone={tone} />
          ))}
        </div>
      ) : (
        <div className={cn("m-3 border bg-black/20 p-5 text-center", styles.softBorder)}>
          <p className="font-machine text-sm text-rm-metal-textLight">等待名单与 Elo 数据完成关联</p>
          <p className="mt-2 text-xs text-rm-metal-textMuted">仅接受 teamKey 精确身份关联。</p>
        </div>
      )}
    </section>
  );
}

export function FinalsEloRankings({
  overview,
  repechage,
  nationals,
}: {
  overview: OverviewResponse;
  repechage: FinalEventResponse;
  nationals: FinalEventResponse;
}) {
  const sections = useMemo(() => {
    const teamIndex = buildTeamIndex(overview);
    return [
      buildRankingSection(overview, repechage, teamIndex),
      buildRankingSection(overview, nationals, teamIndex),
    ];
  }, [nationals, overview, repechage]);
  const [activeSlug, setActiveSlug] = useState<FinalEventSlug>("repechage");
  const activeSection = sections.find((section) => section.slug === activeSlug) ?? sections[0];
  const totalUnmatched = sections.reduce((sum, section) => sum + section.unmatchedCount, 0);

  return (
    <div className="space-y-4">
      {totalUnmatched > 0 ? (
        <div className="border border-rm-status-warn/45 bg-rm-status-warn/5 px-4 py-3 text-xs text-rm-status-warn">
          有 {totalUnmatched} 支已确认队伍尚未通过 teamKey 关联到当前 Elo 数据；页面未使用显示名回退。
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="赛事 Elo 榜单"
        className="grid grid-cols-2 gap-2 border border-rm-metal-border bg-rm-metal-card p-2 lg:hidden"
      >
        {sections.map((section) => {
          const selected = section.slug === activeSlug;
          const styles = TONE_STYLES[EVENT_META[section.slug].tone];
          return (
            <button
              key={section.slug}
              id={`elo-${section.slug}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`elo-mobile-${section.slug}`}
              onClick={() => setActiveSlug(section.slug)}
              className={cn(
                "border px-3 py-2.5 font-mono text-xs font-bold tracking-widest transition-colors",
                selected
                  ? styles.badge
                  : "border-rm-metal-border bg-black/20 text-rm-metal-textMuted",
              )}
            >
              {section.label}
              <span className="ml-2 text-[9px] opacity-70">{section.expectedCount}</span>
            </button>
          );
        })}
      </div>

      <div className="lg:hidden" role="tabpanel" aria-labelledby={`elo-${activeSlug}-tab`}>
        <RankingSectionCard section={activeSection} instance="mobile" />
      </div>

      <div className="hidden items-start gap-5 lg:grid lg:grid-cols-2">
        {sections.map((section) => (
          <RankingSectionCard key={section.slug} section={section} instance="desktop" />
        ))}
      </div>
    </div>
  );
}
