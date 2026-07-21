"use client";

import Link from "next/link";

import { PredictionExplanationCard } from "@/components/prediction-explanation-card";
import { PredictionSignalsPanel } from "@/components/prediction-signals";
import { cn } from "@/lib/utils";
import {
  formatMatchLabel,
  formatRankingResultLabel,
  translateConfidenceLabel,
  translateOfficialStatusLabel,
  translateStageLabel,
} from "@/lib/display";
import { derivePredictionVerdict } from "@/lib/prediction-insights";
import { predictDisplayScoreline } from "@/lib/scoreline";
import { formatBeijingMonthDayTime } from "@/lib/time-format";
import { buildTeamHref } from "@/lib/team-profile";
import {
  isOfficialPlaceholderMatch,
  shouldRenderTeamInspector,
  type TeamDrawerMode,
  type WorkspaceInspectorTeam,
} from "@/lib/workspace-selection";
import {
  deriveMatchRatingBreakdown,
  formatSignedRatingDelta,
  ratingDeltaTone,
  type MatchRatingBreakdown,
} from "@/lib/live-rating";
import type {
  FinalRankingRow,
  InspectorSelection,
  MatchRow,
  OverviewRegion,
} from "@/lib/types";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function displayElo(team: { currentElo?: number; mu0?: number }) {
  return team.currentElo ?? team.mu0 ?? null;
}

function hasMatchElo(match: MatchRow) {
  return (
    typeof match.redMu0 === "number" &&
    typeof match.blueMu0 === "number" &&
    typeof match.redDelta === "number" &&
    typeof match.blueDelta === "number"
  );
}

