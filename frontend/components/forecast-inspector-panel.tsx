"use client";

import Link from "next/link";

import { formatMatchCardScheduleTime, predictScoreline } from "@/components/canvas-card";
import { EloSparkline, formatEloDelta, downsampleTrajectory } from "@/components/elo-sparkline";
import { PredictionExplanationCard } from "@/components/prediction-explanation-card";
import { PredictionSignalsPanel } from "@/components/prediction-signals";
import { translateConfidenceLabel, translateStageLabel } from "@/lib/display";
import {
  formatFinalsDateRange,
  getRepechageSwissMatchHint,
  type FinalsStageProbabilityProjection,
} from "@/lib/finals-schedule";
import {
  deriveMatchRatingBreakdown,
  formatSignedRatingDelta,
  ratingDeltaTone,
} from "@/lib/live-rating";
import { buildTeamHref } from "@/lib/team-profile";
import { isOfficialPlaceholderMatch } from "@/lib/workspace-selection";
import type {
  FinalEventMatch,
  FinalEventSchedule,
  FinalEventSlug,
  InspectorSelection,
  MatchRow,
  OverviewTeam,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ForecastMode = "live" | "sim";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
function MatchRoute({ match, eventSlug }: { match: FinalEventMatch; eventSlug?: FinalEventSlug }) {
  const flowHint = eventSlug === "repechage" ? getRepechageSwissMatchHint(match) : null;
  if (flowHint) {
    return <span className="text-rm-status-scheduled">{flowHint.title}</span>;
  }
  if (!match.winnerTo && !match.loserTo) {
    return <span className="text-rm-metal-textFaint">瑞士轮排名决定后续落位</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {match.winnerTo ? <span className="text-rm-status-safe">胜 → {match.winnerTo}</span> : null}
      {match.loserTo ? <span className="text-rm-metal-textMuted">负 → {match.loserTo}</span> : null}
    </span>
  );
}

const FINALS_OUTCOME_LABELS: Record<string, string> = {
  全国赛: "晋级全国赛",
  淘汰: "淘汰",
};

export interface InspectorTeamInfo {
  teamKey: string;
  collegeName: string;
  teamName: string;
  elo: number | null;
  seasonDelta: number | null;
  globalRank: number | null;
  probabilities: OverviewTeam["probabilities"] | null;
  eloTrajectory?: number[];
}

export function ForecastInspectorPanel({
  selection,
  mode,
  eventSlug,
  event,
  teamInfo,
  teamPath,
  teamOutcome,
  match,
  matchRow,
  topTeams,
  projection,
  onMatchOpen,
  onTeamOpen,
  onClose,
}: {
  selection: InspectorSelection | null;
  mode: ForecastMode;
  eventSlug: FinalEventSlug;
  event: FinalEventSchedule;
  teamInfo: InspectorTeamInfo | null;
  teamPath: MatchRow[];
  teamOutcome: string | null;
  match: FinalEventMatch | null;
  matchRow: MatchRow | null;
  topTeams: Array<{ teamKey: string; collegeName: string; championRate: number }>;
  projection: FinalsStageProbabilityProjection | null;
  onMatchOpen: (match: MatchRow) => void;
  onTeamOpen: (teamKey: string) => void;
  onClose: () => void;
}) {
  // ── 队伍情报（与区域赛 InspectorPanel 队伍分支一致） ──
  if (selection?.kind === "team" && teamInfo) {
    const probabilities = teamInfo.probabilities;
    const globalRankLabel =
      typeof teamInfo.globalRank === "number" ? `全球 #${teamInfo.globalRank}` : "全球排名待确认";

    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto overflow-x-hidden animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">队伍情报</p>
            <h3 className="text-lg font-machine text-white truncate w-56">{teamInfo.collegeName}</h3>
            <p className="text-xs text-rm-blue font-mono">{teamInfo.teamName}</p>
            <Link
              href={buildTeamHref(teamInfo.teamKey)}
              className="mt-2 inline-flex border border-rm-blue/30 bg-rm-blue/8 px-2 py-1 font-mono text-[10px] text-rm-blue hover:border-rm-blue/60 hover:text-white"
            >
              打开队伍档案
            </Link>
          </div>
          <button onClick={onClose} aria-label="关闭情报面板" className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <span className="text-rm-metal-text">Elo {teamInfo.elo === null ? "待确认" : teamInfo.elo.toFixed(1)}</span>
            <span className="text-rm-metal-text">{globalRankLabel}</span>
            {mode === "live" && teamInfo.eloTrajectory && teamInfo.eloTrajectory.length >= 2 ? (
              <div className="col-span-2 mt-1 flex items-center justify-between border-y border-rm-metal-border/70 py-2">
                <div>
                  <div className="text-rm-metal-textMuted">赛季 Elo 走势</div>
                  <div className={teamInfo.seasonDelta && teamInfo.seasonDelta >= 0 ? "text-rm-status-safe" : "text-rm-red"}>
                    赛季 {teamInfo.seasonDelta !== null ? formatEloDelta(teamInfo.seasonDelta) : "--"}
                  </div>
                </div>
                <EloSparkline
                  points={downsampleTrajectory(teamInfo.eloTrajectory)}
                  className="h-7 w-20"
                />
              </div>
            ) : null}
            {eventSlug === "repechage" ? (
              <span className="col-span-2 text-rm-blue">
                晋级率{" "}
                {projection
                  ? percent(projection.repechage.get(teamInfo.teamKey)?.advancementRate ?? 0)
                  : probabilities
                    ? percent(probabilities.national)
                    : "--"}
              </span>
            ) : (
              <>
                <span className="col-span-2 text-rm-blue">
                  十六强率{" "}
                  {projection
                    ? percent(projection.nationals.get(teamInfo.teamKey)?.groupAdvancementRate ?? 0)
                    : probabilities
                      ? percent(probabilities.roundOf16)
                      : "--"}
                </span>
                <span className="col-span-2 text-rm-status-scheduled">
                  八强率{" "}
                  {projection
                    ? percent(projection.nationals.get(teamInfo.teamKey)?.topEightRate ?? 0)
                    : "--"}
                </span>
                <span className="col-span-2 text-rm-status-safe">
                  四强率{" "}
                  {projection
                    ? percent(projection.nationals.get(teamInfo.teamKey)?.topFourRate ?? 0)
                    : "--"}
                </span>
                <span className="col-span-2 text-rm-result-winner">
                  冠军率{" "}
                  {projection
                    ? percent(projection.nationals.get(teamInfo.teamKey)?.championRate ?? 0)
                    : probabilities
                      ? percent(probabilities.champion)
                      : "--"}
                </span>
              </>
            )}
          </div>

          <div>
            <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-2 border-l-2 border-rm-blue pl-2">赛程路径</h4>
            <p className="text-[11px] text-rm-metal-text mb-3">
              {teamOutcome
                ? `模拟最终去向 · ${FINALS_OUTCOME_LABELS[teamOutcome] ?? teamOutcome}`
                : "最终名次随赛程推进持续更新；当前展示概率推演与已确认赛程。"}
            </p>
            <div className="space-y-2">
              {teamPath.length ? teamPath.map((teamMatch) => {
                const opponent = teamMatch.redTeam.teamKey === teamInfo.teamKey ? teamMatch.blueTeam : teamMatch.redTeam;
                const hasActualResult = Boolean(teamMatch.isRealResult);
                const isWin = hasActualResult && teamMatch.winnerTeamKey === teamInfo.teamKey;
                const scheduleLabel = formatMatchCardScheduleTime(teamMatch.plannedStartAt) ?? "已排期";
                const detailLabel = hasActualResult ? teamMatch.scoreline : scheduleLabel;
                return (
                  <button key={teamMatch.matchLabel} onClick={() => onMatchOpen(teamMatch)} className="w-full flex items-center justify-between bg-rm-metal-dark border border-rm-metal-border p-2 hover:border-rm-blue transition-colors text-left group">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className={cn(
                        "flex-none w-5 h-5 flex items-center justify-center text-[10px] font-bold",
                        hasActualResult
                          ? (isWin ? "bg-rm-status-safe text-black" : "bg-rm-metal-text border border-rm-metal-text/30 text-white")
                          : "border border-rm-status-scheduled/40 bg-rm-status-scheduled/10 text-rm-status-scheduled"
                      )}>
                        {hasActualResult ? (isWin ? "W" : "L") : "排"}
                      </span>
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[11px] font-bold text-white truncate">{opponent.collegeName}</span>
                        <span className="text-[10px] text-rm-metal-text font-mono truncate">{detailLabel} / {translateStageLabel(teamMatch.stage)}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-rm-metal-text font-mono opacity-0 group-hover:opacity-100 transition-opacity">V</span>
                  </button>
                );
              }) : (
                <div className="border border-dashed border-rm-metal-border bg-rm-metal-dark px-3 py-4 text-[11px] text-rm-metal-text">
                  暂无可展示赛程路径。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 赛事对战情报（与区域赛 InspectorPanel 比赛分支一致） ──
  if (selection?.kind === "match" && match && matchRow) {
    const isOfficialPlaceholder = isOfficialPlaceholderMatch(matchRow, mode);
    const predictedScore = predictScoreline(matchRow.pGameRed, matchRow.pSeriesRed, matchRow.bestOf || 3);
    const redRatingBreakdown = deriveMatchRatingBreakdown(matchRow, "red");
    const blueRatingBreakdown = deriveMatchRatingBreakdown(matchRow, "blue");
    const hasEloUpdate = Boolean(matchRow.isRealResult && redRatingBreakdown && blueRatingBreakdown);

    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">赛事对战情报</p>
            <h3 className="text-lg font-machine text-white">第 {match.number} 场</h3>
            <p className="text-xs text-rm-blue font-mono">{matchRow.stage}</p>
          </div>
          <button onClick={onClose} aria-label="关闭情报面板" className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          {isOfficialPlaceholder ? (
            <section className="border border-rm-status-scheduled/35 bg-rm-status-scheduled/8 p-3 clip-chamfer">
              <p className="text-[10px] font-bold uppercase tracking-widest text-rm-status-scheduled">对阵待确认</p>
              <p className="mt-2 text-[11px] leading-relaxed text-rm-metal-text">
                该场次已排期，对阵双方待抽签落位后更新预测数据。
              </p>
            </section>
          ) : (
            <PredictionExplanationCard match={matchRow} />
          )}

          <div className="text-center font-machine text-sm text-rm-metal-text border border-dashed border-rm-metal-border bg-rm-metal-dark py-4 relative overflow-hidden">
            {matchRow.isRealResult ? `已完赛 · ${matchRow.scoreline}` : "比赛尚未开始"}
            <div className="absolute bottom-1 right-2 text-[10px] text-rm-metal-text/50 font-sans">BO{matchRow.bestOf}</div>
          </div>

          {!isOfficialPlaceholder ? (
            <div className="text-center font-machine text-lg tracking-widest bg-rm-metal-dark border py-3 relative overflow-hidden border-rm-blue text-rm-blue">
              {predictedScore.scoreline}
              <div className="absolute bottom-1 right-2 text-[10px] opacity-70 font-sans">AI 预测</div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono p-3 bg-rm-metal-dark border border-rm-metal-border">
            {!isOfficialPlaceholder ? (
              <>
                <div className="col-span-2">
                  <PredictionSignalsPanel
                    density="compact"
                    ts2RedRate={matchRow.pSeriesRed}
                    ts2BlueRate={matchRow.pSeriesBlue}
                    miniProgramPrediction={matchRow.miniProgramPrediction}
                    showAudience={Boolean(matchRow.miniProgramPrediction || matchRow.officialMatchId)}
                    modelBadge="实时胜率"
                    ratePrecision={2}
                  />
                </div>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
                {hasEloUpdate ? (
                  <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 gap-y-1.5 border border-rm-metal-border/70 bg-rm-metal-abyss px-2 py-2 tabular-nums">
                    <span className="text-rm-metal-textFaint">Elo 变化</span>
                    <span className="text-right text-rm-metal-textFaint">赛前</span>
                    <span className="text-right text-rm-metal-textFaint">本场</span>
                    <span className="text-right text-rm-metal-textFaint">赛后</span>
                    {[redRatingBreakdown!, blueRatingBreakdown!].map((breakdown, index) => (
                      <div key={breakdown.teamName} className="contents">
                        <span className={cn("truncate font-bold", index === 0 ? "text-rm-red" : "text-rm-blue")}>{breakdown.teamName}</span>
                        <span className="text-right text-white">{breakdown.before.toFixed(1)}</span>
                        <span className={cn("text-right font-bold", ratingDeltaTone(breakdown.totalDelta))}>
                          {formatSignedRatingDelta(breakdown.totalDelta)}
                        </span>
                        <span className={cn("text-right font-bold", index === 0 ? "text-rm-red" : "text-rm-blue")}>{breakdown.after.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="col-span-2 text-rm-metal-text">
                    仅真实完赛结果更新 Elo；预测赛果不会写回。
                  </span>
                )}
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
                <span className="text-rm-metal-text">结果置信度</span>
                <span className="text-white font-bold text-right">{translateConfidenceLabel(matchRow.confidenceLabel)}</span>
              </>
            ) : null}
          </div>

          {/* 全国赛适配补充：官方槽位流向与时间（区域赛无对应数据） */}
          <div className="border border-rm-metal-border bg-black/50 p-3 leading-relaxed font-mono text-[10px]">
            <div className="mb-2 text-rm-metal-textFaint">胜败流向</div>
            <MatchRoute match={match} eventSlug={eventSlug} />
          </div>
          <div className="flex items-center justify-between border-t border-rm-metal-border pt-3 text-rm-metal-textMuted font-mono text-[10px]">
            <span>{match.startsAt.slice(0, 10)} {match.startTime}</span>
            <span className="text-rm-status-scheduled">BO{match.bestOf}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── 赛事模块（与区域赛 InspectorPanel 默认分支一致，按全国赛数据适配） ──
  return (
    <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
      <div className="border-b border-rm-metal-border pb-4 mb-4">
        <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest">赛事模块</p>
        <h3 className="text-lg font-machine text-white">{event.name}</h3>
      </div>
      <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono mb-6">
        <span className="text-rm-metal-text">队伍数量</span>
        <span className="text-white font-bold text-right">{event.participantCount}</span>
        <span className="text-rm-metal-text">比赛场次</span>
        <span className="text-rm-status-safe font-bold text-right">{event.formalMatchCount}</span>
        <span className="text-rm-metal-text">比赛日期</span>
        <span className="text-rm-status-warn font-bold text-right">
          {formatFinalsDateRange(event.competitionRange.start, event.competitionRange.end)}
        </span>
      </div>

      <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-3">头部竞争队</h4>
      <div className="space-y-2">
        {topTeams.map((team) => (
          <button key={team.teamKey} onClick={() => onTeamOpen(team.teamKey)} className="w-full flex items-start justify-between gap-3 bg-rm-metal-dark border border-rm-metal-border px-3 py-2 hover:border-rm-blue transition-colors group">
            <span className="min-w-0 flex-1 text-xs font-bold text-white text-left leading-5 line-clamp-2">{team.collegeName}</span>
            <span className="shrink-0 pt-0.5 text-[10px] font-mono text-rm-blue">{percent(team.championRate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
