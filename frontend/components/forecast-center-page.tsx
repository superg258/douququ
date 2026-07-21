"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CompetitionSelector, isRegionCompetition } from "@/components/competition-selector";
import { PredictionExplanationCard } from "@/components/prediction-explanation-card";
import { PredictionSignalsPanel } from "@/components/prediction-signals";
import { WorkspaceStageView } from "@/components/workspace-stage";
import { formatMatchCardScheduleTime, predictScoreline } from "@/components/canvas-card";
import { ErrorPanel } from "@/components/ui/async-state";
import { getFinalEvent, getOverview } from "@/lib/api";
import { translateConfidenceLabel, translateStageLabel } from "@/lib/display";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { buildFinalsMatchRow } from "@/lib/finals-match-adapter";
import { simulateFinalsEvents } from "@/lib/finals-simulation";
import { buildRegionHref, getOrCreateSessionSeed, parseSeed, refreshSessionSeed } from "@/lib/region-config";
import {
  FINAL_STAGE_OPTIONS,
  formatFinalsDateRange,
  getRepechageSwissMatchHint,
  matchesForFinalStage,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
  type FinalsStageProbabilityProjection,
} from "@/lib/finals-schedule";
import { buildTeamHref } from "@/lib/team-profile";
import { isOfficialPlaceholderMatch } from "@/lib/workspace-selection";
import type {
  FinalEventMatch,
  FinalEventResponse,
  FinalEventSchedule,
  FinalEventSlug,
  FinalEventStageFilter,
  InspectorSelection,
  MatchRow,
  OverviewResponse,
  OverviewTeam,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ForecastMode = "live" | "sim";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function defaultStage(eventSlug: FinalEventSlug) {
  return FINAL_STAGE_OPTIONS[eventSlug][0].id;
}

function isFinalEventSlug(value: string | null): value is FinalEventSlug {
  return value === "repechage" || value === "nationals";
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

interface InspectorTeamInfo {
  teamKey: string;
  collegeName: string;
  teamName: string;
  elo: number | null;
  globalRank: number | null;
  probabilities: OverviewTeam["probabilities"] | null;
}

function InspectorPanel({
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
                        <span className="text-[9px] text-rm-metal-text font-mono truncate">{detailLabel} / {translateStageLabel(teamMatch.stage)}</span>
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
            比赛尚未开始
            <div className="absolute bottom-1 right-2 text-[9px] text-rm-metal-text/50 font-sans">BO{matchRow.bestOf}</div>
          </div>

          {!isOfficialPlaceholder ? (
            <div className="text-center font-machine text-lg tracking-widest bg-rm-metal-dark border py-3 relative overflow-hidden border-rm-blue text-rm-blue">
              {predictedScore.scoreline}
              <div className="absolute bottom-1 right-2 text-[8px] opacity-70 font-sans">AI 预测</div>
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
                <span className="col-span-2 text-rm-metal-text">
                  比赛结束后将自动更新战力变化。
                </span>
                <div className="col-span-2 border-t border-rm-metal-border my-1"></div>
                <span className="text-rm-metal-text">历史战绩修正</span>
                <span className="text-white font-bold text-right">{matchRow.deltaH2H.toFixed(3)}</span>
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
            <span className="shrink-0 pt-0.5 text-[9px] font-mono text-rm-blue">{percent(team.championRate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ForecastCenterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // URL 即状态源：响应浏览器前进/后退；旧链接 view=bracket / view=matches 一律并入实时模式
  const requestedEvent = searchParams.get("event");
  const eventSlug: FinalEventSlug = isFinalEventSlug(requestedEvent) ? requestedEvent : "repechage";
  const mode: ForecastMode = searchParams.get("mode") === "sim" ? "sim" : "live";
  const requestedStage = searchParams.get("stage") as FinalEventStageFilter | null;
  const stage: FinalEventStageFilter =
    requestedStage && FINAL_STAGE_OPTIONS[eventSlug].some((item) => item.id === requestedStage)
      ? requestedStage
      : defaultStage(eventSlug);
  const parsedSeed = parseSeed(searchParams.get("seed"));
  const [sessionSeed, setSessionSeed] = useState<number | null>(null);
  const seed = parsedSeed ?? sessionSeed;
  const [seedDraft, setSeedDraft] = useState("");
  const [events, setEvents] = useState<Record<FinalEventSlug, FinalEventResponse> | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewWarnDismissed, setOverviewWarnDismissed] = useState(false);
  const [eventsReloadKey, setEventsReloadKey] = useState(0);
  const [overviewReloadKey, setOverviewReloadKey] = useState(0);

  const updateDeepLink = useCallback(
    (nextEvent: FinalEventSlug, nextMode: ForecastMode, nextStage: FinalEventStageFilter, nextSeed: number | null) => {
      const params = new URLSearchParams({ event: nextEvent, mode: nextMode, stage: nextStage });
      if (nextMode === "sim" && nextSeed !== null) params.set("seed", String(nextSeed));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  // Suppress root layout header on mount — this page is a fullscreen canvas
  useEffect(() => {
    document.body.classList.add("canvas-fullscreen-page");
    return () => {
      document.body.classList.remove("canvas-fullscreen-page");
    };
  }, []);

  // 模拟模式缺种子时补一个会话种子（不写回 URL，与原行为一致）
  useEffect(() => {
    if (mode === "sim" && seed === null) {
      setSessionSeed(getOrCreateSessionSeed());
    }
  }, [mode, seed]);

  // 决赛双事件：任一失败即整页错误，可重试
  useEffect(() => {
    let canceled = false;
    Promise.all([getFinalEvent("repechage"), getFinalEvent("nationals")])
      .then(([repechage, nationals]) => {
        if (!canceled) {
          setEvents({ repechage, nationals });
          setEventsError(null);
        }
      })
      .catch((reason) => {
        if (!canceled) setEventsError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      canceled = true;
    };
  }, [eventsReloadKey]);

  // 概览数据：失败不阻塞页面，情报/概率降级为 "--"
  useEffect(() => {
    if (overview) return;
    let canceled = false;
    getOverview()
      .then((payload) => {
        if (!canceled) setOverview(payload);
      })
      .catch((reason) => {
        if (!canceled) {
          setOverviewError(reason instanceof Error ? reason.message : String(reason));
          setOverviewWarnDismissed(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [overview, overviewReloadKey]);

  const retryEvents = useCallback(() => {
    setEventsError(null);
    setEventsReloadKey((key) => key + 1);
  }, []);

  const retryOverview = useCallback(() => {
    setOverviewError(null);
    setOverviewWarnDismissed(false);
    setOverviewReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    setSeedDraft(seed === null ? "" : String(seed));
  }, [seed]);

  const current = events?.[eventSlug] ?? null;
  const simulation = useMemo(
    () => (mode === "sim" && events && overview && seed !== null
      ? simulateFinalsEvents(events.repechage.event, events.nationals.event, overview, seed)
      : null),
    [mode, events, overview, seed],
  );
  const currentSimulation = mode === "sim" ? simulation?.[eventSlug] ?? null : null;
  const workspace = useMemo(
    () => current ? buildFinalsWorkspaceStage(current.event, stage, currentSimulation ?? undefined) : null,
    [current, stage, currentSimulation],
  );

  const finalsProjection = useMemo<FinalsStageProbabilityProjection | null>(() => {
    if (!events || !overview) return null;
    return projectFinalsStageProbabilities(
      events.repechage.event.participants,
      events.nationals.event.participants,
      overview,
    );
  }, [events, overview]);

  const selectedTeamKey = selection?.kind === "team" ? selection.teamKey : null;
  const selectedMatchLabel = selection?.kind === "match" ? selection.matchLabel : null;
  const allTeams = useMemo(() => overview?.regions.flatMap((region) => region.teams) ?? [], [overview]);

  const selectedMatch = useMemo(() => {
    if (!current || !selectedMatchLabel) return null;
    return current.event.matches.find((match) => `${current.event.slug}:${match.number}` === selectedMatchLabel) ?? null;
  }, [current, selectedMatchLabel]);
  const selectedMatchSimulation = useMemo(
    () => (selectedMatch && currentSimulation ? currentSimulation.matchResults.get(selectedMatch.number) ?? null : null),
    [selectedMatch, currentSimulation],
  );
  const selectedMatchRow = useMemo(
    () => (current && selectedMatch ? buildFinalsMatchRow(current.event, selectedMatch, selectedMatchSimulation) : null),
    [current, selectedMatch, selectedMatchSimulation],
  );

  const selectedTeamInfo = useMemo<InspectorTeamInfo | null>(() => {
    if (!selectedTeamKey || !current) return null;
    const overviewTeam = allTeams.find((team) => team.teamKey === selectedTeamKey) ?? null;
    const participant = current.event.participants.find((item) => item.teamKey === selectedTeamKey) ?? null;
    let simulatedName: { collegeName: string; teamName: string } | null = null;
    if (currentSimulation) {
      for (const result of currentSimulation.matchResults.values()) {
        if (result.red?.teamKey === selectedTeamKey) { simulatedName = result.red; break; }
        if (result.blue?.teamKey === selectedTeamKey) { simulatedName = result.blue; break; }
      }
    }
    const collegeName = overviewTeam?.collegeName ?? participant?.collegeName ?? simulatedName?.collegeName ?? null;
    if (!collegeName) return null;
    return {
      teamKey: selectedTeamKey,
      collegeName,
      teamName: overviewTeam?.teamName ?? participant?.teamName ?? simulatedName?.teamName ?? "",
      elo: overviewTeam ? (overviewTeam.currentElo ?? overviewTeam.mu0 ?? null) : null,
      globalRank: overviewTeam?.eloGlobalRank ?? null,
      probabilities: overviewTeam?.probabilities ?? null,
    };
  }, [selectedTeamKey, current, allTeams, currentSimulation]);

  const selectedTeamPath = useMemo<MatchRow[]>(() => {
    if (!selectedTeamKey || !current || !currentSimulation) return [];
    return current.event.matches
      .filter((match) => {
        const result = currentSimulation.matchResults.get(match.number);
        return result?.red?.teamKey === selectedTeamKey || result?.blue?.teamKey === selectedTeamKey;
      })
      .sort((left, right) => left.number - right.number)
      .map((match) => buildFinalsMatchRow(current.event, match, currentSimulation.matchResults.get(match.number)));
  }, [selectedTeamKey, current, currentSimulation]);

  const selectedTeamOutcome = useMemo(() => {
    if (!selectedTeamKey || !currentSimulation) return null;
    for (const [destination, teams] of currentSimulation.terminalOutcomes) {
      if (teams.some((team) => team.teamKey === selectedTeamKey)) return destination;
    }
    return null;
  }, [selectedTeamKey, currentSimulation]);

  const topTeams = useMemo(() => {
    if (!current || !overview) return [];
    const teamIndex = new Map(allTeams.map((team) => [team.teamKey, team]));
    return rankFinalEventParticipantsByCurrentElo(current.event.participants, overview)
      .slice(0, 6)
      .map((participant) => ({
        teamKey: participant.teamKey,
        collegeName: participant.collegeName,
        championRate: teamIndex.get(participant.teamKey)?.probabilities.champion ?? 0,
      }));
  }, [current, overview, allTeams]);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelection(null);
  }, []);

  const openTeam = useCallback((teamKey: string) => {
    if (!teamKey || teamKey.startsWith("outcome:")) return;
    setSelection({ kind: "team", teamKey });
    setInspectorOpen(true);
  }, []);

  const openMatch = useCallback((matchLabel: string) => {
    if (!current) return;
    const exists = current.event.matches.some((match) => `${current.event.slug}:${match.number}` === matchLabel);
    if (!exists) return;
    setSelection({ kind: "match", matchLabel });
    setInspectorOpen(true);
  }, [current]);

  const chooseEvent = (nextEvent: FinalEventSlug) => {
    const nextStage = defaultStage(nextEvent);
    closeInspector();
    updateDeepLink(nextEvent, mode, nextStage, seed);
  };
  const chooseMode = (nextMode: ForecastMode) => {
    const nextSeed = nextMode === "sim" ? (seed ?? getOrCreateSessionSeed()) : seed;
    if (nextMode === "sim") setSessionSeed(nextSeed);
    closeInspector();
    updateDeepLink(eventSlug, nextMode, stage, nextMode === "sim" ? nextSeed : null);
  };
  const chooseStage = (nextStage: FinalEventStageFilter) => {
    closeInspector();
    updateDeepLink(eventSlug, mode, nextStage, seed);
  };
  const applySeedDraft = () => {
    const parsed = parseSeed(seedDraft);
    if (parsed === null) return;
    setSessionSeed(parsed);
    updateDeepLink(eventSlug, "sim", stage, parsed);
  };
  const refreshSeed = () => {
    const nextSeed = refreshSessionSeed();
    setSessionSeed(nextSeed);
    updateDeepLink(eventSlug, "sim", stage, nextSeed);
  };

  if (eventsError) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-rm-metal-canvas p-6">
        <ErrorPanel title="实时预测中心加载失败" message={eventsError} onRetry={retryEvents} />
      </div>
    );
  }
  if (!current || !workspace || (mode === "sim" && !currentSimulation && !overviewError)) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-rm-metal-canvas animate-pulse">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-rm-blue/30 border-t-rm-blue" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">{mode === "sim" ? "加载模拟沙盘..." : "加载正式赛程..."}</span>
      </div>
    );
  }

  const visibleMatches = matchesForFinalStage(current.event, stage);
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
        mode={mode}
        eventSlug={eventSlug}
        event={current.event}
        teamInfo={selectedTeamInfo}
        teamPath={selectedTeamPath}
        teamOutcome={selectedTeamOutcome}
        match={selectedMatch}
        matchRow={selectedMatchRow}
        topTeams={topTeams}
        projection={finalsProjection}
        onMatchOpen={(matchRow) => openMatch(matchRow.matchLabel)}
        onTeamOpen={openTeam}
        onClose={closeInspector}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-rm-metal-canvas bg-red-blue-split">
      <header className="glass-sheet z-30 flex select-none flex-col gap-2 px-3 py-2 md:px-4 md:py-2.5">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <Link href="/" className="flex h-7 w-7 shrink-0 items-center justify-center border border-rm-blue/40 bg-rm-blue/15 text-rm-blue clip-chamfer transition-colors hover:bg-rm-blue hover:text-white" title="返回全景战略板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </Link>
          <CompetitionSelector
            value={eventSlug}
            onChange={(nextCompetition) => {
              if (isRegionCompetition(nextCompetition)) {
                router.push(buildRegionHref(nextCompetition, "playoff"));
                return;
              }
              chooseEvent(nextCompetition);
            }}
          />
          <div className="flex shrink-0 overflow-hidden border border-white/10 bg-rm-metal-dark/80">
            <button
              type="button"
              onClick={() => chooseMode("live")}
              title="基于官方赛程的实时数据"
              className={cn(
                "px-2.5 py-1.5 text-xs font-bold uppercase transition-colors",
                mode === "live" ? "bg-rm-status-warn text-black" : "text-rm-metal-text hover:text-white",
              )}
            >
              实时
            </button>
            <button
              type="button"
              onClick={() => chooseMode("sim")}
              title="自定义种子模拟完整赛程推演"
              className={cn(
                "px-2.5 py-1.5 text-xs font-bold uppercase transition-colors",
                mode === "sim" ? "bg-rm-blue text-white" : "text-rm-metal-text hover:text-white",
              )}
            >
              模拟
            </button>
          </div>
          {mode === "sim" ? (
            <div className="flex shrink-0 items-center overflow-hidden border border-white/10 bg-rm-metal-dark/80">
              <span className="px-2 font-mono text-[10px] text-rm-metal-text">种子</span>
              <input
                type="text"
                value={seedDraft}
                onChange={(event) => setSeedDraft(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => { if (event.key === "Enter") applySeedDraft(); }}
                aria-label="随机种子"
                className="w-16 bg-transparent px-1.5 py-1.5 font-mono text-xs text-white focus:outline-none md:w-20"
              />
              <button
                type="button"
                onClick={refreshSeed}
                className="border-l border-white/10 bg-rm-blue/20 px-2 py-1.5 text-[10px] font-bold text-rm-blue transition-colors hover:bg-rm-blue hover:text-white"
              >
                刷新
              </button>
            </div>
          ) : null}
          <div className="hidden items-center gap-2 font-mono text-[10px] text-rm-metal-textMuted lg:flex">
            <span>{current.event.participantCount} 队</span><span className="text-white/20">/</span>
            <span>{current.event.formalMatchCount} 场</span><span className="text-white/20">/</span>
            <span className="text-rm-status-scheduled">{formatFinalsDateRange(current.event.competitionRange.start, current.event.competitionRange.end)}</span>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={() => setLegendOpen((open) => !open)} className={cn("shrink-0 border px-2.5 py-1.5 text-xs transition-colors", legendOpen ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text hover:text-white")}>图例</button>
          <button
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            className={cn(
              "shrink-0 border px-2.5 py-1.5 text-xs uppercase transition-colors",
              inspectorVisible ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text hover:text-white"
            )}
          >
            情报
          </button>
          <span className="hidden shrink-0 font-mono text-[10px] text-rm-metal-textFaint sm:inline">{current.event.statusLabel}</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {FINAL_STAGE_OPTIONS[eventSlug].map((item) => (
            <button key={item.id} type="button" onClick={() => chooseStage(item.id)} className={cn("flex-none px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-all clip-chamfer", stage === item.id ? "bg-rm-blue text-white shadow-[0_0_10px_rgba(42,159,255,0.4)]" : "border border-transparent text-rm-metal-text hover:border-white/15")}>{item.label}</button>
          ))}
          <span className="ml-auto hidden shrink-0 font-mono text-[9px] text-rm-metal-textFaint md:inline">
            当前 {visibleMatches.length} 场 · 数据更新 {current.verifiedAt.slice(0, 10)}
            {mode === "sim" && seed !== null ? ` · 种子 ${seed}` : ""}
          </span>
        </div>
      </header>

      {overviewError && !overviewWarnDismissed ? (
        <div className="z-30 flex items-center gap-2 border-b border-rm-status-warn/40 bg-rm-status-warn/10 px-3 py-1.5 font-mono text-[10px] text-rm-status-warn md:px-4">
          <span className="min-w-0 flex-1 truncate" title={overviewError}>
            概览数据加载失败（{overviewError}）：胜率情报已降级为 &quot;--&quot; 显示{mode === "sim" ? "，模拟推演暂不可用" : ""}。
          </span>
          <button
            type="button"
            onClick={retryOverview}
            className="shrink-0 border border-rm-status-warn/50 px-2 py-0.5 font-bold uppercase transition-colors hover:bg-rm-status-warn hover:text-black"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => setOverviewWarnDismissed(true)}
            aria-label="关闭概览数据警告"
            className="shrink-0 px-1 font-bold transition-colors hover:text-white"
          >
            X
          </button>
        </div>
      ) : null}

      {legendOpen ? (
        <div className="absolute left-0 right-0 top-[74px] z-40 glass-sheet border-y border-rm-metal-border px-3 py-3 md:left-auto md:right-4 md:top-20 md:w-72 md:border">
          <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">路线图例</span><button type="button" onClick={() => setLegendOpen(false)} className="font-mono text-[10px] text-rm-metal-text hover:text-white">收起</button></div>
          <div className="mt-3 space-y-2 font-mono text-[10px] text-rm-metal-textMuted">
            <span className="flex items-center gap-2"><span className="h-0.5 w-8 bg-rm-status-safe" />胜者晋级</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-8 bg-rm-result-winner" />席位与名次落位</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-8 bg-rm-metal-text/60" />负者转战或淘汰</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-8 bg-rm-blue" />瑞士轮按战绩配对</span>
          </div>
        </div>
      ) : null}

      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 min-w-0 relative bg-transparent">
          <div className="absolute inset-0">
            <WorkspaceStageView
              stage={workspace}
              mode={mode}
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={null}
              selectedMatchLabel={selectedMatchLabel}
              onTeamSelect={openTeam}
              onMatchSelect={openMatch}
              onFullscreenChange={setStageFullscreen}
              reserveRightRail={inspectorOpen}
            />
          </div>
        </div>

        {!stageFullscreen ? inspectorToggle : null}
        {!stageFullscreen && inspectorOpen ? inspectorPanel : null}
      </div>
      {stageFullscreen && typeof document !== "undefined" ? createPortal(
        <>
          {inspectorToggle}
          {inspectorOpen ? inspectorPanel : null}
        </>,
        document.body
      ) : null}
    </div>
  );
}
