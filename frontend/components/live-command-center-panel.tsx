import { buildLiveCommandCenter } from "@/lib/live-command-center";
import type { CommandCenterResponse, PrematchCenterMatch, RegionSlug } from "@/lib/types";
import { PrematchMatchCard } from "@/components/prematch-match-card";

const TONE_CONFIG = {
  green: {
    bar: "bg-rm-status-safe/70 shadow-[0_0_8px_rgba(0,232,120,0.3)]",
    accent: "rgba(0,232,120,0.06)",
  },
  amber: {
    bar: "bg-rm-status-warn/70 shadow-[0_0_8px_rgba(255,176,0,0.3)]",
    accent: "rgba(255,176,0,0.06)",
  },
  blue: {
    bar: "bg-rm-blue/70 shadow-[0_0_8px_rgba(42,159,255,0.3)]",
    accent: "rgba(42,159,255,0.06)",
  },
  red: {
    bar: "bg-rm-status-upset/70 shadow-[0_0_8px_rgba(255,80,80,0.3)]",
    accent: "rgba(255,80,80,0.06)",
  },
  steel: {
    bar: "bg-rm-metal-textMuted/50",
    accent: "rgba(255,255,255,0.02)",
  },
};

export function LiveCommandCenterPanel({
  command,
  regionFilter = "all",
  bucketFilter = "all",
}: {
  command: CommandCenterResponse;
  regionFilter?: RegionSlug | "all";
  bucketFilter?: string;
}) {
  const center = buildLiveCommandCenter(command);
  const sections = center.sections
    .filter((section) => bucketFilter === "all" || section.id === bucketFilter)
    .map((section) => ({
      ...section,
      items: section.items.filter((match: PrematchCenterMatch) => {
        if (regionFilter !== "all" && match.regionSlug !== regionFilter) return false;
        return true;
      }),
    }));

  return (
    <section className="space-y-4">
      {center.unavailableReason && (
        <div className="border border-rm-status-warn/30 bg-rm-status-warn/8 px-4 py-3 font-mono text-xs text-rm-status-warn">
          {center.unavailableReason}
        </div>
      )}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id} className="space-y-3">
            {/* Section header */}
            <div className="relative bg-rm-metal-panel border border-rm-metal-border overflow-hidden"
                 style={{
                   boxShadow: `inset 0 1px 0 rgba(255,255,255,0.02), inset 0 -1px 0 rgba(0,0,0,0.2)`,
                   background: `radial-gradient(ellipse at 0% 50%, ${TONE_CONFIG[section.tone].accent} 0%, transparent 70%)`,
                 }}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className={`h-5 w-1 rounded-full ${TONE_CONFIG[section.tone].bar}`} />
                <div>
                  <div className="font-sans text-sm font-semibold text-rm-metal-textLight">
                    {section.title}
                    <span className="ml-2 font-mono text-[10px] text-rm-metal-textFaint">
                      {section.items.length} 场
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-rm-metal-textFaint/70">
                    {section.description}
                  </div>
                </div>
              </div>
            </div>

            {/* Cards */}
            {section.items.length > 0 ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {section.items.map((match) => (
                  <PrematchMatchCard key={match.id} match={match} />
                ))}
              </div>
            ) : (
              <div className="border border-rm-metal-border bg-rm-metal-panel/50 px-4 py-3 font-mono text-xs text-rm-metal-textFaint/60">
                {section.emptyLabel}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
