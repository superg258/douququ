import { describe, expect, it } from "vitest";
import { buildFullSeasonTrajectories } from "@/lib/elo-trajectory";
import type { LiveStateLedgerRow, OverviewResponse } from "@/lib/types";

function makeLedgerRow(
  teamKey: string,
  matchDate: string,
  ratingAfter: number,
): LiveStateLedgerRow {
  return {
    matchId: `match-${teamKey}-${matchDate}`,
    matchDate,
    regionSlug: "south_region",
    stageFamily: "swiss",
    teamKey,
    opponentTeamKey: "opponent",
    teamSide: "red",
    scoreline: "2:1",
    matchResult: "win",
    publishedRatingBeforeMatch: ratingAfter - 5,
    publishedRatingAfterMatch: ratingAfter,
    publishedDeltaRating: 5,
    liveUpdateDeltaRating: 5,
    priorComponentDeltaRating: 0,
    priorRetentionFractionBeforeMatch: 0.5,
    priorRetentionFractionAfterMatch: 0.5,
    priorAbsorptionFractionBeforeMatch: 0.5,
    priorAbsorptionFractionAfterMatch: 0.5,
    confirmedPriorRatingAfterMatch: ratingAfter,
    residualPriorRatingAfterMatch: 0,
  };
}

function makeOverview(teams: Array<{ teamKey: string; preseasonElo?: number; mu0: number }>): OverviewResponse {
  return {
    generatedAt: "2026-07-22T00:00:00Z",
    regions: [
      {
        regionSlug: "south_region",
        regionName: "南部赛区",
        nationalSlots: 4,
        repechageSlots: 4,
        monteCarlo: {
          aggregationMode: "mean",
          seedCount: 1,
          iterationsPerSeed: 1000,
          effectiveIterations: 1000,
          seeds: [1],
          pairProbabilitySamples: 100,
        },
        teams: teams.map((t) => ({
          teamKey: t.teamKey,
          collegeName: t.teamKey,
          teamName: "A队",
          mu0: t.mu0,
          preseasonElo: t.preseasonElo,
          sigma0: 100,
          eloGlobalRank: 1,
          eloRegionRank: 1,
          seedTier: "第一梯队",
          seedRankInRegion: 1,
          regionSlug: "south_region" as const,
          regionName: "南部赛区",
          probabilities: { roundOf16: 0.5, repechage: 0.3, national: 0.2, champion: 0.05 },
        })),
      },
    ],
  };
}

describe("buildFullSeasonTrajectories", () => {
  it("prepends preseasonElo to finals trajectory", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: 1800, mu0: 1800 }]);
    const finalsTrajectories = {
      team1: [1800, 1830, 1835],
    };

    const result = buildFullSeasonTrajectories(overview, [], finalsTrajectories);

    expect(result.team1).toEqual([1800, 1830, 1835]);
  });

  it("inserts regional ledger points between preseason and finals", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: 1800, mu0: 1800 }]);
    const regionLedgers = [
      [
        makeLedgerRow("team1", "2026-05-01", 1805),
        makeLedgerRow("team1", "2026-05-15", 1812),
        makeLedgerRow("team1", "2026-06-01", 1820),
      ],
    ];
    // Finals trajectory starts at preseasonElo → eventEntryElo (should ≈ last regional point)
    const finalsTrajectories = {
      team1: [1800, 1820, 1830],
    };

    const result = buildFullSeasonTrajectories(overview, regionLedgers, finalsTrajectories);

    // preseason(1800) → regional(1805,1812,1820) → finals(1820 deduped, 1830)
    expect(result.team1).toEqual([1800, 1805, 1812, 1820, 1830]);
  });

  it("deduplicates consecutive identical values", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: 1800, mu0: 1800 }]);
    const regionLedgers = [
      [
        makeLedgerRow("team1", "2026-05-01", 1800), // same as preseason
        makeLedgerRow("team1", "2026-05-15", 1800), // same again
      ],
    ];
    const finalsTrajectories = {
      team1: [1800, 1800, 1810],
    };

    const result = buildFullSeasonTrajectories(overview, regionLedgers, finalsTrajectories);

    // All 1800s deduped to one, then 1810
    expect(result.team1).toEqual([1800, 1810]);
  });

  it("falls back to mu0 when preseasonElo is undefined", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: undefined, mu0: 1750 }]);
    const finalsTrajectories = {
      team1: [1750, 1780],
    };

    const result = buildFullSeasonTrajectories(overview, [], finalsTrajectories);

    expect(result.team1).toEqual([1750, 1780]);
  });

  it("returns empty-handed for teams with fewer than 2 points", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: 1800, mu0: 1800 }]);

    const result = buildFullSeasonTrajectories(overview, [], {});

    // Only preseasonElo, no trajectory data → not enough for sparkline
    expect(result.team1).toBeUndefined();
  });

  it("merges teams from multiple regions", () => {
    const overview = makeOverview([
      { teamKey: "team_a", preseasonElo: 1800, mu0: 1800 },
      { teamKey: "team_b", preseasonElo: 1900, mu0: 1900 },
    ]);
    const regionLedgers = [
      [makeLedgerRow("team_a", "2026-05-01", 1810)],
      [makeLedgerRow("team_b", "2026-05-01", 1910)],
    ];
    const finalsTrajectories = {
      team_a: [1800, 1810, 1820],
      team_b: [1900, 1910],
    };

    const result = buildFullSeasonTrajectories(overview, regionLedgers, finalsTrajectories);

    expect(result.team_a).toEqual([1800, 1810, 1820]);
    expect(result.team_b).toEqual([1900, 1910]);
  });

  it("sorts ledger rows by matchDate regardless of input order", () => {
    const overview = makeOverview([{ teamKey: "team1", preseasonElo: 1800, mu0: 1800 }]);
    const regionLedgers = [
      [
        makeLedgerRow("team1", "2026-06-01", 1830),
        makeLedgerRow("team1", "2026-05-01", 1810),
        makeLedgerRow("team1", "2026-04-15", 1805),
      ],
    ];
    const finalsTrajectories = { team1: [1800, 1830] };

    const result = buildFullSeasonTrajectories(overview, regionLedgers, finalsTrajectories);

    // Should be sorted by date: 1805, 1810, 1830
    expect(result.team1).toEqual([1800, 1805, 1810, 1830]);
  });
});
