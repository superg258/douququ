"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getOverview } from "@/lib/api";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import { buildRegionHref, isRegionRealtimeEnabled } from "@/lib/region-config";
import type { OverviewDashboard, RegionDashboardCard, WorkspaceView, OverviewTeam, RegionSlug, RegionStrengthRow } from "@/lib/types";
import { MechCard } from "@/components/ui/mech-card";
import { cn } from "@/lib/utils";

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

function nationalRaceChipLabel(chasingCount: number) {
  if (chasingCount > 0) {
    return `追赶 ${chasingCount} 队`;
  }
  return "卡位待定";
}

function RegionHeroMetrics({ region }: { region: RegionDashboardCard }) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-6">
      <div className="flex flex-col space-y-1">
        <span className="text-[10px] text-rm-metal-text uppercase tracking-widest font-bold">头号种子</span>
        <span className="text-xl font-machine text-white truncate max-w-full">
          {region.favorite.collegeName}
        </span>
        <span className="text-xs text-rm-blue font-bold font-mono">
          夺冠率 {pct(region.favorite.probabilities.champion)} / ELO {elo(region.favorite.mu0)}
        </span>
      </div>

      <div className="flex flex-col space-y-1 justify-end">
        <span className="text-[10px] text-rm-metal-text uppercase tracking-widest font-bold">战区数据</span>
        <span className="text-xs text-rm-metal-text font-mono">
          总队伍: {region.teamCount} 支
          <br/>
          国赛/复活赛席位: {region.nationalSlots}/{region.repechageSlots}
        </span>
      </div>
    </div>
  );
}

function LockTeamList({ teams }: { teams: OverviewTeam[] }) {
  if (teams.length === 0) {
    return <div className="text-xs text-rm-metal-text/50 font-mono italic">未检测到稳进名单...</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {teams.map((team) => (
        <span key={team.teamKey} className="px-2 py-1 border border-rm-status-safe/30 bg-rm-status-safe/10 text-rm-status-safe text-xs font-bold rounded-sm shadow-[0_0_5px_rgba(0,255,157,0.1)]">
              {team.collegeName}
            </span>
          ))}
        </div>
  );
}

function RaceTeamChips({
  cutoffTeam,
  chasingTeams,
  totalChasingCount,
  cutoffProbability,
  gap,
  locksCount,
  variant = "national",
}: {
  cutoffTeam: OverviewTeam | null;
  chasingTeams: OverviewTeam[];
  totalChasingCount: number;
  cutoffProbability: number;
  gap: number;
  locksCount: number;
  variant?: "national" | "repechage";
}) {
  if (!cutoffTeam) {
    return <div className="text-xs text-rm-metal-text/50 font-mono italic">卡位分析数据不足...</div>;
  }

  const chasingCount = chasingTeams.length;
  const isSafe = cutoffProbability > 0.5 && gap > 0.05 && chasingCount === 0;
  const isRepechage = variant === "repechage";
  const getProb = (team: OverviewTeam) => isRepechage ? team.probabilities.repechage : team.probabilities.national;

  return (
    <div className="space-y-3">
      {/* 守门员 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-rm-metal-dark border border-rm-metal-border p-2 flex items-center justify-between">
          <span className="text-xs font-bold text-white max-w-full">{cutoffTeam.collegeName}</span>
          <div className="flex flex-col items-end">
            <span className={cn("font-machine text-xs", isRepechage ? "text-rm-status-warn" : "text-rm-red")}>
              守位 {pct(getProb(cutoffTeam))}
            </span>
            <span className="font-machine text-[10px] text-rm-metal-text">
              ELO {elo(cutoffTeam.mu0)}
            </span>
          </div>
        </div>
        <div className={cn(
          "w-16 flex items-center justify-center text-[10px] font-bold border py-1 tracking-widest",
          isSafe ? "bg-rm-status-safe/20 border-rm-status-safe text-rm-status-safe" : 
            (isRepechage ? "bg-rm-status-warn/20 border-rm-status-warn text-rm-status-warn animate-pulse" : "bg-rm-red/20 border-rm-red text-rm-red animate-pulse")
        )}>
          {isSafe ? "门槛稳定" : nationalRaceChipLabel(totalChasingCount)}
        </div>
      </div>

      {/* 追兵列表 */}
      {chasingCount > 0 && (
        <div className={cn("space-y-1 mt-2 pl-4 border-l-2 relative", isRepechage ? "border-rm-status-warn/50" : "border-rm-red/50")}>
          <div className={cn("absolute -left-[5px] top-2 bottom-2 w-[2px] opacity-30", isRepechage ? "bg-rm-status-warn" : "bg-rm-red")}></div>
          {chasingTeams.map((team) => (
            <div key={team.teamKey} className="flex items-center justify-between text-[11px]">
              <span className="text-rm-metal-text font-bold text-xs">{team.collegeName}</span>
              <span className={cn("font-machine text-[10px] bg-rm-metal-dark px-1 border border-rm-metal-border", isRepechage ? "text-rm-status-warn" : "text-rm-red")}>
                {pct(getProb(team))}
              </span>
            </div>
          ))}
          {totalChasingCount > 3 && (
            <div className="flex items-center justify-between text-[11px] text-rm-metal-text/50 pl-1 mt-1">
              <span>... 等其余 {totalChasingCount - 3} 支梯队追赶中</span>
            </div>
          )}
          <div className="text-[10px] text-rm-metal-text/60 font-mono mt-1">
            * 领先追兵概率差 {pct(gap)}
          </div>
        </div>
      )}
    </div>
  );
}


