// frontend/components/rankings-column.tsx
import Link from "next/link";
import type { EloRankingRow, RegionSlug } from "@/lib/types";
import { buildRegionHref } from "@/lib/region-config";
import { cn } from "@/lib/utils";

function pct(value: number) {
  if (value < 0.001 && value > 0) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function elo(value: number) {
  return value.toFixed(1);
}

function signedEloDelta(value: number) {
  if (Math.abs(value) < 0.05) return "±0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

/* ─── 概率颜色（按类型区分） ─── */

function repechageColor(value: number) {
  if (value >= 0.5) return "text-[#FFB000] font-bold drop-shadow-[0_0_4px_rgba(255,176,0,0.5)]";
  if (value >= 0.2) return "text-[#FFB000]/80 font-semibold";
  if (value >= 0.05) return "text-[#FFB000]/50";
  return "text-rm-metal-textFaint/50";
}

function nationalColor(value: number) {
  if (value >= 0.7) return "text-[#00E878] font-bold drop-shadow-[0_0_5px_rgba(0,232,120,0.4)]";
  if (value >= 0.4) return "text-[#00E878]/85 font-semibold";
  if (value >= 0.1) return "text-[#00E878]/55";
  return "text-rm-metal-textFaint/50";
}

function championColor(value: number) {
  if (value >= 0.15) return "text-[#E8C44A] font-bold drop-shadow-[0_0_5px_rgba(232,196,74,0.4)]";
  if (value >= 0.05) return "text-[#E8C44A]/80 font-semibold";
  if (value >= 0.01) return "text-[#E8C44A]/50";
  return "text-rm-metal-textFaint/50";
}

/* ─── 赛区配色（红/蓝/紫对照首页） ─── */

const ACCENT: Record<string, {
  bar: string;
  glow: string;
  text: string;
  border: string;
  rankBg: string;
  rowHover: string;
}> = {
  south_region: {
    bar: "bg-gradient-to-r from-rm-red/80 via-rm-red/40 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(232,48,42,0.06)]",
    text: "text-rm-red",
    border: "border-rm-red/30",
    rankBg: "bg-rm-red/15",
    rowHover: "hover:border-rm-red/40 hover:shadow-[inset_0_0_20px_rgba(232,48,42,0.04)]",
  },
  east_region: {
    bar: "bg-gradient-to-r from-rm-blue/80 via-rm-blue/40 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(42,159,255,0.06)]",
    text: "text-rm-blue",
    border: "border-rm-blue/30",
    rankBg: "bg-rm-blue/15",
    rowHover: "hover:border-rm-blue/40 hover:shadow-[inset_0_0_20px_rgba(42,159,255,0.04)]",
  },
  north_region: {
    bar: "bg-gradient-to-r from-rm-violet/70 via-rm-violet/30 to-transparent",
    glow: "shadow-[inset_0_0_16px_rgba(139,92,246,0.06)]",
    text: "text-rm-violet",
    border: "border-rm-violet/30",
    rankBg: "bg-rm-violet/15",
    rowHover: "hover:border-rm-violet/40 hover:shadow-[inset_0_0_20px_rgba(139,92,246,0.04)]",
  },
};

/* ─── 排名行 ─── */

function RankingRow({
  regionSlug,
  row,
  globalRank,
}: {
  regionSlug: RegionSlug;
  row: EloRankingRow;
  globalRank: number;
}) {
  const a = ACCENT[regionSlug] ?? ACCENT.north_region;
  const playoffUrl = buildRegionHref(regionSlug, "playoff", { highlight: row.teamKey });
  const isTop3 = row.rankInRegion <= 3;
  const currentElo = row.currentElo ?? row.mu0;
  const eloDelta = row.eloDeltaFromPreseason ?? currentElo - row.mu0;

  return (
    <Link
      href={playoffUrl}
      className={cn(
        "group flex flex-col p-3 mb-1 bg-rm-metal-panel border border-rm-metal-border transition-all duration-200",
        a.rowHover,
      )}
    >
      <div className="flex items-start justify-between mb-2.5">
        {/* Left: rank badges + school info */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Rank badges */}
          <div className="flex items-center gap-2 shrink-0">
            <div className={cn(
              "flex flex-col items-center w-7 py-0.5 rounded-sm",
              isTop3 && a.rankBg,
            )}>
              <span className={cn(
                "font-mono text-base font-black",
                isTop3 ? a.text : "text-rm-metal-textLight",
              )}>
                {row.rankInRegion}
              </span>
              <span className="text-[7px] text-rm-metal-textFaint leading-tight">
                赛区
              </span>
            </div>
            <div className="flex flex-col items-center w-7 py-0.5">
              <span className="font-mono text-xs font-bold text-rm-metal-textMuted">
                {globalRank}
              </span>
              <span className="text-[7px] text-rm-metal-textFaint leading-tight">
                全国
              </span>
            </div>
          </div>

          {/* School name */}
          <div className="min-w-0">
            <div className={cn(
              "truncate font-sans tracking-wide",
              isTop3 ? "text-base font-black text-rm-metal-textLight" : "text-sm font-bold text-rm-metal-textLight/90",
            )}>
              {row.collegeName}
            </div>
            <div className="text-[10px] text-rm-metal-textFaint tracking-wider truncate">
              {row.teamName}
            </div>
          </div>
        </div>

        {/* Right: TS2 */}
        <div className="text-right shrink-0 ml-3">
          <div className="text-[8px] text-rm-metal-textFaint tracking-widest uppercase mb-0.5">
            战力
          </div>
          <div className={cn(
            "font-mono text-base font-bold tabular-nums",
            isTop3 ? a.text : "text-rm-metal-textLight",
          )}>
            {elo(currentElo)}
          </div>
          <div className={cn(
            "font-mono text-[9px] tabular-nums",
            eloDelta > 0.05 ? "text-rm-status-safe" : eloDelta < -0.05 ? "text-rm-red/80" : "text-rm-metal-textFaint",
          )}>
            {signedEloDelta(eloDelta)}
          </div>
        </div>
      </div>

      {/* Probabilities row */}
      <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-rm-metal-border/50">
        <div className="text-center">
          <div className="text-[8px] text-rm-metal-textFaint tracking-widest uppercase mb-1">
            复活赛
          </div>
          <div className={cn("text-xs font-mono tabular-nums", repechageColor(row.repechageProbability))}>
            {pct(row.repechageProbability)}
          </div>
        </div>
        <div className="text-center border-l border-rm-metal-border/50">
          <div className="text-[8px] text-rm-metal-textFaint tracking-widest uppercase mb-1">
            国赛
          </div>
          <div className={cn("text-xs font-mono tabular-nums", nationalColor(row.nationalProbability))}>
            {pct(row.nationalProbability)}
          </div>
        </div>
        <div className="text-center border-l border-rm-metal-border/50">
          <div className="text-[8px] text-rm-metal-textFaint tracking-widest uppercase mb-1">
            夺冠
          </div>
          <div className={cn("text-xs font-mono tabular-nums", championColor(row.championProbability))}>
            {pct(row.championProbability)}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ─── 赛区列 ─── */

export function RankingsColumn({
  regionSlug,
  regionName,
  topTeam,
  top8AverageElo,
  medianElo,
  rows,
  globalRanks,
}: {
  regionSlug: RegionSlug;
  regionName: string;
  topTeam: string;
  top8AverageElo: number;
  medianElo: number;
  rows: EloRankingRow[];
  globalRanks: Map<string, number>;
}) {
  const a = ACCENT[regionSlug] ?? ACCENT.north_region;

  return (
    <div className={cn(
      "flex flex-col bg-rm-metal-card border border-rm-metal-border overflow-hidden",
      "hover:border-rm-metal-textMuted/30 transition-all duration-300",
      a.glow,
    )}>
      {/* Colored top bar */}
      <div className={cn("h-0.5 w-full", a.bar)} />

      {/* Column header */}
      <div className={cn(
        "px-4 py-4 border-b border-rm-metal-border relative overflow-hidden",
        // Per-region header gradient
        regionSlug === "south_region"
          ? "bg-[linear-gradient(180deg,rgba(232,48,42,0.08),rgba(28,28,31,0.1),transparent)]"
          : regionSlug === "east_region"
          ? "bg-[linear-gradient(180deg,rgba(42,159,255,0.08),rgba(28,28,31,0.1),transparent)]"
          : "bg-[linear-gradient(180deg,rgba(139,92,246,0.08),rgba(28,28,31,0.1),transparent)]",
      )}>
        <h2 className="font-sans text-lg font-black text-rm-metal-textLight mb-3 tracking-wide">
          {regionName}
        </h2>
        <div className="grid grid-cols-3 gap-3 font-mono text-[10px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-rm-metal-textFaint text-[8px] tracking-widest uppercase">
              赛区天花板
            </span>
            <span className="text-rm-metal-textLight font-bold text-xs truncate">
              {topTeam}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-rm-metal-textFaint text-[8px] tracking-widest uppercase">
              八强均战力
            </span>
            <span className={cn("font-bold text-xs", a.text)}>
              {elo(top8AverageElo)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-rm-metal-textFaint text-[8px] tracking-widest uppercase">
              中位战力
            </span>
            <span className={cn("font-bold text-xs", a.text)}>
              {elo(medianElo)}
            </span>
          </div>
        </div>
      </div>

      {/* Team list */}
      <div className="flex flex-col p-2">
        <div className="flex justify-between px-2.5 pb-2 text-[9px] tracking-widest text-rm-metal-textFaint font-bold border-b border-rm-metal-border/50 mb-1.5">
          <span>队伍 / 排名</span>
          <span>概率推演</span>
        </div>
        {rows.map((row) => (
          <RankingRow
            key={row.teamKey}
            regionSlug={regionSlug}
            row={row}
            globalRank={globalRanks.get(row.teamKey) ?? 0}
          />
        ))}
      </div>
    </div>
  );
}
