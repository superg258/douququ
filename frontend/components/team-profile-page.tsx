"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getFinalEvents, getOverview, getTeamProfile } from "@/lib/api";
import { formatMatchLabel, formatRankingResultLabel, translateStageLabel } from "@/lib/display";
import { EloSparkline, downsampleTrajectory } from "@/components/elo-sparkline";
import { buildFullSeasonTrajectories } from "@/lib/elo-trajectory";
import {
  FINALS_OUTCOME_LABELS,
  buildFinalsTeamPath,
  findFinalsOfficialSlot,
  findFinalsParticipation,
  hasFinalsStageData,
  resolveFinalsStageRates,
  resolveLockedTeamOutcome,
  resolveTeamFinalsCardModel,
  type TeamFinalsMetricCard,
} from "@/lib/finals-team";
import type { FinalsStageProbabilityProjection } from "@/lib/finals-schedule";
import { projectFinalsStageProbabilities } from "@/lib/finals-schedule";
import {
  simulateFinalsLiveEvents,
  type FinalsEventSimulation,
  type FinalsSimulationResult,
} from "@/lib/finals-simulation";
import { DEFAULT_SEED } from "@/lib/region-config";
import { buildTeamRegionHref, buildTeamHref, formatTeamProfileSubtitle } from "@/lib/team-profile";
import type {
  FinalEventParticipant,
  FinalEventResponse,
  FinalEventSchedule,
  FinalEventSlug,
  MatchRow,
  OverviewResponse,
  TeamProfileMatch,
  TeamProfileResponse,
} from "@/lib/types";
import { SourceFreshnessStrip } from "@/components/source-freshness-strip";
import { ErrorPanel, EmptyState } from "@/components/ui/async-state";
import { MechCard } from "@/components/ui/mech-card";
import { cn } from "@/lib/utils";
import { formatBeijingMonthDayTime } from "@/lib/time-format";

