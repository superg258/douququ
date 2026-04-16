"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OverviewModule } from "@/components/overview-module";
import { getOverview } from "@/lib/api";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import { buildRegionHref } from "@/lib/region-config";
import type { OverviewMetric, OverviewResponse, OverviewTeam, RegionDashboardCard, RegionSlug, WorkspaceView } from "@/lib/types";

const REGION_QUICK_VIEWS: Array<{ id: WorkspaceView; label: string }> = [
  { id: "qualification", label: "资格赛" },
  { id: "playoff", label: "主淘汰赛" },
  { id: "final-rankings", label: "最终排名" },
];

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

function numberWithComma(value: number) {
  return value.toLocaleString("zh-CN");
}

function holdLabel(value: number) {
  return `守线把握 ${pct(value)}`;
}

function chaseGapLabel(value: number) {
  return `领先追兵 ${pct(value)}`;
}

function regionHref(regionSlug: RegionSlug, view: WorkspaceView, highlight?: string) {
  return buildRegionHref(regionSlug, view, { highlight });
}

function aggregationLabel(mode: string) {
  switch (mode) {
    case "mean_of_seed_runs":
      return "多种子平均";
    case "single_seed":
      return "单种子";
    default:
      return "自定义聚合";
  }
}

function RaceTeamChips({ teams }: { teams: OverviewTeam[] }) {
  if (teams.length === 0) {
    return <p className="race-team-empty">当前追赶组尚未拉开。</p>;
  }

  return (
    <div className="race-team-list" aria-label="追赶队伍">
      {teams.map((team) => (
        <span key={team.teamKey} className="race-team-chip">
          {team.collegeName}
        </span>
      ))}
    </div>
  );
}

function LockTeamList({ teams }: { teams: OverviewTeam[] }) {
  if (teams.length === 0) {
    return <p className="race-team-empty">当前还没有达到稳进国赛线的队伍。</p>;
  }

  return (
    <div className="lock-team-list" aria-label="国赛稳进名单">
      {teams.map((team) => (
        <span key={team.teamKey} className="lock-team-chip">
          {team.collegeName}
        </span>
      ))}
    </div>
  );
}

function RegionQuickLinks({
  regionSlug,
  className,
}: {
  regionSlug: RegionSlug;
  className?: string;
}) {
  return (
    <div className={className ?? "region-view-links"}>
      {REGION_QUICK_VIEWS.map((view) => (
        <Link key={view.id} href={regionHref(regionSlug, view.id)} className="region-view-link">
          {view.label}
        </Link>
      ))}
    </div>
  );
}

function HeroRegionCard({ region }: { region: RegionDashboardCard }) {
  return (
    <article className="hero-command-card">
      <div className="hero-command-head">
        <div className="hero-command-title">
          <p>{region.regionName}</p>
          <strong>{region.favorite.collegeName}</strong>
        </div>
        <span className="hero-command-signal">争冠 {pct(region.favorite.probabilities.champion)}</span>
      </div>
      <div className="hero-command-grid">
        <span>队伍 {region.teamCount}</span>
        <span>国赛 {region.nationalSlots}</span>
        <span>复活赛 {region.repechageSlots}</span>
        <span>头号国赛 {pct(region.favorite.probabilities.national)}</span>
      </div>
      <RegionQuickLinks regionSlug={region.regionSlug} className="hero-region-links" />
    </article>
  );
}

