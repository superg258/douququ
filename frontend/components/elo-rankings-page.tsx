"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OverviewModule } from "@/components/overview-module";
import { getOverview } from "@/lib/api";
import { buildEloRankingsDashboard } from "@/lib/overview-builders";
import { buildRegionHref } from "@/lib/region-config";
import type { EloRankingRow, OverviewResponse, RegionSlug } from "@/lib/types";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

function playoffHref(regionSlug: RegionSlug, highlight?: string) {
  return buildRegionHref(regionSlug, "playoff", { highlight });
}

function regionTone(regionSlug: RegionSlug) {
  switch (regionSlug) {
    case "south_region":
      return "amber";
    case "east_region":
      return "cyan";
    default:
      return "steel";
  }
}

function RankingRow({
  regionSlug,
  row,
}: {
  regionSlug: RegionSlug;
  row: EloRankingRow;
}) {
  return (
    <Link href={playoffHref(regionSlug, row.teamKey)} className={`elo-team-row${row.rankInRegion <= 4 ? " is-elite" : ""}`}>
      <span className="elo-team-rank">#{row.rankInRegion}</span>
      <span className="elo-team-main">
        <strong>{row.collegeName}</strong>
        <small>{row.teamName}</small>
      </span>
      <span className="elo-team-metrics">
        <span className="elo-team-stat">
          <small>Elo</small>
          <strong>{elo(row.mu0)}</strong>
        </span>
        <span className="elo-team-stat">
          <small>复</small>
          <strong>{pct(row.repechageProbability)}</strong>
        </span>
        <span className="elo-team-stat">
          <small>国</small>
          <strong>{pct(row.nationalProbability)}</strong>
        </span>
        <span className="elo-team-stat">
          <small>冠</small>
          <strong>{pct(row.championProbability)}</strong>
        </span>
      </span>
    </Link>
  );
}

export function EloRankingsPage() {
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

  const dashboard = useMemo(() => (data ? buildEloRankingsDashboard(data) : null), [data]);

  return (
    <main className="control-home elo-rankings-page">
      <section className="control-hero elo-rankings-hero">
        <div className="control-hero-copy">
          <p className="hero-eyebrow">Elo Rankings / Region Control</p>
          <h1 className="elo-rankings-title">
            <span>赛区 Elo</span>
            <span>并列总览</span>
          </h1>
          <p className="hero-lead">
            桌面端把南部、东部、北部三赛区并排放在同一视野里；每支队伍只保留排名、学校、队名和四项关键指标，减少翻页和来回扫视成本。
          </p>
          <div className="hero-actions">
            <Link href="/" className="hero-primary-link">
              返回总控首页
            </Link>
            <span className="hero-generated">最新数据 {dashboard?.generatedLabel ?? "载入中"}</span>
          </div>
        </div>

        <aside className="hero-command-panel elo-rankings-panel">
          <div className="hero-command-panel-head">
            <small>三赛区总览</small>
            <strong>先看头号 Elo，再直接落到并列榜单</strong>
            <p>桌面端三列同步对照，移动端按南部、东部、北部顺序压缩堆叠。每队点击后仍会跳到对应赛区主淘汰赛。</p>
          </div>
          <div className="elo-rankings-rail">
            {dashboard?.sections.map((section) => (
              <article key={section.regionSlug} className={`elo-brief-card tone-${regionTone(section.regionSlug)}`}>
                <div className="elo-brief-head">
                  <div>
                    <p>{section.regionName}</p>
                    <strong>{section.topTeam?.collegeName ?? "待生成"}</strong>
                  </div>
                  <span>Top8 {elo(section.top8AverageElo)}</span>
                </div>
                <div className="elo-brief-metrics">
                  <span>队伍 {section.teamCount}</span>
                  <span>头号 Elo {section.topTeam ? elo(section.topTeam.mu0) : "--"}</span>
                  <span>头号国赛 {section.topTeam ? pct(section.topTeam.probabilities.national) : "--"}</span>
                </div>
                <div className="elo-brief-links">
                  <a href={`#${section.regionSlug}`} className="region-view-link">
                    查看本列
                  </a>
                  <Link href={playoffHref(section.regionSlug)} className="region-view-link">
                    打开赛区
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      {error ? <section className="error-panel">接口请求失败：{error}</section> : null}

      {dashboard ? (
        <OverviewModule
          meta={{
            id: "elo-parallel-board",
            eyebrow: "Parallel Region Board",
            title: "三赛区并列 Elo 榜单",
            description: "桌面端三列并排；移动端顺序堆叠。每行压缩成排名、队伍和四项关键指标，优先减少无效留白和滚动长度。",
            tone: "steel",
          }}
        >
          <div className="elo-region-grid">
            {dashboard.sections.map((section) => (
              <section key={section.regionSlug} id={section.regionSlug} className={`elo-region-column tone-${regionTone(section.regionSlug)}`}>
                <div className="elo-region-column-head">
                  <div className="elo-region-column-title">
                    <p>{section.regionName}</p>
                    <h3>{section.topTeam?.collegeName ?? "待生成"}</h3>
                    <span>头号 Elo {section.topTeam ? elo(section.topTeam.mu0) : "--"}</span>
                  </div>
                  <Link href={playoffHref(section.regionSlug)} className="elo-region-entry">
                    主淘汰赛
                  </Link>
                </div>

                <div className="elo-region-summary">
                  <span>队伍 {section.teamCount}</span>
                  <span>Top8 {elo(section.top8AverageElo)}</span>
                  <span>头号复活赛 {section.topTeam ? pct(section.topTeam.probabilities.repechage) : "--"}</span>
                  <span>头号国赛 {section.topTeam ? pct(section.topTeam.probabilities.national) : "--"}</span>
                </div>

                <div className="elo-region-list">
                  {section.rows.map((row) => (
                    <RankingRow key={row.teamKey} regionSlug={section.regionSlug} row={row} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </OverviewModule>
      ) : (
        <section className="loading-panel">正在汇总三赛区 Elo 排名…</section>
      )}
    </main>
  );
}