function pct(value: number | undefined) {
  if (typeof value !== "number") return "暂无";
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number | undefined) {
  if (typeof value !== "number") return "暂无";
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatTime(value: string | null | undefined) {
  return formatBeijingMonthDayTime(value) ?? "未排期";
}

const REGION_ACCENT: Record<string, {
  glowPrimary: string;
  glowSecondary: string;
  glowBar: string;
  blob: string;
  blobSecondary: string;
  divider: string;
  edgePrimary: string;
  edgeSecondary: string;
  accentBar: string;
  btnBg: string;
  btnBorder: string;
  btnHover: string;
  linkColor: string;
  barColor: string;
  bottomBar: string;
}> = {
  south_region: {
    glowPrimary: "bg-rm-red",
    glowSecondary: "bg-rm-blue",
    glowBar: "from-rm-red/90 via-rm-red/30 to-rm-blue/30",
    blob: "bg-rm-red/5",
    blobSecondary: "bg-rm-blue/5",
    divider: "bg-rm-red/40",
    edgePrimary: "bg-rm-red/30",
    edgeSecondary: "bg-rm-blue/30",
    accentBar: "bg-rm-blue/60",
    btnBg: "bg-rm-red/15",
    btnBorder: "border-rm-red/60",
    btnHover: "hover:bg-rm-red hover:text-white hover:shadow-[0_0_20px_rgba(232,48,42,0.4)]",
    linkColor: "text-rm-red",
    barColor: "bg-rm-red/50 shadow-[0_0_6px_rgba(232,48,42,0.3)]",
    bottomBar: "bg-rm-red/60",
  },
  east_region: {
    glowPrimary: "bg-rm-blue",
    glowSecondary: "bg-rm-red",
    glowBar: "from-rm-blue/90 via-rm-blue/30 to-rm-red/30",
    blob: "bg-rm-blue/5",
    blobSecondary: "bg-rm-red/5",
    divider: "bg-rm-blue/40",
    edgePrimary: "bg-rm-blue/30",
    edgeSecondary: "bg-rm-red/30",
    accentBar: "bg-rm-red/60",
    btnBg: "bg-rm-blue/15",
    btnBorder: "border-rm-blue/60",
    btnHover: "hover:bg-rm-blue hover:text-white hover:shadow-[0_0_20px_rgba(42,159,255,0.4)]",
    linkColor: "text-rm-blue",
    barColor: "bg-rm-blue/50 shadow-[0_0_6px_rgba(42,159,255,0.3)]",
    bottomBar: "bg-rm-blue/60",
  },
  north_region: {
    glowPrimary: "bg-rm-violet",
    glowSecondary: "bg-rm-blue",
    glowBar: "from-rm-violet/90 via-rm-violet/30 to-rm-blue/30",
    blob: "bg-rm-violet/5",
    blobSecondary: "bg-rm-red/5",
    divider: "bg-rm-violet/40",
    edgePrimary: "bg-rm-violet/30",
    edgeSecondary: "bg-rm-blue/30",
    accentBar: "bg-rm-red/60",
    btnBg: "bg-rm-violet/15",
    btnBorder: "border-rm-violet/60",
    btnHover: "hover:bg-rm-violet hover:text-white hover:shadow-[0_0_20px_rgba(139,92,246,0.4)]",
    linkColor: "text-rm-violet",
    barColor: "bg-rm-violet/50 shadow-[0_0_6px_rgba(139,92,246,0.3)]",
    bottomBar: "bg-rm-violet/60",
  },
};

/* ─── 赛程路径行（时间线样式） ─── */
function MatchPathRow({
  match,
  isLast,
  accent,
}: {
  match: TeamProfileMatch;
  isLast: boolean;
  accent: (typeof REGION_ACCENT)[string];
}) {
  const isWin = match.resultForTeam === "win";
  const isLoss = match.resultForTeam === "loss";
  const isPending = !isWin && !isLoss;

  const dotColor = isWin
    ? "bg-rm-status-safe shadow-[0_0_6px_rgba(0,232,120,0.5)]"
    : isLoss
      ? "bg-rm-red shadow-[0_0_6px_rgba(232,48,42,0.5)]"
      : "bg-rm-blue shadow-[0_0_6px_rgba(42,159,255,0.4)] animate-dot-pulse";

  const leftBorder = isWin
    ? "border-l-rm-status-safe/60"
    : isLoss
      ? "border-l-rm-red/60"
      : "border-l-rm-blue/40";

  const bgHover = isWin
    ? "hover:bg-rm-status-safe/5"
    : isLoss
      ? "hover:bg-rm-red/5"
      : "hover:bg-rm-blue/5";

  return (
    <div className="relative flex gap-3">
      {/* 时间线竖线 + 节点 */}
      <div className="flex flex-col items-center shrink-0 w-5">
        <div className={cn("w-2.5 h-2.5 rounded-full border-2 border-rm-metal-border", dotColor)} />
        {!isLast && <div className="w-px flex-1 bg-rm-metal-border/50 my-0.5" />}
      </div>

      {/* 内容卡片 */}
      <Link
        href={buildTeamHref(match.opponent.teamKey)}
        aria-label={`查看对手 ${match.opponent.collegeName} 的队伍档案`}
        className={cn(
          "group/match flex-1 border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-colors duration-200",
          `border-l-2 ${leftBorder}`,
          bgHover,
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[10px] px-1.5 py-0.5 border",
                  isWin
                    ? "border-rm-status-safe/30 bg-rm-status-safe/10 text-rm-status-safe"
                    : isLoss
                      ? "border-rm-red/30 bg-rm-red/10 text-rm-red"
                      : "border-rm-blue/30 bg-rm-blue/10 text-rm-blue",
                )}
              >
                {isWin ? "已胜" : isLoss ? "已负" : "未赛"}
              </span>
              <span className="font-sans text-sm font-semibold text-rm-metal-textLight truncate">
                {formatMatchLabel(match.matchLabel)}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-rm-metal-textMuted">
              对手{" "}
              <span
                className={cn(
                  "underline-offset-2 transition-colors group-hover/match:underline",
                  isWin ? "text-rm-status-safe/70 hover:text-rm-status-safe" : "text-rm-metal-text hover:text-rm-metal-textLight",
                )}
              >
                {match.opponent.collegeName}
              </span>
              {" "}· {match.opponent.teamName} · {formatTime(match.plannedStartAt)}
            </div>
          </div>
          <div className="text-right font-mono text-xs shrink-0">
            {!isWin && !isLoss && (
              <div className={cn("font-semibold", accent.linkColor)}>
                预测胜率 {(match.winProbability * 100).toFixed(0)}%
              </div>
            )}
            <div className="text-rm-metal-textFaint">{match.scoreline}</div>
          </div>
        </div>
      </Link>
    </div>
  );
}

/* ─── 后续对手行 ─── */
function UpcomingOpponentRow({
  match,
  teamElo,
}: {
  match: TeamProfileMatch;
  teamElo: number;
}) {
  const opponentElo =
    match.side === "red"
      ? (match.blueCurrentElo ?? match.blueMu0 ?? 0)
      : (match.redCurrentElo ?? match.redMu0 ?? 0);
  const eloDiff = teamElo - opponentElo;

  return (
    <Link
      href={buildTeamHref(match.opponent.teamKey)}
      className="block border border-rm-metal-border bg-rm-metal-panel px-3 py-3 transition-all duration-200 hover:border-rm-metal-textMuted/30 hover:bg-rm-metal-card group/opp"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-sans text-sm font-semibold text-rm-metal-textLight group-hover/opp:text-white transition-colors truncate">
            {match.opponent.collegeName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-rm-metal-textMuted">
            <span>{match.opponent.teamName}</span>
            <span className="text-rm-metal-textFaint/70">·</span>
            <span>{match.stageLabel}</span>
            {opponentElo > 0 && (
              <>
                <span className="text-rm-metal-textFaint/70">·</span>
                <span className={cn(
                  "font-semibold",
                  eloDiff > 5 ? "text-rm-status-safe/80" : eloDiff < -5 ? "text-rm-red/80" : "text-rm-metal-text/70",
                )}>
                  Elo {opponentElo.toFixed(1)} ({eloDiff > 0 ? "+" : ""}{eloDiff.toFixed(1)})
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ─── 决赛事件主题（复活赛蓝 / 全国赛金） ─── */
const FINALS_EVENT_THEME: Record<FinalEventSlug, {
  badge: string;
  badgeText: string;
  badgeSub: string;
  panel: string;
  panelTitle: string;
  headerBar: string;
}> = {
  repechage: {
    badge: "border-rm-blue/50 bg-rm-blue/10 shadow-[0_0_12px_rgba(42,159,255,0.15)]",
    badgeText: "text-rm-blue",
    badgeSub: "text-rm-blue/70",
    panel: "border-rm-blue/40 bg-rm-blue/5 shadow-[0_0_24px_rgba(42,159,255,0.08)]",
    panelTitle: "text-rm-blue",
    headerBar: "bg-rm-blue/60 shadow-[0_0_6px_rgba(42,159,255,0.3)]",
  },
  nationals: {
    badge: "border-rm-gold/50 bg-rm-gold/10 shadow-[0_0_12px_rgba(232,196,74,0.15)]",
    badgeText: "text-rm-gold",
    badgeSub: "text-rm-gold/70",
    panel: "border-rm-gold/40 bg-rm-gold/5 shadow-[0_0_24px_rgba(232,196,74,0.08)]",
    panelTitle: "text-rm-gold",
    headerBar: "bg-rm-gold/60 shadow-[0_0_6px_rgba(232,196,74,0.3)]",
  },
};

/* ─── Hero 决赛身份徽章 ─── */
function FinalsEventBadge({
  eventSlug,
  participant,
}: {
  eventSlug: FinalEventSlug;
  participant: FinalEventParticipant;
}) {
  const theme = FINALS_EVENT_THEME[eventSlug];
  return (
    <span className={cn("inline-flex items-center gap-2 border px-2.5 py-1 clip-chamfer", theme.badge)}>
      <span className={cn("font-mono text-[11px] font-bold tracking-widest", theme.badgeText)}>
        {eventSlug === "repechage" ? "复活赛参赛" : "全国赛参赛"}
      </span>
      <span className={cn("font-mono text-[10px]", theme.badgeSub)}>{participant.drawTier}</span>
    </span>
  );
}

/* ─── Hero 抽签状态 chip ─── */
function FinalsDrawChip({ label, tone }: { label: string; tone: "scheduled" | "blue" | "safe" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-1 font-mono text-[10px] tracking-widest",
        tone === "safe"
          ? "border-rm-status-safe/40 bg-rm-status-safe/10 text-rm-status-safe"
          : tone === "blue"
            ? "border-rm-blue/40 bg-rm-blue/10 text-rm-blue"
            : "border-rm-status-scheduled/40 bg-rm-status-scheduled/10 text-rm-status-scheduled",
      )}
    >
      {label}
    </span>
  );
}

/* ─── 决赛概率指标卡（投影未就绪时显示 "--"） ─── */
function FinalsRateCard({
  card,
  ready,
}: {
  card: TeamFinalsMetricCard;
  ready: boolean;
}) {
  const value = ready && typeof card.value === "number" ? card.value * 100 : null;
  const isGold = card.tone === "gold";
  return (
    <MechCard
      variant="default"
      label={card.label}
      className={cn(
        isGold
          ? "!border-rm-gold/60 !bg-[rgba(232,196,74,0.10)] shadow-[0_0_15px_rgba(232,196,74,0.15)]"
          : "!border-rm-blue/60 !bg-[rgba(42,159,255,0.13)] shadow-[0_0_15px_rgba(42,159,255,0.15)]",
      )}
    >
      <div className={cn("font-machine text-2xl font-bold tracking-wide", isGold ? "text-rm-gold" : "text-rm-blue")}>
        {value !== null ? `${value.toFixed(1)}%` : "--"}
      </div>
      <div
        role="progressbar"
        aria-label={card.label}
        aria-valuenow={value !== null ? Math.round(value) : 0}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-1.5 bg-rm-metal-dark rounded-full overflow-hidden"
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", isGold ? "bg-rm-gold/50" : "bg-rm-blue/50")}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </MechCard>
  );
}

/* ─── 决赛面板内概率行（两列网格，复用情报面板排版） ─── */
function FinalsRateRow({
  label,
  value,
  tone,
  ready,
}: {
  label: string;
  value: number | undefined;
  tone: string;
  ready: boolean;
}) {
  const pctValue = ready && typeof value === "number" ? value * 100 : null;
  return (
    <div className="border border-rm-metal-border/70 bg-rm-metal-dark/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("font-mono text-[10px] tracking-widest", tone)}>{label}</span>
        <span className="font-mono text-sm font-bold tabular-nums text-rm-metal-textLight">
          {pctValue !== null ? `${pctValue.toFixed(1)}%` : "--"}
        </span>
      </div>
      <div className="mt-1.5 h-1 bg-rm-metal-dark rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full bg-current opacity-60 transition-all duration-500", tone)}
          style={{ width: `${pctValue ?? 0}%` }}
        />
      </div>
    </div>
  );
}

/* ─── 决赛赛程路径行（W/L/排 徽章 + 模型胜率） ─── */
function FinalsPathRow({
  row,
  teamKey,
  isLast,
}: {
  row: MatchRow;
  teamKey: string;
  isLast: boolean;
}) {
  const hasActualResult = Boolean(row.isRealResult);
  const isWin = hasActualResult && row.winnerTeamKey === teamKey;
  const isLoss = hasActualResult && !isWin;
  const teamIsRed = row.redTeam.teamKey === teamKey;
  const opponent = teamIsRed ? row.blueTeam : row.redTeam;
  const winPct = (teamIsRed ? row.pSeriesRed : row.pSeriesBlue) * 100;

  const dotColor = isWin
    ? "bg-rm-status-safe shadow-[0_0_6px_rgba(0,232,120,0.5)]"
    : isLoss
      ? "bg-rm-red shadow-[0_0_6px_rgba(232,48,42,0.5)]"
      : "bg-rm-blue shadow-[0_0_6px_rgba(42,159,255,0.4)] animate-dot-pulse";

  const cardContent = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex-none w-5 h-5 flex items-center justify-center border font-mono text-[10px] font-bold",
                isWin
                  ? "border-rm-status-safe/50 bg-rm-status-safe/15 text-rm-status-safe"
                  : isLoss
                    ? "border-rm-red/50 bg-rm-red/15 text-rm-red"
                    : "border-rm-blue/40 bg-rm-blue/10 text-rm-blue",
              )}
            >
              {hasActualResult ? (isWin ? "W" : "L") : "排"}
            </span>
            <span className="font-sans text-sm font-semibold text-rm-metal-textLight truncate">
              {translateStageLabel(row.stage)}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-rm-metal-textMuted">
            对手{" "}
            <span className={cn(
              "underline-offset-2 transition-colors",
              opponent.teamKey ? "group-hover/match:underline" : "",
              isWin ? "text-rm-status-safe/70" : "text-rm-metal-text",
            )}
            >
              {opponent.collegeName || "槽位待确认"}
            </span>
            {" "}· {formatTime(row.plannedStartAt)}
          </div>
        </div>
        <div className="text-right font-mono text-xs shrink-0">
          {hasActualResult ? (
            <div className="text-rm-metal-textFaint">{row.scoreline}</div>
          ) : (
            <div className="font-semibold text-rm-blue">
              预测胜率 {winPct.toFixed(0)}%
            </div>
          )}
        </div>
      </div>
    </>
  );

  const cardClass = cn(
    "flex-1 border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-colors duration-200 border-l-2",
    isWin
      ? "border-l-rm-status-safe/60 hover:bg-rm-status-safe/5"
      : isLoss
        ? "border-l-rm-red/60 hover:bg-rm-red/5"
        : "border-l-rm-blue/40 hover:bg-rm-blue/5",
  );

  return (
    <div className="relative flex gap-3">
      {/* 时间线竖线 + 节点 */}
      <div className="flex flex-col items-center shrink-0 w-5">
        <div className={cn("w-2.5 h-2.5 rounded-full border-2 border-rm-metal-border", dotColor)} />
        {!isLast && <div className="w-px flex-1 bg-rm-metal-border/50 my-0.5" />}
      </div>

      {opponent.teamKey ? (
        <Link
          href={buildTeamHref(opponent.teamKey)}
          aria-label={`查看对手 ${opponent.collegeName} 的队伍档案`}
          className={cn(cardClass, "group/match block")}
        >
          {cardContent}
        </Link>
      ) : (
        <div className={cardClass}>{cardContent}</div>
      )}
    </div>
  );
}

