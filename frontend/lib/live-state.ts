import type { LiveMatchImpactRow, MatchRow } from "@/lib/types";

export interface LiveMatchImpactPair {
  matchId: string;
  red: LiveMatchImpactRow;
  blue: LiveMatchImpactRow;
}

function teamPairMatches(match: MatchRow, row: LiveMatchImpactRow) {
  return (
    (row.teamKey === match.redTeam.teamKey && row.opponentTeamKey === match.blueTeam.teamKey) ||
    (row.teamKey === match.blueTeam.teamKey && row.opponentTeamKey === match.redTeam.teamKey)
  );
}

export function buildLiveTimelineForTeam(teamKey: string, ledger: LiveMatchImpactRow[]): LiveMatchImpactRow[] {
  return ledger
    .filter((row) => row.teamKey === teamKey)
    .slice()
    .sort((left, right) => {
      if (left.matchDate !== right.matchDate) {
        return left.matchDate.localeCompare(right.matchDate);
      }
      return left.matchId.localeCompare(right.matchId);
    });
}

export function findLiveMatchImpactPair(match: MatchRow, ledger: LiveMatchImpactRow[]): LiveMatchImpactPair | null {
  if (!match.isRealResult) {
    return null;
  }

  const byMatchId = new Map<string, LiveMatchImpactRow[]>();
  for (const row of ledger) {
    if (!teamPairMatches(match, row)) {
      continue;
    }
    const current = byMatchId.get(row.matchId) ?? [];
    current.push(row);
    byMatchId.set(row.matchId, current);
  }

  for (const [matchId, rows] of byMatchId.entries()) {
    if (rows.length < 2) {
      continue;
    }
    const red = rows.find((row) => row.teamKey === match.redTeam.teamKey && row.opponentTeamKey === match.blueTeam.teamKey);
    const blue = rows.find((row) => row.teamKey === match.blueTeam.teamKey && row.opponentTeamKey === match.redTeam.teamKey);
    if (!red || !blue) {
      continue;
    }
    if (red.scoreline !== match.scoreline && blue.scoreline !== match.scoreline) {
      continue;
    }
    return { matchId, red, blue };
  }

  return null;
}
