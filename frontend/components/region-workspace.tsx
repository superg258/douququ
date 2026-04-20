"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import PinyinMatch from "pinyin-match";

import { WorkspaceStageView } from "@/components/workspace-stage";
import { getOverview, getSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { formatRankingResultLabel, translateConfidenceLabel, translateDestinationLabel, translateStageLabel } from "@/lib/display";
import { buildRegionHref, getOrCreateSessionSeed, isRegionRealtimeEnabled, parseSeed, refreshSessionSeed, REGION_LABELS, REGION_VIEWS } from "@/lib/region-config";
import { predictScoreline } from "@/components/canvas-card";
import type {
  InspectorSelection,
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

function hasMatchElo(match: MatchRow) {
  return (
    typeof match.redMu0 === "number" &&
    typeof match.blueMu0 === "number" &&
    typeof match.redDelta === "number" &&
    typeof match.blueDelta === "number"
  );
}

function validRegion(regionSlug: string): regionSlug is RegionSlug {
  return regionSlug === "east_region" || regionSlug === "south_region" || regionSlug === "north_region";
}

function validView(view: string | null): view is WorkspaceView {
  return REGION_VIEWS.some((item) => item.id === view);
}

function sanitizeSeedInput(seedText: string) {
  return seedText.replace(/\D/g, "").slice(0, 12);
}

function sortTeamsByQuery(teams: OverviewTeam[], query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return teams;
  }
  return teams.filter((team) => {
    return (
      team.collegeName.includes(normalized) ||
      team.teamName.includes(normalized) ||
      PinyinMatch.match(team.collegeName, normalized) ||
      PinyinMatch.match(team.teamName, normalized)
    );
  });
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

function phaseLabel(phase: MatchPhase) {
  return phase === "post" ? "赛后评价" : "赛前预测";
}

function phaseClass(phase: MatchPhase) {
  return phase === "post"
    ? "text-rm-status-safe border-rm-status-safe/35 bg-rm-status-safe/12"
    : "text-rm-blue border-rm-blue/35 bg-rm-blue/12";
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
          <h3 className="text-sm font-bold tracking-widest text-rm-status-safe">南部赛区 {groupName} 组实时赛程列表</h3>
          <span className="text-[10px] font-mono border border-rm-status-safe/45 bg-rm-status-safe/10 px-2 py-0.5 text-rm-status-safe">
            未完赛在前，已完赛在后
          </span>
        </div>
        <p className="mt-2 text-xs text-rm-metal-text">
          已明确对局但未正式开赛/未出结果的场次优先展示；已完赛场次放在列表后半区并给出赛后分析。
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
          <span className="border border-rm-blue/35 bg-rm-blue/10 px-2 py-0.5 text-rm-blue">待开赛/待结果 {pendingRows.length}</span>
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
                ? `赛前主胜判断命中，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`
                : `赛前主胜判断未命中，出现逆转，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`
            )
            : `本场尚未产生正式赛果，当前仅展示预计走向，置信等级：${translateConfidenceLabel(row.confidenceLabel)}。`;

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
                  <span className="text-sm font-machine tracking-widest text-white">{row.matchLabel}</span>
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
                  <div className="flex items-center justify-center text-[9px] font-mono mb-2 px-1 uppercase tracking-widest">
                    {isCompleted ? <span className="text-rm-metal-text/60">系统预测记录</span> : <span className="text-rm-status-warn/80">实时预测信号</span>}
                  </div>
                  <div className="h-8 w-full relative bg-rm-metal-dark border border-rm-metal-border overflow-hidden clip-chamfer">
                    {/* Red Bar */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-rm-red/80 to-rm-red/90 transition-all duration-500 flex items-center justify-start pl-3 z-10"
                      style={{ 
                        width: `calc(${(expectedRed * 100).toFixed(1)}% + 6px)`, 
                        clipPath: "polygon(0 0, 100% 0, calc(100% - 12px) 100%, 0 100%)" 
                      }}
                    >
                      <span className="text-white font-machine text-xs tracking-wider drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">
                        {(expectedRed * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Glowing Separator */}
                    <div 
                      className="absolute top-0 bottom-0 w-[3px] bg-white z-20 transition-all duration-500"
                      style={{
                        left: `${(expectedRed * 100).toFixed(1)}%`,
                        marginLeft: '-1px',
                        transform: "skewX(-20.5deg)",
                        boxShadow: "0 0 12px 2px rgba(255,255,255,0.7)"
                      }}
                    />

                    {/* Blue Bar */}
                    <div 
                      className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-rm-blue/80 to-rm-blue/90 transition-all duration-500 flex items-center justify-end pr-3 z-10"
                      style={{ 
                        width: `calc(${(expectedBlue * 100).toFixed(1)}% + 6px)`, 
                        clipPath: "polygon(12px 0, 100% 0, 100% 100%, 0 100%)" 
                      }}
                    >
                      <span className="text-white font-machine text-xs tracking-wider drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">
                        {(expectedBlue * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  
                  <div className="mt-3 bg-rm-metal-dark/30 border-l-[3px] border-rm-blue px-3 py-2">
                    <div className="text-[10px] text-rm-metal-text font-mono flex items-start gap-2">
                      <span className={cn("font-bold mt-[1px]", isCompleted ? "text-rm-status-safe" : "text-rm-blue opacity-50")}>{'>'}</span>
                      <span className="leading-relaxed flex-1">
                        <span className={cn("font-bold mr-2", isCompleted ? "text-white" : "text-rm-metal-text")}>
                          {isCompleted ? "赛后结论 //" : "情报摘要 //"}
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
            [ CLOSE ]
          </button>
        </div>
        <div className="p-4 overflow-y-auto no-scrollbar">{children}</div>
      </div>
    </div>
  );
}

function InspectorPanel({ selection, regionOverview, selectedOverviewTeam, selectedRanking, selectedPath, selectedMatch, onMatchOpen, onTeamOpen, onClose }: any) {
  if (selection?.kind === "team" && selectedOverviewTeam && selectedRanking) {
    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-80 shadow-2xl p-4 overflow-y-auto overflow-x-hidden animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">队伍情报</p>
            
            <h3 className="text-lg font-machine text-white truncate w-56">{selectedOverviewTeam.collegeName}</h3>
            <p className="text-xs text-rm-blue font-mono">{selectedOverviewTeam.teamName}</p>
          </div>
          <button onClick={onClose} className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>
        
        <div className="space-y-6">
          <div className="bg-rm-metal-dark border border-rm-metal-border p-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <span className="text-rm-metal-text">Elo {selectedOverviewTeam.mu0.toFixed(1)}</span>
            <span className="text-rm-metal-text">全球 #{selectedOverviewTeam.eloGlobalRank}</span>
            <span className="col-span-2 text-rm-status-safe">国赛率 {percent(selectedOverviewTeam.probabilities.national)}</span>
            <span className="col-span-2 text-rm-status-warn">复活赛 {percent(selectedOverviewTeam.probabilities.repechage)}</span>
            <span className="col-span-2 text-rm-blue">夺冠率 {percent(selectedOverviewTeam.probabilities.champion)}</span>
          </div>

          <div>
            <h4 className="text-xs text-white font-bold uppercase tracking-widest mb-2 border-l-2 border-rm-blue pl-2">模拟晋级路径</h4>
            <p className="text-[11px] text-rm-metal-text mb-3">{formatRankingResultLabel(selectedRanking.rank, selectedRanking.finalBucket, selectedRanking.advancement)}</p>
            <div className="space-y-2">
              {selectedPath.map((match: any) => {
                const opponent = match.redTeam.teamKey === selectedOverviewTeam.teamKey ? match.blueTeam : match.redTeam;
                const isWin = match.winnerTeamKey === selectedOverviewTeam.teamKey;
                return (
                  <button key={match.matchLabel} onClick={() => onMatchOpen(match)} className="w-full flex items-center justify-between bg-rm-metal-dark border border-rm-metal-border p-2 hover:border-rm-blue transition-colors text-left group">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className={`flex-none w-5 h-5 flex items-center justify-center text-[10px] font-bold ${isWin ? 'bg-rm-status-safe text-black' : 'bg-rm-metal-text border border-rm-metal-text/30 text-white'}`}>{isWin ? "W" : "L"}</span>
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[11px] font-bold text-white truncate">{opponent.collegeName}</span>
                        <span className="text-[9px] text-rm-metal-text font-mono truncate">{match.scoreline} / {translateStageLabel(match.stage)}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-rm-metal-text font-mono opacity-0 group-hover:opacity-100 transition-opacity">V</span>
                  </button>
                );
              })}
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

    return (
      <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
        <div className="flex justify-between items-start border-b border-rm-metal-border pb-4 mb-4">
          <div>
            <p className="text-[10px] text-rm-metal-text font-bold uppercase tracking-widest leading-tight">赛事对战情报</p>
            <h3 className="text-lg font-machine text-white">{selectedMatch.matchLabel}</h3>
            <p className="text-xs text-rm-blue font-mono">{translateStageLabel(selectedMatch.stage)}</p>
          </div>
          <button onClick={onClose} className="text-rm-metal-text hover:text-rm-red font-mono text-[10px]">X</button>
        </div>

        <div className="space-y-6">
          <div className="text-center font-machine text-xl text-white tracking-widest bg-rm-metal-dark border border-rm-metal-border py-4 relative overflow-hidden">
             {selectedMatch.scoreline}
             <div className="absolute bottom-1 right-2 text-[9px] text-rm-metal-text font-sans">实际 BO{selectedMatch.bestOf}</div>
          </div>
          
          <div className={cn("text-center font-machine text-lg tracking-widest bg-rm-metal-dark border py-3 relative overflow-hidden",
            selectedMatch.isRealResult 
              ? (!actualWinnerSame ? "border-[#ef4444] text-[#ef4444]" : !actualScoreSame ? "border-[#a855f7] text-[#a855f7]" : "border-rm-status-safe text-rm-status-safe")
              : "border-rm-blue text-rm-blue"
          )}>
             {predictedScore.scoreline}
             <div className="absolute bottom-1 right-2 text-[8px] opacity-70 font-sans">AI 预测</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono p-3 bg-rm-metal-dark border border-rm-metal-border">
            <span className="text-rm-red opacity-80">红方预计胜率</span>
            <span className="text-rm-red font-bold text-right">{percent(selectedMatch.pSeriesRed)}</span>
            <span className="text-rm-blue opacity-80">蓝方预计胜率</span>
            <span className="text-rm-blue font-bold text-right">{percent(selectedMatch.pSeriesBlue)}</span>
            <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
            
            {/* Show ELO changes only for matches with an actual published result */}
            {hasMatchElo(selectedMatch) && (
              <>
                <span className="text-rm-red opacity-80 flex items-center justify-between col-span-2 mt-1">
                  <span className="text-rm-red font-bold">{selectedMatch.redTeam?.collegeName || "红方 ELO"}</span>
                  <span className="font-bold flex gap-2">
                    <span className="text-white">{selectedMatch.redMu0?.toFixed(1)}</span>
                    <span className={selectedMatch.redDelta > 0 ? "text-rm-status-safe" : selectedMatch.redDelta < 0 ? "text-rm-red" : "text-rm-metal-text"}>
                      {selectedMatch.redDelta > 0 ? "+" : ""}{selectedMatch.redDelta?.toFixed(1)}
                    </span>
                    <span className="text-rm-red">→ {((selectedMatch.redMu0 ?? 0) + (selectedMatch.redDelta ?? 0)).toFixed(1)}</span>
                  </span>
                </span>
                <span className="text-rm-blue opacity-80 flex items-center justify-between col-span-2 mt-1">
                  <span className="text-rm-blue font-bold">{selectedMatch.blueTeam?.collegeName || "蓝方 ELO"}</span>
                  <span className="font-bold flex gap-2">
                    <span className="text-white">{selectedMatch.blueMu0?.toFixed(1)}</span>
                    <span className={selectedMatch.blueDelta > 0 ? "text-rm-status-safe" : selectedMatch.blueDelta < 0 ? "text-rm-red" : "text-rm-metal-text"}>
                      {selectedMatch.blueDelta > 0 ? "+" : ""}{selectedMatch.blueDelta?.toFixed(1)}
                    </span>
                    <span className="text-rm-blue">→ {((selectedMatch.blueMu0 ?? 0) + (selectedMatch.blueDelta ?? 0)).toFixed(1)}</span>
                  </span>
                </span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}
            {!hasMatchElo(selectedMatch) && (
              <>
                <span className="col-span-2 text-rm-metal-text">
                  本场尚未产生实际赛果，不计算 Elo 变化，避免把模拟分支误当成真实总榜更新。
                </span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
              </>
            )}

                      <span className="text-rm-metal-text">历史战绩修正</span>
            <span className="text-white font-bold text-right">{selectedMatch.deltaH2H.toFixed(3)}</span>
            <span className="text-rm-metal-text">结果置信度</span>
            <span className="text-white font-bold text-right">{translateConfidenceLabel(selectedMatch.confidenceLabel)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-rm-metal-panel/95 border-l border-rm-metal-border w-80 shadow-2xl p-4 overflow-y-auto animate-in slide-in-from-right-8 clip-chamfer-tr-bl">
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
          <button key={team.teamKey} onClick={() => onTeamOpen(team.teamKey)} className="w-full flex items-center justify-between bg-rm-metal-dark border border-rm-metal-border px-3 py-2 hover:border-rm-blue transition-colors group">
            <span className="text-xs font-bold text-white truncate w-32 text-left">{team.collegeName}</span>
            <span className="text-[9px] font-mono text-rm-blue">{percent(team.probabilities.champion)}</span>
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
  const realtimeEnabled = isRegionRealtimeEnabled(regionSlug);
  const view = validView(searchParams.get("view")) ? (searchParams.get("view") as WorkspaceView) : defaultView;
  const requestedMode = (searchParams.get("mode") === "sim" || searchParams.get("mode") === "live")
    ? searchParams.get("mode") as "sim" | "live"
    : "sim";
  const mode = realtimeEnabled && requestedMode === "live" ? "live" : "sim";
  const highlightedTeamKey = searchParams.get("highlight");
  const parsedSeed = parseSeed(searchParams.get("seed"));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sessionSeed, setSessionSeed] = useState<number | null>(null);
  const seed = parsedSeed ?? sessionSeed;
  const [seedDraft, setSeedDraft] = useState(() => (seed ? String(seed) : ""));
  const [selection, setSelection] = useState<InspectorSelection | null>(
    highlightedTeamKey ? { kind: "team", teamKey: highlightedTeamKey } : null
  );
  const deferredSearchText = useDeferredValue(searchText);
  const resolveSeed = useCallback(() => seed ?? getOrCreateSessionSeed(), [seed]);

  useEffect(() => {
    setSelection(highlightedTeamKey ? { kind: "team", teamKey: highlightedTeamKey } : null);
    setInspectorOpen(Boolean(highlightedTeamKey));
  }, [highlightedTeamKey]);

  useEffect(() => {
    setSeedDraft(seed ? String(seed) : "");
  }, [regionSlug, seed, mode]);

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
    if (seed === null) {
      return;
    }
    setError(null);
    setSimulation(null);
    getSimulation(regionSlug, seed, mode)
      .then(setSimulation)
      .catch((err: Error) => setError(err.message));
  }, [regionSlug, seed, mode]);

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
    if (parsedSeed || sessionSeed === null) {
      return;
    }
    updateQuery({ seed: String(sessionSeed) });
  }, [parsedSeed, sessionSeed, updateQuery]);

  useEffect(() => {
    if (requestedMode !== "live" || realtimeEnabled) {
      return;
    }
    updateQuery({ mode: null });
  }, [realtimeEnabled, requestedMode, updateQuery]);

  const viewMeta = useMemo(
    () => REGION_VIEWS.find((item) => item.id === view) ?? REGION_VIEWS.find((item) => item.id === defaultView) ?? REGION_VIEWS[0],
    [defaultView, view]
  );
  const regionOverview = useMemo(
    () => overview?.regions.find((item) => item.regionSlug === regionSlug) ?? null,
    [overview, regionSlug]
  );
  const allTeams = useMemo(() => overview?.regions.flatMap((region) => region.teams) ?? [], [overview]);
  const searchResults = useMemo(
    () => sortTeamsByQuery(allTeams, deferredSearchText).slice(0, 18),
    [allTeams, deferredSearchText]
  );
  const selectedTeamKey = selection?.kind === "team" ? selection.teamKey : null;
  const selectedMatchLabel = selection?.kind === "match" ? selection.matchLabel : null;
  const selectedOverviewTeam = useMemo(
    () => (selectedTeamKey ? allTeams.find((team) => team.teamKey === selectedTeamKey) ?? null : null),
    [allTeams, selectedTeamKey]
  );
  const selectedRanking = useMemo(
    () => (simulation && selectedTeamKey ? simulation.finalRankings.find((row) => row.teamKey === selectedTeamKey) ?? null : null),
    [simulation, selectedTeamKey]
  );
  const selectedPath = useMemo(
    () => (simulation && selectedTeamKey ? teamPath(simulation, selectedTeamKey) : []),
    [simulation, selectedTeamKey]
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

    const sortedRows = rows
      .slice()
      .sort((left, right) => {
        if (left.stageOrder !== right.stageOrder) {
          return right.stageOrder - left.stageOrder;
        }
        return right.matchLabel.localeCompare(left.matchLabel);
      });

    const preMatches = sortedRows.filter((match) => deriveMatchPhase(match) === "pre").slice(0, 4);
    const postMatches = sortedRows.filter((match) => deriveMatchPhase(match) === "post").slice(0, 4);

    return { counters, accuracy, preMatches, postMatches };
  }, [simulation]);

  const openTeam = (teamKey: string) => {
    setSelection({ kind: "team", teamKey });
    setInspectorOpen(true);
    updateQuery({ highlight: teamKey });
  };

  const openMatch = (match: MatchRow) => {
    setSelection({ kind: "match", matchLabel: match.matchLabel });
    setInspectorOpen(true);
  };

  const closeInspector = () => {
    if (selection?.kind === "team") {
      updateQuery({ highlight: null });
    }
    setInspectorOpen(false);
    setSelection(null);
  };

  const chooseSearchTeam = (team: OverviewTeam) => {
    setSearchOpen(false);
    setSearchText("");
    setInspectorOpen(true);
    router.push(buildRegionHref(team.regionSlug, view, { seed: resolveSeed(), highlight: team.teamKey, mode }));
    setSelection({ kind: "team", teamKey: team.teamKey });
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
    setInspectorOpen(false);
    setSelection(null);
    router.push(buildRegionHref(nextRegion, view, { seed: resolveSeed(), mode }));
  };

  const inspectorVisible = inspectorOpen || Boolean(selection);
  const inspectorToggleLabel = selection?.kind === "team" ? "队伍情报" : selection?.kind === "match" ? "比赛情报" : "赛区情报";

  return (
    <div className="absolute inset-0 flex flex-col min-h-0 bg-[#0a0a0f] bg-red-blue-split">
      {/* Header Panel */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 py-4 bg-rm-metal-panel/80 border-b border-rm-metal-border backdrop-blur-sm z-30">
        <div className="flex flex-col">
          <div className="text-[10px] text-rm-metal-text font-mono tracking-widest uppercase mb-1 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-rm-status-safe animate-pulse"/>
            RMUC 2026 // {REGION_LABELS[regionSlug] ?? regionSlug}
          </div>
          <h1 className="text-2xl font-machine text-white tracking-widest uppercase text-glow-blue">{viewMeta.label}</h1>
        </div>
        
        <div className="flex items-center gap-4 mt-4 md:mt-0 font-mono text-xs">
           <div className="flex bg-rm-metal-dark border border-rm-metal-border overflow-hidden">
             <button 
               onClick={() => {
                 if (realtimeEnabled) {
                   updateQuery({ mode: "live" });
                 }
               }}
               disabled={!realtimeEnabled}
               className={cn(
                 "px-4 py-1.5 transition-colors font-bold uppercase",
                 !realtimeEnabled
                   ? "cursor-not-allowed text-rm-metal-text/40"
                   : mode === "live"
                     ? "bg-rm-status-warn text-black"
                     : "text-rm-metal-text hover:text-white"
               )}
             >
               {realtimeEnabled ? "实时预测" : "实时预测待接入"}
             </button>
             <button 
               onClick={() => updateQuery({ mode: "sim" })}
               className={cn("px-4 py-1.5 transition-colors font-bold uppercase", mode === "sim" ? "bg-rm-blue text-white" : "border-l border-rm-metal-border text-rm-metal-text hover:text-white")}
             >
               赛程模拟
             </button>
           </div>

           <select 
              value={regionSlug} 
              onChange={(e) => router.push(`/regions/${e.target.value}?${searchParams.toString()}`)} 
              className="bg-rm-metal-dark border border-rm-metal-border text-white px-3 py-1.5 focus:outline-none focus:border-rm-blue"
           >
              {overview?.regions.map((region) => (
                <option key={region.regionSlug} value={region.regionSlug}>{region.regionName}</option>
              ))}
           </select>
           
           {mode === "sim" && (
             <div className="flex items-center bg-rm-metal-dark border border-rm-metal-border overflow-hidden">
               <div className="bg-rm-metal-panel border-r border-rm-metal-border px-2 py-1.5 text-rm-metal-text">种子</div>
               <input
                 type="text"
                 value={seedDraft}
                 onChange={(e) => setSeedDraft(sanitizeSeedInput(e.target.value))}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") {
                     applySeedDraft();
                   }
                 }}
                 className="bg-transparent w-24 px-2 py-1.5 text-white focus:outline-none font-mono"
               />
               <button onClick={refreshSimulationSeed} className="bg-rm-blue/20 text-rm-blue hover:bg-rm-blue hover:text-white px-3 py-1.5 font-bold transition-colors border-l border-rm-metal-border">
                 刷新
               </button>
             </div>
           )}
           
           <button onClick={() => setSearchOpen(true)} className="border border-rm-metal-border bg-rm-metal-dark hover:bg-rm-metal-panel text-rm-metal-text px-3 py-1.5 transition-colors uppercase">
             SEARCH
           </button>
        </div>
      </header>
      
      {/* Subnav Panel */}
      <div className="flex items-center gap-1 overflow-x-auto px-6 py-2 bg-rm-metal-dark border-b border-rm-metal-border z-20">
         {REGION_VIEWS.map((item) => (
            <button
              key={item.id}
              onClick={() => updateQuery({ view: item.id })}
              className={`px-4 py-1 flex-none text-xs font-bold uppercase tracking-widest transition-all clip-chamfer ${item.id === view ? 'bg-rm-blue text-white shadow-[0_0_10px_rgba(0,163,255,0.4)]' : 'text-rm-metal-text border border-transparent hover:border-rm-metal-border'}`}
            >
              {item.label}
            </button>
         ))}
         
         <div className="ml-auto opacity-0 md:opacity-100 hidden md:flex items-center gap-4 text-[10px] text-rm-metal-text font-mono font-bold">
            <span>T-COUNT: {overview?.regions.find(r => r.regionSlug === regionSlug)?.teams.length ?? 0}</span>
            <span>当前种子: <span className="text-white">{seed}</span></span>
         </div>
      </div>

      {/* Prediction / Review Strip */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 bg-rm-metal-panel/60 border-b border-rm-metal-border z-20">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">图框图例</span>
          <span className="text-[10px] font-bold border border-rm-status-safe bg-rm-status-safe/10 text-rm-status-safe px-1.5 py-0.5 shadow-[0_0_5px_rgba(0,255,157,0.3)]">精准预测</span>
          <span className="text-[10px] font-bold border border-[#a855f7] bg-[#a855f7]/10 text-[#a855f7] px-1.5 py-0.5 shadow-[0_0_5px_rgba(168,85,247,0.3)]">比分偏离</span>
          <span className="text-[10px] font-bold border border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444] px-1.5 py-0.5 shadow-[0_0_5px_rgba(239,68,68,0.3)]">路线爆冷</span>
          <span className="text-[10px] font-bold border border-[#facc15] bg-[#facc15]/10 text-[#facc15] px-1.5 py-0.5 shadow-[0_0_5px_rgba(250,204,21,0.3)]">确认未赛</span>
          <span className="text-[10px] font-bold border border-rm-blue bg-rm-blue/10 text-rm-blue px-1.5 py-0.5 shadow-[0_0_5px_rgba(0,163,255,0.3)]">模拟预测</span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-rm-metal-text">预测与评价</span>
        <span className="text-[10px] font-mono border border-rm-blue/35 bg-rm-blue/10 text-rm-blue px-2 py-0.5">
          预测池 {matchPhaseOverview.counters.pre}
        </span>
        <div className="flex items-center text-[10px] font-mono border border-rm-status-safe/35 bg-rm-status-safe/10 text-rm-status-safe px-2 py-0.5 gap-2">
          <span>已完赛 {matchPhaseOverview.counters.post}</span>
          <span className="text-white/30">|</span>
          <span className="text-rm-status-safe">{matchPhaseOverview.accuracy.correct} <span className="opacity-70">精准</span></span>
          <span className="text-[#a855f7]">{matchPhaseOverview.accuracy.mismatch} <span className="opacity-70">偏离</span></span>
          <span className="text-[#ef4444]">{matchPhaseOverview.accuracy.upset} <span className="opacity-70">爆冷</span></span>
        </div>
      </div>

      {/* Prediction / Review Tape */}
      {matchPhaseOverview.preMatches.length || matchPhaseOverview.postMatches.length ? (
        <div className="flex items-stretch gap-2 overflow-x-auto px-6 py-2.5 bg-[#08080d]/90 border-b border-rm-metal-border z-10 no-scrollbar">
          {[...matchPhaseOverview.preMatches, ...matchPhaseOverview.postMatches].map((match) => {
            const phase = deriveMatchPhase(match);
            return (
              <button
                key={match.matchLabel}
                type="button"
                onClick={() => openMatch(match)}
                className="flex-none min-w-[220px] max-w-[260px] border border-rm-metal-border bg-rm-metal-dark/80 px-2.5 py-2 text-left hover:border-rm-blue transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-rm-metal-text font-mono truncate">{translateStageLabel(match.stage)}</span>
                  <span className={`text-[9px] font-mono border px-1.5 py-0.5 ${phaseClass(phase)}`}>
                    {phaseLabel(phase)}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-white font-bold truncate">{match.redTeam.collegeName}</div>
                <div className="text-[11px] text-white font-bold truncate">{match.blueTeam.collegeName}</div>
                <div className="mt-1 text-[10px] text-rm-blue font-mono">{match.matchLabel} / {match.scoreline || "--"}</div>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 relative bg-transparent">
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
                mode={mode}
                selectedTeamKey={selectedTeamKey}
                highlightedTeamKey={highlightedTeamKey}
                selectedMatchLabel={selectedMatchLabel}
                onTeamSelect={openTeam}
                onMatchSelect={(matchLabel) => {
                  const match = simulation?.matches.find((row) => row.matchLabel === matchLabel);
                  if (match) openMatch(match);
                }}
              />
            </div>
          ) : null}
        </div>
        
        {/* Toggle Inspector Button */}
        <div className={`absolute top-4 transition-all duration-300 z-40 ${inspectorOpen ? 'right-[336px]' : 'right-4'}`}>
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

        {/* Inspector Panel */}
        <div className={`flex-none w-80 transform transition-transform duration-300 ease-in-out z-30 ${inspectorOpen ? 'translate-x-0' : 'translate-x-full absolute right-0 top-0 bottom-0'}`}>
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
      </div>
      
      <SearchModal open={searchOpen} title="搜索队伍档案" onClose={() => setSearchOpen(false)}>
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
              <button 
                key={team.teamKey} 
                onClick={() => chooseSearchTeam(team)}
                className="group flex flex-col items-start p-3 bg-rm-metal-panel border border-rm-metal-border hover:border-rm-blue hover:bg-rm-blue/10 text-left transition-all"
              >
                <div className="flex items-center justify-between w-full mb-1">
                   <strong className="text-white font-bold group-hover:text-rm-blue transition-colors text-sm">{team.collegeName}</strong>
                   <span className="text-[10px] text-rm-metal-text font-mono border border-rm-metal-border px-1.5">{team.regionName}</span>
                </div>
                <div className="flex items-center justify-between w-full mt-1">
                   <span className="text-xs text-rm-metal-text font-mono">{team.teamName}</span>
                   <span className="text-[10px] text-rm-status-safe font-bold font-mono">国赛率 {percent(team.probabilities.national)}</span>
                </div>
              </button>
            ))}
            {searchResults.length === 0 ? <div className="text-rm-metal-text/50 font-mono text-xs italic p-4 text-center">未找到与“{searchText}”匹配的队伍</div> : null}
          </div>
        </div>
      </SearchModal>
    </div>
  );
}