/* ─── 决赛阶段征程 · 单事件面板 ─── */
function FinalsEventPanel({
  eventSlug,
  event,
  simulation,
  projection,
  teamKey,
  seasonTrajectory,
}: {
  eventSlug: FinalEventSlug;
  event: FinalEventSchedule;
  simulation: FinalsEventSimulation | null;
  projection: FinalsStageProbabilityProjection | null;
  teamKey: string;
  seasonTrajectory?: number[];
}) {
  const theme = FINALS_EVENT_THEME[eventSlug];
  const projectionReady = projection !== null;
  const rates = resolveFinalsStageRates(projection, eventSlug, teamKey);
  const outcome = simulation ? resolveLockedTeamOutcome(event, simulation, teamKey) : null;
  const path = simulation ? buildFinalsTeamPath(event, simulation, teamKey) : [];
  const trajectory = seasonTrajectory ?? simulation?.eloTrajectoryByTeamKey?.[teamKey];

  const statusPending = event.drawStatus === "pending";
  const statusLabel = statusPending ? "抽签待定" : (event.statusLabel || "赛程已确认");

  return (
    <div className={cn("relative border clip-chamfer-tr-bl overflow-hidden", theme.panel)}>
      {/* 头部：赛事名 + 状态 + 去向 + Elo 走势 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rm-metal-border/60 px-4 py-3">
        <div className={cn("h-4 w-0.5", theme.headerBar)} />
        <h3 className={cn("font-sans text-base font-bold", theme.panelTitle)}>{event.name}</h3>
        <span
          className={cn(
            "border px-1.5 py-0.5 font-mono text-[10px] tracking-widest",
            statusPending
              ? "border-rm-status-scheduled/40 bg-rm-status-scheduled/10 text-rm-status-scheduled"
              : "border-rm-status-safe/40 bg-rm-status-safe/10 text-rm-status-safe",
          )}
        >
          {statusLabel}
        </span>
        {outcome ? (
          <span className="border border-rm-result-winner/50 bg-rm-result-winner/10 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-rm-result-winner">
            锁定去向 · {FINALS_OUTCOME_LABELS[outcome] ?? outcome}
          </span>
        ) : null}
        {trajectory && trajectory.length >= 2 ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-rm-metal-textFaint">赛季 Elo</span>
            <EloSparkline points={downsampleTrajectory(trajectory)} className="h-6 w-16" />
          </span>
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* 概率条区 */}
        <div className="grid grid-cols-2 gap-2">
          {eventSlug === "repechage" ? (
            <FinalsRateRow label="晋级率" value={rates.advancementRate} tone="text-rm-blue" ready={projectionReady} />
          ) : (
            <>
              <FinalsRateRow label="十六强率" value={rates.groupAdvancementRate} tone="text-rm-blue" ready={projectionReady} />
              <FinalsRateRow label="八强率" value={rates.topEightRate} tone="text-rm-status-scheduled" ready={projectionReady} />
              <FinalsRateRow label="四强率" value={rates.topFourRate} tone="text-rm-status-safe" ready={projectionReady} />
              <FinalsRateRow label="冠军率" value={rates.championRate} tone="text-rm-result-winner" ready={projectionReady} />
            </>
          )}
        </div>

        {/* 赛程路径 */}
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
            <span>赛程路径</span>
            <span className="text-rm-metal-textFaint/70">{path.length} 场</span>
          </div>
          {path.length > 0 ? (
            <div className="space-y-1.5 pl-0.5">
              {path.map((row, idx) => (
                <FinalsPathRow
                  key={row.matchLabel}
                  row={row}
                  teamKey={teamKey}
                  isLast={idx === path.length - 1}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="官方对阵待抽签，抽签后展示赛程" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   TeamProfilePage
   ══════════════════════════════════════════ */
export function TeamProfilePage({ encodedTeamKey }: { encodedTeamKey: string }) {
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [finalsEvents, setFinalsEvents] = useState<Partial<Record<FinalEventSlug, FinalEventResponse>>>({});
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [finalsWarning, setFinalsWarning] = useState<string | null>(null);
  const [finalsWarnDismissed, setFinalsWarnDismissed] = useState(false);
  const [projection, setProjection] = useState<FinalsStageProbabilityProjection | null>(null);
  const teamKey = decodeURIComponent(encodedTeamKey);

  // 队伍档案（区域赛载荷）：失败 → 整页 ErrorPanel
  useEffect(() => {
    const controller = new AbortController();
    getTeamProfile(teamKey, DEFAULT_SEED, "live", controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setProfile(payload);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      controller.abort();
    };
  }, [teamKey, reloadKey]);

  // 决赛快照 + 总览：失败不整页报错，决赛区块整体降级隐藏 + 可关闭警告条
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([getFinalEvents("live", controller.signal), getOverview(controller.signal)])
      .then(([finalsResult, overviewResult]) => {
        if (controller.signal.aborted) return;
        let warning: string | null = null;
        if (finalsResult.status === "fulfilled") {
          setFinalsEvents(finalsResult.value.events);
        } else {
          warning = finalsResult.reason instanceof Error ? finalsResult.reason.message : String(finalsResult.reason);
        }
        if (overviewResult.status === "fulfilled") {
          setOverview(overviewResult.value);
        } else if (warning === null) {
          warning = overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason);
        }
        setFinalsWarning(warning);
        if (warning !== null) setFinalsWarnDismissed(false);
      });
    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  const finalsReady = hasFinalsStageData(finalsEvents, overview);

  const participation = useMemo(
    () => findFinalsParticipation(finalsEvents, teamKey),
    [finalsEvents, teamKey],
  );

  const simulation = useMemo<FinalsSimulationResult | null>(() => {
    if (!finalsEvents.repechage || !finalsEvents.nationals || !overview) return null;
    return simulateFinalsLiveEvents(
      finalsEvents.repechage.event,
      finalsEvents.nationals.event,
      overview,
      DEFAULT_SEED,
    );
  }, [finalsEvents, overview]);

  // 阶段概率 Monte Carlo 推算延迟 250ms 执行，避免阻塞首屏渲染（同首页范式）
  useEffect(() => {
    if (!finalsEvents.repechage || !finalsEvents.nationals || !overview) {
      setProjection(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setProjection(projectFinalsStageProbabilities(
        finalsEvents.repechage!.event.participants,
        finalsEvents.nationals!.event.participants,
        overview,
      ));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [finalsEvents, overview]);

  const finalsRates = useMemo(() => ({
    repechage: resolveFinalsStageRates(projection, "repechage", teamKey),
    nationals: resolveFinalsStageRates(projection, "nationals", teamKey),
  }), [projection, teamKey]);

  const finalsCards = useMemo(
    () => (finalsReady ? resolveTeamFinalsCardModel(participation, finalsRates) : null),
    [finalsReady, participation, finalsRates],
  );

  const primarySlug: FinalEventSlug | null = participation.repechage
    ? "repechage"
    : participation.nationals
      ? "nationals"
      : null;

  // 赛季 Elo 轨迹：季前 → 区域赛逐场（profile.liveState.ledger）→ 决赛真实赛果，
  // 与预测中心同一构建器；未开赛时呈现的是真实的区域赛赛季曲线而非两点直线
  const seasonTrajectories = useMemo(() => {
    if (!overview || !simulation || !primarySlug) return null;
    const ledger = profile?.liveState?.ledger;
    if (!ledger || ledger.length === 0) return null;
    return buildFullSeasonTrajectories(
      overview,
      [ledger],
      simulation[primarySlug]?.eloTrajectoryByTeamKey ?? {},
    );
  }, [overview, simulation, primarySlug, profile]);

  const handleRetry = () => {
    setProfile(null);
    setError("");
    setReloadKey((key) => key + 1);
  };

  /* ── 错误态 ── */
  if (error) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-screen-xl px-4 py-8">
          <ErrorPanel
            title="系统错误"
            message={`队伍档案加载失败：${error}`}
            onRetry={handleRetry}
            backHref="/"
            backLabel="返回总控台"
          />
        </div>
      </div>
    );
  }

  /* ── 加载态（骨架屏） ── */
  if (!profile) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-8">
          {/* 骨架 header */}
          <div className="border border-rm-metal-border bg-rm-metal-panel px-5 py-6 animate-pulse">
            <div className="h-3 w-24 bg-rm-metal-border rounded mb-3" />
            <div className="h-7 w-64 bg-rm-metal-border rounded mb-2" />
            <div className="h-4 w-40 bg-rm-metal-border rounded" />
          </div>
          {/* 骨架指标卡片 */}
          <div className="grid gap-3 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="border border-rm-metal-border bg-rm-metal-card px-4 py-3 animate-pulse">
                <div className="h-2.5 w-16 bg-rm-metal-border rounded mb-2" />
                <div className="h-6 w-20 bg-rm-metal-border rounded" />
              </div>
            ))}
          </div>
          {/* 骨架双栏 */}
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-3 animate-pulse">
                <div className="h-5 w-28 bg-rm-metal-border rounded" />
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="border border-rm-metal-border bg-rm-metal-card px-3 py-4">
                    <div className="h-4 w-full bg-rm-metal-border rounded mb-2" />
                    <div className="h-3 w-2/3 bg-rm-metal-border rounded" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── 正常内容 ── */
  const finalLabel = profile.finalRanking
    ? formatRankingResultLabel(profile.finalRanking.rank, profile.finalRanking.finalBucket, profile.finalRanking.advancement)
    : "暂无最终落位";
  const regionHref = buildTeamRegionHref(profile);
  const regionSlug = profile.region.regionSlug;
  const accent = REGION_ACCENT[regionSlug] ?? REGION_ACCENT.north_region;
  const teamElo = profile.team.currentElo ?? profile.team.mu0;

  /* ── 决赛派生：当前 Elo（live 回放 Elo → 赛事评分索引 → 区域赛档案） ── */
  const primarySimulation = primarySlug ? simulation?.[primarySlug] ?? null : null;
  const liveFinalElo = primarySimulation?.finalEloByTeamKey?.[teamKey];
  const ratingIndexElo = primarySlug
    ? finalsEvents[primarySlug]?.event.teamRatingIndex?.[teamKey]?.currentElo
    : undefined;
  const displayElo = (typeof liveFinalElo === "number" && Number.isFinite(liveFinalElo) ? liveFinalElo : undefined)
    ?? (typeof ratingIndexElo === "number" && Number.isFinite(ratingIndexElo) ? ratingIndexElo : undefined)
    ?? teamElo;

  /* ── 决赛派生：Hero 抽签状态 chip ── */
  const heroDrawChip = (slug: FinalEventSlug): { label: string; tone: "scheduled" | "blue" | "safe" } => {
    const event = finalsEvents[slug]?.event ?? null;
    const officialSlot = event ? findFinalsOfficialSlot(event, teamKey) : null;
    if (officialSlot) return { label: `官方落位 ${officialSlot}`, tone: "safe" };
    return event?.drawStatus === "completed"
      ? { label: "落位待确认", tone: "scheduled" }
      : { label: "抽签待定", tone: "scheduled" };
  };

  return (
    <div className="min-h-screen">
      {/* 页面氛围光晕 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div
          className={cn(
            "absolute top-0 right-0 w-[40vw] h-[60vh] rounded-full blur-[120px] opacity-[0.07]",
            accent.glowPrimary,
          )}
          style={{ transform: "translate(20%, -20%)" }}
        />
        <div
          className={cn(
            "absolute bottom-0 left-0 w-[35vw] h-[50vh] rounded-full blur-[100px] opacity-[0.05]",
            accent.glowSecondary,
          )}
          style={{ transform: "translate(-20%, 20%)" }}
        />
      </div>

      <div className="relative mx-auto max-w-screen-xl space-y-6 px-4 py-8">
        {/* ═══ 面包屑 ═══ */}
        <nav aria-label="面包屑" className="flex items-center gap-2 font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
          <Link href="/" className="hover:text-rm-metal-textMuted transition-colors">
            战术指挥中心
          </Link>
          <span>/</span>
          <Link
            href={regionHref}
            className={cn("hover:text-rm-metal-textLight transition-colors", accent.linkColor)}
          >
            {profile.region.regionName}
          </Link>
          <span>/</span>
          <span aria-current="page" className="text-rm-metal-textLight">{profile.team.collegeName}</span>
        </nav>

        {/* ═══ Hero 头部 ═══ */}
        <div>
          <div className="relative">
            {/* 顶部发光条 */}
            <div
              className={cn(
                "h-0.5 bg-gradient-to-r shadow-[0_0_12px_rgba(232,48,42,0.2),0_0_12px_rgba(42,159,255,0.2)]",
                accent.glowBar,
              )}
            />

            {/* 主面板 */}
            <div
              className={cn(
                "relative bg-rm-metal-panel border-x border-b border-rm-metal-border",
                "clip-chamfer-tr-bl overflow-hidden",
              )}
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.3)" }}
            >
              {/* 扫描线覆盖层 */}
              <div
                className="absolute inset-0 pointer-events-none z-10 opacity-[0.025]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.8) 2px, rgba(255,255,255,0.8) 3px)",
                  backgroundSize: "100% 4px",
                }}
              />

              {/* 氛围光晕 */}
              <div
                className={cn(
                  "absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none",
                  accent.blob,
                )}
              />
              <div
                className={cn(
                  "absolute bottom-0 left-0 w-72 h-72 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none opacity-60",
                  accent.blobSecondary,
                )}
              />

              {/* 角落铆钉 */}
              {[
                "top-4 left-4",
                "top-4 left-9",
                "top-4 right-4",
                "top-4 right-9",
                "bottom-4 left-4",
                "bottom-4 left-9",
                "bottom-4 right-4",
                "bottom-4 right-9",
              ].map((pos) => (
                <div
                  key={pos}
                  className={cn(
                    "absolute w-2 h-2 rounded-full bg-rm-metal-textMuted/25 shadow-[0_0_3px_rgba(255,255,255,0.08)]",
                    pos,
                  )}
                />
              ))}

              {/* L型角标 */}
              <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-rm-metal-textMuted/20 pointer-events-none" />

              {/* 顶部边缘标记 */}
              <div className="absolute top-0 left-1/3 w-px h-2 bg-rm-metal-textMuted/15 pointer-events-none" />
              <div className="absolute top-0 left-1/2 w-px h-2 bg-rm-metal-textMuted/20 pointer-events-none" />
              <div className="absolute top-0 right-1/3 w-px h-2 bg-rm-metal-textMuted/15 pointer-events-none" />
              <div className="absolute top-0 left-1/2 -translate-x-6 text-[10px] text-rm-metal-textFaint/25 font-mono pointer-events-none">
                SYS
              </div>

              {/* ── 内容区 ── */}
              <div className="relative z-10 px-6 sm:px-8 py-7">
                {/* 分类标签 */}
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn("h-px w-6", accent.divider)} />
                  <span className="font-mono text-[10px] text-rm-metal-textFaint/70 tracking-[0.3em] uppercase">
                    {profile.region.regionName} · 队伍档案
                  </span>
                </div>

                {/* 队名 + 操作区 */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className={cn("flex items-center gap-4 border-l-2 pl-4", accent.btnBorder)}>
                    <div
                      aria-label={`队伍编号 ${profile.slot?.slot ?? "待定"}`}
                      className={cn(
                        "min-w-16 border border-current/35 bg-black/30 px-3 py-2 text-center font-machine text-2xl font-black tracking-tight text-glow-blue sm:min-w-20 sm:text-3xl",
                        accent.linkColor,
                      )}
                    >
                      {profile.slot?.slot ?? "--"}
                    </div>
                    <div className="min-w-0">
                      <h1
                        className="font-sans text-2xl font-black text-rm-metal-textLight sm:text-3xl"
                        style={{ textShadow: "0 0 18px rgba(255,255,255,0.08)" }}
                      >
                        {profile.team.collegeName}
                      </h1>
                      <p className="mt-1.5 font-mono text-xs text-rm-metal-textMuted">
                        {formatTeamProfileSubtitle(profile.team.teamName, profile.slot)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={regionHref}
                    className={cn(
                      "group/btn inline-flex items-center gap-2 border px-4 py-2.5 text-center font-mono text-xs transition-all duration-200 active:scale-[0.98]",
                      accent.btnBorder,
                      accent.btnBg,
                      accent.linkColor,
                      accent.btnHover,
                      "shadow-[0_0_10px_rgba(232,48,42,0.1)]",
                    )}
                  >
                    <span className="group-hover/btn:translate-x-0.5 transition-transform duration-200">←</span>
                    回到赛区沙盘并高亮该队
                  </Link>
                </div>

                {/* 决赛身份区：参赛徽章 + 抽签状态 */}
                {finalsReady && (participation.repechage || participation.nationals) ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-rm-metal-border/50 pt-4">
                    {participation.repechage ? (
                      <>
                        <FinalsEventBadge eventSlug="repechage" participant={participation.repechage} />
                        <FinalsDrawChip {...heroDrawChip("repechage")} />
                      </>
                    ) : null}
                    {participation.nationals ? (
                      <>
                        <FinalsEventBadge eventSlug="nationals" participant={participation.nationals} />
                        <FinalsDrawChip {...heroDrawChip("nationals")} />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* 底部装饰条 */}
            <div className="flex items-center gap-0 -mt-px">
              <div className={cn("h-0.5 flex-1", accent.edgePrimary)} />
              <div className={cn("h-0.5 w-12", accent.bottomBar)} />
              <div className="h-0.5 w-8 bg-rm-result-winner/40" />
              <div className="h-0.5 w-6 bg-rm-metal-textMuted/15" />
              <div className={cn("h-0.5 w-12", accent.accentBar)} />
              <div className={cn("h-0.5 flex-1", accent.edgeSecondary)} />
            </div>
          </div>
        </div>

        {/* ═══ 数据源新鲜度 ═══ */}
        <SourceFreshnessStrip freshness={profile.sourceFreshness} />

        {/* ═══ 决赛数据降级警告条（可关闭） ═══ */}
        {finalsWarning && !finalsWarnDismissed ? (
          <div className="clip-chamfer-tr-bl flex items-center gap-2 border border-rm-status-warn/40 bg-rm-status-warn/10 px-3 py-2 font-mono text-[10px] text-rm-status-warn">
            <span className="min-w-0 flex-1 truncate" title={finalsWarning}>
              决赛阶段数据加载失败（{finalsWarning}）：决赛区块已隐藏，区域赛档案不受影响。
            </span>
            <button
              type="button"
              onClick={handleRetry}
              className="shrink-0 border border-rm-status-warn/50 px-2 py-0.5 font-bold uppercase transition-colors hover:bg-rm-status-warn hover:text-black"
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => setFinalsWarnDismissed(true)}
              aria-label="关闭决赛数据警告"
              className="shrink-0 px-1 font-bold transition-colors hover:text-white"
            >
              X
            </button>
          </div>
        ) : null}

        {/* ═══ 四维指标卡片（决赛参赛队伍自适应概率卡） ═══ */}
        <section className="grid gap-3 md:grid-cols-4">
          <MechCard variant="blue" label="当前 Elo">
            <div className="font-machine text-2xl font-bold text-rm-metal-textLight tracking-wide">
              {displayElo.toFixed(1)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-xs">
              <span
                className={cn(
                  (profile.team.eloDeltaFromPreseason ?? 0) > 0 ? "text-rm-status-safe" : "text-rm-red",
                )}
              >
                {signed(profile.team.eloDeltaFromPreseason)}
              </span>
              <span className="text-rm-metal-textFaint text-[10px]">vs 赛季初</span>
            </div>
          </MechCard>

          {finalsCards ? (
            finalsCards.map((card) => (
              <FinalsRateCard key={card.key} card={card} ready={projection !== null} />
            ))
          ) : (
            <>
              <MechCard
                variant="default"
                label="国赛概率"
                className="!border-rm-status-warn/60 !bg-[rgba(255,176,0,0.13)] shadow-[0_0_15px_rgba(255,176,0,0.15)]"
              >
                <div className="font-machine text-2xl font-bold text-rm-status-warn tracking-wide">
                  {pct(profile.team.probabilities.national)}
                </div>
                <div
                  role="progressbar"
                  aria-label="国赛概率"
                  aria-valuenow={Math.round((profile.team.probabilities.national ?? 0) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-2 h-1.5 bg-rm-metal-dark rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-rm-status-warn/50 rounded-full"
                    style={{ width: `${(profile.team.probabilities.national ?? 0) * 100}%` }}
                  />
                </div>
              </MechCard>

              <MechCard
                variant="default"
                label="复活赛概率"
                className="!border-rm-blue/60 !bg-[rgba(42,159,255,0.13)] shadow-[0_0_15px_rgba(42,159,255,0.15)]"
              >
                <div className="font-machine text-2xl font-bold text-rm-blue tracking-wide">
                  {pct(profile.team.probabilities.repechage)}
                </div>
                <div
                  role="progressbar"
                  aria-label="复活赛概率"
                  aria-valuenow={Math.round((profile.team.probabilities.repechage ?? 0) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-2 h-1.5 bg-rm-metal-dark rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-rm-blue/50 rounded-full"
                    style={{ width: `${(profile.team.probabilities.repechage ?? 0) * 100}%` }}
                  />
                </div>
              </MechCard>

              <MechCard variant="red" label="最终落位">
                <div className="font-machine text-lg font-bold text-rm-metal-textLight tracking-wide">
                  {finalLabel}
                </div>
                <div className="mt-1 font-mono text-[10px] text-rm-metal-textFaint">
                  {profile.finalRanking ? `排名 #${profile.finalRanking.rank}` : "未产生"}
                </div>
              </MechCard>
            </>
          )}
        </section>

        {/* ═══ 决赛阶段征程（未晋级显示空态；数据缺失时整块降级隐藏） ═══ */}
        {finalsReady ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-4 w-0.5 bg-rm-gold/60 shadow-[0_0_6px_rgba(232,196,74,0.3)]" />
              <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight">决赛阶段征程</h2>
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                实时快照
              </span>
            </div>
            {!participation.repechage && !participation.nationals ? (
              <EmptyState text="未晋级决赛阶段" />
            ) : (
              <div className="space-y-4">
                {participation.repechage && finalsEvents.repechage ? (
                  <FinalsEventPanel
                    eventSlug="repechage"
                    event={finalsEvents.repechage.event}
                    simulation={simulation?.repechage ?? null}
                    projection={projection}
                    teamKey={teamKey}
                    seasonTrajectory={seasonTrajectories?.[teamKey]}
                  />
                ) : null}
                {participation.nationals && finalsEvents.nationals ? (
                  <FinalsEventPanel
                    eventSlug="nationals"
                    event={finalsEvents.nationals.event}
                    simulation={simulation?.nationals ?? null}
                    projection={projection}
                    teamKey={teamKey}
                    seasonTrajectory={seasonTrajectories?.[teamKey]}
                  />
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {/* ═══ 双栏：区域赛征程（已完赛，保留降级） ═══ */}
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* 左侧：赛程路径（时间线） */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("h-4 w-0.5", accent.barColor)} />
              <h2 className="whitespace-nowrap font-sans text-lg font-semibold text-rm-metal-textLight">
                区域赛赛程路径（已完赛）
              </h2>
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                {profile.matchPath.length} 场
              </span>
              {profile.finalRanking ? (
                <span className="font-mono text-[10px] text-rm-gold/80 tracking-widest">
                  最终排名 #{profile.finalRanking.rank}
                </span>
              ) : null}
            </div>
            <div className="space-y-1.5 pl-0.5">
              {profile.matchPath.map((match, idx) => (
                <MatchPathRow
                  key={match.matchLabel}
                  match={match}
                  isLast={idx === profile.matchPath.length - 1}
                  accent={accent}
                />
              ))}
              {profile.matchPath.length === 0 && (
                <EmptyState text="暂无已举行比赛" />
              )}
            </div>
          </div>

          {/* 右侧：实际去向 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("h-4 w-0.5", accent.barColor)} />
              <h2 className="whitespace-nowrap font-sans text-lg font-semibold text-rm-metal-textLight">
                实际去向
              </h2>
              <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                {profile.finalRanking
                  ? "已完赛"
                  : `待赛 ${profile.upcomingMatches.length} 场`}
              </span>
            </div>
            <div className="space-y-2">
              {profile.upcomingMatches.map((match) => (
                <UpcomingOpponentRow
                  key={match.matchLabel}
                  match={match}
                  teamElo={teamElo}
                />
              ))}
              {profile.upcomingMatches.length === 0 && (
                <div className={cn(
                  "relative overflow-hidden border p-5 text-center",
                  profile.finalRanking?.rank === 1
                    ? "border-rm-gold/60 bg-rm-gold/10 shadow-[0_0_24px_rgba(232,196,74,0.12)]"
                    : "border-rm-metal-border bg-rm-metal-card",
                )}>
                  <div className={cn("font-machine text-[10px] tracking-[0.28em]", profile.finalRanking?.rank === 1 ? "text-rm-gold" : "text-rm-metal-textMuted")}>SEASON SUMMARY</div>
                  <div className={cn("mt-3 font-machine text-xl font-black", profile.finalRanking?.rank === 1 ? "text-rm-gold text-glow-winner" : "text-rm-metal-textLight")}>{finalLabel}</div>
                  <p className="mt-2 text-xs text-rm-metal-textMuted">
                    本赛区赛程已全部结束，以上为本赛季实际去向。
                  </p>
                  {profile.finalRanking?.rank === 1 ? <div className="mt-4 border-t border-rm-gold/25 pt-3 font-mono text-[10px] tracking-widest text-rm-gold">REGIONAL CHAMPION</div> : null}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
