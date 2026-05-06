import Link from "next/link";
import { buildRegionHref } from "@/lib/region-config";
import type { PredictionRecapResponse } from "@/lib/types";

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

export function ModelRecapPanel({
  recap,
  compact = false,
}: {
  recap: PredictionRecapResponse;
  compact?: boolean;
}) {
  const summary = recap.summary;
  const notable = compact ? recap.notableMatches.slice(0, 3) : recap.notableMatches;

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
          <div className="grid gap-2 lg:grid-cols-2">
            {notable.map((match) => {
              const isUpset = match.deviationType === "upset_miss";
              return (
                <Link
                  key={match.id}
                  href={buildRegionHref(match.regionSlug, match.workspaceView, {
                    seed: match.seed,
                    mode: "live",
                    highlight: match.actualWinnerTeamKey ?? match.predictedWinnerTeamKey,
                  })}
                  className="border border-rm-metal-border bg-rm-metal-card px-3 py-2.5 transition-all hover:border-rm-status-deviation/50 hover:shadow-[0_0_12px_rgba(139,92,246,0.06)]"
                >
                  {/* Top: match context */}
                  <div className="mb-2 truncate font-mono text-[10px] text-rm-metal-textFaint/70">
                    {match.regionName} · {match.stageLabel} · {match.matchLabel}
                  </div>

                  {/* Three-column comparison */}
                  <div className="flex items-stretch gap-2">
                    {/* Left: Prediction */}
                    <div className="flex-1 min-w-0 border border-rm-red/15 bg-rm-red/5 px-2 py-1.5">
                      <div className="font-mono text-[9px] text-rm-metal-textFaint/60">预测结果</div>
                      <div className="mt-0.5 font-sans text-sm font-semibold text-rm-metal-textLight truncate">
                        {match.predictedWinnerName}
                      </div>
                      <div className="font-mono text-xs text-rm-red tabular-nums">
                        {match.predictedScoreline}
                      </div>
                    </div>

                    {/* Center: Deviation badge */}
                    <div className="flex flex-col items-center justify-center shrink-0 px-2">
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 border ${
                        isUpset
                          ? "text-rm-status-upset border-rm-status-upset/30 bg-rm-status-upset/8"
                          : "text-rm-status-warn border-rm-status-warn/30 bg-rm-status-warn/8"
                      }`}>
                        {isUpset ? "爆冷" : "比分偏差"}
                      </span>
                    </div>

                    {/* Right: Actual */}
                    <div className="flex-1 min-w-0 border border-rm-blue/15 bg-rm-blue/5 px-2 py-1.5">
                      <div className="font-mono text-[9px] text-rm-metal-textFaint/60">实际结果</div>
                      <div className="mt-0.5 font-sans text-sm font-semibold text-rm-metal-textLight truncate">
                        {match.actualWinnerName ?? "未知"}
                      </div>
                      <div className="font-mono text-xs text-rm-blue tabular-nums">
                        {match.actualScoreline ?? "待确认"}
                      </div>
                    </div>
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
