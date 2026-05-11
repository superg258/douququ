"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PredictionSignalsPanel } from "@/components/prediction-signals";
import { PredictionExplanationCard } from "@/components/prediction-explanation-card";
import { WorkspaceStageView } from "@/components/workspace-stage";
import { getLiveState, getOverview, getSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { formatMatchLabel, formatRankingResultLabel, translateConfidenceLabel, translateStageLabel } from "@/lib/display";
import { buildPredictionRecap } from "@/lib/prediction-insights";
import {
  buildRegionHref,
  DEFAULT_SEED,
  getOrCreateSessionSeed,
  parseSeed,
  refreshSessionSeed,
  REGION_LABELS,
  REGION_VIEWS,
  resolveWorkspaceDataMode,
} from "@/lib/region-config";
import { buildTeamHref } from "@/lib/team-profile";
import { sortTeamsForWorkspaceSearch } from "@/lib/workspace-search";
import {
  filterTeamDrawerMatches,
  resolveHighlightSelectionState,
  resolveWorkspaceInspectorTeam,
  shouldRenderTeamInspector,
  type InspectorPanelState,
} from "@/lib/workspace-selection";
import { deriveRealtimeAvailability } from "@/lib/realtime";
import { deriveMatchRatingBreakdown, formatSignedRatingDelta, ratingDeltaTone, type MatchRatingBreakdown } from "@/lib/live-rating";
import { formatMatchCardScheduleTime, predictScoreline } from "@/components/canvas-card";
import type {
  InspectorSelection,
  LiveStateResponse,
  MatchRow,
  OverviewResponse,
  OverviewTeam,
  RegionSlug,
  SimulationResponse,
  WorkspaceView,
} from "@/lib/types";

type MatchPhase = "pre" | "post";

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
    <div className="col-span-2 border border-rm-metal-border/70 bg-[#05070c] px-3 py-2 space-y-1.5">
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
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[9px]">
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

function validRegion(regionSlug: string): regionSlug is RegionSlug {
  return regionSlug === "east_region" || regionSlug === "south_region" || regionSlug === "north_region";
}

function validView(view: string | null): view is WorkspaceView {
  return REGION_VIEWS.some((item) => item.id === view);
}

function sanitizeSeedInput(seedText: string) {
  return seedText.replace(/\D/g, "").slice(0, 8);
}

function unavailableLiveState(regionSlug: RegionSlug, reason: string): LiveStateResponse {
  return {
    available: false,
    reason,
    sourceStatus: "error",
    sourceReason: reason,
    sourceUpdatedAt: null,
    completedOfficialMatches: 0,
    confirmedOfficialMatches: 0,
    ledgerRows: 0,
    regionSlug,
    regionName: REGION_LABELS[regionSlug],
    generatedAt: null,
    season: null,
    currentSnapshot: [],
    matchLedger: [],
    teamIndex: {},
  };
}

function teamPath(simulation: SimulationResponse, teamKey: string) {
  return simulation.matches
    .filter((match) => match.redTeam.teamKey === teamKey || match.blueTeam.teamKey === teamKey)
    .sort((left, right) => {
      if (left.stageOrder !== right.stageOrder) {
        return left.stageOrder - right.stageOrder;
      }
      return left.matchLabel.localeCompare(right.matchLabel);
    });
}

function deriveMatchPhase(match: MatchRow): MatchPhase {
  return match.isRealResult ? "post" : "pre";
}

function SouthSwissReplayList({ view, simulation }: { view: WorkspaceView; simulation: SimulationResponse | null }) {
  const groupName = view === "swiss-a" ? "A" : "B";
  const swissRows = (simulation?.matches ?? []).filter((row) => row.stage === "swiss" && row.groupName === groupName);
  const pendingRows = swissRows
    .filter((row) => !row.isRealResult)
    .sort((left, right) => {
      if (left.roundNumber !== right.roundNumber) {
        return left.roundNumber - right.roundNumber;
      }
      return left.matchLabel.localeCompare(right.matchLabel);
    });
  const completedRows = swissRows
    .filter((row) => row.isRealResult)
    .sort((left, right) => {
      if (left.roundNumber !== right.roundNumber) {
        return left.roundNumber - right.roundNumber;
      }
      return left.matchLabel.localeCompare(right.matchLabel);
    });
  const rows = [...pendingRows, ...completedRows];

  return (
    <div className="h-full overflow-y-auto px-6 py-5 no-scrollbar">
      <div className="mb-4 border border-rm-status-safe/45 bg-rm-status-safe/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold tracking-widest text-rm-status-safe">{groupName} 组赛程</h3>
          <span className="text-[10px] font-mono border border-rm-status-safe/45 bg-rm-status-safe/10 px-2 py-0.5 text-rm-status-safe">
            未赛优先
          </span>
        </div>
        <p className="mt-2 text-xs text-rm-metal-text">
          未完赛优先，已完赛靠后。
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
          <span className="border border-rm-blue/35 bg-rm-blue/10 px-2 py-0.5 text-rm-blue">未完赛 {pendingRows.length}</span>
          <span className="border border-rm-status-safe/35 bg-rm-status-safe/10 px-2 py-0.5 text-rm-status-safe">已完赛 {completedRows.length}</span>
        </div>
      </div>

      <div className="space-y-4">
        {rows.map((row) => {
          const isCompleted = Boolean(row.isRealResult);
          const expectedRed = row.pSeriesRed;
          const expectedBlue = row.pSeriesBlue;
          const [redGamesText, blueGamesText] = (row.scoreline || "0:0").split(":");
          const redGames = Number(redGamesText);
          const blueGames = Number(blueGamesText);
          const actualWinnerName = redGames > blueGames ? row.redTeam.collegeName : row.blueTeam.collegeName;
          
          let predictionHit = false;
          if (isCompleted) {
            const expectedWinnerName = expectedRed >= expectedBlue ? row.redTeam.collegeName : row.blueTeam.collegeName;
            predictionHit = expectedWinnerName === actualWinnerName;
          }

          const predictedScore = predictScoreline(row.pGameRed, row.pSeriesRed, row.bestOf || 3);
          const postLine = isCompleted
            ? (
              predictionHit
                ? `赛前预测命中，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`
                : `赛前预测未命中，实际结果出现逆转，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`
            )
            : `本场尚未产生正式赛果，以下为赛前预测走向，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`;

          return (
            <article 
              key={row.matchLabel} 
              className={cn(
                "relative bg-rm-metal-dark/80 px-4 py-4 clip-chamfer group overflow-hidden border transition-colors",
                isCompleted ? "border-rm-status-safe/50 hover:border-rm-status-safe" : "border-rm-metal-border hover:border-rm-blue/50"
              )}
            >
              {isCompleted && (
                <div className="absolute inset-0 bg-gradient-to-r from-rm-status-safe/5 via-transparent to-transparent pointer-events-none" />
              )}
              
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rm-metal-border/50 pb-2 relative z-10">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-0.5 clip-chamfer border",
                    isCompleted ? "border-rm-status-safe text-rm-status-safe bg-rm-status-safe/10 shadow-[0_0_8px_rgba(0,255,157,0.3)]" : "border-rm-blue text-rm-blue bg-rm-blue/10 shadow-[0_0_8px_rgba(0,163,255,0.3)]"
                  )}>
                    {isCompleted ? "已完赛" : "待开赛"}
                  </span>
                  <span className="text-sm font-machine tracking-widest text-white">{formatMatchLabel(row.matchLabel)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-rm-metal-text opacity-70">第 {row.roundNumber} 轮 / BO{row.bestOf}</span>
                  {isCompleted && <span className="bg-rm-status-safe text-black font-bold px-1.5">已出赛果</span>}
                </div>
              </div>

              <div className="mt-5 relative z-10">
                <div className="flex items-stretch justify-between relative bg-[#05070c] border border-rm-metal-border/50 clip-chamfer min-h-[82px]">
                  
                  {/* Red Team Side */}
                  <div className={cn(
                    "flex-[0.45] flex flex-col justify-center p-3 border-l-2 bg-gradient-to-r from-rm-red/10 to-transparent",
                    isCompleted && actualWinnerName === row.redTeam.collegeName ? "border-rm-status-safe shadow-[inset_0_0_20px_rgba(0,255,157,0.15)]" : "border-rm-red"
                  )}>
                     {isCompleted && actualWinnerName === row.redTeam.collegeName && (
                       <span className="text-[9px] font-machine text-rm-status-safe tracking-widest mb-1 animate-pulse">{">>> 胜者"}</span>
                     )}
                     <div 
                       title={row.redTeam.collegeName} 
                       className={cn("text-base font-bold tracking-widest break-normal line-clamp-2 pr-2 h-full flex items-center shadow-black drop-shadow-md", isCompleted && actualWinnerName === row.redTeam.collegeName ? "text-white text-glow-white" : "text-rm-red")}
                     >
                       {row.redTeam.collegeName}
                     </div>
                  </div>
                  
                  {/* Center VS */}
                  <div className="flex-[0.1] flex flex-col items-center justify-center relative">
                    <div className="text-3xl font-machine italic text-rm-metal-text opacity-30 select-none">对阵</div>
                    {isCompleted ? (
                       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0f] border border-rm-status-safe px-4 py-2 text-2xl font-machine text-rm-status-safe shadow-[0_0_15px_rgba(0,255,157,0.4)] whitespace-nowrap z-10 text-glow">
                         {row.scoreline}
                       </div>
                    ) : (
                       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a0a0f] border border-rm-status-warn/50 px-2 py-1 text-xs font-machine text-rm-status-warn/80 whitespace-nowrap z-10 flex flex-col items-center shadow-[0_0_10px_rgba(255,184,46,0.2)]">
                         <span className="-mb-0.5 mt-0.5 text-[9px] text-rm-status-warn/60 uppercase">预测</span>
                         <span className="text-xl tracking-widest">{predictedScore.scoreline}</span>
                       </div>
                    )}
                  </div>

                  {/* Blue Team Side */}
                  <div className={cn(
                    "flex-[0.45] flex flex-col justify-center items-end p-3 border-r-2 bg-gradient-to-l from-rm-blue/10 to-transparent text-right",
                    isCompleted && actualWinnerName === row.blueTeam.collegeName ? "border-rm-status-safe shadow-[inset_0_0_20px_rgba(0,255,157,0.15)]" : "border-rm-blue"
                  )}>
                     {isCompleted && actualWinnerName === row.blueTeam.collegeName && (
                       <span className="text-[9px] font-machine text-rm-status-safe tracking-widest mb-1 animate-pulse">胜者 {"<<<"}</span>
                     )}
                     <div 
                       title={row.blueTeam.collegeName} 
                       className={cn("text-base font-bold tracking-widest break-normal line-clamp-2 pl-2 h-full flex items-center justify-end shadow-black drop-shadow-md", isCompleted && actualWinnerName === row.blueTeam.collegeName ? "text-white text-glow-white" : "text-rm-blue")}
                     >
                       {row.blueTeam.collegeName}
                     </div>
                  </div>
                </div>

                <div className="mt-4 border border-rm-metal-border/50 bg-[#05070c] p-2.5 clip-chamfer">
                  <PredictionSignalsPanel
                    ts2RedRate={expectedRed}
                    ts2BlueRate={expectedBlue}
                    miniProgramPrediction={row.miniProgramPrediction}
                    showAudience={Boolean(row.miniProgramPrediction || row.officialMatchId)}
                    modelBadge={isCompleted ? "赛前记录" : "实时胜率"}
                  />

                  <div className="mt-3 bg-rm-metal-dark/30 border-l-[3px] border-rm-blue px-3 py-2">
                    <div className="text-[10px] text-rm-metal-text font-mono flex items-start gap-2">
                      <span className={cn("font-bold mt-[1px]", isCompleted ? "text-rm-status-safe" : "text-rm-blue opacity-50")}>{'>'}</span>
                      <span className="leading-relaxed flex-1">
                        <span className={cn("font-bold mr-2", isCompleted ? "text-white" : "text-rm-metal-text")}>
                          {isCompleted ? "赛后" : "摘要"}
                        </span>
                        {postLine}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SearchModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-2xl bg-rm-metal-dark border border-rm-metal-border shadow-2xl flex flex-col max-h-[85vh] clip-chamfer-lg">
        <div className="flex justify-between items-center bg-rm-metal-panel p-4 border-b border-rm-metal-border">
          <h3 className="font-machine uppercase tracking-widest text-white">{title}</h3>
          <button onClick={onClose} className="text-rm-metal-text hover:text-rm-red font-mono text-xs focus:outline-none">
            关闭
          </button>
        </div>
        <div className="p-4 overflow-y-auto no-scrollbar">{children}</div>
      </div>
    </div>
  );
}

function InspectorPanel({ selection, regionOverview, selectedOverviewTeam, selectedRanking, selectedPath, selectedMatch, onMatchOpen, onTeamOpen, onClose }: any) {
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
          <button onClick={onClose} className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <span className="text-rm-metal-text">Elo {displayedElo === null ? "待确认" : displayedElo.toFixed(1)}</span>
            <span className="text-rm-metal-text">{globalRankLabel}</span>
            {probabilities ? (
              <>
                <span className="col-span-2 text-rm-status-safe">国赛率 {percent(probabilities.national)}</span>
                <span className="col-span-2 text-rm-status-warn">复活赛 {percent(probabilities.repechage)}</span>
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
                : "实时最终名次待官方确认；当前仅展示队伍概率与已完赛/已排期赛程。"}
            </p>
            <div className="space-y-2">
              {selectedPath.length ? selectedPath.map((match: any) => {
                const opponent = match.redTeam.teamKey === selectedOverviewTeam.teamKey ? match.blueTeam : match.redTeam;
                const hasActualResult = Boolean(match.isRealResult);
                const isWin = hasActualResult && match.winnerTeamKey === selectedOverviewTeam.teamKey;
                const scheduleLabel = formatMatchCardScheduleTime(match.plannedStartAt) ?? "已排期";
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
                        <span className="text-[9px] text-rm-metal-text font-mono truncate">{detailLabel} / {translateStageLabel(match.stage)}</span>
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

  if (selection?.kind === "match" && selectedMatch) {
    const predictedScore = predictScoreline(selectedMatch.pGameRed, selectedMatch.pSeriesRed, selectedMatch.bestOf || 3);
    const [redGamesText, blueGamesText] = (selectedMatch.scoreline || "0:0").split(":");
    const redGames = Number(redGamesText);
    const blueGames = Number(blueGamesText);
    const actualWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
    const actualScoreSame = predictedScore.scoreline === selectedMatch.scoreline;
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
          <button onClick={onClose} className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          <PredictionExplanationCard
            match={selectedMatch}
            regionSlug={regionOverview?.regionSlug}
            regionName={regionOverview?.regionName}
          />

          {selectedMatch.isRealResult ? (
            <div className={cn("text-center font-machine text-xl text-white tracking-widest bg-rm-metal-dark border py-4 relative overflow-hidden",
              !actualWinnerSame ? "border-[#ef4444] text-[#ef4444]" : !actualScoreSame ? "border-[#a855f7] text-[#a855f7]" : "border-rm-status-safe text-rm-status-safe"
            )}>
               {selectedMatch.scoreline}
               <div className="absolute bottom-1 right-2 text-[9px] text-rm-metal-text font-sans">实际 BO{selectedMatch.bestOf}</div>
            </div>
          ) : (
            <div className="text-center font-machine text-sm text-rm-metal-text border border-dashed border-rm-metal-border bg-rm-metal-dark py-4 relative overflow-hidden">
               尚未产生正式赛果
               <div className="absolute bottom-1 right-2 text-[9px] text-rm-metal-text/50 font-sans">BO{selectedMatch.bestOf}</div>
            </div>
          )}

          <div className={cn("text-center font-machine text-lg tracking-widest bg-rm-metal-dark border py-3 relative overflow-hidden",
            selectedMatch.isRealResult
              ? (actualScoreSame ? "border-rm-status-safe text-rm-status-safe" : "border-[#a855f7] text-[#a855f7]")
              : "border-rm-blue text-rm-blue"
          )}>
             {predictedScore.scoreline}
             <div className="absolute bottom-1 right-2 text-[8px] opacity-70 font-sans">AI 预测</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono p-3 bg-rm-metal-dark border border-rm-metal-border">
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
            {selectedMatch.officialMatchId ? (
              <>
                <span className="text-rm-metal-text">官方赛程编号</span>
                <span className="text-white font-bold text-right">{selectedMatch.officialMatchId}</span>
                <span className="text-rm-metal-text">官方状态</span>
                <span className="text-white font-bold text-right">{selectedMatch.officialStatus ?? "暂无数据"}</span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            ) : null}
            {/* Show TS2 changes only for matches with an actual published result */}
            {hasMatchElo(selectedMatch) && (
              <>
                {redRatingBreakdown ? <RatingBreakdownLine breakdown={redRatingBreakdown} sideClassName="text-rm-red" /> : null}
                {blueRatingBreakdown ? <RatingBreakdownLine breakdown={blueRatingBreakdown} sideClassName="text-rm-blue" /> : null}
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}
            {!hasMatchElo(selectedMatch) && (
              <>
                <span className="col-span-2 text-rm-metal-text">
                  本场尚未产生实际赛果，暂不更新战力变化，待正式结果公布后同步。
                </span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}

                      <span className="text-rm-metal-text">历史战绩修正</span>
            <span className="text-white font-bold text-right">{selectedMatch.deltaH2H.toFixed(3)}</span>
        {selectedMatch.confidenceLabel && (
          <>
            <span className="text-rm-metal-text">结果置信度</span>
            <span className="text-white font-bold text-right">{translateConfidenceLabel(selectedMatch.confidenceLabel)}</span>
          </>
        )}
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
        <span className="text-rm-status-safe font-bold text-right">{regionOverview?.nationalSlots ?? 0}</span>
        <span className="text-rm-metal-text">复活赛席位</span>
        <span className="text-rm-status-warn font-bold text-right">{regionOverview?.repechageSlots ?? 0}</span>
      </div>
      
      <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-3">头部竞争队</h4>
      <div className="space-y-2">
        {regionOverview?.teams.slice(0, 6).map((team: any) => (
          <button key={team.teamKey} onClick={() => onTeamOpen(team.teamKey)} className="w-full flex items-start justify-between gap-3 bg-rm-metal-dark border border-rm-metal-border px-3 py-2 hover:border-rm-blue transition-colors group">
            <span className="min-w-0 flex-1 text-xs font-bold text-white text-left leading-5 line-clamp-2">{team.collegeName}</span>
            <span className="shrink-0 pt-0.5 text-[9px] font-mono text-rm-blue">{percent(team.probabilities.champion)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RegionWorkspace({ regionSlug: rawRegionSlug }: { regionSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaultView = useMemo<WorkspaceView>(() => "playoff", []);

  const regionSlug = validRegion(rawRegionSlug) ? rawRegionSlug : "east_region";
  const view = validView(searchParams.get("view")) ? (searchParams.get("view") as WorkspaceView) : defaultView;
  const requestedMode = (searchParams.get("mode") === "sim" || searchParams.get("mode") === "live")
    ? searchParams.get("mode") as "sim" | "live"
    : "sim";
  const highlightedTeamKey = searchParams.get("highlight");
  const parsedSeed = parseSeed(searchParams.get("seed"));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);

  // Suppress root layout header on mount — this page is a fullscreen canvas
  useEffect(() => {
    document.body.classList.add("canvas-fullscreen-page");
    return () => {
      document.body.classList.remove("canvas-fullscreen-page");
    };
  }, []);
  const [legendOpen, setLegendOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sessionSeed, setSessionSeed] = useState<number | null>(null);
  const seed = parsedSeed ?? sessionSeed;
  const [seedDraft, setSeedDraft] = useState(() => (seed ? String(seed) : ""));
  const [selection, setSelection] = useState<InspectorSelection | null>(
    highlightedTeamKey ? { kind: "team", teamKey: highlightedTeamKey } : null
  );
  const selectionRef = useRef<InspectorPanelState>({
    selection: highlightedTeamKey ? { kind: "team", teamKey: highlightedTeamKey } : null,
    inspectorOpen: false,
  });
  const deferredSearchText = useDeferredValue(searchText);
  const resolveSeed = useCallback(() => seed ?? getOrCreateSessionSeed(), [seed]);
  const regionOverview = useMemo(
    () => overview?.regions.find((item) => item.regionSlug === regionSlug) ?? null,
    [overview, regionSlug]
  );
  const realtimeState = liveState ?? regionOverview?.liveStatus ?? null;
  const realtimeStatusLoaded = Boolean(realtimeState);
  const realtimeAvailability = useMemo(
    () => deriveRealtimeAvailability(regionSlug, realtimeState),
    [realtimeState, regionSlug]
  );
  const realtimeEnabled = realtimeAvailability.enabled;
  const dataMode = resolveWorkspaceDataMode(requestedMode, realtimeStatusLoaded, realtimeEnabled);
  const requestedLiveFallback = requestedMode === "live" && realtimeStatusLoaded && !realtimeEnabled;
  const liveSimulationRefreshKey = requestedMode === "live" && liveState
    ? [
        liveState.sourceUpdatedAt ?? "",
        liveState.completedOfficialMatches,
        liveState.confirmedOfficialMatches,
        liveState.ledgerRows,
      ].join(":")
    : "";

  useEffect(() => {
    const nextState = resolveHighlightSelectionState(selectionRef.current, highlightedTeamKey);
    selectionRef.current = nextState;
    setSelection(nextState.selection);
    setInspectorOpen(nextState.inspectorOpen);
  }, [highlightedTeamKey]);

  useEffect(() => {
    selectionRef.current = { selection, inspectorOpen };
  }, [selection, inspectorOpen]);

  useEffect(() => {
    setSeedDraft(seed ? String(seed) : "");
  }, [regionSlug, seed, dataMode]);

  useEffect(() => {
    if (sessionSeed !== null) {
      return;
    }
    setSessionSeed(getOrCreateSessionSeed());
  }, [sessionSeed]);

  useEffect(() => {
    getOverview()
      .then((payload) => {
        setOverview(payload);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    let canceled = false;
    const loadLiveState = () => {
      getLiveState(regionSlug)
        .then((payload) => {
          if (!canceled) {
            setLiveState(payload);
          }
        })
        .catch((err: Error) => {
          if (!canceled) {
            setLiveState(unavailableLiveState(regionSlug, err.message));
          }
        });
    };

    setLiveState(null);
    loadLiveState();
    const timer = window.setInterval(loadLiveState, 30_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [regionSlug]);

  useEffect(() => {
    if (dataMode === "sim" && seed === null) {
      return;
    }
    const requestSeed = dataMode === "sim" ? seed! : (seed ?? DEFAULT_SEED);
    setError(null);
    setSimulation(null);
    getSimulation(regionSlug, requestSeed, dataMode)
      .then(setSimulation)
      .catch((err: Error) => setError(err.message));
  }, [regionSlug, seed, dataMode, liveSimulationRefreshKey]);

  const updateQuery = useCallback(
    (next: Partial<Record<"view" | "seed" | "highlight" | "mode", string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (requestedMode !== "sim" || parsedSeed || sessionSeed === null) {
      return;
    }
    updateQuery({ seed: String(sessionSeed) });
  }, [parsedSeed, requestedMode, sessionSeed, updateQuery]);

  const allTeams = useMemo(() => overview?.regions.flatMap((region) => region.teams) ?? [], [overview]);
  const searchResults = useMemo(
    () => sortTeamsForWorkspaceSearch(allTeams, deferredSearchText, regionSlug).slice(0, 18),
    [allTeams, deferredSearchText, regionSlug]
  );
  const selectedTeamKey = selection?.kind === "team" ? selection.teamKey : null;
  const selectedMatchLabel = selection?.kind === "match" ? selection.matchLabel : null;
  const selectedOverviewTeam = useMemo(
    () => resolveWorkspaceInspectorTeam({
      selectedTeamKey,
      allTeams,
      slots: simulation?.slots ?? [],
      matches: simulation?.matches ?? [],
      regionSlug,
      regionName: REGION_LABELS[regionSlug],
    }),
    [allTeams, regionSlug, selectedTeamKey, simulation]
  );
  const selectedRanking = useMemo(
    () => (simulation && selectedTeamKey ? simulation.finalRankings.find((row) => row.teamKey === selectedTeamKey) ?? null : null),
    [simulation, selectedTeamKey]
  );
  const selectedPath = useMemo(
    () => (simulation && selectedTeamKey ? filterTeamDrawerMatches(teamPath(simulation, selectedTeamKey), dataMode) : []),
    [dataMode, simulation, selectedTeamKey]
  );
  const selectedMatch = useMemo(
    () => (simulation && selectedMatchLabel ? simulation.matches.find((row) => row.matchLabel === selectedMatchLabel) ?? null : null),
    [simulation, selectedMatchLabel]
  );
  const stage = useMemo(
    () => (simulation ? buildWorkspaceStage(view, regionSlug, simulation) : null),
    [simulation, view, regionSlug]
  );
  const useFixedSouthSwissList = false; // user requested to revert back to canvas for south swiss stages
  const predictionRecap = useMemo(
    () => (simulation ? buildPredictionRecap(simulation) : null),
    [simulation]
  );
  const matchPhaseOverview = useMemo(() => {
    const rows = simulation?.matches ?? [];
    const counters: Record<MatchPhase, number> = {
      pre: 0,
      post: 0,
    };
    const accuracy = { correct: 0, mismatch: 0, upset: 0 };

    rows.forEach((match) => {
      counters[deriveMatchPhase(match)] += 1;
      
      if (match.isRealResult) {
        const expectedRed = match.pSeriesRed ?? match.pGameRed ?? 0.5;
        const predictedScore = predictScoreline(match.pGameRed ?? expectedRed, expectedRed, match.bestOf || 3);
        const [redGamesText, blueGamesText] = (match.scoreline || "0:0").split(":");
        const redGames = Number(redGamesText);
        const blueGames = Number(blueGamesText);
        const predWinnerSame = (predictedScore.scoreline[0] > predictedScore.scoreline[2]) === (redGames > blueGames);
        const predScoreSame = predictedScore.scoreline === match.scoreline;
        
        if (!predWinnerSame) {
          accuracy.upset += 1;
        } else if (!predScoreSame) {
          accuracy.mismatch += 1;
        } else {
          accuracy.correct += 1;
        }
      }
    });

    return { counters, accuracy };
  }, [simulation]);

  const openTeam = (teamKey: string) => {
    const nextSelection: InspectorSelection = { kind: "team", teamKey };
    selectionRef.current = { selection: nextSelection, inspectorOpen: true };
    setSelection(nextSelection);
    setInspectorOpen(true);
    updateQuery({ highlight: teamKey });
  };

  const openMatch = (match: MatchRow) => {
    const nextSelection: InspectorSelection = { kind: "match", matchLabel: match.matchLabel };
    selectionRef.current = { selection: nextSelection, inspectorOpen: true };
    setSelection(nextSelection);
    setInspectorOpen(true);
    if (highlightedTeamKey) {
      updateQuery({ highlight: null });
    }
  };

  const closeInspector = () => {
    if (highlightedTeamKey) {
      updateQuery({ highlight: null });
    }
    selectionRef.current = { selection: null, inspectorOpen: false };
    setInspectorOpen(false);
    setSelection(null);
  };

  const chooseSearchTeam = (team: OverviewTeam) => {
    setSearchOpen(false);
    setSearchText("");
    setInspectorOpen(true);
    router.push(buildRegionHref(team.regionSlug, view, {
      seed: requestedMode === "sim" ? resolveSeed() : null,
      highlight: team.teamKey,
      mode: requestedMode,
    }));
    const nextSelection: InspectorSelection = { kind: "team", teamKey: team.teamKey };
    selectionRef.current = { selection: nextSelection, inspectorOpen: true };
    setSelection(nextSelection);
  };

  const applySeedDraft = () => {
    const normalized = sanitizeSeedInput(seedDraft);
    const nextSeed = String(parseSeed(normalized) ?? resolveSeed());
    setSeedDraft(nextSeed);
    updateQuery({ seed: nextSeed, highlight: selection?.kind === "team" ? selection.teamKey : highlightedTeamKey });
  };

  const refreshSimulationSeed = () => {
    const nextSeed = refreshSessionSeed();
    setSessionSeed(nextSeed);
    setSeedDraft(String(nextSeed));
    updateQuery({ seed: String(nextSeed), highlight: selection?.kind === "team" ? selection.teamKey : highlightedTeamKey });
  };

  const onRegionChange = (nextRegion: RegionSlug) => {
    selectionRef.current = { selection: null, inspectorOpen: false };
    setInspectorOpen(false);
    setSelection(null);
    router.push(buildRegionHref(nextRegion, view, { seed: requestedMode === "sim" ? resolveSeed() : null, mode: requestedMode }));
  };

  const inspectorVisible = inspectorOpen || Boolean(selection);
  const inspectorToggle = (
    <div className={cn(
      "hidden md:block top-28 transition-all duration-300",
      stageFullscreen ? "fixed z-[180]" : "absolute z-40",
      inspectorOpen
        ? "opacity-0 pointer-events-none md:opacity-100 md:pointer-events-auto right-4 md:right-[336px]"
        : "right-4"
    )}>
      <button 
        onClick={() => setInspectorOpen(!inspectorOpen)}
        className="flex flex-col gap-1 w-8 h-10 items-center justify-center bg-rm-metal-panel border border-rm-metal-border hover:border-rm-blue text-rm-metal-text clip-chamfer group transition-all"
        title={inspectorOpen ? "收起情报面板" : "打开情报面板"}
      >
        <div className="w-1 h-1 bg-current group-hover:bg-rm-blue"></div>
        <div className="w-1 h-1 bg-current group-hover:bg-rm-blue"></div>
        <div className="w-1 h-1 bg-current group-hover:bg-rm-blue"></div>
      </button>
    </div>
  );
  const inspectorPanel = (
    <div className={cn(
      "w-full overflow-hidden transition-transform duration-300 ease-in-out absolute inset-x-0 bottom-0",
      stageFullscreen
        ? "z-[170] md:fixed md:inset-y-0 md:right-0 md:left-auto md:w-80"
        : "z-30 md:relative md:inset-auto md:w-0 md:shrink-0",
      !stageFullscreen && inspectorOpen ? "md:w-80" : null,
      "h-[58%] md:h-full",
      inspectorOpen ? "pointer-events-auto" : "pointer-events-none",
      inspectorOpen
        ? "translate-y-0 md:translate-x-0"
        : "translate-y-full md:translate-y-0 md:translate-x-full"
    )}>
      <InspectorPanel
        selection={selection}
        regionOverview={regionOverview}
        selectedOverviewTeam={selectedOverviewTeam}
        selectedRanking={selectedRanking}
        selectedPath={selectedPath}
        selectedMatch={selectedMatch}
        onMatchOpen={openMatch}
        onTeamOpen={openTeam}
        onClose={closeInspector}
      />
    </div>
  );

  const renderHomeButton = () => (
    <Link
      href="/"
      className="flex h-7 w-7 shrink-0 items-center justify-center border border-rm-blue/40 bg-rm-blue/15 text-rm-blue clip-chamfer transition-colors hover:bg-rm-blue hover:text-white"
      title="返回全景战略板"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </Link>
  );

  const renderRegionSelector = () => (
    <select
      value={regionSlug}
      onChange={(e) => {
        const nextRegion = e.target.value;
        if (validRegion(nextRegion)) {
          onRegionChange(nextRegion);
        }
      }}
      className="shrink-0 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs text-white focus:border-rm-blue focus:outline-none"
    >
      {overview?.regions.map((region) => (
        <option key={region.regionSlug} value={region.regionSlug}>{region.regionName}</option>
      ))}
    </select>
  );

  const renderModeToggle = () => (
    <div className="flex shrink-0 overflow-hidden border border-white/10 bg-rm-metal-dark/80">
      <button
        onClick={() => updateQuery({ mode: "live", seed: null })}
        title={realtimeAvailability.hint}
        className={cn(
          "px-2.5 py-1.5 text-xs font-bold uppercase transition-colors",
          requestedMode === "live"
            ? dataMode === "live"
              ? "bg-rm-status-warn text-black"
              : "bg-rm-status-warn/15 text-rm-status-warn"
            : "text-rm-metal-text hover:text-white"
        )}
      >
        {realtimeEnabled ? "实时" : "实时未接入"}
      </button>
      <button
        onClick={() => updateQuery({ mode: "sim", seed: String(resolveSeed()) })}
        className={cn(
          "px-2.5 py-1.5 text-xs font-bold uppercase transition-colors",
          requestedMode === "sim" ? "bg-rm-blue text-white" : "text-rm-metal-text hover:text-white"
        )}
      >
        模拟
      </button>
    </div>
  );

  const renderSeedControl = () => dataMode === "sim" ? (
    <div className="flex shrink-0 items-center overflow-hidden border border-white/10 bg-rm-metal-dark/80">
      <span className="px-2 font-mono text-[10px] text-rm-metal-text">种子</span>
      <input
        type="text"
        value={seedDraft}
        onChange={(e) => setSeedDraft(sanitizeSeedInput(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter") applySeedDraft(); }}
        className="w-16 bg-transparent px-1.5 py-1.5 font-mono text-xs text-white focus:outline-none md:w-20"
      />
      <button
        onClick={refreshSimulationSeed}
        className="border-l border-white/10 bg-rm-blue/20 px-2 py-1.5 text-[10px] font-bold text-rm-blue transition-colors hover:bg-rm-blue hover:text-white"
      >
        刷新
      </button>
    </div>
  ) : null;

  const renderSearchButton = () => (
    <button
      onClick={() => setSearchOpen(true)}
      className="shrink-0 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs uppercase text-rm-metal-text transition-colors hover:bg-rm-metal-panel"
    >
      搜索
    </button>
  );

  const renderLegendButton = () => (
    <button
      type="button"
      onClick={() => setLegendOpen((c) => !c)}
      className={cn(
        "shrink-0 border px-2 py-1.5 text-xs uppercase transition-colors",
        legendOpen ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text"
      )}
    >
      图例
    </button>
  );

  const renderInspectorButton = () => (
    <button
      type="button"
      onClick={() => setInspectorOpen((c) => !c)}
      className={cn(
        "shrink-0 border px-2 py-1.5 text-xs uppercase transition-colors",
        inspectorVisible ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text"
      )}
    >
      情报
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col min-h-0 bg-[#0a0a0f] bg-red-blue-split">
      {/* Floating glass header — scutbot-inspired compact bar */}
      <header className="glass-sheet z-30 px-3 py-2 md:px-4 md:py-2.5 flex flex-col gap-2 select-none">
        {/* Desktop row: preserve the original one-line tool layout. */}
        <div className="hidden items-center gap-2 md:flex md:flex-wrap">
          {renderHomeButton()}
          {renderRegionSelector()}
          {renderModeToggle()}
          {renderSeedControl()}
          <div className="flex-1 hidden md:block" />
          {renderSearchButton()}
          {renderLegendButton()}
          {renderInspectorButton()}
          {dataMode === "sim" && seed !== null ? (
            <span className="hidden md:inline text-[10px] text-rm-metal-text font-mono shrink-0">
              种子 {seed}
            </span>
          ) : null}
        </div>

        {/* Mobile row 1: navigation, region, mode. */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 md:hidden no-scrollbar">
          {renderHomeButton()}
          {renderRegionSelector()}
          {renderModeToggle()}
        </div>

        {/* Mobile row 2: seed and tools. */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 md:hidden no-scrollbar">
          {renderSeedControl()}
          {renderSearchButton()}
          {renderLegendButton()}
          {renderInspectorButton()}
        </div>

        {/* Row 3 on mobile / row 2 on desktop: view tabs — horizontal scroll */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {REGION_VIEWS.map((item) => (
            <button
              key={item.id}
              onClick={() => updateQuery({ view: item.id })}
              className={cn(
                "px-3 py-1 flex-none text-[11px] font-bold uppercase tracking-widest transition-all clip-chamfer",
                item.id === view
                  ? "bg-rm-blue text-white shadow-[0_0_10px_rgba(42,159,255,0.4)]"
                  : "text-rm-metal-text border border-transparent hover:border-white/15"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {requestedLiveFallback ? (
        <div className="z-30 border-b border-rm-status-warn/35 bg-rm-status-warn/10 px-3 py-2 font-mono text-[11px] text-rm-status-warn md:px-4">
          已请求实时赛程；官方赛程尚未接入，当前显示模拟沙盘。点击“模拟”会切换为模拟模式。
        </div>
      ) : null}

      {legendOpen ? (
        <div className="absolute top-0 left-0 right-0 z-40 glass-sheet px-3 py-3 md:left-auto md:right-4 md:top-20 md:w-72 md:border md:border-rm-metal-border">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">图例与统计</div>
            <button
              type="button"
              onClick={() => setLegendOpen(false)}
              className="text-[10px] font-mono uppercase text-rm-metal-text hover:text-white"
            >
              收起
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-[10px] font-bold border border-rm-status-safe bg-rm-status-safe/10 text-rm-status-safe px-1.5 py-0.5 shadow-[0_0_5px_rgba(0,255,157,0.3)]">精准预测</span>
            <span className="text-[10px] font-bold border border-[#a855f7] bg-[#a855f7]/10 text-[#a855f7] px-1.5 py-0.5 shadow-[0_0_5px_rgba(168,85,247,0.3)]">比分偏离</span>
            <span className="text-[10px] font-bold border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] px-1.5 py-0.5 shadow-[0_0_5px_rgba(239,68,68,0.3)]">路线爆冷</span>
            <span className="text-[10px] font-bold border border-[#facc15] bg-[#facc15]/10 text-[#facc15] px-1.5 py-0.5 shadow-[0_0_5px_rgba(250,204,21,0.3)]">确认未赛</span>
            <span className="text-[10px] font-bold border border-rm-blue bg-rm-blue/10 text-rm-blue px-1.5 py-0.5 shadow-[0_0_5px_rgba(0,163,255,0.3)]">模拟预测</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <span className="border border-rm-blue/35 bg-rm-blue/10 text-rm-blue px-2 py-1">待验证 {matchPhaseOverview.counters.pre}</span>
            <span className="border border-rm-status-safe/35 bg-rm-status-safe/10 text-rm-status-safe px-2 py-1">已完赛 {matchPhaseOverview.counters.post}</span>
            <span className="col-span-2 border border-white/15 bg-white/5 text-white px-2 py-1">胜负命中率 {predictionRecap ? percent(predictionRecap.winnerHitRate) : "0.0%"}</span>
            <span className="border border-rm-status-safe/35 bg-rm-status-safe/10 text-rm-status-safe px-2 py-1">精准 {matchPhaseOverview.accuracy.correct}</span>
            <span className="border border-[#a855f7]/35 bg-[#a855f7]/10 text-[#a855f7] px-2 py-1">偏离 {matchPhaseOverview.accuracy.mismatch}</span>
            <span className="col-span-2 border border-[#ef4444]/35 bg-[#ef4444]/10 text-[#ef4444] px-2 py-1">爆冷 {matchPhaseOverview.accuracy.upset}</span>
          </div>
        </div>
      ) : null}

      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 min-w-0 relative bg-transparent">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
              <div className="bg-rm-red/20 border border-rm-red text-rm-red p-6 font-mono text-sm shadow-[0_0_20px_rgba(230,0,0,0.5)]">
                 <h2 className="text-xl font-machine mb-2">系统错误</h2>
                 {error}
              </div>
            </div>
          ) : null}
          
          {!stage && !error && !useFixedSouthSwissList ? (
            <div className="absolute inset-0 flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-4">
                 <div className="w-10 h-10 border-4 border-rm-blue border-r-transparent rounded-full animate-spin"/>
                 <div className="text-rm-blue font-machine tracking-widest text-sm animate-pulse">正在生成预测图谱...</div>
              </div>
            </div>
          ) : null}

          {useFixedSouthSwissList ? (
            <div className="absolute inset-0">
              <SouthSwissReplayList view={view} simulation={simulation} />
            </div>
          ) : null}

          {stage && !useFixedSouthSwissList ? (
            <div className="absolute inset-0">
              <WorkspaceStageView
                stage={stage}
                mode={dataMode}
                selectedTeamKey={selectedTeamKey}
                highlightedTeamKey={highlightedTeamKey}
                selectedMatchLabel={selectedMatchLabel}
                onTeamSelect={openTeam}
                onMatchSelect={(matchLabel) => {
                  const match = simulation?.matches.find((row) => row.matchLabel === matchLabel);
                  if (match) openMatch(match);
                }}
                onFullscreenChange={setStageFullscreen}
                reserveRightRail={inspectorOpen}
              />
            </div>
          ) : null}
        </div>
        
        {!stageFullscreen ? inspectorToggle : null}
        {!stageFullscreen ? inspectorPanel : null}
      </div>
      {stageFullscreen && typeof document !== "undefined" ? createPortal(
        <>
          {inspectorToggle}
          {inspectorPanel}
        </>,
        document.body
      ) : null}
      
      <SearchModal open={searchOpen} title="搜索队伍档案 · 当前赛区优先" onClose={() => setSearchOpen(false)}>
        <div className="flex flex-col gap-4">
          <input
            name="team-search"
            type="text"
            autoComplete="off"
            placeholder="输入高校名称或拼音..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="bg-rm-metal-dark border-2 border-rm-metal-border focus:border-rm-blue px-4 py-3 text-white font-mono text-sm focus:outline-none transition-colors"
          />
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-2 no-scrollbar">
            {searchResults.map((team: any) => (
              <div
                key={team.teamKey}
                className="group flex items-stretch bg-rm-metal-panel border border-rm-metal-border hover:border-rm-blue hover:bg-rm-blue/10 text-left transition-all"
              >
                <button onClick={() => chooseSearchTeam(team)} className="flex-1 p-3 text-left">
                  <div className="flex items-center justify-between w-full mb-1">
                     <strong className="text-white font-bold group-hover:text-rm-blue transition-colors text-sm">{team.collegeName}</strong>
                     <span className="text-[10px] text-rm-metal-text font-mono border border-rm-metal-border px-1.5">{team.regionName}</span>
                  </div>
                  <div className="flex items-center justify-between w-full mt-1">
                     <span className="text-xs text-rm-metal-text font-mono">{team.teamName}</span>
                     <span className="text-[10px] text-rm-status-safe font-bold font-mono">国赛率 {percent(team.probabilities.national)}</span>
                  </div>
                </button>
                <Link
                  href={buildTeamHref(team.teamKey)}
                  className="flex items-center border-l border-rm-metal-border px-3 font-mono text-[10px] text-rm-blue hover:text-white"
                >
                  档案
                </Link>
              </div>
            ))}
            {searchResults.length === 0 ? <div className="text-rm-metal-text/50 font-mono text-xs italic p-4 text-center">未找到与“{searchText}”匹配的队伍</div> : null}
          </div>
        </div>
      </SearchModal>
    </div>
  );
}
