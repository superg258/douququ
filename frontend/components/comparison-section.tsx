// frontend/components/comparison-section.tsx
import type { RegionStrengthRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function elo(value: number) {
  return value.toFixed(1);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

const REGION_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  south_region: {
    border: "border-l-[rgba(232,48,42,0.55)]",
    bg: "bg-[rgba(232,48,42,0.04)]",
    badge: "border-[rgba(232,48,42,0.4)] bg-[rgba(232,48,42,0.08)] text-[#E8302A]",
  },
  east_region: {
    border: "border-l-[rgba(42,159,255,0.55)]",
    bg: "bg-[rgba(42,159,255,0.04)]",
    badge: "border-[rgba(42,159,255,0.4)] bg-[rgba(42,159,255,0.08)] text-[#2A9FFF]",
  },
  north_region: {
    border: "border-l-[rgba(139,92,246,0.55)]",
    bg: "bg-[rgba(139,92,246,0.04)]",
    badge: "border-[rgba(139,92,246,0.4)] bg-[rgba(139,92,246,0.08)] text-[#8B5CF6]",
  },
};

export function ComparisonSection({ strengths }: { strengths: RegionStrengthRow[] }) {
  if (!strengths || strengths.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className="h-4 w-0.5 bg-rm-red/60" />
        <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight tracking-wide">
          赛区实力对比
        </h2>
      </div>
      <div className="bg-rm-metal-card border border-rm-metal-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-rm-metal-border text-rm-metal-textFaint font-mono text-[10px] uppercase tracking-widest bg-rm-metal-dark/40">
                <th className="py-3 px-4 font-bold">赛区</th>
                <th className="py-3 px-4 font-bold text-right">强度指数</th>
                <th className="py-3 px-4 font-bold text-right">四强均ELO</th>
                <th className="py-3 px-4 font-bold text-right">八强均ELO</th>
                <th className="py-3 px-4 font-bold text-right">中位ELO</th>
                <th className="py-3 px-4 font-bold text-right">头号种子夺冠率</th>
              </tr>
            </thead>
            <tbody className="font-mono divide-y divide-rm-metal-border/50">
              {strengths.map((row) => {
                const colors = REGION_COLORS[row.regionSlug] ?? { border: "", bg: "", badge: "" };
                return (
                  <tr
                    key={row.regionSlug}
                    className={cn(
                      "hover:bg-rm-metal-panel/60 transition-colors",
                      colors.bg,
                    )}
                  >
                    <td className={cn("py-3 pl-4 pr-3 font-sans font-semibold text-sm text-rm-metal-textLight border-l-[3px]", colors.border)}>
                      {row.regionName}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className={cn(
                        "inline-flex items-center justify-center font-bold px-2.5 py-0.5 min-w-[3rem] border",
                        colors.badge,
                      )}>
                        {row.powerIndex.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-rm-metal-textLight/80">
                      {elo(row.top4AverageElo)}
                    </td>
                    <td className="py-3 px-3 text-right text-rm-metal-textMuted">
                      {elo(row.top8AverageElo)}
                    </td>
                    <td className="py-3 px-3 text-right text-rm-metal-textFaint">
                      {elo(row.medianElo)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="bg-rm-metal-dark/60 border border-rm-metal-border px-2 py-0.5 text-rm-metal-textMuted">
                        {pct(row.favoriteChampionProbability)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

