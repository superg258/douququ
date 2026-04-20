"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import PinyinMatch from "pinyin-match";

import { WorkspaceStageView } from "@/components/workspace-stage";
import { getLiveRegionState, getOverview, getSimulation } from "@/lib/api";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { formatRankingResultLabel, translateConfidenceLabel, translateDestinationLabel, translateStageLabel } from "@/lib/display";
import { buildLiveTimelineForTeam, findLiveMatchImpactPair } from "@/lib/live-state";
import { buildRegionHref, getOrCreateSessionSeed, parseMode, parseSeed, REGION_LABELS, REGION_VIEWS } from "@/lib/region-config";
import type {
  InspectorSelection,
  LiveRegionStateResponse,
  MatchRow,
  OverviewResponse,
  OverviewTeam,
  RegionSlug,
  SimulationResponse,
  WorkspaceMode,
  WorkspaceView,
} from "@/lib/types";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function rating(value: number) {
  return value.toFixed(1);
}

function signedRating(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function translateLiveStageFamily(stageFamily: string) {
  switch (stageFamily) {
    case "regional_group":
      return "区域赛小组赛";
    case "post_group":
      return "区域赛淘汰赛";
    case "repechage":
      return "复活赛";
    case "nationals":
      return "国赛";
    default:
      return stageFamily;
  }
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

function SearchModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <>
      <button type="button" className="overlay-backdrop" onClick={onClose} aria-label="关闭搜索" />
      <aside className="search-modal">
        <div className="search-modal-head">
          <div>
            <p className="module-eyebrow">全站检索</p>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="search-modal-body">{children}</div>
      </aside>
    </>
  );
}