function TacticalRosterGrid({ teams }: { teams: OverviewTeam[] }) {
  const sortedTeams = [...teams].sort((a,b) => b.mu0 - a.mu0);
  
  return (
    <div className="flex-1 flex flex-col min-h-[160px] border-t border-rm-metal-border pt-4 px-4 bg-transparent relative z-10 w-full overflow-hidden">
      <div className="flex items-center shrink-0 mb-4">
        <div className="w-1.5 h-1.5 bg-rm-blue animate-pulse mr-2 box-shadow-[0_0_8px_rgba(0,163,255,1)]"></div>
        <h4 className="text-[10px] font-bold text-rm-blue tracking-widest uppercase text-glow-blue">
          战队战力数据矩阵
        </h4>
      </div>
      
      <div className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative pointer-events-auto h-0">
        <table className="w-full text-left border-collapse text-xs whitespace-nowrap select-none">
          <thead className="sticky top-0 bg-rm-metal-panel/90 backdrop-blur z-20 shadow-md">
            <tr className="border-b border-rm-metal-border text-rm-metal-text/80 font-mono text-[9px] uppercase tracking-widest">
              <th className="py-2.5 px-2 font-bold w-4">本区排名</th>
              <th className="py-2.5 px-2 font-bold w-1/3">高校名称</th>
              <th className="py-2.5 px-2 font-bold text-right w-1/4">预计战力(ELO)</th>
              <th className="py-2.5 px-2 font-bold text-center w-1/5">晋级全国赛</th>
              <th className="py-2.5 px-2 font-bold text-center">赛区夺冠</th>
            </tr>
          </thead>
          <tbody className="font-mono divide-y divide-rm-metal-border/30">
            {sortedTeams.map((team, idx) => {
              const isLock = team.probabilities.national >= 0.8;
              const isChasing = team.probabilities.national >= 0.1 && team.probabilities.national < 0.8;
              
              return (
                <tr 
                  key={team.teamKey} 
                  className={cn(
                    "hover:bg-rm-blue/10 transition-colors group/row cursor-default",
                    isLock ? "text-rm-status-safe" : isChasing ? "text-rm-status-warn focus:text-rm-status-warn" : "text-rm-metal-text/50"
                  )}
                >
                  <td className="py-2 px-2 text-[10px] opacity-70 group-hover/row:opacity-100 group-hover/row:text-white transition-opacity">{idx + 1}</td>
                  <td className="py-2 px-2 font-bold font-sans tracking-wide group-hover/row:text-white transition-colors">{team.collegeName}</td>
                  <td className="py-2 px-2 text-right">
                    <span className="font-machine tracking-widest bg-rm-metal-dark px-1.5 py-0.5 border border-rm-metal-border/50 rounded-sm">
                      {elo(team.mu0)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <div className="w-full max-w-[48px] h-1.5 bg-rm-metal-dark mx-auto overflow-hidden relative border border-rm-metal-border/50">
                       <div className="absolute top-0 left-0 bottom-0 bg-current transition-all" style={{ width: pct(team.probabilities.national) }}></div>
                    </div>
                    <div className="text-[9px] mt-1 font-machine tracking-widest group-hover/row:text-glow transition-all">{pct(team.probabilities.national)}</div>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className={cn("text-[9px] font-machine tracking-widest", team.probabilities.champion > 0.05 ? "text-glow-blue text-rm-blue" : "")}>
                      {pct(team.probabilities.champion)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegionCard({ region }: { region: RegionDashboardCard }) {
  const isLive = region.monteCarlo.effectiveIterations > 0;
  const realtimeEnabled = isRegionRealtimeEnabled(region.regionSlug);
  const realtimeBadge = realtimeEnabled ? "已接入" : "待接入";
  const realtimeHint = "当前模块尚未接入真实赛中数据；此处为真实信息入口预留位，不属于赛程模拟内容。";
  
  return (
    <MechCard 
      label={`${region.regionName} / 大数据推演结果`}
      className={cn(
        "flex h-full flex-col group overflow-hidden",
        isLive ? "hover:border-rm-red/50 hover:shadow-[0_0_20px_rgba(255,42,42,0.15)] transition-all" : "opacity-60"
      )}
    >
      <div className="grid shrink-0 gap-4 mb-6 [grid-template-rows:minmax(128px,auto)_auto_auto_minmax(86px,auto)_minmax(72px,auto)_minmax(150px,auto)_minmax(150px,auto)]">
        <div
          className={cn(
            "bg-gradient-to-r via-rm-metal-dark px-3 py-2.5 text-white",
            realtimeEnabled
              ? "border border-rm-status-safe/45 from-rm-status-safe/20 to-rm-blue/20"
              : "border border-rm-status-warn/45 from-rm-status-warn/20 to-rm-blue/20",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-rm-metal-text">实时数据入口</span>
              <span className="truncate text-sm font-bold tracking-wide">实时胜率信息</span>
            </div>
            <span
              className={cn(
                "shrink-0 border px-2 py-1 text-[10px] font-bold uppercase tracking-widest",
                realtimeEnabled
                  ? "border-rm-status-safe/60 bg-rm-status-safe/15 text-rm-status-safe"
                  : "border-rm-status-warn/60 bg-rm-status-warn/15 text-rm-status-warn",
              )}
            >
              {realtimeBadge}
            </span>
          </div>
          <p className="mt-2 text-[10px] font-mono text-rm-metal-text leading-relaxed">
            {realtimeHint}
          </p>
        </div>

        <div className="flex items-center justify-between border-b-2 border-rm-metal-border pb-2">
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              isLive ? "bg-rm-status-safe animate-pulse" : "bg-rm-status-dead"
            )}/>
            <span className="font-mono text-xs text-rm-metal-text tracking-wider uppercase">
              {isLive ? `推演种子点: ${region.monteCarlo.seeds[0] || 0}` : "等待推演源数据注入"}
            </span>
          </div>
          <span className="font-mono text-[10px] text-rm-metal-text/60">
            {isLive ? `${region.monteCarlo.effectiveIterations.toLocaleString("en-US")} 场平行赛程验证` : "推演集群离线"}
          </span>
        </div>

        <RegionHeroMetrics region={region} />
        
        <div className="p-3 bg-rm-metal-dark/50 border-l-2 border-rm-blue/50 text-[11px] text-rm-metal-text leading-relaxed font-mono">
          <p className="text-white/90 mb-2 font-sans tracking-wide">
            {region.summarySentence}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {region.profileTags.map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-rm-metal-panel/80 border border-rm-metal-border text-[9px] text-rm-blue tracking-widest break-all">
                {tag}
              </span>
            ))}
          </div>
        </div>
        
        <div>
          <h4 className="text-[10px] font-bold text-rm-metal-text tracking-widest uppercase mb-2 flex items-center">
            <span className="w-1 h-3 bg-rm-status-safe mr-2"></span>稳进国赛阵容
          </h4>
          <LockTeamList teams={region.nationalLocks} />
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-rm-metal-text tracking-widest uppercase mb-2 flex items-center">
            <span className="w-1 h-3 bg-rm-red mr-2"></span>国赛焦点卡位战圈
          </h4>
          <RaceTeamChips {...region.nationalRace} />
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-rm-metal-text tracking-widest uppercase mb-2 flex items-center">
            <span className="w-1 h-3 bg-rm-status-warn mr-2"></span>复活赛焦点卡位战圈
          </h4>
          <RaceTeamChips {...region.repechageRace} variant="repechage" />
        </div>
      </div>

      <div className="flex bg-rm-metal-dark/20 flex-col h-[400px] shrink-0 -mx-4 -mb-4 mt-auto">
        <TacticalRosterGrid teams={region.teams} />
        {isLive && (
          <div className="shrink-0 border-t border-rm-metal-border pt-4 px-4 pb-4 flex justify-between gap-2 overflow-x-auto no-scrollbar bg-transparent relative z-20 pointer-events-auto">
            {REGION_QUICK_VIEWS.map((view) => (
              <Link 
                key={view.id} 
                href={buildRegionHref(region.regionSlug, view.id)}
                className="flex-none px-3 py-1.5 bg-rm-metal-dark border border-rm-metal-border text-xs font-bold text-rm-metal-text hover:text-rm-blue hover:border-rm-blue/50 transition-colors whitespace-nowrap"
              >
                {view.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </MechCard>
  );
}


function SystemBrief() {
  return (
    <MechCard label="系统简报 / 赛区监控网络简报" className="mb-6">
      <div className="text-sm font-mono text-rm-metal-text leading-relaxed space-y-2">
        <p className="text-white"><span className="text-rm-blue font-bold mr-2">{'>'}</span>欢迎访问 RMUC 2026 全局赛区监控网络。</p>
        <p><span className="text-rm-metal-text/50 mr-2">{'>'}</span>这里展示基于 TrueSkill 2 算法与 Monte Carlo 蒙特卡洛预测模型推演的各赛区战局与晋级态势。</p>
        <p><span className="text-rm-metal-text/50 mr-2">{'>'}</span>全方位分析各个赛区的「资格赛」、「主淘汰赛」分流走向，实时呈现重点梯队夺冠预测及各赛区战力指数评估。</p>
        <p><span className="text-rm-blue/80 font-bold tracking-widest text-xs uppercase animate-pulse">{">>>"} 系统数据同步完成</span></p>
      </div>
    </MechCard>
  );
}

function GlobalContenders({ contenders }: { contenders: OverviewTeam[] }) {
  if (!contenders || contenders.length === 0) return null;
  
  return (
    <MechCard label="全国总决赛夺冠形势预测梯队" className="mt-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contenders.map((team, idx) => (
          <div key={team.teamKey} className="bg-rm-metal-dark border border-rm-metal-border p-4 flex flex-col group hover:border-rm-blue/50 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 w-8 h-8 bg-rm-blue/10 transform rotate-45 translate-x-4 -translate-y-4 group-hover:bg-rm-blue/30 transition-colors" />
            <div className="text-[10px] text-rm-metal-text font-bold mb-1 flex items-center justify-between">
              <span className={cn(idx < 4 ? "text-rm-status-safe" : "")}>
                {idx < 4 ? "第一梯队" : idx < 8 ? "第二梯队" : "第三梯队"} / 全国排名 {idx + 1}
              </span>
              <span className="text-rm-blue text-right ml-2 truncate max-w-[80px]">{team.regionName}</span>
            </div>
            <div className="text-lg font-bold text-white font-sans mt-1 mb-2 truncate group-hover:text-glow-white transition-all">
              {team.collegeName}
            </div>
            <div className="flex justify-between items-end mt-auto pt-2 border-t border-rm-metal-border/50">
              <div className="flex flex-col">
                <span className="text-[9px] text-rm-metal-text tracking-widest">综述战力得分</span>
                <span className="text-sm font-machine text-white">{elo(team.mu0)}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] text-rm-metal-text tracking-widest">总决赛问鼎率</span>
                <span className={cn("text-sm font-machine", team.probabilities.champion > 0.1 ? "text-rm-blue text-glow-blue" : "text-white")}>
                  {pct(team.probabilities.champion)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MechCard>
  );
}

function RegionComparison({ strengths }: { strengths: RegionStrengthRow[] }) {
  if (!strengths || strengths.length === 0) return null;
  
  return (
    <MechCard label="各赛区整体战备实力对比" className="mt-8 overflow-hidden">
      <div className="overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
          <thead className="bg-rm-metal-panel/50">
            <tr className="border-b flex-nowrap border-rm-metal-border text-rm-metal-text font-mono text-[10px] uppercase tracking-widest">
              <th className="py-3 px-3 font-bold">赛区分布</th>
              <th className="py-3 px-3 font-bold text-right">赛区强度</th>
              <th className="py-3 px-3 font-bold text-right">四强平均战力</th>
              <th className="py-3 px-3 font-bold text-right">八强平均战力</th>
              <th className="py-3 px-3 font-bold text-right">中下游平均底线</th>
              <th className="py-3 px-3 font-bold text-right">头号种子独裁率</th>
            </tr>
          </thead>
          <tbody className="font-mono divide-y divide-rm-metal-border/50">
            {strengths.map((row) => (
              <tr key={row.regionSlug} className="hover:bg-rm-blue/5 transition-colors group cursor-default">
                <td className="py-3 px-3 font-bold font-sans text-white text-sm">{row.regionName}</td>
                <td className="py-3 px-3 text-right">
                  <span className="text-rm-blue font-bold group-hover:text-glow-blue transition-all">
                    {row.powerIndex.toFixed(1)}
                  </span>
                </td>
                <td className="py-3 px-3 text-right text-white/90">{elo(row.top4AverageElo)}</td>
                <td className="py-3 px-3 text-right text-white/70">{elo(row.top8AverageElo)}</td>
                <td className="py-3 px-3 text-right text-rm-metal-text">{elo(row.medianElo)}</td>
                <td className="py-3 px-3 text-right">
                  <span className="font-machine tracking-widest border border-rm-metal-border bg-rm-metal-dark px-2 py-0.5 group-hover:border-rm-blue/50 transition-colors">
                    {pct(row.favoriteChampionProbability)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MechCard>
  );
}

export function OverviewPage() {
  const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    getOverview()
      .then((res) => {
        if (!canceled) {
          setDashboard(buildOverviewDashboard(res));
        }
      })
      .catch((err) => {
        if (!canceled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="text-rm-red p-4 border border-rm-red bg-rm-red-dim font-mono">
        FATAL ERROR: {error}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex flex-col items-center justify-center p-20 animate-pulse">
        <div className="w-8 h-8 border-4 border-rm-blue border-t-transparent rounded-full animate-spin mb-4"></div>
        <span className="font-machine text-rm-blue tracking-widest uppercase text-xs">
          正在接入战区预测引擎节点...
        </span>
      </div>
    );
  }


  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex items-end justify-between border-b-2 border-transparent pb-4 relative">
        <div className="absolute bottom-0 left-0 right-1/2 h-[2px] bg-gradient-to-r from-transparent to-rm-red shadow-[0_0_10px_rgba(255,42,42,0.8)]" />
        <div className="absolute bottom-0 right-0 left-1/2 h-[2px] bg-gradient-to-l from-transparent to-rm-blue shadow-[0_0_10px_rgba(0,229,255,0.8)]" />
        
        <h2 className="text-3xl font-black uppercase tracking-widest text-white flex items-center group">
           RoboMaster 胜率预测总控台 
           <span className="ml-4 flex gap-1">
             <span className="w-3 h-3 bg-rm-red skew-x-[-15deg] box-shadow-[0_0_8px_rgba(255,42,42,0.8)]"></span>
             <span className="w-3 h-3 bg-rm-blue skew-x-[15deg] box-shadow-[0_0_8px_rgba(0,229,255,0.8)]"></span>
           </span>
        </h2>
        
        <div className="flex items-center gap-4 hidden sm:flex bg-rm-metal-dark px-3 py-1 border border-rm-metal-border/50">
          <span className="flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-rm-status-safe opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rm-status-safe"></span>
          </span>
          <span className="font-mono text-[10px] text-rm-metal-text uppercase tracking-widest text-glow">
            {dashboard.generatedLabel} / 系统运转正常
          </span>
        </div>
      </div>

      <SystemBrief />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dashboard.regions.map((region) => (
          <RegionCard key={region.regionSlug} region={region} />
        ))}
      </div>

      <GlobalContenders contenders={dashboard.contenders} />
      
      <RegionComparison strengths={dashboard.regionStrength} />
      
      <div className="text-center font-mono text-[9px] text-rm-metal-text/40 pt-4 pb-12 tracking-widest">
        RoboMaster 2026 机甲大师区域赛战术测算系统 / 引擎核心：基于对战历史的 TrueSkill 2 与全分组平行蒙特卡洛预测方案 //
      </div>
    </div>
  );
}