function UltraWideHeroLayer({
  generatedLabel,
  heroMetrics,
  regions,
}: {
  generatedLabel: string;
  heroMetrics: OverviewMetric[];
  regions: RegionDashboardCard[];
}) {
  return (
    <section className="ultra-stage-layer">
      <div className="ultra-stage-copy">
        <p className="ultra-stage-kicker">RMUC 2026 / Molten Arena</p>
        <div className="ultra-stage-heading" aria-label="RoboMaster 赛程模拟总控台">
          <span className="ultra-stage-title-en">RoboMaster</span>
          <span className="ultra-stage-title-cn">赛程模拟总控台</span>
        </div>
        <p className="ultra-stage-lead">
          首页改为赛事中心型总控：先统一进入三赛区资格赛、主淘汰赛和最终排名，再对比争冠集团、赛区深度与出线分档。具体对阵链路仍在赛区画布内展开。
        </p>
        <div className="ultra-stage-actions">
          <Link href={regionHref("east_region", "playoff")} className="ultra-stage-cta">
            进入赛区工作区
          </Link>
          <Link href="/elo-rankings" className="hero-secondary-link">
            查看 Elo 总览
          </Link>
          <span className="ultra-stage-generated">最新数据 {generatedLabel}</span>
        </div>
      </div>

      <aside className="ultra-stage-panel">
        <p className="ultra-stage-panel-kicker">三赛区总入口</p>
        <strong className="ultra-stage-panel-title">直接切入资格赛、主淘汰赛与最终排名</strong>
        <p className="ultra-stage-panel-copy">超宽屏下改用独立顶层渲染，保留赛区入口、头号争冠与席位结构，但不再依赖首屏原始 Hero 容器绘制。</p>
        <div className="ultra-stage-list">
          {regions.map((region) => (
            <article key={region.regionSlug} className="ultra-stage-card">
              <div className="ultra-stage-card-head">
                <div className="ultra-stage-card-title">
                  <span className="ultra-stage-card-region">{region.regionName}</span>
                  <strong>{region.favorite.collegeName}</strong>
                </div>
                <span className="ultra-stage-card-signal">争冠 {pct(region.favorite.probabilities.champion)}</span>
              </div>
              <div className="ultra-stage-card-metrics">
                <span>队伍 {region.teamCount}</span>
                <span>
                  国赛 {region.nationalSlots} / 复活赛 {region.repechageSlots}
                </span>
                <span>头号国赛 {pct(region.favorite.probabilities.national)}</span>
              </div>
              <div className="ultra-stage-links">
                {REGION_QUICK_VIEWS.map((view) => (
                  <Link key={view.id} href={regionHref(region.regionSlug, view.id)} className="ultra-stage-link">
                    {view.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </aside>

      <div className="hero-metric-rail ultra-stage-metrics">
        {heroMetrics.map((metric) => (
          <article key={metric.label} className="hero-metric-segment">
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function RegionCommandCard({ region }: { region: RegionDashboardCard }) {
  return (
    <article className="command-region-card region-command-card">
      <div className="command-region-head">
        <div>
          <p>{region.regionName}</p>
          <h3>{region.favorite.collegeName}</h3>
        </div>
        <Link href={regionHref(region.regionSlug, "playoff")} className="region-enter-link">
          打开画布
        </Link>
      </div>
      <div className="command-region-grid">
        <span>队伍 {region.teamCount}</span>
        <span>国赛 {region.nationalSlots}</span>
        <span>复活赛 {region.repechageSlots}</span>
        <span>Top8 Elo {elo(region.avgTop8Elo)}</span>
      </div>
      <RegionQuickLinks regionSlug={region.regionSlug} />
      <div className="region-summary-block">
        <p>{region.summarySentence}</p>
        <div className="profile-tag-list" aria-label="赛区画像">
          <span className="profile-tag profile-tag-shape">{region.titleShapeTag}</span>
          {region.profileTags.map((tag) => (
            <span key={tag} className="profile-tag">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="command-region-panels">
        <div className="favorite-cluster region-data-cluster region-title-cluster">
          <div className="region-cluster-head">
            <small>争冠格局</small>
            <span className="region-shape-chip">{region.titleShapeTag}</span>
          </div>
          <strong>{region.favorite.collegeName}</strong>
          <p>{region.favorite.teamName}</p>
          <div className="region-data-rows">
            <span>头号争冠 {pct(region.favorite.probabilities.champion)}</span>
            <span>前三份额 {pct(region.top3ChampionShare)}</span>
            <span>头二差值 {pct(region.titleGap)}</span>
          </div>
        </div>
        <div className="favorite-cluster muted region-data-cluster region-lock-cluster">
          <div className="region-cluster-head">
            <small>国赛稳进名单</small>
            <span className="region-race-chip qualified">
              {region.nationalLocks.length > 0 ? `稳进 ${region.nationalLocks.length} 队` : "暂未形成"}
            </span>
          </div>
          <strong>{region.nationalLocks.length > 0 ? `${region.regionName}锁定组` : "名单待定"}</strong>
          <p>
            {region.nationalLocks.length > 0
              ? "这些队伍当前已经基本脱离国赛卡位战，首页直接列出稳进名单。"
              : "当前还没有队伍把国赛资格稳稳握在手里。"}
          </p>
          <LockTeamList teams={region.nationalLocks} />
        </div>
        <div className="favorite-cluster muted region-data-cluster region-race-cluster">
          <div className="region-cluster-head">
            <small>国赛争夺带</small>
            <span className="region-race-chip">
              {region.nationalRace.locksCount > 0 ? `稳进 ${region.nationalRace.locksCount} 队` : "暂无稳进队"}
            </span>
          </div>
          <strong>{region.nationalRace.cutoffTeam?.collegeName ?? "待定"}</strong>
          <p>
            {region.nationalRace.cutoffTeam
              ? `${region.nationalRace.cutoffTeam.teamName} 当前守在最后一张国赛票`
              : "当前还没有稳定的国赛分界。"}
          </p>
          <RaceTeamChips teams={region.nationalRace.chasingTeams} />
          <div className="region-data-rows">
            <span>{holdLabel(region.nationalRace.cutoffProbability)}</span>
            <span>{chaseGapLabel(region.nationalRace.gap)}</span>
          </div>
        </div>
        <div className="favorite-cluster muted region-data-cluster secondary region-race-cluster">
          <div className="region-cluster-head">
            <small>复活赛争夺带</small>
            <span className="region-race-chip secondary">
              {region.repechageRace.locksCount > 0 ? `大概率 ${region.repechageRace.locksCount} 队` : "暂无稳进队"}
            </span>
          </div>
          <strong>{region.repechageRace.cutoffTeam?.collegeName ?? "待定"}</strong>
          <p>
            {region.repechageRace.cutoffTeam
              ? `${region.repechageRace.cutoffTeam.teamName} 当前守在最后一张复活赛票`
              : "当前还没有稳定的复活赛分界。"}
          </p>
          <RaceTeamChips teams={region.repechageRace.chasingTeams} />
          <div className="region-data-rows">
            <span>{holdLabel(region.repechageRace.cutoffProbability)}</span>
            <span>{chaseGapLabel(region.repechageRace.gap)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function FeaturedContender({ team, rank }: { team: OverviewTeam; rank: number }) {
  return (
    <Link href={regionHref(team.regionSlug, "playoff", team.teamKey)} className="contender-feature-card">
      <div className="contender-feature-top">
        <span className="contender-rank">#{rank}</span>
        <span className="contender-region">{team.regionName}</span>
      </div>
      <div className="contender-feature-main">
        <strong>{team.collegeName}</strong>
        <p>{team.teamName}</p>
      </div>
      <div className="contender-feature-metrics">
        <span>争冠 {pct(team.probabilities.champion)}</span>
        <span>国赛 {pct(team.probabilities.national)}</span>
      </div>
    </Link>
  );
}

function ContenderListItem({ team }: { team: OverviewTeam }) {
  return (
    <Link href={regionHref(team.regionSlug, "playoff", team.teamKey)} className="contender-list-item">
      <div className="contender-list-copy">
        <strong>{team.collegeName}</strong>
        <p>
          {team.regionName} / 全球 Elo #{team.eloGlobalRank}
        </p>
      </div>
      <div className="contender-list-metrics">
        <span>争冠 {pct(team.probabilities.champion)}</span>
        <span>国赛 {pct(team.probabilities.national)}</span>
      </div>
    </Link>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, []);

  const dashboard = useMemo(() => (data ? buildOverviewDashboard(data) : null), [data]);
  const featuredContenders = dashboard?.contenders.slice(0, 3) ?? [];
  const contenderQueue = dashboard?.contenders.slice(3) ?? [];

  return (
    <main className="control-home">
      {dashboard ? <UltraWideHeroLayer generatedLabel={dashboard.generatedLabel} heroMetrics={dashboard.heroMetrics} regions={dashboard.regions} /> : null}

      <section className="control-hero home-command-hero">
        <div className="control-hero-copy">
          <p className="hero-eyebrow">RMUC 2026 / Molten Arena</p>
          <p className="hero-side-label">Molten Arena</p>
          <h1>
            <span>RoboMaster</span>
            <span>赛程模拟总控台</span>
          </h1>
          <p className="hero-lead">
            首页改为赛事中心型总控：先统一进入三赛区资格赛、主淘汰赛和最终排名，再对比争冠集团、赛区深度与出线分档。具体对阵链路仍在赛区画布内展开。
          </p>
          <div className="hero-actions">
            <Link href={regionHref("east_region", "playoff")} className="hero-primary-link">
              进入赛区工作区
            </Link>
            <Link href="/elo-rankings" className="hero-secondary-link">
              查看 Elo 总览
            </Link>
            <span className="hero-generated">最新数据 {dashboard?.generatedLabel ?? "载入中"}</span>
          </div>
        </div>

        <aside className="hero-command-panel">
          <div className="hero-command-panel-head">
            <small>三赛区总入口</small>
            <strong>直接切入资格赛、主淘汰赛与最终排名</strong>
            <p>保留赛事中心入口角色，不再用单队预警占据首屏。每张赛区卡固定展示头号争冠、席位结构与快捷跳转。</p>
          </div>
          <div className="hero-command-list">
            {dashboard?.regions.map((region) => (
              <HeroRegionCard key={region.regionSlug} region={region} />
            ))}
          </div>
        </aside>

        <div className="hero-metric-rail">
          {dashboard?.heroMetrics.map((metric) => (
            <article key={metric.label} className="hero-metric-segment">
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>
      </section>

      {error ? <section className="error-panel">接口请求失败：{error}</section> : null}

      {dashboard ? (
        <>
          <OverviewModule
            meta={{
              id: "regions",
              eyebrow: "Region Command",
              title: "赛区快速进入",
              description: "每张卡同时承担入口和赛区画像：在一张卡里讲清争冠格局、国赛争夺带和复活赛争夺带。",
              tone: "cyan",
            }}
          >
            <div className="region-deck">
              {dashboard.regions.map((region) => (
                <RegionCommandCard key={region.regionSlug} region={region} />
              ))}
            </div>
          </OverviewModule>

          <OverviewModule
            meta={{
              id: "contenders",
              eyebrow: "Title Group",
              title: "全局争冠梯队",
              description: "Top3 抬高视觉优先级，4-8 名压缩成列表，仍支持直接跳转到高亮深链。",
              tone: "amber",
            }}
          >
            <div className="contender-board">
              <div className="contender-podium">
                {featuredContenders.map((team, index) => (
                  <FeaturedContender key={team.teamKey} team={team} rank={index + 1} />
                ))}
              </div>
              <div className="contender-queue">
                {contenderQueue.map((team) => (
                  <ContenderListItem key={team.teamKey} team={team} />
                ))}
              </div>
            </div>
          </OverviewModule>

          <OverviewModule
            meta={{
              id: "strength",
              eyebrow: "Strength Matrix",
              title: "赛区强度对比",
              description: "综合评分优先看头部火力与整体深度，争冠格局保留为补充观察，不再使用单一 Top4 Elo + 冠军份额。",
              tone: "steel",
            }}
          >
            <div className="strength-compare-grid">
              {dashboard.regionStrength.map((row) => (
                <article key={row.regionSlug} className="strength-panel">
                  <div className="strength-panel-head">
                    <div>
                      <p>{row.regionName}</p>
                      <strong>综合评分 {row.powerIndex}</strong>
                    </div>
                    <span className="strength-badge">PWR {row.powerIndex}</span>
                  </div>
                  <div className="strength-metric-groups">
                    <section className="strength-group">
                      <h3>头部火力</h3>
                      <div className="strength-group-grid">
                        <span>Top4 Elo {elo(row.top4AverageElo)}</span>
                        <span>Top8 Elo {elo(row.top8AverageElo)}</span>
                      </div>
                    </section>
                    <section className="strength-group">
                      <h3>整体深度</h3>
                      <div className="strength-group-grid">
                        <span>平均 Elo {elo(row.meanElo)}</span>
                        <span>中位数 Elo {elo(row.medianElo)}</span>
                      </div>
                    </section>
                    <section className="strength-group">
                      <h3>争冠格局</h3>
                      <div className="strength-group-grid">
                        <span>Top3 份额 {pct(row.top3ChampionShare)}</span>
                        <span>头二差值 {pct(row.titleGap)}</span>
                      </div>
                    </section>
                  </div>
                </article>
              ))}
            </div>
          </OverviewModule>

          <OverviewModule
            meta={{
              id: "simulation-spec",
              eyebrow: "Simulation Spec",
              title: "模拟口径与赛制总览",
              description: "把首页统计的 Monte Carlo 聚合方式、席位结构和生成时间说清楚，首页更像赛事中心而不是提醒流。",
              tone: "emerald",
            }}
          >
            <div className="simulation-spec-grid">
              {dashboard.regions.map((region) => (
                <article key={region.regionSlug} className="simulation-spec-card">
                  <div className="simulation-spec-head">
                    <strong>{region.regionName}</strong>
                    <span>{region.teamCount} 支队伍</span>
                  </div>
                  <div className="simulation-spec-list">
                    <div>
                      <span>席位结构</span>
                      <strong>
                        国赛 {region.nationalSlots} / 复活赛 {region.repechageSlots}
                      </strong>
                    </div>
                    <div>
                      <span>种子场景</span>
                      <strong>{region.monteCarlo.seedCount} 组</strong>
                    </div>
                    <div>
                      <span>有效迭代</span>
                      <strong>{numberWithComma(region.monteCarlo.effectiveIterations)} 次</strong>
                    </div>
                    <div>
                      <span>聚合方式</span>
                      <strong>{aggregationLabel(region.monteCarlo.aggregationMode)}</strong>
                    </div>
                    <div>
                      <span>最近生成</span>
                      <strong>{dashboard.generatedLabel}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </OverviewModule>
        </>
      ) : (
        <section className="loading-panel">正在组装总控首页…</section>
      )}
    </main>
  );
}
