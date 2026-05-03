// frontend/components/contender-section.tsx
import type { OverviewTeam } from "@/lib/types";
import { cn } from "@/lib/utils";

function elo(value: number) {
  return value.toFixed(1);
}

function displayElo(team: OverviewTeam) {
  return team.currentElo ?? team.mu0;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function tierConfig(index: number) {
  if (index < 4) return {
    label: "T1",
    bar: "bg-rm-blue/70",
    glow: "shadow-[0_0_12px_rgba(42,159,255,0.10)]",
    cardBg: "bg-rm-metal-card",
  };
  if (index < 8) return {
    label: "T2",
    bar: "bg-rm-metal-textMuted/50",
    glow: "",
    cardBg: "bg-rm-metal-card",
  };
  return {
    label: "T3",
    bar: "bg-rm-metal-textFaint/40",
    glow: "",
    cardBg: "bg-rm-metal-card",
  };
}

export function ContenderSection({ contenders }: { contenders: OverviewTeam[] }) {
  if (!contenders || contenders.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className="h-4 w-0.5 bg-rm-blue/70" />
        <h2 className="font-sans text-lg font-semibold text-rm-metal-textLight tracking-wide">
          全国冠军争夺者
        </h2>
        <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
          前 {contenders.length} 名
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contenders.map((team, idx) => {
          const tier = tierConfig(idx);
          return (
            <div
              key={team.teamKey}
              className={cn(
                "border border-rm-metal-border px-4 py-3 relative overflow-hidden",
                "hover:border-rm-metal-textMuted/30 transition-all duration-200",
                tier.cardBg,
                tier.glow,
              )}
            >
              {/* Tier accent bar + corner decoration */}
              <div className={cn("h-0.5 -mx-4 -mt-3 mb-3", tier.bar)} />
              {idx < 4 && (
                <div className="absolute top-0 right-0 w-10 h-10 bg-rm-blue/15 transform rotate-45 translate-x-5 -translate-y-5" />
              )}

              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] text-rm-metal-textFaint tracking-widest">
                  {tier.label} · 全国 #{idx + 1}
                </span>
                <span className="font-mono text-[10px] text-rm-metal-textMuted">
                  {team.regionName}
                </span>
              </div>
              <div className="font-sans text-base font-semibold text-rm-metal-textLight mb-3 truncate">
                {team.collegeName}
              </div>
              <div className="flex justify-between items-end pt-2 border-t border-rm-metal-border">
                <div>
                  <div className="text-[9px] text-rm-metal-textFaint tracking-widest">战力</div>
                  <div className="font-mono text-sm text-rm-metal-textLight">{elo(displayElo(team))}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-rm-metal-textFaint tracking-widest">夺冠率</div>
                  <div className={cn(
                    "font-mono text-sm",
                    team.probabilities.champion > 0.1
                      ? "text-rm-metal-textLight font-semibold"
                      : "text-rm-metal-textMuted",
                  )}>
                    {pct(team.probabilities.champion)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
