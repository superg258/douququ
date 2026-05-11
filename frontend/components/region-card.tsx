// frontend/components/region-card.tsx
import { useState } from "react";
import Link from "next/link";
import type { OverviewTeam, RegionDashboardCard } from "@/lib/types";
import { buildRegionHref } from "@/lib/region-config";
import { buildTeamHref } from "@/lib/team-profile";
import { deriveRealtimeAvailability } from "@/lib/realtime";
import { getRepechageRaceProbability } from "@/lib/overview-builders";
import { cn } from "@/lib/utils";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

function displayElo(team: Pick<OverviewTeam, "mu0" | "currentElo">) {
  return team.currentElo ?? team.mu0;
}


const REGION_ACCENT: Record<string, { bar: string; glow: string; link: string; btnHover: string }> = {
  south_region: {
    bar: "bg-gradient-to-r from-rm-red/80 via-rm-red/40 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(232,48,42,0.06)]",
    link: "text-rm-red",
    btnHover: "group-hover:shadow-[0_0_16px_rgba(232,48,42,0.25)]",
  },
  east_region: {
    bar: "bg-gradient-to-r from-rm-blue/80 via-rm-blue/40 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(42,159,255,0.06)]",
    link: "text-rm-blue",
    btnHover: "group-hover:shadow-[0_0_16px_rgba(42,159,255,0.25)]",
  },
  north_region: {
    bar: "bg-gradient-to-r from-rm-violet/70 via-rm-violet/30 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(139,92,246,0.06)]",
    link: "text-rm-violet",
    btnHover: "group-hover:shadow-[0_0_16px_rgba(139,92,246,0.2)]",
  },
};

/* ─── 稳进国赛标签 ─── */
function LockedTeamBadge({ team }: { team: OverviewTeam }) {
  return (
    <Link href={buildTeamHref(team.teamKey)} className="inline-flex items-center gap-1.5 px-2 py-1 border border-rm-status-safe/30
                     bg-rm-status-safe/10 text-rm-status-safe text-xs font-bold rounded-sm
                     shadow-[0_0_5px_rgba(0,255,157,0.1)]
                     hover:border-rm-status-safe/50 hover:bg-rm-status-safe/15 transition-all duration-200">
      {team.collegeName}
      <span className="font-mono text-[10px] text-rm-status-confirmed font-semibold">
        {pct(team.probabilities.national)}
      </span>
    </Link>
  );
}

