// frontend/components/rankings-columns.tsx
import { useMemo } from "react";
import type { EloRankingSection } from "@/lib/types";
import { RankingsColumn } from "@/components/rankings-column";

export function RankingsColumns({ sections }: { sections: EloRankingSection[] }) {
  const globalRanks = useMemo(() => {
    const allTeams = sections.flatMap((s) => s.rows);
    allTeams.sort((a, b) => (b.currentElo ?? b.mu0) - (a.currentElo ?? a.mu0));
    const ranks = new Map<string, number>();
    allTeams.forEach((team, i) => ranks.set(team.teamKey, i + 1));
    return ranks;
  }, [sections]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      {sections.map((section) => (
        <RankingsColumn
          key={section.regionSlug}
          regionSlug={section.regionSlug}
          regionName={section.regionName}
          topTeam={section.topTeam?.collegeName ?? "待定"}
          top8AverageElo={section.top8AverageElo}
          medianElo={section.medianElo}
          rows={section.rows}
          globalRanks={globalRanks}
        />
      ))}
    </div>
  );
}
