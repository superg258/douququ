import PinyinMatch from "pinyin-match";

import type { OverviewTeam, RegionSlug } from "@/lib/types";

function matchesTeamQuery(team: OverviewTeam, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }
  return (
    team.collegeName.includes(normalizedQuery) ||
    team.teamName.includes(normalizedQuery) ||
    Boolean(PinyinMatch.match(team.collegeName, normalizedQuery)) ||
    Boolean(PinyinMatch.match(team.teamName, normalizedQuery))
  );
}

function searchRank(team: OverviewTeam) {
  return [
    team.eloRegionRank,
    -team.probabilities.national,
    -team.probabilities.champion,
    team.collegeName,
  ] as const;
}

export function sortTeamsForWorkspaceSearch(
  teams: OverviewTeam[],
  query: string,
  currentRegionSlug: RegionSlug
) {
  const normalizedQuery = query.trim();
  const rows = normalizedQuery
    ? teams.filter((team) => matchesTeamQuery(team, normalizedQuery))
    : teams.filter((team) => team.regionSlug === currentRegionSlug);

  return [...rows].sort((left, right) => {
    if (left.regionSlug === currentRegionSlug && right.regionSlug !== currentRegionSlug) {
      return -1;
    }
    if (left.regionSlug !== currentRegionSlug && right.regionSlug === currentRegionSlug) {
      return 1;
    }

    const leftRank = searchRank(left);
    const rightRank = searchRank(right);
    for (let index = 0; index < leftRank.length; index += 1) {
      if (leftRank[index] < rightRank[index]) return -1;
      if (leftRank[index] > rightRank[index]) return 1;
    }
    return 0;
  });
}
