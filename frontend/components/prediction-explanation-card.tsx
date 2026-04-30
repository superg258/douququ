"use client";

import { explainMatchPrediction } from "@/lib/prediction-insights";
import { cn } from "@/lib/utils";
import type { MatchRow, RegionSlug } from "@/lib/types";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function PredictionExplanationCard({
  match,
  regionSlug,
  regionName,
  compact = false,
}: {
  match: MatchRow;
  regionSlug?: RegionSlug;
  regionName?: string;
  compact?: boolean;
}) {
  const explanation = explainMatchPrediction(match, { regionSlug, regionName });
  const verdictTone = {
    pending: "border-rm-blue/45 bg-rm-blue/10 text-rm-blue",
    hit: "border-rm-status-safe/45 bg-rm-status-safe/10 text-rm-status-safe",
    "score-hit": "border-rm-status-safe/60 bg-rm-status-safe/15 text-rm-status-safe",
    miss: "border-[#a855f7]/45 bg-[#a855f7]/10 text-[#c084fc]",
    upset: "border-rm-red/55 bg-rm-red/10 text-rm-red",
  }[explanation.verdict];

  return (
    <section className={cn("border border-rm-metal-border bg-[#05070c] clip-chamfer", compact ? "p-2" : "p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-rm-metal-text">预测解释</p>
          <h4 className={cn("font-machine tracking-widest text-white", compact ? "text-sm" : "text-base")}>
            看好 {explanation.favoriteName}
          </h4>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="border border-rm-blue/45 bg-rm-blue/10 px-2 py-0.5 text-rm-blue">
            {explanation.predictedScoreline}
          </span>
          <span className={cn("border px-2 py-0.5 font-bold", verdictTone)}>
            {explanation.verdictLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
        <div className="border border-rm-metal-border bg-rm-metal-dark/80 px-2 py-1.5">
          <span className="block text-rm-metal-text">胜率</span>
          <strong className={cn("text-sm", explanation.favoriteSide === "red" ? "text-rm-red" : "text-rm-blue")}>
            {pct(explanation.favoriteRate)}
          </strong>
        </div>
        <div className="border border-rm-metal-border bg-rm-metal-dark/80 px-2 py-1.5">
          <span className="block text-rm-metal-text">优势差</span>
          <strong className="text-sm text-white">{pct(explanation.margin)}</strong>
        </div>
        <div className="border border-rm-metal-border bg-rm-metal-dark/80 px-2 py-1.5">
          <span className="block text-rm-metal-text">置信</span>
          <strong className="text-sm text-rm-status-warn">{explanation.confidenceText}</strong>
        </div>
      </div>

      {!compact ? (
        <div className="mt-3 space-y-2">
          {explanation.reasonBullets.map((reason) => (
            <p key={reason} className="border-l-2 border-rm-blue/60 bg-rm-metal-dark/50 px-2 py-1.5 text-[11px] leading-relaxed text-rm-metal-text">
              {reason}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
