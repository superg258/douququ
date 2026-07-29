"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { WorkspaceStageView } from "@/components/workspace-stage";
import { CompetitionSelector, isRegionCompetition } from "@/components/competition-selector";
import { RegionInspectorPanel } from "@/components/region-inspector-panel";
import { RegionLegendPopover } from "@/components/region-legend-popover";
import { RegionWorkspaceToolbar } from "@/components/region-workspace-toolbar";
import { ShareScheduleButton } from "@/components/share-schedule-button";
import { WorkspaceSearchModal } from "@/components/workspace-search-modal";
import { ErrorPanel } from "@/components/ui/async-state";
import { ExportCanvasButton } from "@/components/export-canvas-button";
import { getLiveState, getOverview, getSimulation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { percent } from "@/lib/display";
import { buildPredictionRecap, derivePredictionVerdict } from "@/lib/prediction-insights";
import { predictDisplayScoreline } from "@/lib/scoreline";
import {
  buildRegionHref,
  DEFAULT_SEED,
  getOrCreateSessionSeed,
  isRegionSlug,
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
  type InspectorPanelState,
} from "@/lib/workspace-selection";
import { deriveRealtimeAvailability, liveStateRefreshKey } from "@/lib/realtime";
import { buildScheduleShareUrl } from "@/lib/share-link";
import { useRevisionPolling } from "@/lib/use-revision-polling";
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
    sourceKind: null,
    isSynthetic: false,
    sourceUpdatedAt: null,
    sourceAgeSeconds: null,
    freshnessLabel: "missing",
    validationState: "missing",
    scenarioId: null,
    runtimeArtifactVersion: "",
    completedMatches: 0,
    confirmedMatches: 0,
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

export function RegionWorkspace({ regionSlug: rawRegionSlug }: { regionSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaultView = useMemo<WorkspaceView>(() => "playoff", []);

  const regionSlug = isRegionSlug(rawRegionSlug) ? rawRegionSlug : "east_region";
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
  const [simulationRetryToken, setSimulationRetryToken] = useState(0);
  const simulationRequestRef = useRef({ identity: "", generation: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);

  // 根布局 Header 由 RootNav 按 /regions/* 路径名隐藏；这里的 body class
  // 只负责锁定页面滚动与文本选择（见 globals.css 的 .canvas-fullscreen-page）。
  useEffect(() => {
    document.body.classList.add("canvas-fullscreen-page");
    return () => {
      document.body.classList.remove("canvas-fullscreen-page");
    };
  }, []);

  // 非法 region slug 回退到 east_region 时，把地址栏同步替换为实际生效的 slug。
  useEffect(() => {
    if (isRegionSlug(rawRegionSlug)) {
      return;
    }
    const query = searchParams.toString();
    router.replace(query ? `/regions/east_region?${query}` : "/regions/east_region", { scroll: false });
  }, [rawRegionSlug, router, searchParams]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
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
  const liveSimulationRefreshKey = requestedMode === "live" ? liveStateRefreshKey(liveState) : "";

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

  const loadFullLiveState = useCallback(async () => {
    const payload = await getLiveState(regionSlug);
    setLiveState(payload);
    setError(null);
  }, [regionSlug]);

  useEffect(() => {
    setLiveState(null);
  }, [regionSlug, requestedMode]);

  useRevisionPolling({
    enabled: requestedMode === "live",
    resourceIdentity: `region:${regionSlug}`,
    currentRevision: liveState?.dataRevision,
    selectRevision: (payload) => payload.regions[regionSlug]?.dataRevision,
    loadFull: loadFullLiveState,
    onError: (err) => {
      setLiveState((current) => current ?? unavailableLiveState(regionSlug, err.message));
      setError(err.message);
    },
  });

  useEffect(() => {
    if (dataMode === "sim" && seed === null) {
      return;
    }
    const requestSeed = dataMode === "sim" ? seed! : (seed ?? DEFAULT_SEED);
    const identity = `${regionSlug}:${requestSeed}:${dataMode}`;
    const generation = simulationRequestRef.current.generation + 1;
    const isNavigation = simulationRequestRef.current.identity !== identity;
    simulationRequestRef.current = { identity, generation };
    setError(null);
    if (isNavigation) {
      setSimulation(null);
    }
    getSimulation(regionSlug, requestSeed, dataMode)
      .then((payload) => {
        if (
          simulationRequestRef.current.identity === identity
          && simulationRequestRef.current.generation === generation
        ) {
          setSimulation(payload);
        }
      })
      .catch((err: Error) => {
        if (
          simulationRequestRef.current.identity === identity
          && simulationRequestRef.current.generation === generation
        ) {
          setError(err.message);
        }
      });
  }, [regionSlug, seed, dataMode, liveSimulationRefreshKey, simulationRetryToken]);

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
  useEffect(() => {
    setSearchActiveIndex(0);
  }, [deferredSearchText, searchOpen]);
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
        const predictedScore = predictDisplayScoreline(match.pGameRed ?? expectedRed, expectedRed, match.bestOf || 3);
        const verdict = derivePredictionVerdict(match, predictedScore.scoreline);

        if (verdict === "upset") {
          accuracy.upset += 1;
        } else if (verdict === "deviation") {
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
      <RegionInspectorPanel
        selection={selection}
        regionOverview={regionOverview}
        selectedOverviewTeam={selectedOverviewTeam}
        selectedRanking={selectedRanking}
        selectedPath={selectedPath}
        selectedMatch={selectedMatch}
        dataMode={dataMode}
        onMatchOpen={openMatch}
        onTeamOpen={openTeam}
        onClose={closeInspector}
      />
    </div>
  );

  const renderHomeButton = () => (
    <Link
      href="/"
      className="flex h-10 w-10 shrink-0 items-center justify-center border border-rm-blue/40 bg-rm-blue/15 text-rm-blue clip-chamfer transition-colors hover:bg-rm-blue hover:text-white md:h-7 md:w-7"
      title="返回全景战略板"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </Link>
  );

  const renderRegionSelector = () => (
    <CompetitionSelector
      value={regionSlug}
      onChange={(nextCompetition) => {
        if (isRegionCompetition(nextCompetition)) {
          onRegionChange(nextCompetition);
          return;
        }
        router.push(`/forecast-center?event=${nextCompetition}`);
      }}
    />
  );

  const renderModeToggle = () => (
    <div className="flex shrink-0 overflow-hidden border border-white/10 bg-rm-metal-dark/80">
      <button
        onClick={() => updateQuery({ mode: "live", seed: null })}
        title={realtimeAvailability.hint}
        className={cn(
          "min-h-10 px-2.5 py-1.5 text-xs font-bold uppercase transition-colors md:min-h-0",
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
          "min-h-10 px-2.5 py-1.5 text-xs font-bold uppercase transition-colors md:min-h-0",
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
        className="min-h-10 border-l border-white/10 bg-rm-blue/20 px-2 py-1.5 text-[10px] font-bold text-rm-blue transition-colors hover:bg-rm-blue hover:text-white md:min-h-0"
      >
        刷新
      </button>
    </div>
  ) : null;

  const renderSearchButton = () => (
    <button
      onClick={() => setSearchOpen(true)}
      className="min-h-10 shrink-0 border border-white/10 bg-rm-metal-dark/80 px-2.5 py-1.5 text-xs uppercase text-rm-metal-text transition-colors hover:bg-rm-metal-panel md:min-h-0"
    >
      搜索
    </button>
  );

  const renderShareButton = () => (
    <ShareScheduleButton
      title={`${REGION_LABELS[regionSlug]}赛程`}
      buildUrl={() => buildScheduleShareUrl({
        origin: window.location.origin,
        pathname,
        mode: dataMode,
        seed: dataMode === "sim" ? resolveSeed() : null,
        state: {
          view,
          highlight: selection?.kind === "team" ? selection.teamKey : highlightedTeamKey,
        },
      })}
    />
  );

  const renderLegendButton = () => (
    <button
      type="button"
      onClick={() => setLegendOpen((c) => !c)}
      className={cn(
        "min-h-10 shrink-0 border px-2 py-1.5 text-xs uppercase transition-colors md:min-h-0",
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
        "min-h-10 shrink-0 border px-2 py-1.5 text-xs uppercase transition-colors md:min-h-0",
        inspectorVisible ? "border-rm-blue bg-rm-blue/15 text-rm-blue" : "border-white/10 bg-rm-metal-dark/80 text-rm-metal-text"
      )}
    >
      情报
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col min-h-0 bg-rm-metal-canvas bg-red-blue-split">
      <h1 className="sr-only">{REGION_LABELS[regionSlug]}赛区工作区</h1>
      <RegionWorkspaceToolbar
        view={view}
        homeButton={renderHomeButton()}
        regionSelector={renderRegionSelector()}
        modeToggle={renderModeToggle()}
        seedControl={renderSeedControl()}
        searchButton={renderSearchButton()}
        shareButton={renderShareButton()}
        exportButton={(
          <ExportCanvasButton
            competition={regionSlug}
            stage={view}
            mode={dataMode}
            seed={dataMode === "sim" ? seed : null}
            highlight={selection?.kind === "team" ? selection.teamKey : highlightedTeamKey}
            revision={simulation?.meta.dataRevision}
          />
        )}
        legendButton={renderLegendButton()}
        inspectorButton={renderInspectorButton()}
        desktopSeedLabel={dataMode === "sim" && seed !== null ? (
          <span className="hidden shrink-0 font-mono text-[10px] text-rm-metal-text md:inline">
            种子 {seed}
          </span>
        ) : null}
        onViewChange={(nextView) => updateQuery({ view: nextView })}
      />

      {requestedLiveFallback ? (
        <div className="z-30 border-b border-rm-status-warn/35 bg-rm-status-warn/10 px-3 py-2 font-mono text-[11px] text-rm-status-warn md:px-4">
          已请求实时赛程；实时赛程暂未开放，当前展示模拟推演。赛程公布后将自动切换为实时模式。
        </div>
      ) : null}

      <RegionLegendPopover
        open={legendOpen}
        counters={matchPhaseOverview.counters}
        accuracy={matchPhaseOverview.accuracy}
        winnerHitRate={predictionRecap?.winnerHitRate ?? null}
        onClose={() => setLegendOpen(false)}
      />

      <div className="flex-1 relative flex overflow-hidden">
        {/* Canvas Area */}
        <div
          id="region-workspace-panel"
          role="tabpanel"
          aria-labelledby={`region-${view}-tab`}
          className="flex-1 min-w-0 relative bg-transparent"
        >
          {error && !stage ? (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
              <ErrorPanel
                title="系统错误"
                message={error}
                onRetry={() => setSimulationRetryToken((token) => token + 1)}
              />
            </div>
          ) : null}

          {error && stage ? (
            <div className="absolute right-3 top-3 z-40 border border-rm-status-warn/50 bg-black/85 px-3 py-2 font-mono text-[11px] text-rm-status-warn">
              更新失败，当前展示上一次成功数据
            </div>
          ) : null}
          
          {!stage && !error ? (
            <div className="absolute inset-0 flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-4">
                 <div className="w-10 h-10 border-4 border-rm-blue border-r-transparent rounded-full animate-spin"/>
                 <div className="text-rm-blue font-machine tracking-widest text-sm animate-pulse">正在生成预测图谱...</div>
              </div>
            </div>
          ) : null}

          {stage ? (
            <div className="absolute inset-0">
              <WorkspaceStageView
                stage={stage}
                layoutKey={`${regionSlug}:${view}:${dataMode}:regional-v1`}
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
      
      <WorkspaceSearchModal open={searchOpen} title="搜索队伍档案 · 当前赛区优先" onClose={() => setSearchOpen(false)}>
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
