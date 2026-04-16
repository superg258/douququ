"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import PinyinMatch from "pinyin-match";

import { WorkspaceStageView } from "@/components/workspace-stage";
import { getOverview, getSimulation } from "@/lib/api";
import { buildWorkspaceStage } from "@/lib/canvas-builders";
import { formatRankingResultLabel, translateConfidenceLabel, translateDestinationLabel, translateStageLabel } from "@/lib/display";
import { buildRegionHref, getOrCreateSessionSeed, parseSeed, REGION_LABELS, REGION_VIEWS } from "@/lib/region-config";
import type {
  InspectorSelection,
  MatchRow,
  OverviewResponse,
  OverviewTeam,
  RegionSlug,
  SimulationResponse,
  WorkspaceView,
} from "@/lib/types";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
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
  regionOverview,
  selectedOverviewTeam,
  selectedRanking,
  selectedPath,
  selectedMatch,
  onMatchOpen,
  onTeamOpen,
  onClose,
}: {
  selection: InspectorSelection | null;
  regionOverview: OverviewResponse["regions"][number] | null;
  selectedOverviewTeam: OverviewTeam | null;
  selectedRanking: SimulationResponse["finalRankings"][number] | null;
  selectedPath: MatchRow[];
  selectedMatch: MatchRow | null;
  onMatchOpen: (match: MatchRow) => void;
  onTeamOpen: (teamKey: string) => void;
  onClose: () => void;
}) {
  if (selection?.kind === "team" && selectedOverviewTeam && selectedRanking) {
    return (
      <div className="inspector-stack">
        <div className="inspector-head">
          <div>
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
            <span>Elo {selectedOverviewTeam.mu0.toFixed(1)}</span>
            <span>全站 #{selectedOverviewTeam.eloGlobalRank}</span>
            <span>赛区 #{selectedOverviewTeam.eloRegionRank}</span>
            <span>16 强 {percent(selectedOverviewTeam.probabilities.roundOf16)}</span>
            <span>复活赛 {percent(selectedOverviewTeam.probabilities.repechage)}</span>
            <span>国赛 {percent(selectedOverviewTeam.probabilities.national)}</span>
            <span>冠军 {percent(selectedOverviewTeam.probabilities.champion)}</span>
          </div>
        </section>

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
      </div>
    );
  }

  if (selection?.kind === "match" && selectedMatch) {
    return (
      <div className="inspector-stack">
        <div className="inspector-head">
          <div>
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
        <div>
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
  const highlightedTeamKey = searchParams.get("highlight");
  const parsedSeed = parseSeed(searchParams.get("seed"));

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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
    getSimulation(regionSlug, seed)
      .then(setSimulation)
      .catch((err: Error) => setError(err.message));
  }, [regionSlug, seed]);

  const updateQuery = useCallback(
    (next: Partial<Record<"view" | "seed" | "highlight", string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
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

  const openTeam = (teamKey: string) => {
    setSelection({ kind: "team", teamKey });
    updateQuery({ highlight: teamKey });
  };

  const openMatch = (match: MatchRow) => {
    setSelection({ kind: "match", matchLabel: match.matchLabel });
  };

  const closeInspector = () => {
    if (selection?.kind === "team") {
      updateQuery({ highlight: null });
    }
    setSelection(null);
  };

  const chooseSearchTeam = (team: OverviewTeam) => {
    setSearchOpen(false);
    setSearchText("");
    router.push(buildRegionHref(team.regionSlug, view, { seed: resolveSeed(), highlight: team.teamKey }));
    setSelection({ kind: "team", teamKey: team.teamKey });
  };

  const applySeedDraft = () => {
    const normalized = sanitizeSeedInput(seedDraft);
    const nextSeed = String(parseSeed(normalized) ?? resolveSeed());
    setSeedDraft(nextSeed);
    updateQuery({ seed: nextSeed, highlight: selection?.kind === "team" ? selection.teamKey : highlightedTeamKey });
  };

  const onRegionChange = (nextRegion: RegionSlug) => {
    setSelection(null);
    router.push(buildRegionHref(nextRegion, view, { seed: resolveSeed() }));
  };

  return (
    <main className={`workspace-shell view-${view}`}>
      <div className="workspace-ambient-grid" />
      <div className="workspace-ambient-glow glow-one" />
      <div className="workspace-ambient-glow glow-two" />

      <header className="workspace-topbar">
        <div className="workspace-topbar-main">
          <div className="workspace-topbar-copy-block">
            <p className="toolbar-kicker">RMUC 2026 / 赛区看板</p>
            <h1>{REGION_LABELS[regionSlug]}</h1>
            <p className="workspace-copy">{viewMeta.description}</p>
          </div>
          <div className="toolbar-actions workspace-topbar-actions">
            <Link href="/" className="toolbar-link">
              返回总控首页
            </Link>
            <button type="button" onClick={() => setSearchOpen(true)}>
              搜索队伍
            </button>
          </div>
        </div>

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
                onClick={() => updateQuery({ view: item.id })}
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
          </div>
        </div>
      </header>

      <section className="workspace-grid">
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

        <aside className="workspace-inspector">
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
        </aside>
      </section>

      {selection ? (
        <section className="workspace-inspector-drawer">
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
        </section>
      ) : null}

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
