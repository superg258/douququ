import { describe, expect, it } from "vitest";

import { findLiveMatchImpactPair } from "@/lib/live-state";
import { buildRegionHref } from "@/lib/region-config";
import type { LiveMatchImpactRow, MatchRow } from "@/lib/types";

function makeImpactRow(overrides: Partial<LiveMatchImpactRow> = {}): LiveMatchImpactRow {
  return {
    matchId: "official-1",
    matchDate: "2026-11-11",
    regionSlug: "south_region",
    stageFamily: "regional_group",
    teamKey: "red-team",
    opponentTeamKey: "blue-team",
    teamSide: "red",
    scoreline: "2:0",
    matchResult: "win",
    publishedRatingBeforeMatch: 1700,
    publishedRatingAfterMatch: 1694,
    publishedDeltaRating: -6,
    liveUpdateDeltaRating: 8,
    priorComponentDeltaRating: -14,
    confirmedPriorRatingAfterMatch: 0,
    residualPriorRatingAfterMatch: 42,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    matchLabel: "A-SWISS-1-1",
    stage: "swiss",
    stageOrder: 1,
    roundNumber: 1,
    groupName: "A",
    bestOf: 3,
    isRealResult: true,
    isConfirmedMatchup: true,
    redTeam: { teamKey: "red-team", collegeName: "Red College", teamName: "Red" },
    blueTeam: { teamKey: "blue-team", collegeName: "Blue College", teamName: "Blue" },
    scoreline: "2:0",
    winnerTeamKey: "red-team",
    loserTeamKey: "blue-team",
    pGameRed: 0.5,
    pGameBlue: 0.5,
    pSeriesRed: 0.5,
    pSeriesBlue: 0.5,
    deltaH2H: 0,
    confidenceLabel: "medium",
    winnerNext: "next",
    loserNext: "next",
    ...overrides,
  };
}

describe("buildRegionHref", () => {
  it("preserves live mode in workspace deep links", () => {
    const href = buildRegionHref("south_region", "swiss-a", {
      seed: 20261111,
      highlight: "red-team",
      mode: "live",
    });

    expect(href).toContain("view=swiss-a");
    expect(href).toContain("seed=20261111");
    expect(href).toContain("highlight=red-team");
    expect(href).toContain("mode=live");
  });
});

describe("findLiveMatchImpactPair", () => {
  it("returns both team-side ledger rows for a completed live match", () => {
    const match = makeMatch();
    const ledger = [
      makeImpactRow(),
      makeImpactRow({
        teamKey: "blue-team",
        opponentTeamKey: "red-team",
        teamSide: "blue",
        matchResult: "loss",
        publishedRatingBeforeMatch: 1680,
        publishedRatingAfterMatch: 1686,
        publishedDeltaRating: 6,
        liveUpdateDeltaRating: -8,
        priorComponentDeltaRating: 14,
      }),
    ];

    const pair = findLiveMatchImpactPair(match, ledger);

    expect(pair?.red.teamKey).toBe("red-team");
    expect(pair?.blue.teamKey).toBe("blue-team");
    expect(pair?.red.publishedDeltaRating).toBe(-6);
  });

  it("ignores simulated matches without actual live results", () => {
    const pending = makeMatch({ isRealResult: false });
    const pair = findLiveMatchImpactPair(pending, [makeImpactRow()]);
    expect(pair).toBeNull();
  });
});
