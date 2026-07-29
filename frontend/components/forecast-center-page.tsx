"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CompetitionSelector, isRegionCompetition } from "@/components/competition-selector";
import { ForecastInspectorPanel, type InspectorTeamInfo } from "@/components/forecast-inspector-panel";
import { ShareScheduleButton } from "@/components/share-schedule-button";
import { WorkspaceStageView } from "@/components/workspace-stage";
import { WorkspaceSearchModal } from "@/components/workspace-search-modal";
import { ErrorPanel } from "@/components/ui/async-state";
import { ExportCanvasButton } from "@/components/export-canvas-button";
import { getFinalEvents, getLiveState, getOverview } from "@/lib/api";
import { buildFullSeasonTrajectories } from "@/lib/elo-trajectory";
import { percent } from "@/lib/display";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { buildFinalsMatchRow, resolveFinalsTeamRating } from "@/lib/finals-match-adapter";
import { buildFinalsTeamPath, resolveFinalsTeamOutcome } from "@/lib/finals-team";
import { hasOfficialFinalMatchData, simulateFinalsEvents, simulateFinalsLiveEvents } from "@/lib/finals-simulation";
import {
  buildForecastHref,
  forecastEventsResourceIdentity,
  shouldShowForecastLoadError,
  type ForecastMode,
} from "@/lib/forecast-routing";
import { mergeRegionLiveStates } from "@/lib/live-state-merge";
import { DEFAULT_SEED, REGION_LABELS, REGION_ORDER, buildRegionHref, getOrCreateSessionSeed, isRegionRealtimeEnabled, parseSeed, refreshSessionSeed } from "@/lib/region-config";
import { useRevisionPolling } from "@/lib/use-revision-polling";
import {
  FINAL_STAGE_OPTIONS,
  formatFinalsDateRange,
  getFinalsLiveUnavailableReason,
  hasOfficialFinalSchedule,
  matchesForFinalStage,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
  type FinalsStageProbabilityProjection,
} from "@/lib/finals-schedule";
import { buildTeamHref } from "@/lib/team-profile";
import { buildScheduleShareUrl } from "@/lib/share-link";
import { formatShortDateTimeLabel } from "@/lib/time-format";
import { sortTeamsForWorkspaceSearch } from "@/lib/workspace-search";
import { handleHorizontalTabKeyDown } from "@/lib/keyboard-navigation";
import type {
  FinalEventResponse,
  FinalEventSlug,
  FinalEventStageFilter,
  InspectorSelection,
  LiveStateResponse,
  MatchRow,
  OverviewResponse,
  OverviewTeam,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function defaultStage(eventSlug: FinalEventSlug) {
  return FINAL_STAGE_OPTIONS[eventSlug][0].id;
}

function isFinalEventSlug(value: string | null): value is FinalEventSlug {
  return value === "repechage" || value === "nationals";
}

export function ForecastCenterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // URL 即状态源：显式 mode 保持用户选择；未指定时先探测正式赛程，再写回首选画布。
  const requestedEvent = searchParams.get("event");
  const eventSlug: FinalEventSlug = isFinalEventSlug(requestedEvent) ? requestedEvent : "repechage";
  const requestedMode = searchParams.get("mode");
  const explicitMode: ForecastMode | null = requestedMode === "live" || requestedMode === "sim" ? requestedMode : null;
  const mode: ForecastMode = explicitMode ?? "live";
  const requestedStage = searchParams.get("stage") as FinalEventStageFilter | null;
  const stage: FinalEventStageFilter =
    requestedStage && FINAL_STAGE_OPTIONS[eventSlug].some((item) => item.id === requestedStage)
      ? requestedStage
      : defaultStage(eventSlug);
  const parsedSeed = parseSeed(searchParams.get("seed"));
  const sharedHighlight = searchParams.get("highlight");
  const [sessionSeed, setSessionSeed] = useState<number | null>(null);
  const seed = parsedSeed ?? sessionSeed;
  const [seedDraft, setSeedDraft] = useState("");
  const [events, setEvents] = useState<Partial<Record<FinalEventSlug, FinalEventResponse>>>({});
  const [eventsMode, setEventsMode] = useState<ForecastMode | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [selection, setSelection] = useState<InspectorSelection | null>(
    sharedHighlight ? { kind: "team", teamKey: sharedHighlight } : null,
  );
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(sharedHighlight));
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [eventErrors, setEventErrors] = useState<Partial<Record<FinalEventSlug, string>>>({});
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewWarnDismissed, setOverviewWarnDismissed] = useState(false);
  const [eventsReloadKey, setEventsReloadKey] = useState(0);
  const [eventsRevision, setEventsRevision] = useState<string | null>(null);
  const [overviewReloadKey, setOverviewReloadKey] = useState(0);
  const [regionLiveStates, setRegionLiveStates] = useState<LiveStateResponse[]>([]);
  const [regionalErrors, setRegionalErrors] = useState<string[]>([]);

  const updateDeepLink = useCallback(
    (nextEvent: FinalEventSlug, nextMode: ForecastMode, nextStage: FinalEventStageFilter, nextSeed: number | null) => {
      router.replace(buildForecastHref(pathname, {
        event: nextEvent,
        mode: nextMode,
        stage: nextStage,
        seed: nextSeed,
      }), { scroll: false });
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

  useEffect(() => {
    if (!sharedHighlight) return;
    setSelection({ kind: "team", teamKey: sharedHighlight });
    setInspectorOpen(true);
  }, [sharedHighlight]);

  // 模拟模式缺种子时补一个会话种子（不写回 URL，与原行为一致）
  useEffect(() => {
    if (mode === "sim" && seed === null) {
      setSessionSeed(getOrCreateSessionSeed());
    }
  }, [mode, seed]);

  const loadEvents = useCallback(async (signal: AbortSignal) => {
    try {
      const snapshot = await getFinalEvents(mode, signal);
      if (signal.aborted) return;
      setEvents(snapshot.events);
      setEventsMode(snapshot.mode);
      setEventsRevision(snapshot.dataRevision ?? snapshot.runtimeArtifactVersion);
      setEventErrors({});
    } catch (reason) {
      if (signal.aborted) throw reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      setEventErrors({ repechage: message, nationals: message });
      throw reason;
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "sim") return;
    const controller = new AbortController();
    void loadEvents(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [eventSlug, eventsReloadKey, loadEvents, mode]);

  useRevisionPolling({
    enabled: mode === "live",
    resourceIdentity: forecastEventsResourceIdentity(eventSlug, mode, eventsReloadKey),
    currentRevision: eventsRevision,
    selectRevision: (payload) => payload.finals.dataRevision,
    loadFull: loadEvents,
  });

  useEffect(() => {
    if (explicitMode || eventsMode !== "live") return;
    const liveEvent = events[eventSlug];
    if (!liveEvent) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", hasOfficialFinalSchedule(liveEvent) ? "live" : "sim");
    params.delete("seed");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [eventSlug, events, eventsMode, explicitMode, pathname, router, searchParams]);

  const loadRegionalContext = useCallback(async (signal: AbortSignal) => {
    const results = await Promise.allSettled([
      getOverview(signal),
      ...REGION_ORDER.map((slug) => getLiveState(slug, signal)),
    ]);
    if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const [overviewResult, ...liveStateResults] = results;
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
      setOverviewError(null);
    } else {
      const message = overviewResult.reason instanceof Error
        ? overviewResult.reason.message
        : String(overviewResult.reason);
      setOverviewError(message);
      setOverviewWarnDismissed(false);
    }
    const successfulLiveStates = liveStateResults
      .map((result) => result.status === "fulfilled" ? result.value : null)
      .filter((value): value is LiveStateResponse => value !== null);
    const failedRegions = liveStateResults
      .map((result, index) => result.status === "rejected" ? REGION_ORDER[index] : null)
      .filter((slug): slug is LiveStateResponse["regionSlug"] => slug !== null);
    if (successfulLiveStates.length > 0) {
      setRegionLiveStates((current) => mergeRegionLiveStates(current, successfulLiveStates));
    }
    setRegionalErrors(failedRegions.map((slug) => `${REGION_LABELS[slug]}实时数据`));
    const failures = [
      ...(overviewResult.status === "rejected" ? ["概览数据"] : []),
      ...failedRegions.map((slug) => `${REGION_LABELS[slug]}实时数据`),
    ];
    if (failures.length > 0) throw new Error(`${failures.join("、")}刷新失败`);
  }, []);

  const regionalRevision = regionLiveStates.length === REGION_ORDER.length
    ? REGION_ORDER.map(
      (slug) => regionLiveStates.find((state) => state.regionSlug === slug)?.dataRevision ?? "",
    ).join("|")
    : null;

  useEffect(() => {
    if (mode !== "sim") return;
    const controller = new AbortController();
    void loadRegionalContext(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [loadRegionalContext, mode, overviewReloadKey]);

  useRevisionPolling({
    enabled: mode === "live",
    resourceIdentity: `regional-context:${overviewReloadKey}`,
    currentRevision: regionalRevision,
    selectRevision: (payload) => REGION_ORDER.map(
      (slug) => payload.regions[slug].dataRevision,
    ).join("|"),
    loadFull: loadRegionalContext,
  });

  const retryEvents = useCallback(() => {
    setEventErrors({});
    setEventsReloadKey((key) => key + 1);
  }, []);

  const retryOverview = useCallback(() => {
    setOverviewError(null);
    setRegionalErrors([]);
    setOverviewWarnDismissed(false);
    setOverviewReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    setSeedDraft(seed === null ? "" : String(seed));
  }, [seed]);

  const current = events?.[eventSlug] ?? null;
  const officialLiveSchedule = current ? hasOfficialFinalSchedule(current) : false;
  const liveReferenceReason = mode === "live" && current && !officialLiveSchedule
    ? getFinalsLiveUnavailableReason(current) ?? "官方实时源未就绪，当前仅展示参考赛程。"
    : null;
  const simulation = useMemo(
    () => (mode === "sim" && events.repechage && events.nationals && overview && seed !== null
      ? simulateFinalsEvents(events.repechage.event, events.nationals.event, overview, seed)
      : null),
    [mode, events, overview, seed],
  );
  const liveFinalsProjection = useMemo(
    () => {
      if (mode !== "live" || !current || !overview || !events.repechage || !events.nationals) return null;
      if (!hasOfficialFinalSchedule(current)) return null;
      // 全国赛首轮尚未开赛时，只要复活赛已有真实赛果，仍需建立继承 Elo 的
      // 全国赛 field；后端会决定名单是否已完整，前端不自行补预测晋级者。
      if (!hasOfficialFinalMatchData(events.repechage.event) && !hasOfficialFinalMatchData(events.nationals.event)) return null;
      return simulateFinalsLiveEvents(
        events.repechage.event,
        events.nationals.event,
        overview,
        DEFAULT_SEED,
      )[eventSlug];
    },
    [mode, current, overview, events.repechage, events.nationals, eventSlug],
  );
  const currentSimulation = mode === "sim"
    ? simulation?.[eventSlug] ?? null
    : liveFinalsProjection;

  // 给当前赛事的轨迹注入区域赛逐场记录，构建完整赛季轨迹
  const enrichedTrajectories = useMemo<Record<string, number[]> | null>(() => {
    if (!overview || !currentSimulation) return null;
    const regionLedgers = regionLiveStates
      .filter((ls) => ls.available && ls.matchLedger.length > 0)
      .map((ls) => ls.matchLedger);
    if (regionLedgers.length === 0) return null;
    return buildFullSeasonTrajectories(
      overview,
      regionLedgers,
      currentSimulation.eloTrajectoryByTeamKey,
    );
  }, [overview, currentSimulation, regionLiveStates]);

  const workspace = useMemo(
    () => current ? buildFinalsWorkspaceStage(current.event, stage, currentSimulation ?? undefined) : null,
    [current, stage, currentSimulation],
  );

  const finalsProjection = useMemo<FinalsStageProbabilityProjection | null>(() => {
    if (!events.repechage || !events.nationals || !overview) return null;
    return projectFinalsStageProbabilities(
      events.repechage.event.participants,
      events.nationals.event.participants,
      overview,
    );
  }, [events, overview]);

  const selectedTeamKey = selection?.kind === "team" ? selection.teamKey : null;
  const selectedMatchLabel = selection?.kind === "match" ? selection.matchLabel : null;
  const allTeams = useMemo(() => overview?.regions.flatMap((region) => region.teams) ?? [], [overview]);
  const deferredSearchText = useDeferredValue(searchText);
  // 搜索范围限定在当前赛事参赛队伍内，与画布可见内容一致
  const eventTeams = useMemo(() => {
    if (!current) return [] as OverviewTeam[];
    const participantKeys = new Set(current.event.participants.map((participant) => participant.teamKey));
    return allTeams.filter((team) => participantKeys.has(team.teamKey));
  }, [current, allTeams]);
  const searchResults = useMemo(
    () => sortTeamsForWorkspaceSearch(eventTeams, deferredSearchText, null).slice(0, 18),
    [eventTeams, deferredSearchText],
  );

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [deferredSearchText, searchOpen]);

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
    const rating = resolveFinalsTeamRating(
      selectedTeamKey,
      allTeams,
      currentSimulation?.finalEloByTeamKey,
    );
    return {
      teamKey: selectedTeamKey,
      collegeName,
      teamName: overviewTeam?.teamName ?? participant?.teamName ?? simulatedName?.teamName ?? "",
      elo: rating.currentElo,
      seasonDelta: rating.seasonDelta,
      globalRank: rating.globalRank,
      probabilities: overviewTeam?.probabilities ?? null,
      eloTrajectory: enrichedTrajectories?.[selectedTeamKey]
        ?? currentSimulation?.eloTrajectoryByTeamKey?.[selectedTeamKey],
    };
  }, [selectedTeamKey, current, allTeams, currentSimulation, enrichedTrajectories]);

  const selectedTeamPath = useMemo<MatchRow[]>(() => {
    if (!selectedTeamKey || !current || !currentSimulation) return [];
    return buildFinalsTeamPath(current.event, currentSimulation, selectedTeamKey);
  }, [selectedTeamKey, current, currentSimulation]);

  const selectedTeamOutcome = useMemo(() => {
    if (!selectedTeamKey || !currentSimulation) return null;
    return resolveFinalsTeamOutcome(currentSimulation, selectedTeamKey);
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

  const chooseSearchTeam = (team: OverviewTeam) => {
    setSearchOpen(false);
    setSearchText("");
    openTeam(team.teamKey);
  };

  const chooseEvent = (nextEvent: FinalEventSlug) => {
    const nextStage = defaultStage(nextEvent);
    closeInspector();
    updateDeepLink(nextEvent, mode, nextStage, mode === "sim" ? seed : null);
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

  const selectedEventError = eventErrors[eventSlug];

  if (selectedEventError && shouldShowForecastLoadError({
    hasError: true,
    hasCurrentEvent: Boolean(current),
    loadedMode: eventsMode,
    requestedMode: mode,
  })) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-rm-metal-canvas p-6">
        <ErrorPanel title={`${eventSlug === "repechage" ? "复活赛" : "全国赛"}加载失败`} message={selectedEventError} onRetry={retryEvents} />
      </div>
    );
  }
  if (!explicitMode || eventsMode !== mode || !current || !workspace || (mode === "sim" && !currentSimulation && !overviewError)) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-rm-metal-canvas animate-pulse">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-rm-blue/30 border-t-rm-blue" />
        <span className="font-mono text-xs tracking-widest text-rm-blue">{mode === "sim" ? "加载模拟沙盘..." : "加载正式赛程..."}</span>
      </div>
    );
  }

  const visibleMatches = matchesForFinalStage(current.event, stage);

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
      <ForecastInspectorPanel
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
      <h1 className="sr-only">RMUC 2026 实时预测中心</h1>
      <header className="glass-sheet z-30 flex select-none flex-col gap-2 px-3 py-2 md:px-4 md:py-2.5">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <Link href="/" className="flex h-7 w-7 shrink-0 items-center justify-center border border-rm-blue/40 bg-rm-blue/15 text-rm-blue clip-chamfer transition-colors hover:bg-rm-blue hover:text-white" title="返回全景战略板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </Link>
          <CompetitionSelector
            value={eventSlug}
            onChange={(nextCompetition) => {
              if (isRegionCompetition(nextCompetition)) {
                const liveStatus = overview?.regions.find((region) => region.regionSlug === nextCompetition)?.liveStatus;
                const nextMode = isRegionRealtimeEnabled(nextCompetition, liveStatus) ? "live" : "sim";
                router.push(buildRegionHref(nextCompetition, "playoff", {
                  mode: nextMode,
                  seed: nextMode === "sim" ? (seed ?? getOrCreateSessionSeed()) : null,
                }));
                return;
              }
              chooseEvent(nextCompetition);
            }}
          />
          <div className="flex shrink-0 overflow-hidden border border-white/10 bg-rm-metal-dark/80">
            <button
              type="button"
              onClick={() => chooseMode("live")}
              title={mode !== "live"
                ? "检查并打开官方实时赛程"
                : officialLiveSchedule
                  ? "基于官方赛程的实时数据"
                  : "官方实时源未就绪；打开参考赛程"}
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
          {mode === "live" && current.liveStatus?.isSynthetic ? (
            <span
              className="shrink-0 border border-rm-status-deviation/70 bg-rm-status-deviation/15 px-2 py-1 font-mono text-[10px] font-bold text-rm-status-deviation"
              title={current.liveStatus.scenarioId ?? "synthetic runtime scenario"}
            >
              仿真数据
            </span>
          ) : mode === "live" && liveReferenceReason ? (
            <span className="shrink-0 border border-rm-status-warn/70 bg-rm-status-warn/15 px-2 py-1 font-mono text-[10px] font-bold text-rm-status-warn">
              官方实时源未就绪 · 仅参考赛程
            </span>
          ) : mode === "live" ? (
            <span className="shrink-0 border border-rm-status-safe/60 bg-rm-status-safe/10 px-2 py-1 font-mono text-[10px] font-bold text-rm-status-safe">
              官方赛程 · 实时
            </span>
          ) : null}
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
            <span>{current.event.fieldCapacity ?? current.event.participantCount} 席</span>
            {current.event.pendingEntryCount ? (
              <span className="text-rm-status-warn">
                {current.event.pendingEntryCount} 席待确认
              </span>
            ) : null}
            <span className="text-white/20">/</span>
            <span>{current.event.formalMatchCount} 场</span><span className="text-white/20">/</span>
            <span className="text-rm-status-scheduled">{formatFinalsDateRange(current.event.competitionRange.start, current.event.competitionRange.end)}</span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="shrink-0 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs uppercase text-rm-metal-text transition-colors hover:bg-rm-metal-panel hover:text-white"
          >
            搜索
          </button>
          <ShareScheduleButton
            title={`${eventSlug === "repechage" ? "复活赛" : "全国赛"}赛程`}
            buildUrl={() => buildScheduleShareUrl({
              origin: window.location.origin,
              pathname,
              mode,
              seed: mode === "sim" ? (seed ?? getOrCreateSessionSeed()) : null,
              state: {
                event: eventSlug,
                stage,
                highlight: selection?.kind === "team" ? selection.teamKey : null,
              },
            })}
          />
          <ExportCanvasButton
            competition={eventSlug}
            stage={stage}
            mode={mode}
            seed={mode === "sim" ? (seed ?? getOrCreateSessionSeed()) : null}
            highlight={selection?.kind === "team" ? selection.teamKey : null}
            revision={eventsRevision}
          />
          <span className="hidden shrink-0 font-mono text-[10px] text-rm-metal-textFaint sm:inline">{current.event.statusLabel}</span>
        </div>
        <div role="tablist" aria-label="赛事阶段" onKeyDown={handleHorizontalTabKeyDown} className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {FINAL_STAGE_OPTIONS[eventSlug].map((item) => (
            <button key={item.id} id={`forecast-${item.id}-tab`} type="button" role="tab" aria-selected={stage === item.id} aria-controls="forecast-stage-panel" tabIndex={stage === item.id ? 0 : -1} onClick={() => chooseStage(item.id)} className={cn("min-h-10 flex-none px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-all clip-chamfer md:min-h-0", stage === item.id ? "bg-rm-blue text-white shadow-[0_0_10px_rgba(42,159,255,0.4)]" : "border border-transparent text-rm-metal-text hover:border-white/15")}>{item.label}</button>
          ))}
          <span className="ml-auto hidden shrink-0 font-mono text-[10px] text-rm-metal-textFaint md:inline">
            当前 {visibleMatches.length} 场 · 数据更新 {formatShortDateTimeLabel(current.verifiedAt)}
            {mode === "sim" && seed !== null ? ` · 种子 ${seed}` : ""}
          </span>
        </div>
      </header>

      {liveReferenceReason ? (
        <div className="z-30 flex flex-wrap items-center gap-2 border-b border-rm-status-warn/50 bg-rm-status-warn/10 px-3 py-2 font-mono text-[11px] text-rm-status-warn md:px-4">
          <span className="min-w-0 flex-1">
            {liveReferenceReason} 此页面保留显式 live 深链，但不包含官方实时赛果。
          </span>
          <button type="button" onClick={() => chooseMode("sim")} className="border border-rm-status-warn/50 px-2 py-1 font-bold hover:bg-rm-status-warn hover:text-black">
            进入模拟推演
          </button>
          <button type="button" onClick={retryEvents} className="px-2 py-1 underline underline-offset-2">
            重新检查
          </button>
        </div>
      ) : null}

      {selectedEventError ? (
        <div className="border-b border-rm-status-warn/40 bg-rm-status-warn/5 px-4 py-2 font-mono text-[11px] text-rm-status-warn">
          更新失败，当前展示上一次成功的{officialLiveSchedule ? "官方赛程" : "参考赛程"}。
          <button type="button" onClick={retryEvents} className="ml-3 underline underline-offset-2">重试</button>
        </div>
      ) : null}

      {regionalErrors.length > 0 ? (
        <div className="z-30 flex items-center gap-2 border-b border-rm-status-warn/40 bg-rm-status-warn/10 px-3 py-1.5 font-mono text-[10px] text-rm-status-warn md:px-4">
          <span className="min-w-0 flex-1">
            {regionalErrors.join("、")}刷新失败；已保留上一次成功数据，相关 Elo 轨迹可能暂时滞后。
          </span>
          <button type="button" onClick={retryOverview} className="shrink-0 underline underline-offset-2">重试</button>
        </div>
      ) : null}

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

      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas Area */}
        <div id="forecast-stage-panel" role="tabpanel" aria-labelledby={`forecast-${stage}-tab`} className="flex-1 min-w-0 relative bg-transparent">
          <div className="absolute inset-0">
            <WorkspaceStageView
              stage={workspace}
              layoutKey={`${eventSlug}:${stage}:${mode}:finals-v1`}
              mode={mode}
              background="nationals"
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={selectedTeamKey}
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

      <WorkspaceSearchModal open={searchOpen} title="搜索队伍档案 · 当前赛事" onClose={() => setSearchOpen(false)}>
        <div className="flex flex-col gap-4">
          <input
            name="team-search"
            type="text"
            autoComplete="off"
            autoFocus
            placeholder="输入高校名称或拼音..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSearchActiveIndex((index) => Math.min(Math.max(0, searchResults.length - 1), index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSearchActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && searchResults[searchActiveIndex]) {
                event.preventDefault();
                chooseSearchTeam(searchResults[searchActiveIndex]);
              }
            }}
            aria-controls="team-search-results"
            aria-activedescendant={searchResults[searchActiveIndex] ? `team-search-result-${searchActiveIndex}` : undefined}
            className="bg-rm-metal-dark border-2 border-rm-metal-border focus:border-rm-blue px-4 py-3 text-white font-mono text-sm focus:outline-none transition-colors"
          />
          <div id="team-search-results" role="listbox" className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-2 no-scrollbar">
            {searchResults.map((team, index) => (
              <div
                key={team.teamKey}
                id={`team-search-result-${index}`}
                role="option"
                aria-selected={index === searchActiveIndex}
                className={cn(
                  "group flex items-stretch border bg-rm-metal-panel text-left transition-all hover:border-rm-blue hover:bg-rm-blue/10",
                  index === searchActiveIndex ? "border-rm-blue bg-rm-blue/10 shadow-[0_0_16px_rgba(42,159,255,0.15)]" : "border-rm-metal-border",
                )}
              >
                <button onClick={() => chooseSearchTeam(team)} className="flex-1 p-3 text-left">
                  <div className="flex items-center justify-between w-full mb-1">
                     <strong className="text-white font-bold group-hover:text-rm-blue transition-colors text-sm">{team.collegeName}</strong>
                     <span className="text-[10px] text-rm-metal-text font-mono border border-rm-metal-border px-1.5">{team.regionName}</span>
                  </div>
                  <div className="flex items-center justify-between w-full mt-1">
                     <span className="text-xs text-rm-metal-text font-mono">{team.teamName}</span>
                  <span className="text-[10px] text-rm-status-warn font-bold font-mono">国赛率 {percent(team.probabilities.national)}</span>
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
      </WorkspaceSearchModal>
    </div>
  );
}