function RatingBreakdownLine({ breakdown, sideClassName }: { breakdown: MatchRatingBreakdown; sideClassName: string }) {
  const showPriorAdjustment = breakdown.hasSplitAdjustment && breakdown.priorDelta !== null && Math.abs(breakdown.priorDelta) >= 0.05;
  return (
    <div className="col-span-2 border border-rm-metal-border/70 bg-rm-metal-abyss px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={cn("font-bold truncate", sideClassName)}>{breakdown.teamName}</span>
        <span className="font-bold flex gap-2 whitespace-nowrap">
          <span className="text-white">{breakdown.before.toFixed(1)}</span>
          <span className={ratingDeltaTone(breakdown.totalDelta)}>
            {formatSignedRatingDelta(breakdown.totalDelta)}
          </span>
          <span className={sideClassName}>→ {breakdown.after.toFixed(1)}</span>
        </span>
      </div>
      {breakdown.hasSplitAdjustment ? (
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[10px]">
          <span className="text-rm-metal-text">本场表现更新</span>
          <span className={cn("font-bold", ratingDeltaTone(breakdown.liveDelta ?? 0))}>
            {formatSignedRatingDelta(breakdown.liveDelta ?? 0)}
          </span>
          {showPriorAdjustment ? (
            <>
              <span className="text-rm-status-warn">{breakdown.priorLabel}</span>
              <span className={cn("font-bold", ratingDeltaTone(breakdown.priorDelta ?? 0))}>
                {formatSignedRatingDelta(breakdown.priorDelta ?? 0)}
              </span>
            </>
          ) : null}
          <span className="text-rm-metal-textFaint">合计变化</span>
          <span className={cn("font-bold", ratingDeltaTone(breakdown.totalDelta))}>
            {formatSignedRatingDelta(breakdown.totalDelta)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export interface RegionInspectorPanelProps {
  selection: InspectorSelection | null;
  regionOverview: OverviewRegion | null;
  selectedOverviewTeam: WorkspaceInspectorTeam | null;
  selectedRanking: FinalRankingRow | null;
  selectedPath: MatchRow[];
  selectedMatch: MatchRow | null;
  dataMode: TeamDrawerMode;
  onMatchOpen: (match: MatchRow) => void;
  onTeamOpen: (teamKey: string) => void;
  onClose: () => void;
}

export function RegionInspectorPanel({ selection, regionOverview, selectedOverviewTeam, selectedRanking, selectedPath, selectedMatch, dataMode, onMatchOpen, onTeamOpen, onClose }: RegionInspectorPanelProps) {
  if (shouldRenderTeamInspector(selection, selectedOverviewTeam)) {
    const displayedElo = displayElo(selectedOverviewTeam);
    const probabilities = selectedOverviewTeam.probabilities ?? null;
    const globalRankLabel =
      typeof selectedOverviewTeam.eloGlobalRank === "number" ? `全球 #${selectedOverviewTeam.eloGlobalRank}` : "全球排名待确认";

    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto overflow-x-hidden animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">队伍情报</p>

            <h3 className="text-lg font-machine text-white truncate w-56">{selectedOverviewTeam.collegeName}</h3>
            <p className="text-xs text-rm-blue font-mono">{selectedOverviewTeam.teamName}</p>
            <Link
              href={buildTeamHref(selectedOverviewTeam.teamKey)}
              className="mt-2 inline-flex border border-rm-blue/30 bg-rm-blue/8 px-2 py-1 font-mono text-[10px] text-rm-blue hover:border-rm-blue/60 hover:text-white"
            >
              打开队伍档案
            </Link>
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <span className="text-rm-metal-text">Elo {displayedElo === null ? "待确认" : displayedElo.toFixed(1)}</span>
            <span className="text-rm-metal-text">{globalRankLabel}</span>
            {probabilities ? (
              <>
                <span className="col-span-2 text-rm-status-warn">国赛率 {percent(probabilities.national)}</span>
                <span className="col-span-2 text-rm-blue">复活赛 {percent(probabilities.repechage)}</span>
                <span className="col-span-2 text-rm-blue">夺冠率 {percent(probabilities.champion)}</span>
              </>
            ) : (
              <span className="col-span-2 text-rm-metal-text">概率待模型同步</span>
            )}
          </div>

          <div>
            <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-2 border-l-2 border-rm-blue pl-2">赛程路径</h4>
            <p className="text-[11px] text-rm-metal-text mb-3">
              {selectedRanking
                ? formatRankingResultLabel(selectedRanking.rank, selectedRanking.finalBucket, selectedRanking.advancement)
                : "最终名次随赛程推进持续更新；当前展示概率推演与已确认赛程。"}
            </p>
            <div className="space-y-2">
              {selectedPath.length ? selectedPath.map((match) => {
                const opponent = match.redTeam.teamKey === selectedOverviewTeam.teamKey ? match.blueTeam : match.redTeam;
                const hasActualResult = Boolean(match.isRealResult);
                const isWin = hasActualResult && match.winnerTeamKey === selectedOverviewTeam.teamKey;
                const scheduleLabel = formatBeijingMonthDayTime(match.plannedStartAt) ?? "已排期";
                const detailLabel = hasActualResult ? match.scoreline : scheduleLabel;
                return (
                  <button key={match.matchLabel} onClick={() => onMatchOpen(match)} className="w-full flex items-center justify-between bg-rm-metal-dark border border-rm-metal-border p-2 hover:border-rm-blue transition-colors text-left group">
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
                        <span className="text-[10px] text-rm-metal-text font-mono truncate">{detailLabel} / {translateStageLabel(match.stage)}</span>
                      </div>
                    </div>
                    <span aria-hidden="true" className="text-[10px] text-rm-metal-text font-mono">V</span>
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

  if (selection?.kind === "match" && selectedMatch) {
    const isOfficialPlaceholder = isOfficialPlaceholderMatch(selectedMatch, dataMode);
    const predictedScore = predictDisplayScoreline(selectedMatch.pGameRed, selectedMatch.pSeriesRed, selectedMatch.bestOf || 3);
    const verdict = derivePredictionVerdict(selectedMatch, predictedScore.scoreline);
    const redRatingBreakdown = deriveMatchRatingBreakdown(selectedMatch, "red");
    const blueRatingBreakdown = deriveMatchRatingBreakdown(selectedMatch, "blue");

    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">赛事对战情报</p>
            <h3 className="text-lg font-machine text-white">{formatMatchLabel(selectedMatch.matchLabel)}</h3>
            <p className="text-xs text-rm-blue font-mono">{translateStageLabel(selectedMatch.stage)}</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
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
            <PredictionExplanationCard
              match={selectedMatch}
              regionSlug={regionOverview?.regionSlug}
              regionName={regionOverview?.regionName}
            />
          )}

          {selectedMatch.isRealResult ? (
            <div className={cn("text-center font-machine text-xl text-white tracking-widest bg-rm-metal-dark border py-4 relative overflow-hidden",
              verdict === "upset" ? "border-rm-status-upset text-rm-status-upset" : verdict === "deviation" ? "border-rm-status-deviation text-rm-status-deviation" : "border-rm-status-safe text-rm-status-safe"
            )}>
               {selectedMatch.scoreline}
               <div className="absolute bottom-1 right-2 text-[10px] text-rm-metal-text font-sans">实际 BO{selectedMatch.bestOf}</div>
            </div>
          ) : (
            <div className="text-center font-machine text-sm text-rm-metal-text border border-dashed border-rm-metal-border bg-rm-metal-dark py-4 relative overflow-hidden">
               比赛尚未开始
               <div className="absolute bottom-1 right-2 text-[10px] text-rm-metal-text/50 font-sans">BO{selectedMatch.bestOf}</div>
            </div>
          )}

          {!isOfficialPlaceholder ? (
            <div className={cn("text-center font-machine text-lg tracking-widest bg-rm-metal-dark border py-3 relative overflow-hidden",
              selectedMatch.isRealResult
                ? (verdict === "exact" ? "border-rm-status-safe text-rm-status-safe" : "border-rm-status-deviation text-rm-status-deviation")
                : "border-rm-blue text-rm-blue"
            )}>
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
                    ts2RedRate={selectedMatch.pSeriesRed}
                    ts2BlueRate={selectedMatch.pSeriesBlue}
                    miniProgramPrediction={selectedMatch.miniProgramPrediction}
                    showAudience={Boolean(selectedMatch.miniProgramPrediction || selectedMatch.officialMatchId)}
                    modelBadge={selectedMatch.isRealResult ? "赛前记录" : "实时胜率"}
                    ratePrecision={2}
                  />
                </div>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            ) : null}
            {selectedMatch.officialMatchId ? (
              <>
                <span className="text-rm-metal-text">官方赛程编号</span>
                <span className="text-white font-bold text-right">{selectedMatch.officialMatchId}</span>
                <span className="text-rm-metal-text">官方状态</span>
                <span className="text-white font-bold text-right">{translateOfficialStatusLabel(selectedMatch.officialStatus)}</span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            ) : null}
            {/* Show TS2 changes only for matches with an actual published result */}
            {!isOfficialPlaceholder && hasMatchElo(selectedMatch) && (
              <>
                {redRatingBreakdown ? <RatingBreakdownLine breakdown={redRatingBreakdown} sideClassName="text-rm-red" /> : null}
                {blueRatingBreakdown ? <RatingBreakdownLine breakdown={blueRatingBreakdown} sideClassName="text-rm-blue" /> : null}
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}
            {!isOfficialPlaceholder && !hasMatchElo(selectedMatch) && (
              <>
                <span className="col-span-2 text-rm-metal-text">
                  比赛结束后将自动更新战力变化。
                </span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}

            {!isOfficialPlaceholder ? (
              <>
                {selectedMatch.confidenceLabel && (
                  <>
                    <span className="text-rm-metal-text">结果置信度</span>
                    <span className="text-white font-bold text-right">{translateConfidenceLabel(selectedMatch.confidenceLabel)}</span>
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-full md:w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
      <div className="border-b border-rm-metal-border pb-4 mb-4">
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest">赛区模块</p>
        <h3 className="text-lg font-machine text-white">{regionOverview?.regionName ?? "等待载入"}</h3>
      </div>
      <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono mb-6">
        <span className="text-rm-metal-text">队伍数量</span>
        <span className="text-white font-bold text-right">{regionOverview?.teams.length ?? 0}</span>
        <span className="text-rm-metal-text">国赛席位</span>
        <span className="text-rm-status-warn font-bold text-right">{regionOverview?.nationalSlots ?? 0}</span>
        <span className="text-rm-metal-text">复活赛席位</span>
        <span className="text-rm-blue font-bold text-right">{regionOverview?.repechageSlots ?? 0}</span>
      </div>

      <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-3">头部竞争队</h4>
      <div className="space-y-2">
        {regionOverview?.teams.slice(0, 6).map((team) => (
          <button key={team.teamKey} onClick={() => onTeamOpen(team.teamKey)} className="w-full flex items-start justify-between gap-3 bg-rm-metal-dark border border-rm-metal-border px-3 py-2 hover:border-rm-blue transition-colors group">
            <span className="min-w-0 flex-1 text-xs font-bold text-white text-left leading-5 line-clamp-2">{team.collegeName}</span>
            <span className="shrink-0 pt-0.5 text-[10px] font-mono text-rm-blue">{percent(team.probabilities.champion)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
