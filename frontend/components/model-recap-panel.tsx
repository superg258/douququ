import Link from "next/link";
import { formatMatchLabel } from "@/lib/display";
import { buildRegionHref } from "@/lib/region-config";
import type { PredictionRecapMatch, PredictionRecapResponse, TeamRef } from "@/lib/types";

function pct(value: number | null) {
  if (value == null) return "暂无";
  return `${Math.round(value * 100)}%`;
}

function MetricCard({ label, value, tone = "text-rm-metal-textLight" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="relative border border-rm-metal-border bg-rm-metal-card px-3 py-2 overflow-hidden"
         style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}>
      <div className="font-mono text-[9px] tracking-widest text-rm-metal-textFaint">{label}</div>
      <div className={`font-mono text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function isTeamRef(value: unknown): value is TeamRef {
  if (!value || typeof value !== "object") return false;
  const team = value as Partial<TeamRef>;
  return typeof team.teamKey === "string" && typeof team.collegeName === "string";
}

function isRenderableRecapMatch(match: PredictionRecapMatch) {
  const candidate = match as Partial<PredictionRecapMatch>;
  return (
    isTeamRef(candidate.redTeam) &&
    isTeamRef(candidate.blueTeam) &&
    (candidate.predictedWinnerSide === "red" || candidate.predictedWinnerSide === "blue")
  );
}


export function ModelRecapPanel({
  recap,
  compact = false,
}: {
  recap: PredictionRecapResponse;
  compact?: boolean;
}) {
  const summary = recap.summary;
  const renderableNotableMatches = recap.notableMatches.filter(isRenderableRecapMatch);
  const notable = compact ? renderableNotableMatches.slice(0, 3) : renderableNotableMatches;

  return (
    <section className="space-y-4">
      {/* Section header */}
      <div className="relative bg-rm-metal-panel border border-rm-metal-border overflow-hidden"
           style={{
             boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)',
             background: 'radial-gradient(ellipse at 0% 50%, rgba(139,92,246,0.05) 0%, transparent 70%)',
           }}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="h-5 w-1 rounded-full bg-rm-status-deviation/70 shadow-[0_0_8px_rgba(139,92,246,0.3)]" />
          <h2 className="font-sans text-sm font-semibold tracking-wide text-rm-metal-textLight">模型表现复盘</h2>
        </div>
      </div>

      {/* Summary metrics */}
      <div className={`grid gap-2 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-5"}`}>
        <MetricCard label="已复盘场次" value={`${summary.completedMatches} 场`} />
        <MetricCard label="胜负预测命中率" value={pct(summary.winnerHitRate)} tone="text-rm-status-safe" />
        <MetricCard label="比分预测命中率" value={pct(summary.scorelineHitRate)} tone="text-rm-blue" />
        <MetricCard label="爆冷偏离场次" value={`${summary.upsetMisses} 场`} tone={summary.upsetMisses > 0 ? "text-rm-status-upset" : "text-rm-metal-textLight"} />
        {!compact && <MetricCard label="未完赛场次" value={`${summary.pendingMatches} 场`} tone="text-rm-status-warn" />}
      </div>

      {/* Per-region breakdown */}
      {!compact && (
        <div className="grid gap-2 md:grid-cols-3">
          {Object.entries(recap.byRegion).map(([regionSlug, group]) => (
            <div key={regionSlug} className="border border-rm-metal-border bg-rm-metal-panel px-3 py-2"
                 style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}>
              <div className="font-sans text-sm font-semibold text-rm-metal-textLight">{group.regionName}</div>
              <div className="mt-1 font-mono text-[11px] text-rm-metal-textMuted">
                胜负命中 {pct(group.winnerHitRate)} · 比分命中 {pct(group.scorelineHitRate)} · 爆冷 {group.upsetMisses} 场
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notable deviation matches */}
      {notable.length > 0 && (
        <div className="space-y-2">
          <div className="relative bg-rm-metal-panel border border-rm-metal-border px-4 py-2 overflow-hidden"
               style={{
                 boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                 background: 'radial-gradient(ellipse at 0% 50%, rgba(255,80,80,0.04) 0%, transparent 70%)',
               }}>
            <div className="flex items-center gap-2">
              <span className="h-3 w-0.5 bg-rm-status-upset/50" />
              <span className="font-mono text-[10px] tracking-widest text-rm-metal-textFaint">预测偏离场次</span>
            </div>
          </div>
          <div className={compact ? "grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"}>
            {notable.map((match) => {
              const isUpset = match.deviationType === "upset_miss";
              const red = match.redTeam;
              const blue = match.blueTeam;
              const actualWinnerKey = match.actualWinnerTeamKey;
              const predictedSide = match.predictedWinnerSide;
              const redIsActual = actualWinnerKey === red.teamKey;
              const blueIsActual = actualWinnerKey === blue.teamKey;
              const redIsPredicted = predictedSide === "red";
              const blueIsPredicted = predictedSide === "blue";

              if (compact) {
                const actualSide = redIsActual ? "red" : blueIsActual ? "blue" : null;
                return (
                  <Link
                    key={match.id}
                    href={buildRegionHref(match.regionSlug, match.workspaceView, {
                      seed: match.seed,
                      mode: "live",
                      highlight: match.actualWinnerTeamKey ?? match.predictedWinnerTeamKey,
                    })}
                    className={`clip-chamfer relative border bg-rm-metal-card px-2.5 py-1.5 transition-all hover:shadow-[0_0_14px_rgba(42,159,255,0.06),0_0_14px_rgba(232,48,42,0.04)] ${
                      isUpset
                        ? "border-rm-status-upset/15 hover:border-rm-status-upset/30"
                        : "border-rm-status-deviation/10 hover:border-rm-status-deviation/20"
                    }`}
                    style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                  >
                    {/* Left accent bar */}
                    <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                      isUpset
                        ? "bg-rm-status-upset shadow-[0_0_8px_rgba(232,48,42,0.5)]"
                        : "bg-rm-status-deviation shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                    }`} />

                    <div className="border-b border-white/[0.04] pb-1">
                      <div className="flex items-center gap-1.5">
                        {/* Red side (left) */}
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${redIsActual ? "bg-rm-status-upset shadow-[0_0_6px_rgba(232,48,42,0.5)]" : "bg-rm-status-upset/50"}`} />
                        <span className={`font-sans text-xs font-semibold truncate ${redIsActual ? "text-rm-status-upset font-bold" : "text-rm-status-upset/70"}`}>
                          {red.collegeName}
                        </span>
                        {/* VS + score */}
                        <span className="font-mono text-[11px] font-bold text-rm-metal-textLight tabular-nums shrink-0">
                          {match.actualScoreline ?? "-:-"}
                        </span>
                        {/* Blue side (right) */}
                        <span className={`font-sans text-xs font-semibold truncate ${blueIsActual ? "text-rm-blue font-bold" : "text-rm-blue/70"}`}>
                          {blue.collegeName}
                        </span>
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${blueIsActual ? "bg-rm-blue shadow-[0_0_6px_rgba(42,159,255,0.5)]" : "bg-rm-blue/50"}`} />
                        {/* Deviation badge */}
                        <span className={`ml-auto shrink-0 font-mono text-[8px] px-1 py-0.5 border ${
                          isUpset
                            ? "text-rm-status-upset border-rm-status-upset/25 bg-rm-status-upset/6"
                            : "text-rm-status-deviation border-rm-status-deviation/25 bg-rm-status-deviation/6"
                        }`}>
                          {isUpset ? "爆冷" : "比分偏差"}
                        </span>
                      </div>
                    </div>
                    {/* Summary text */}
                    <div className="mt-1 font-mono text-[10px] text-rm-metal-textFaint/60 truncate">
                      预测 <span className={match.predictedWinnerSide === "red" ? "text-rm-status-upset" : "text-rm-blue"}>{match.predictedWinnerName}</span> {match.predictedScoreline}
                      · 实际 <span className={actualSide === "red" ? "text-rm-status-upset" : actualSide === "blue" ? "text-rm-blue" : "text-rm-metal-textFaint"}>{match.actualWinnerName ?? "?"}</span> {match.actualScoreline ?? "?"}
                    </div>
                  </Link>
                );
              }

              return (
                <Link
                  key={match.id}
                  href={buildRegionHref(match.regionSlug, match.workspaceView, {
                    seed: match.seed,
                    mode: "live",
                    highlight: match.actualWinnerTeamKey ?? match.predictedWinnerTeamKey,
                  })}
                  className={`clip-chamfer relative border bg-rm-metal-card transition-all hover:shadow-[0_0_18px_rgba(42,159,255,0.08),0_0_18px_rgba(232,48,42,0.05)] ${
                    isUpset
                      ? "border-rm-status-upset/20 hover:border-rm-status-upset/40"
                      : "border-rm-status-deviation/15 hover:border-rm-status-deviation/30"
                  }`}
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                >
                  {/* Left accent bar */}
                  <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                    isUpset
                      ? "bg-rm-status-upset shadow-[0_0_8px_rgba(232,48,42,0.5)]"
                      : "bg-rm-status-deviation shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                  }`} />

                  {/* Header: match context + deviation badge */}
                  <div className="px-3 pt-2.5 pb-1.5 border-b border-white/[0.04] flex items-center gap-2">
                    <span className="truncate font-mono text-[10px] text-rm-metal-textFaint/70">
                      {match.regionName} · {formatMatchLabel(match.matchLabel)}
                    </span>
                    <span className={`ml-auto shrink-0 font-mono text-[10px] px-1.5 py-0.5 border ${
                      isUpset
                        ? "text-rm-status-upset border-rm-status-upset/30 bg-rm-status-upset/8"
                        : "text-rm-status-deviation border-rm-status-deviation/30 bg-rm-status-deviation/8"
                    }`}>
                      {isUpset ? "爆冷偏离" : "比分偏差"}
                    </span>
                  </div>

                  {/* VS layout: red left, blue right, fixed order */}
                  <div className="flex items-center gap-0 px-2 py-1.5">
                    {/* Red side (left) */}
                    <SideBlock
                      team={red}
                      side="red"
                      isActualWinner={redIsActual}
                      isPredictedWinner={redIsPredicted}
                      predictedScoreline={match.predictedScoreline}
                      deviationType={match.deviationType}
                      className="rounded-l"
                    />

                    {/* Center: VS + score */}
                    <div className="flex flex-col items-center justify-center px-1.5 min-w-[56px] bg-rm-metal-panel/30 gap-0">
                      <span className="font-mono text-[7px] text-rm-metal-textFaint/60">预测</span>
                      <span className="font-mono text-xs text-rm-metal-textMuted tabular-nums">
                        {match.predictedScoreline}
                      </span>
                      <span className={`font-mono text-xs ${isUpset ? "text-rm-status-upset" : "text-rm-status-deviation"}`}>
                        {isUpset ? "↧" : "⇅"}
                      </span>
                      <span className="font-mono text-base font-bold text-[#4ade80] tabular-nums leading-tight">
                        {match.actualScoreline ?? "-:-"}
                      </span>
                      <span className="font-mono text-[7px] text-rm-metal-textFaint/60">实际</span>
                      {/* SplitBar */}
                      <div className="w-full mt-0.5">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[9px] text-rm-status-upset tabular-nums">
                            {match.predictedWinnerSide === "red" ? Math.round(match.favoriteRate * 100) : Math.round((1 - match.favoriteRate) * 100)}%
                          </span>
                          <div className="flex-1 h-1.5 flex rounded-sm overflow-hidden border border-white/10 bg-black/80">
                            <div
                              className="h-full bg-gradient-to-r from-rm-status-upset/80 to-rm-status-upset/65"
                              style={{
                                width: `${match.predictedWinnerSide === "red" ? match.favoriteRate * 100 : (1 - match.favoriteRate) * 100}%`,
                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
                              }}
                            />
                            <div className="w-px bg-white/80" style={{ boxShadow: '0 0 6px rgba(255,255,255,0.8)' }} />
                            <div
                              className="flex-1 h-full bg-gradient-to-l from-rm-blue/80 to-rm-blue/65"
                              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}
                            />
                          </div>
                          <span className="font-mono text-[9px] text-rm-blue tabular-nums">
                            {match.predictedWinnerSide === "blue" ? Math.round(match.favoriteRate * 100) : Math.round((1 - match.favoriteRate) * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Blue side (right) */}
                    <SideBlock
                      team={blue}
                      side="blue"
                      isActualWinner={blueIsActual}
                      isPredictedWinner={blueIsPredicted}
                      predictedScoreline={match.predictedScoreline}
                      deviationType={match.deviationType}
                      className="rounded-r"
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SideBlock({
  team,
  side,
  isActualWinner,
  isPredictedWinner,
  predictedScoreline,
  deviationType,
  className = "",
}: {
  team: { collegeName: string; teamKey: string; teamName?: string };
  side: "red" | "blue";
  isActualWinner: boolean;
  isPredictedWinner: boolean;
  predictedScoreline: string;
  deviationType: string;
  className?: string;
}) {
  const dotColor = side === "red" ? "bg-rm-status-upset" : "bg-rm-blue";
  const dotShadow = side === "red"
    ? "0 0 8px rgba(232,48,42,0.5)"
    : "0 0 8px rgba(42,159,255,0.4)";
  const isUpsetActual = isActualWinner && deviationType === "upset_miss";
  const isScorelineHit = isActualWinner && deviationType === "scoreline_miss";

  const borderClass = isUpsetActual
    ? "border-2 border-[#4ade80]/35 bg-[rgba(74,222,128,0.04)]"
    : isPredictedWinner && deviationType === "upset_miss"
      ? "border-2 border-dashed border-rm-metal-textFaint/25 bg-transparent"
      : isScorelineHit
        ? "border border-[#4ade80]/20 bg-[rgba(74,222,128,0.02)]"
        : "border border-rm-metal-border/30 bg-transparent";

  return (
    <div className={`flex-1 min-w-0 flex flex-col items-center py-1 px-1 relative ${borderClass} ${className}`}>
      {/* Colored dot */}
      <div
        className={`w-2 h-2 rounded-full ${dotColor}`}
        style={{ boxShadow: dotShadow }}
      />

      {/* Team name */}
      <div className={`mt-0.5 font-sans text-xs font-semibold text-center truncate w-full ${side === "red" ? "text-rm-status-upset" : "text-rm-blue"}`}>
        {team.collegeName}
      </div>
      <div className="font-mono text-[9px] text-rm-metal-textFaint/60">{team.teamName}</div>

      {/* Status tag */}
      <div className="mt-1 font-mono text-[8px] px-2 py-0.5 rounded-sm text-center">
        {isActualWinner && isPredictedWinner ? (
          <span className="text-rm-status-deviation bg-rm-status-deviation/8 border border-rm-status-deviation/25 px-1.5 py-0.5">
            胜方正确 比分偏差
          </span>
        ) : isPredictedWinner ? (
          <span className="text-rm-metal-textMuted px-1.5 py-0.5">
            模型预测 {predictedScoreline} 胜
          </span>
        ) : isActualWinner ? (
          <span className="text-[#4ade80] bg-[rgba(74,222,128,0.12)] border border-[rgba(74,222,128,0.35)] px-1.5 py-0.5">
            实际结果 胜
          </span>
        ) : (
          <span className="text-rm-metal-textFaint/40">预测负</span>
        )}
      </div>
    </div>
  );
}
