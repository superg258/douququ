"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getOverview } from "@/lib/api";
import { buildEloRankingsDashboard } from "@/lib/overview-builders";
import { buildRegionHref } from "@/lib/region-config";
import type { EloRankingRow, OverviewResponse, RegionSlug } from "@/lib/types";

function pct(value: number) {
  if (value < 0.001 && value > 0) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

function playoffHref(regionSlug: RegionSlug, highlight?: string) {
  return buildRegionHref(regionSlug, "playoff", { highlight });
}

function MechCard({
  children,
  className = "",
  glowColor = "red",
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: "red" | "blue" | "white";
}) {
  const glowClasses = {
    red: "hover:shadow-[0_0_15px_rgba(230,0,0,0.15)] md:shadow-[0_0_15px_rgba(230,0,0,0.05)] border-rm-red/30",
    blue: "hover:shadow-[0_0_15px_rgba(0,163,255,0.15)] md:shadow-[0_0_15px_rgba(0,163,255,0.05)] border-rm-blue/30",
    white: "hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] border-white/20",
  };

  return (
    <div
      className={`relative bg-rm-metal-panel border border-white/5 p-4 transition-all duration-300 ${glowClasses[glowColor]} ${className}`}
    >
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/20" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/20" />
      {children}
    </div>
  );
}


function getChampionColor(p: number) {
  if (p >= 0.15) return "text-rm-red font-bold drop-shadow-[0_0_5px_rgba(230,0,0,0.8)]";
  if (p >= 0.05) return "text-rm-red font-semibold";
  if (p >= 0.01) return "text-orange-400";
  if (p > 0.001) return "text-white/60";
  return "text-white/20";
}

function getNationalColor(p: number) {
  if (p >= 0.8) return "text-rm-blue font-bold drop-shadow-[0_0_5px_rgba(0,163,255,0.8)]";
  if (p >= 0.4) return "text-rm-blue font-semibold";
  if (p >= 0.1) return "text-cyan-500";
  if (p > 0.001) return "text-white/60";
  return "text-white/20";
}

function getRepechageColor(p: number) {
  if (p >= 0.5) return "text-amber-400 font-bold";
  if (p >= 0.2) return "text-amber-600 font-semibold";
  if (p >= 0.05) return "text-zinc-400";
  if (p > 0.001) return "text-white/60";
  return "text-white/20";
}

function RankingRow({

  regionSlug,
  row,
  globalRank
}: {
  regionSlug: RegionSlug;
  row: EloRankingRow;
  globalRank: number;
}) {
  const hoverColor =
    regionSlug === "south_region"
      ? "hover:bg-rm-red/10 border-white/5 hover:border-rm-red/30"
      : regionSlug === "east_region"
      ? "hover:bg-rm-blue/10 border-white/5 hover:border-rm-blue/30"
      : "hover:bg-white/5 border-white/5 hover:border-white/20";

  return (
    <Link
      href={playoffHref(regionSlug, row.teamKey)}
      className={`group flex flex-col p-2.5 mb-1 bg-[#0a0a0a] border transition-all duration-200 ${hoverColor} ${
        row.rankInRegion <= 4 ? "border-l-2 border-l-rm-red" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center justify-center w-8">
            <span className={`font-mono text-sm font-bold leading-none ${row.rankInRegion <= 4 ? "text-white text-shadow-sm" : "text-rm-metal-text"}`}>
              {row.rankInRegion}
            </span>
            <span className="text-[8px] text-rm-metal-text leading-tight mt-0.5">赛区</span>
          </div>
          <div className="flex flex-col items-center justify-center w-8 border-l border-white/10">
            <span className="font-mono text-sm font-bold text-white leading-none">
              {globalRank}
            </span>
            <span className="text-[8px] text-rm-blue leading-tight mt-0.5">全国</span>
          </div>
          <div className="flex flex-col ml-1">
            <strong className="text-sm text-white group-hover:text-shadow-sm transition-all">{row.collegeName}</strong>
            <small className="text-[10px] text-rm-metal-text uppercase tracking-wider">{row.teamName}</small>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[9px] text-rm-metal-text tracking-widest">ELO战力</span>
          <strong className="text-sm font-mono text-white">{elo(row.mu0)}</strong>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-2">
        <div className="flex flex-col items-center">
          <span className="text-[9px] text-rm-metal-text tracking-widest">复活赛率</span>
          <strong className={`text-xs font-mono mt-0.5 transition-colors ${getRepechageColor(row.repechageProbability)}`}>{pct(row.repechageProbability)}</strong>
        </div>
        <div className="flex flex-col items-center border-l border-white/5">
          <span className="text-[9px] text-rm-metal-text tracking-widest">国赛率</span>
          <strong className={`text-xs font-mono mt-0.5 transition-colors ${getNationalColor(row.nationalProbability)}`}>{pct(row.nationalProbability)}</strong>
        </div>
        <div className="flex flex-col items-center border-l border-white/5">
          <span className="text-[9px] text-rm-metal-text tracking-widest">夺冠率</span>
          <strong className={`text-xs font-mono mt-0.5 transition-colors ${getChampionColor(row.championProbability)}`}>{pct(row.championProbability)}</strong>
        </div>
      </div>
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
  
  const globalRanks = useMemo(() => {
    if (!dashboard) return new Map<string, number>();
    const allTeams = dashboard.sections.flatMap(s => s.rows);
    allTeams.sort((a, b) => b.mu0 - a.mu0);
    const ranks = new Map<string, number>();
    allTeams.forEach((team, index) => ranks.set(team.teamKey, index + 1));
    return ranks;
  }, [dashboard]);

  return (
    <div className="min-h-screen bg-black text-white relative font-sans selection:bg-rm-red/30 pb-20">
      {/* Background scanlines */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-20 mix-blend-overlay"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 1px, #FFF 1px, #FFF 2px)`,
          backgroundSize: "100% 3px",
        }}
      />
      
      {/* Control Header */}
      <header className="relative z-10 border-b border-white/10 bg-[#050505]/90 backdrop-blur-md sticky top-0">
        <div className="max-w-[1600px] mx-auto p-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-rm-metal-text hover:text-white transition-colors group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 group-hover:-translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              <span className="text-xs tracking-widest font-bold uppercase">返回战局大盘</span>
            </Link>
            <div className="h-6 w-px bg-white/10" />
            <h1 className="text-lg font-bold tracking-widest flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-rm-red animate-pulse" />
              <span className="text-glow-red">大区 ELO 平行阵列</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-2 text-rm-metal-text">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-rm-blue animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              {dashboard?.generatedLabel ?? "同步中..."}
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
        
        <div className="mb-8 p-4 border border-white/5 bg-[#121212] relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-white/5 to-transparent pointer-events-none" />
          <p className="text-sm text-rm-metal-text max-w-3xl leading-relaxed relative z-10">
            全景平行分析南部、东部、北部三大赛区的战力分布。纵向对比各赛区争冠梯队的绝对统治力以及晋级全国赛概率。推演数据由 TrueSkill 2 与平行蒙特卡洛引擎进行持续更新。整个页面支持跨赛区直观滚动对比，不再局限独立画幅。
          </p>
        </div>

        {error ? (
          <div className="p-4 bg-rm-red/10 border border-rm-red text-rm-red rounded mb-8 text-sm">
            [错误] 数据链加载失败：{error}
          </div>
        ) : !dashboard ? (
          <div className="flex flex-col items-center justify-center p-20 text-rm-metal-text">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 animate-pulse text-rm-blue mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <p className="tracking-widest uppercase text-xs">正在建立 ELO 并行流连接...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            {dashboard.sections.map((section) => {
              const isSouth = section.regionSlug === "south_region";
              const isEast = section.regionSlug === "east_region";
              const accentColor = isSouth ? "red" : isEast ? "blue" : "white";
              const accentClass = isSouth ? "text-rm-red" : isEast ? "text-rm-blue" : "text-white";
              const borderClass = isSouth ? "border-rm-red/30" : isEast ? "border-rm-blue/30" : "border-white/20";
              const bgFadeClass = isSouth ? "bg-rm-red/5" : isEast ? "bg-rm-blue/5" : "bg-white/5";

              return (
                <MechCard key={section.regionSlug} glowColor={accentColor} className="flex flex-col relative w-full h-auto pb-4">
                  {/* Column Header - Sticky to top inside view when scrolling */}
                  <div className={`p-4 border-b ${borderClass} ${bgFadeClass} mb-4 relative overflow-hidden`}>
                    <div className="absolute right-0 bottom-0 opacity-10">
                      <strong className={`text-6xl font-bold tracking-tighter ${accentClass}`}>{section.regionName.substring(0, 1)}</strong>
                    </div>
                    
                    <h2 className={`text-xl font-bold tracking-widest ${accentClass} mb-1 flex items-center gap-2`}>
                      {section.regionName}
                    </h2>
                    
                    <div className="flex flex-col gap-1 mt-4 relative z-10">
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] text-rm-metal-text tracking-widest">赛区天花板</span>
                        <strong className="text-sm text-white">{section.topTeam?.collegeName ?? "待定"}</strong>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] text-rm-metal-text tracking-widest">八强平均战力</span>
                        <strong className="text-sm font-mono text-white">{elo(section.top8AverageElo)}</strong>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] text-rm-metal-text tracking-widest">赛区队伍集群</span>
                        <strong className="text-sm font-mono text-white">{section.teamCount} 支</strong>
                      </div>
                    </div>
                  </div>

                  {/* Desktop Only / Column Legend */}
                  <div className="flex justify-between px-2 pb-2 text-[10px] tracking-widest text-rm-metal-text font-bold border-b border-white/5 mb-2">
                    <span>排行节点 / 队列档案</span>
                    <span className="text-right">战术评分雷达</span>
                  </div>

                  {/* Roster List - No overflow scroll, just standard rendering */}
                  <div className="flex flex-col">
                    {section.rows.map((row) => (
                      <RankingRow key={row.teamKey} regionSlug={section.regionSlug} row={row} globalRank={globalRanks.get(row.teamKey) ?? 0} />
                    ))}
                  </div>
                </MechCard>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