function InspectorPanel({
  selection,
  workspaceMode,
  liveStateAvailable,
  liveStateReason,
  regionOverview,
  selectedOverviewTeam,
  selectedLiveSnapshot,
  selectedRanking,
  selectedTimeline,
  selectedPath,
  selectedMatch,
  selectedMatchImpact,
  onMatchOpen,
  onTeamOpen,
  onClose,
}: {
  selection: InspectorSelection | null;
  workspaceMode: WorkspaceMode;
  liveStateAvailable: boolean;
  liveStateReason: string | null;
  regionOverview: OverviewResponse["regions"][number] | null;
  selectedOverviewTeam: OverviewTeam | null;
  selectedLiveSnapshot: LiveRegionStateResponse["currentSnapshot"][number] | null;
  selectedRanking: SimulationResponse["finalRankings"][number] | null;
  selectedTimeline: LiveRegionStateResponse["matchLedger"];
  selectedPath: MatchRow[];
  selectedMatch: MatchRow | null;
  selectedMatchImpact: ReturnType<typeof findLiveMatchImpactPair> | null;
  onMatchOpen: (match: MatchRow) => void;
  onTeamOpen: (teamKey: string) => void;
  onClose: () => void;
}) {
  if (selection?.kind === "team" && selectedOverviewTeam) {
    return (
      <div className="inspector-stack">
        <div className="inspector-head">
          <div className="inspector-head-copy">
            <p className="module-eyebrow">队伍详情</p>
            <h3>{selectedOverviewTeam.collegeName}</h3>
            <p>{selectedOverviewTeam.teamName}</p>
          </div>
          <button type="button" onClick={onClose}>
            清除
          </button>
        </div>

        <section className="inspector-card">
          <div className="inspector-stat-grid">
            <span>{workspaceMode === "live" && selectedLiveSnapshot ? `当前 Elo ${rating(selectedLiveSnapshot.currentPublishedRating)}` : `Elo ${selectedOverviewTeam.mu0.toFixed(1)}`}</span>
            {workspaceMode === "live" && selectedLiveSnapshot ? (
              <span>较赛前 {signedRating(selectedLiveSnapshot.publishedDeltaFromPreseason)}</span>
            ) : null}
            <span>全站 #{selectedOverviewTeam.eloGlobalRank}</span>
            <span>赛区 #{selectedOverviewTeam.eloRegionRank}</span>
            <span>16 强 {percent(selectedOverviewTeam.probabilities.roundOf16)}</span>
            <span>复活赛 {percent(selectedOverviewTeam.probabilities.repechage)}</span>
            <span>国赛 {percent(selectedOverviewTeam.probabilities.national)}</span>
            <span>冠军 {percent(selectedOverviewTeam.probabilities.champion)}</span>
          </div>
        </section>

        {selectedRanking ? (
          <section className="inspector-card">
            <h4>本次模拟结果</h4>
            <p>{formatRankingResultLabel(selectedRanking.rank, selectedRanking.finalBucket, selectedRanking.advancement)}</p>
            <div className="inspector-path-list">
              {selectedPath.map((match) => {
                const opponent = match.redTeam.teamKey === selectedOverviewTeam.teamKey ? match.blueTeam : match.redTeam;
                const result = match.winnerTeamKey === selectedOverviewTeam.teamKey ? "胜" : "负";
                return (
                  <button key={match.matchLabel} type="button" className="path-item" onClick={() => onMatchOpen(match)}>
                    <strong>{match.matchLabel}</strong>
                    <span>
                      {result} {opponent.collegeName} {match.scoreline}
                    </span>
                    <small>{translateStageLabel(match.stage)}</small>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {workspaceMode === "live" ? (
          <section className="inspector-card">
            <h4>逐场 Elo 时间线</h4>
            {!liveStateAvailable ? <p>{liveStateReason ?? "当前没有可用的 live Elo 账本。"}</p> : null}
            {liveStateAvailable && !selectedLiveSnapshot ? <p>这支队伍还没有 live Elo 快照。</p> : null}
            {liveStateAvailable && selectedLiveSnapshot ? (
              <>
                <div className="inspector-stat-grid">
                  <span>live 分量 {signedRating(selectedLiveSnapshot.liveStateRatingComponent)}</span>
                  <span>已确认先验 {signedRating(selectedLiveSnapshot.confirmedPriorRatingComponent)}</span>
                  <span>剩余先验 {signedRating(selectedLiveSnapshot.residualPriorRatingComponent)}</span>
                  <span>已赛区域赛 {selectedLiveSnapshot.regionalGroupMatchesPlayed} 场</span>
                </div>
                <div className="inspector-path-list">
                  {selectedTimeline.length ? (
                    selectedTimeline.map((row) => (
                      <div key={`${row.matchId}-${row.teamKey}`} className="path-item static">
                        <strong>{row.matchDate} / {translateLiveStageFamily(row.stageFamily)}</strong>
                        <span>
                          {row.matchResult === "win" ? "胜" : "负"} {row.scoreline} / Elo {rating(row.publishedRatingBeforeMatch)} → {rating(row.publishedRatingAfterMatch)}
                        </span>
                        <small>
                          总变化 {signedRating(row.publishedDeltaRating)} / live {signedRating(row.liveUpdateDeltaRating)} / 先验 {signedRating(row.priorComponentDeltaRating)}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p>当前还没有已完赛比赛的 Elo 记录。</p>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  if (selection?.kind === "match" && selectedMatch) {
    return (
      <div className="inspector-stack">
        <div className="inspector-head">
          <div className="inspector-head-copy">
            <p className="module-eyebrow">比赛详情</p>
            <h3>{selectedMatch.matchLabel}</h3>
            <p>{translateStageLabel(selectedMatch.stage)}</p>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <section className="inspector-card">
          <h4>
            {selectedMatch.redTeam.collegeName} vs {selectedMatch.blueTeam.collegeName}
          </h4>
          <p>
            比分 {selectedMatch.scoreline} / BO{selectedMatch.bestOf}
            {selectedMatch.isRealResult ? " / 已完赛" : " / 模拟分支"}
          </p>
          <div className="inspector-stat-grid">
            <span>红方系列赛 {percent(selectedMatch.pSeriesRed)}</span>
            <span>蓝方系列赛 {percent(selectedMatch.pSeriesBlue)}</span>
            <span>红方单局 {percent(selectedMatch.pGameRed)}</span>
            <span>蓝方单局 {percent(selectedMatch.pGameBlue)}</span>
            <span>对位差 {selectedMatch.deltaH2H.toFixed(3)}</span>
            <span>结果把握 {translateConfidenceLabel(selectedMatch.confidenceLabel)}</span>
          </div>
        </section>

        {workspaceMode === "live" ? (
          <section className="inspector-card">
            <h4>实际 Elo 影响</h4>
            {selectedMatch.isRealResult && selectedMatchImpact ? (
              <>
                <div className="inspector-stat-grid">
                  <span>红方 Elo {rating(selectedMatchImpact.red.publishedRatingBeforeMatch)} → {rating(selectedMatchImpact.red.publishedRatingAfterMatch)}</span>
                  <span>红方总变化 {signedRating(selectedMatchImpact.red.publishedDeltaRating)}</span>
                  <span>红方 live {signedRating(selectedMatchImpact.red.liveUpdateDeltaRating)}</span>
                  <span>红方先验 {signedRating(selectedMatchImpact.red.priorComponentDeltaRating)}</span>
                  <span>蓝方 Elo {rating(selectedMatchImpact.blue.publishedRatingBeforeMatch)} → {rating(selectedMatchImpact.blue.publishedRatingAfterMatch)}</span>
                  <span>蓝方总变化 {signedRating(selectedMatchImpact.blue.publishedDeltaRating)}</span>
                  <span>蓝方 live {signedRating(selectedMatchImpact.blue.liveUpdateDeltaRating)}</span>
                  <span>蓝方先验 {signedRating(selectedMatchImpact.blue.priorComponentDeltaRating)}</span>
                </div>
                <p className="inspector-note">
                  这里的总变化固定按 `总变化 = live update + 先验变化` 拆解，能解释“赢了但总分下降”的情况。
                </p>
              </>
            ) : (
              <p>{selectedMatch.isRealResult ? "当前找不到这场比赛对应的 live Elo 账本记录。" : "暂无实际 Elo 影响，仅显示预测概率。"}
              </p>
            )}
          </section>
        ) : null}

        <section className="inspector-card">
          <h4>下一步去向</h4>
          <p>胜者：{translateDestinationLabel(selectedMatch.winnerNext)}</p>
          <p>败者：{translateDestinationLabel(selectedMatch.loserNext)}</p>
          <div className="inspector-inline-actions">
            <button type="button" onClick={() => onTeamOpen(selectedMatch.redTeam.teamKey)}>
              查看红方
            </button>
            <button type="button" onClick={() => onTeamOpen(selectedMatch.blueTeam.teamKey)}>
              查看蓝方
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="inspector-stack">
      <div className="inspector-head">
        <div className="inspector-head-copy">
          <p className="module-eyebrow">当前视图</p>
          <h3>{regionOverview?.regionName ?? "赛区看板"}</h3>
          <p>点击队伍或比赛后，这里会显示战绩、路径和下一步去向。</p>
        </div>
      </div>

      <section className="inspector-card">
        <div className="inspector-stat-grid">
          <span>{regionOverview?.teams.length ?? 0} 支队伍</span>
          <span>国赛 {regionOverview?.nationalSlots ?? 0}</span>
          <span>复活赛 {regionOverview?.repechageSlots ?? 0}</span>
        </div>
      </section>

      <section className="inspector-card">
        <h4>快速查看热门队伍</h4>
        <div className="quick-team-list">
          {regionOverview?.teams.slice(0, 6).map((team) => (
            <button key={team.teamKey} type="button" className="quick-team-button" onClick={() => onTeamOpen(team.teamKey)}>
              <strong>{team.collegeName}</strong>
              <span>争冠 {percent(team.probabilities.champion)}</span>
            </button>
          ))}
        </div>
      </section>
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
  const workspaceMode = parseMode(searchParams.get("mode"));
  const highlightedTeamKey = searchParams.get("highlight");
  const parsedSeed = parseSeed(searchParams.get("seed"));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [liveState, setLiveState] = useState<LiveRegionStateResponse | null>(null);
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
  }, [regionSlug, seed]);

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
    getSimulation(regionSlug, seed, workspaceMode)
      .then(setSimulation)
      .catch((err: Error) => setError(err.message));
  }, [regionSlug, seed, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "live") {
      setLiveState(null);
      return;
    }
    setLiveState(null);
    getLiveRegionState(regionSlug)
      .then(setLiveState)
      .catch((err: Error) => setError(err.message));
  }, [regionSlug, workspaceMode]);

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
  const selectedLiveSnapshot = useMemo(
    () => (liveState && selectedTeamKey ? liveState.currentSnapshot.find((row) => row.teamKey === selectedTeamKey) ?? null : null),
    [liveState, selectedTeamKey]
  );
  const selectedTimeline = useMemo(
    () => (liveState && selectedTeamKey ? buildLiveTimelineForTeam(selectedTeamKey, liveState.matchLedger) : []),
    [liveState, selectedTeamKey]
  );
  const selectedPath = useMemo(
    () => (simulation && selectedTeamKey ? teamPath(simulation, selectedTeamKey) : []),
    [simulation, selectedTeamKey]
  );
  const selectedMatch = useMemo(
    () => (simulation && selectedMatchLabel ? simulation.matches.find((row) => row.matchLabel === selectedMatchLabel) ?? null : null),
    [simulation, selectedMatchLabel]
  );
  const selectedMatchImpact = useMemo(
    () => (liveState && selectedMatch ? findLiveMatchImpactPair(selectedMatch, liveState.matchLedger) : null),
    [liveState, selectedMatch]
  );
  const stage = useMemo(
    () => (simulation ? buildWorkspaceStage(view, regionSlug, simulation) : null),
    [simulation, view, regionSlug]
  );

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
    router.push(buildRegionHref(team.regionSlug, view, { seed: resolveSeed(), highlight: team.teamKey, mode: workspaceMode }));
    setSelection({ kind: "team", teamKey: team.teamKey });
  };

  const applySeedDraft = () => {
    const normalized = sanitizeSeedInput(seedDraft);
    const nextSeed = String(parseSeed(normalized) ?? resolveSeed());
    setSeedDraft(nextSeed);
    updateQuery({ seed: nextSeed, highlight: selection?.kind === "team" ? selection.teamKey : highlightedTeamKey, mode: workspaceMode === "live" ? "live" : null });
  };

  const onRegionChange = (nextRegion: RegionSlug) => {
    setInspectorOpen(false);
    setSelection(null);
    router.push(buildRegionHref(nextRegion, view, { seed: resolveSeed(), mode: workspaceMode }));
  };

  const inspectorVisible = inspectorOpen || Boolean(selection);
  const inspectorToggleLabel = selection?.kind === "team" ? "队伍情报" : selection?.kind === "match" ? "比赛情报" : "赛区情报";

  return (
    <main className={`workspace-shell view-${view}`}>
      <div className="workspace-ambient-grid" />
      <div className="workspace-ambient-glow glow-one" />
      <div className="workspace-ambient-glow glow-two" />

      <header className="workspace-topbar">
        <div className="workspace-topbar-main workspace-title-bar">
          <div className="workspace-topbar-copy-block">
            <p className="toolbar-kicker">RMUC 2026 / 赛区看板</p>
            <h1>{REGION_LABELS[regionSlug]}</h1>
            <p className="workspace-copy">{viewMeta.description}</p>
            {workspaceMode === "live" ? <p className="workspace-copy">当前为 live Elo 口径：已完赛比赛按 published artifacts 结算，未完赛分支仍显示模拟概率。</p> : null}
          </div>
          <div className="toolbar-actions workspace-topbar-actions">
            <button
              type="button"
              className={inspectorVisible ? "workspace-panel-toggle is-active" : "workspace-panel-toggle"}
              onClick={() => {
                if (inspectorVisible) {
                  closeInspector();
                  return;
                }
                setInspectorOpen(true);
              }}
            >
              {inspectorVisible ? "收起" : "打开"}{inspectorToggleLabel}
            </button>
            <button type="button" onClick={() => setSearchOpen(true)}>
              搜索队伍
            </button>
            <Link href="/" className="toolbar-link">
              返回总控首页
            </Link>
          </div>
        </div>

        <div className="workspace-command-deck">
          <div className="workspace-control-strip">
            <label>
              赛区
              <select name="region" value={regionSlug} onChange={(event) => onRegionChange(event.target.value as RegionSlug)}>
                {overview?.regions.map((region) => (
                  <option key={region.regionSlug} value={region.regionSlug}>
                    {region.regionName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模拟种子
              <input
                name="seed"
                type="text"
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
                spellCheck={false}
                value={seedDraft}
                onChange={(event) => setSeedDraft(sanitizeSeedInput(event.target.value))}
              />
            </label>
            <button type="button" className="simulate-button" onClick={applySeedDraft}>
              刷新模拟
            </button>
          </div>

          <div className="workspace-stage-strip">
            <nav className="view-tabs">
              {REGION_VIEWS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === view ? "view-tab is-active" : "view-tab"}
                  onClick={() => updateQuery({ view: item.id, mode: workspaceMode === "live" ? "live" : null })}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="toolbar-meta">
              <span>{regionOverview?.teams.length ?? 0} 支队伍</span>
              <span>国赛 {regionOverview?.nationalSlots ?? 0}</span>
              <span>复活赛 {regionOverview?.repechageSlots ?? 0}</span>
              <span>本次种子 {seed}</span>
              <span>{workspaceMode === "live" ? "live Elo" : "模拟 Elo"}</span>
            </div>
          </div>
        </div>
      </header>

      {inspectorVisible ? (
        <button type="button" className="inspector-overlay-backdrop" onClick={closeInspector} aria-label="关闭情报面板" />
      ) : null}

      <section className={inspectorVisible ? "workspace-grid is-inspector-open" : "workspace-grid"}>
        <div className="workspace-canvas-column">
          {error ? <div className="error-panel dark">数据加载失败：{error}</div> : null}
          {!stage ? <div className="loading-panel workspace-loading">正在生成当前赛程…</div> : null}
          {stage ? (
            <WorkspaceStageView
              stage={stage}
              selectedTeamKey={selectedTeamKey}
              highlightedTeamKey={highlightedTeamKey}
              selectedMatchLabel={selectedMatchLabel}
              onTeamSelect={openTeam}
              onMatchSelect={(matchLabel) => {
                const match = simulation?.matches.find((row) => row.matchLabel === matchLabel);
                if (match) {
                  openMatch(match);
                }
              }}
            />
          ) : null}
        </div>

        {inspectorVisible ? (
          <aside className="workspace-inspector-panel is-open">
            <InspectorPanel
              selection={selection}
              workspaceMode={workspaceMode}
              liveStateAvailable={liveState?.available ?? false}
              liveStateReason={liveState?.reason ?? null}
              regionOverview={regionOverview}
              selectedOverviewTeam={selectedOverviewTeam}
              selectedLiveSnapshot={selectedLiveSnapshot}
              selectedRanking={selectedRanking}
              selectedTimeline={selectedTimeline}
              selectedPath={selectedPath}
              selectedMatch={selectedMatch}
              selectedMatchImpact={selectedMatchImpact}
              onMatchOpen={openMatch}
              onTeamOpen={openTeam}
              onClose={closeInspector}
            />
          </aside>
        ) : null}
      </section>

      <SearchModal open={searchOpen} title="搜索全部赛区队伍" onClose={() => setSearchOpen(false)}>
        <div className="search-panel">
          <input
            name="team-search"
            type="search"
            autoComplete="off"
            placeholder="输入学校、队名或拼音"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <div className="search-results">
            {searchResults.map((team) => (
              <button key={team.teamKey} type="button" className="search-result" onClick={() => chooseSearchTeam(team)}>
                <strong>{team.collegeName}</strong>
                <span>{team.teamName}</span>
                <small>
                  {team.regionName} / 国赛 {percent(team.probabilities.national)}
                </small>
              </button>
            ))}
            {searchResults.length === 0 ? <div className="empty-state">没有找到匹配的队伍。</div> : null}
          </div>
        </div>
      </SearchModal>
    </main>
  );
}