/* ─── 卡位战圈 ─── */
function RaceBattle({
  cutoffTeam,
  chasingTeams,
  totalChasingCount,
  cutoffProbability,
  getProb,
  colorClass,
}: {
  cutoffTeam: OverviewTeam | null;
  chasingTeams: OverviewTeam[];
  totalChasingCount: number;
  cutoffProbability: number;
  getProb: (team: OverviewTeam) => number;
  colorClass: { border: string; bg: string; text: string; badge: string; line: string };
}) {
  if (!cutoffTeam) {
    return (
      <div className="text-[10px] text-rm-metal-textFaint/60 font-mono italic">
        卡位分析数据不足...
      </div>
    );
  }

  const chasingCount = chasingTeams.length;
  const isStable = cutoffProbability > 0.5 && chasingCount === 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      {/* 守门员行 */}
      <div className="flex items-center gap-3">
        <Link href={buildTeamHref(cutoffTeam.teamKey)} className={cn("flex-1 flex items-center justify-between border px-3 py-2 transition-colors duration-150",
          colorClass.bg, colorClass.border,
        )}>
          <span className="text-sm font-black text-rm-metal-textLight">
            {cutoffTeam.collegeName}
          </span>
          <div className="flex items-center gap-3">
            <span className={cn("font-mono text-[10px] font-semibold", colorClass.text)}>
              守位 {pct(cutoffProbability)}
            </span>
            <span className="font-mono text-[10px] text-rm-metal-textFaint">
              Elo {elo(displayElo(cutoffTeam))}
            </span>
          </div>
        </Link>
        <span className={cn(
          "w-20 text-center text-[9px] font-bold py-1.5 tracking-widest border shrink-0",
          isStable
            ? "border-rm-metal-border bg-rm-metal-dark/10 text-rm-metal-textMuted"
            : cn(colorClass.badge, "animate-pulse-slow"),
        )}>
          {isStable ? "稳固" : `共 追赶${totalChasingCount}队`}
        </span>
      </div>

      {/* 追兵列表 */}
      {chasingCount > 0 && (
        <div className={cn("pl-3 border-l-2 space-y-1.5", colorClass.line)}>
          {chasingTeams.slice(0, 3).map((team) => (
            <Link key={team.teamKey} href={buildTeamHref(team.teamKey)} className="flex items-center justify-between text-[11px] hover:text-white">
              <span className="text-rm-metal-textLight font-semibold">{team.collegeName}</span>
              <span className={cn("font-mono font-medium", colorClass.text)}>
                {pct(getProb(team))}
              </span>
            </Link>
          ))}
          {totalChasingCount > 3 && (
            <>
              {expanded && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
                  {chasingTeams.slice(3).map((team) => (
                    <Link key={team.teamKey} href={buildTeamHref(team.teamKey)} className="flex items-center justify-between text-[11px] hover:text-white">
                      <span className="text-rm-metal-textLight font-semibold">{team.collegeName}</span>
                      <span className={cn("font-mono font-medium", colorClass.text)}>
                        {pct(getProb(team))}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[9px] text-rm-metal-textFaint/60 hover:text-rm-metal-textFaint transition-colors duration-150 cursor-pointer"
              >
                {expanded ? "收起" : `... 等 ${totalChasingCount - 3} 支队伍`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 战力矩阵 ─── */
function CompactRosterTable({ teams, regionSlug }: { teams: OverviewTeam[]; regionSlug: string }) {
  const sorted = [...teams].sort((a, b) => displayElo(b) - displayElo(a));

  const barColor =
    regionSlug === "south_region" ? "bg-rm-red/50 shadow-[0_0_6px_rgba(232,48,42,0.3)]" :
    regionSlug === "east_region" ? "bg-rm-blue/50 shadow-[0_0_6px_rgba(42,159,255,0.3)]" :
    "bg-rm-violet/50 shadow-[0_0_6px_rgba(139,92,246,0.3)]";

  const eloColor =
    regionSlug === "south_region" ? "text-rm-red/80" :
    regionSlug === "east_region" ? "text-rm-blue/80" : "text-rm-violet/80";

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-1 h-3", barColor)} />
        <span className="text-[9px] font-bold text-rm-metal-textLight tracking-widest uppercase">
          战力矩阵
        </span>
        <span className="text-[8px] text-rm-metal-textFaint/50 ml-auto">
          共 {sorted.length} 支 · 滚动查看
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto pr-1 border-y border-rm-metal-border/40">
        <table className="w-full text-[10px] border-collapse table-fixed">
          <thead className="sticky top-0 z-10 bg-rm-metal-dark/95 backdrop-blur">
            <tr className="border-b border-rm-metal-border text-rm-metal-textFaint text-[8px] uppercase tracking-widest">
              <td className="py-1.5 w-6">#</td>
              <td className="py-1.5">高校</td>
              <td className="py-1.5 text-right w-14">Elo</td>
              <td className="py-1.5 text-center w-14">国赛</td>
              <td className="py-1.5 text-center w-12">夺冠</td>
            </tr>
          </thead>
          <tbody className="font-mono divide-y divide-rm-metal-border/30">
            {sorted.map((team, idx) => {
              const isTop = idx < 2;
              const currentElo = displayElo(team);
              return (
                <tr
                  key={team.teamKey}
                  className={cn(
                    "hover:bg-rm-metal-panel/50 transition-colors",
                    isTop ? "text-rm-metal-textLight font-semibold" : "text-rm-metal-textMuted",
                  )}
                >
                  <td className="py-1.5 text-rm-metal-textFaint">{idx + 1}</td>
                  <td className="py-1.5 pr-2 font-sans text-[11px] leading-snug break-words">{team.collegeName}</td>
                  <td className={cn("py-1.5 text-right tracking-tight font-semibold", eloColor)}>{elo(currentElo)}</td>
                  <td className="py-1.5 text-center">{pct(team.probabilities.national)}</td>
                  <td className="py-1.5 text-center">{pct(team.probabilities.champion)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   RegionCard
   ══════════════════════════════════════════ */
export function RegionCard({ region, entryHref }: { region: RegionDashboardCard; entryHref: string | null }) {
  const realtimeAvailability = deriveRealtimeAvailability(region.regionSlug, region.liveStatus);
  const realtimeEnabled = realtimeAvailability.enabled;
  const fallbackMode = realtimeEnabled ? "live" : "sim";
  const fallbackHref = buildRegionHref(region.regionSlug, realtimeEnabled ? "qualification" : "playoff", { mode: fallbackMode });
  const accent = REGION_ACCENT[region.regionSlug] ?? REGION_ACCENT.north_region;

  return (
    <div className={cn(
      "group/card flex flex-col lg:grid lg:grid-rows-subgrid lg:row-span-8 relative",
      "bg-rm-metal-card border border-rm-metal-border overflow-hidden",
      "hover:border-rm-metal-textMuted/30 transition-all duration-300",
      accent.glow,
      accent.btnHover,
    )}>
      {/* ── 赛区色顶部条 ── */}
      <div className={cn("absolute top-0 left-0 right-0 h-0.5 z-10", accent.bar)} />

      {/* ═══ 1. 实时/模拟入口面板 ═══ */}
      <Link
        href={entryHref ?? fallbackHref}
        className={cn(
          "block px-4 py-4 border-b-2 border-rm-metal-border transition-all duration-300 group/entry min-h-[138px] relative overflow-hidden",
          "border-l-2",
          // Per-region gradient: brighter, more saturated colors
          region.regionSlug === "south_region"
            ? (realtimeEnabled
                ? "bg-[linear-gradient(135deg,rgba(232,48,42,0.22),rgba(28,28,31,0.2),rgba(232,196,74,0.18))] hover:bg-[linear-gradient(135deg,rgba(232,48,42,0.32),rgba(22,22,26,0.25),rgba(232,196,74,0.28))]"
                : "bg-[linear-gradient(135deg,rgba(232,48,42,0.20),rgba(28,28,31,0.2),rgba(45,212,191,0.16))] hover:bg-[linear-gradient(135deg,rgba(232,48,42,0.30),rgba(22,22,26,0.25),rgba(45,212,191,0.26))]")
            : region.regionSlug === "east_region"
            ? (realtimeEnabled
                ? "bg-[linear-gradient(135deg,rgba(42,159,255,0.22),rgba(28,28,31,0.2),rgba(232,196,74,0.18))] hover:bg-[linear-gradient(135deg,rgba(42,159,255,0.32),rgba(22,22,26,0.25),rgba(232,196,74,0.28))]"
                : "bg-[linear-gradient(135deg,rgba(42,159,255,0.20),rgba(28,28,31,0.2),rgba(45,212,191,0.16))] hover:bg-[linear-gradient(135deg,rgba(42,159,255,0.30),rgba(22,22,26,0.25),rgba(45,212,191,0.26))]")
            : (realtimeEnabled
                ? "bg-[linear-gradient(135deg,rgba(139,92,246,0.22),rgba(28,28,31,0.2),rgba(232,196,74,0.18))] hover:bg-[linear-gradient(135deg,rgba(139,92,246,0.32),rgba(22,22,26,0.25),rgba(232,196,74,0.28))]"
                : "bg-[linear-gradient(135deg,rgba(139,92,246,0.20),rgba(28,28,31,0.2),rgba(45,212,191,0.16))] hover:bg-[linear-gradient(135deg,rgba(139,92,246,0.30),rgba(22,22,26,0.25),rgba(45,212,191,0.26))]"),
          region.regionSlug === "south_region" ? "border-l-rm-red/60" :
          region.regionSlug === "east_region" ? "border-l-rm-blue/60" : "border-l-rm-violet/60",
        )}
      >
        {/* Diagonal sheen decoration */}
        <div className="absolute -top-6 -right-6 w-16 h-16 bg-gradient-to-bl from-white/[0.04] to-transparent rotate-45 pointer-events-none
                        group-hover/entry:from-white/[0.08] transition-all duration-500" />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-rm-metal-textFaint">
              赛程入口 · {realtimeEnabled ? "实时模式" : "模拟沙盘"}
            </span>
            <span className="block truncate text-sm font-bold tracking-wide text-rm-metal-textLight mt-0.5">
              {realtimeEnabled ? "实时赛程" : "赛程沙盘"}
            </span>
          </div>
          <span className={cn(
            "shrink-0 border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest transition-all duration-200",
            realtimeEnabled
              ? "border-rm-status-confirmed/60 bg-rm-status-confirmed/15 text-rm-status-confirmed shadow-[0_0_8px_rgba(0,232,120,0.1)]"
              : "border-rm-metal-border bg-rm-metal-dark/10 text-rm-metal-textMuted",
          )}>
            {realtimeAvailability.badge}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-rm-metal-textMuted">
          {realtimeEnabled
            ? "官方赛果已接入，Elo 战力预测与观众投票并列展示。"
            : "官方赛程尚未接入，当前入口为模拟赛程。"}
        </p>
        <div className="mt-2.5 flex items-start gap-2 text-[8px] font-mono font-bold tracking-widest">
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            <span className="border border-rm-status-confirmed/30 bg-rm-status-confirmed/8 text-rm-status-confirmed/80 px-1.5 py-0.5
                            group-hover/entry:border-rm-status-confirmed/50 group-hover/entry:bg-rm-status-confirmed/15 group-hover/entry:text-rm-status-confirmed transition-all duration-200">
              官方赛程
            </span>
            <span className="border border-rm-blue/30 bg-rm-blue/8 text-rm-blue/80 px-1.5 py-0.5
                            group-hover/entry:border-rm-blue/50 group-hover/entry:bg-rm-blue/15 group-hover/entry:text-rm-blue transition-all duration-200">
              Elo 预测
            </span>
            <span className="border border-rm-status-pending/30 bg-rm-status-pending/8 text-rm-status-pending/80 px-1.5 py-0.5
                            group-hover/entry:border-rm-status-pending/50 group-hover/entry:bg-rm-status-pending/15 group-hover/entry:text-rm-status-pending transition-all duration-200">
              王牌预言家
            </span>
          </div>
          <span className={cn(
            "shrink-0 border px-2.5 py-1 text-[9px] transition-all duration-300 font-bold tracking-widest whitespace-nowrap",
            realtimeEnabled
              ? "shadow-[0_0_10px_rgba(232,196,74,0.2)] border-[#E8C44A]/60 bg-[#E8C44A]/15 text-[#E8C44A] group-hover/entry:bg-[#E8C44A] group-hover/entry:text-black group-hover/entry:shadow-[0_0_18px_rgba(232,196,74,0.4)]"
              : "shadow-[0_0_10px_rgba(45,212,191,0.18)] border-[#2DD4BF]/50 bg-[#2DD4BF]/12 text-[#2DD4BF] group-hover/entry:bg-[#2DD4BF] group-hover/entry:text-black group-hover/entry:shadow-[0_0_18px_rgba(45,212,191,0.35)]",
          )}>
            {realtimeEnabled ? "进入实时赛程 →" : "进入赛程沙盘 →"}
          </span>
        </div>
      </Link>

      {/* ═══ 3. 赛区Hero指标 ═══ */}
      <div className={cn("grid grid-cols-2 gap-4 px-4 py-4 border-b-2 border-rm-metal-border bg-rm-metal-dark/50")}>
        <div>
          <span className="text-[9px] text-rm-metal-textFaint uppercase tracking-widest font-bold">
            头号种子
          </span>
          <div className="text-xl font-black text-rm-metal-textLight mt-1 truncate font-sans tracking-wide">
            {region.favorite.collegeName}
          </div>
          <span className={cn("text-[11px] font-bold font-mono", accent.link)}>
            夺冠率 {pct(region.favorite.probabilities.champion)} · Elo {elo(displayElo(region.favorite))}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[9px] text-rm-metal-textFaint uppercase tracking-widest font-bold">
            战区数据
          </span>
          <div className="font-mono text-xs text-rm-metal-textLight mt-1 space-y-1 font-semibold">
            <div className="text-right">国赛 {region.nationalSlots} 席</div>
            <div className="text-right">复活赛 {region.repechageSlots} 席</div>
          </div>
        </div>
      </div>

      {/* ═══ 4. 战术摘要 + 标签 ═══ */}
      <div className={cn(
        "px-4 py-3 border-b-2 border-rm-metal-border border-l-2 min-h-[88px] bg-rm-metal-dark/50",
        region.regionSlug === "south_region" ? "border-l-rm-red/40" :
        region.regionSlug === "east_region" ? "border-l-rm-blue/40" : "border-l-rm-violet/40",
      )}>
        <p className="text-[11px] text-rm-metal-text leading-relaxed font-mono line-clamp-2">
          {region.summarySentence}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {region.profileTags.map((tag, i) => (
            <span
              key={tag}
              className={cn(
                "px-1.5 py-0.5 border text-[8px] tracking-widest transition-all duration-150",
                i === 0
                  ? "border-rm-blue/30 bg-rm-blue/8 text-rm-blue/80"
                  : "border-rm-metal-border bg-rm-metal-dark/10 text-rm-metal-textFaint",
              )}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* ═══ 5. 稳进国赛阵容 ═══ */}
      {region.nationalLocks.length > 0 ? (
        <div className="border-b-2 border-rm-metal-border px-4 py-3 border-l-2 border-l-rm-status-confirmed/50 bg-rm-metal-dark/50">
          <h4 className="text-[9px] font-bold text-rm-status-confirmed tracking-widest uppercase mb-2 flex items-center gap-2">
            <span className="w-1 h-3 bg-rm-status-confirmed/60 shadow-[0_0_6px_rgba(0,232,120,0.25)]" />
            稳进国赛阵容
          </h4>
          <div className="flex flex-wrap gap-2">
            {region.nationalLocks.map((team) => (
              <LockedTeamBadge key={team.teamKey} team={team} />
            ))}
          </div>
        </div>
      ) : <div />}

      {/* ═══ 6. 国赛卡位战圈 ═══ */}
      {region.nationalRace.cutoffTeam ? (
        <div className="border-b-2 border-rm-metal-border px-4 py-3 border-l-2 border-l-rm-red/40 bg-rm-metal-dark/50">
          <h4 className="text-[9px] font-bold text-rm-red tracking-widest uppercase mb-2 flex items-center gap-2">
            <span className="w-1 h-3 bg-rm-red/60 shadow-[0_0_4px_rgba(232,48,42,0.2)]" />
            国赛卡位战圈 · 最后 {region.nationalSlots - region.nationalRace.locksCount} 席
          </h4>
          <RaceBattle
            cutoffTeam={region.nationalRace.cutoffTeam}
            chasingTeams={region.nationalRace.chasingTeams}
            totalChasingCount={region.nationalRace.totalChasingCount}
            cutoffProbability={region.nationalRace.cutoffProbability}
            getProb={(t) => t.probabilities.national}
            colorClass={{
              border: "border-rm-red/30 hover:border-rm-red/50",
              bg: "bg-[rgba(232,48,42,0.06)]",
              text: "text-rm-red/80",
              badge: "border-rm-red/40 bg-[rgba(232,48,42,0.08)] text-rm-red/90",
              line: "border-rm-red/30",
            }}
          />
        </div>
      ) : <div />}

      {/* ═══ 7. 复活赛卡位战圈 ═══ */}
      {region.repechageRace.cutoffTeam ? (
        <div className="border-b-2 border-rm-metal-border px-4 py-3 border-l-2 border-l-rm-status-pending/50 bg-rm-metal-dark/50">
          <h4 className="text-[9px] font-bold text-rm-status-pending tracking-widest uppercase mb-2 flex items-center gap-2">
            <span className="w-1 h-3 bg-rm-status-pending/60 shadow-[0_0_6px_rgba(255,176,0,0.25)]" />
            复活赛卡位战圈
          </h4>
          <RaceBattle
            cutoffTeam={region.repechageRace.cutoffTeam}
            chasingTeams={region.repechageRace.chasingTeams}
            totalChasingCount={region.repechageRace.totalChasingCount}
            cutoffProbability={region.repechageRace.cutoffProbability}
            getProb={getRepechageRaceProbability}
            colorClass={{
              border: "border-rm-status-pending/30 hover:border-rm-status-pending/50",
              bg: "bg-[rgba(255,176,0,0.06)]",
              text: "text-rm-status-pending/80",
              badge: "border-rm-status-pending/40 bg-[rgba(255,176,0,0.08)] text-rm-status-pending/90",
              line: "border-rm-status-pending/30",
            }}
          />
        </div>
      ) : <div />}

      {/* ═══ 8. 战力矩阵 ═══ */}
      <div className={cn("px-4 py-3 border-b-2 border-rm-metal-border min-h-[268px] bg-rm-metal-dark/50")}>
        <CompactRosterTable teams={region.teams} regionSlug={region.regionSlug} />
      </div>

      {/* ═══ 9. 快捷链接 ═══ */}
      <div className={cn("px-4 py-3 flex items-center justify-between gap-3")}>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildRegionHref(region.regionSlug, "playoff", { mode: fallbackMode })}
            className={cn(
              "font-sans text-sm font-semibold transition-all duration-200 flex items-center gap-1.5",
              "px-3 py-1.5 border rounded-sm",
              "border-rm-accent/50 bg-rm-accent/12 text-rm-accent",
              "hover:bg-rm-accent/22 hover:shadow-[0_0_16px_rgba(45,212,191,0.3)]",
            )}
          >
            进入赛区沙盘
            <span className="group-hover/card:translate-x-0.5 transition-transform duration-200">→</span>
          </Link>
          <Link
            href="/forecast-center"
            className={cn(
              "font-sans text-sm font-semibold transition-all duration-200 flex items-center gap-1.5",
              "px-3 py-1.5 border rounded-sm",
              "border-rm-blue/50 bg-rm-blue/12 text-rm-blue",
              "hover:bg-rm-blue/22 hover:shadow-[0_0_16px_rgba(42,159,255,0.3)]",
            )}
          >
            实时预测
            <span className="group-hover/card:translate-x-0.5 transition-transform duration-200">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
