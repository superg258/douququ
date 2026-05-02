import { describe, expect, it } from "vitest";

import { deriveMatchRatingBreakdown, formatSignedRatingDelta } from "@/lib/live-rating";
import type { MatchRow } from "@/lib/types";

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    matchLabel: "A-SWISS-1-1",
    stage: "swiss",
    stageOrder: 1,
    roundNumber: 1,
    groupName: "A",
    bestOf: 3,
    isRealResult: true,
    redTeam: {
      teamKey: "red",
      collegeName: "红方大学",
      teamName: "红方",
    },
    blueTeam: {
      teamKey: "blue",
      collegeName: "蓝方大学",
      teamName: "蓝方",
    },
    scoreline: "2:0",
    winnerTeamKey: "red",
    loserTeamKey: "blue",
    pGameRed: 0.6,
    pGameBlue: 0.4,
    pSeriesRed: 0.7,
    pSeriesBlue: 0.3,
    deltaH2H: 0,
    confidenceLabel: "medium",
    winnerNext: "next",
    loserNext: "next",
    redMu0: 1700,
    blueMu0: 1680,
    redDelta: -6,
    blueDelta: 6,
    redLiveDelta: 8,
    blueLiveDelta: -8,
    redPriorDelta: -14,
    bluePriorDelta: 14,
    redPriorAdjustmentLabel: "前三轮先验修正",
    bluePriorAdjustmentLabel: "前三轮先验修正",
    ...overrides,
  };
}

describe("live rating helpers", () => {
  it("formats signed rating deltas without hiding zero", () => {
    expect(formatSignedRatingDelta(8)).toBe("+8.0");
    expect(formatSignedRatingDelta(-14)).toBe("-14.0");
    expect(formatSignedRatingDelta(0)).toBe("0.0");
  });

  it("splits the first three rounds prior adjustment from the live match update", () => {
    expect(deriveMatchRatingBreakdown(match(), "red")).toMatchObject({
      teamName: "红方大学",
      before: 1700,
      after: 1694,
      totalDelta: -6,
      liveDelta: 8,
      priorDelta: -14,
      priorLabel: "前三轮先验修正",
      hasSplitAdjustment: true,
    });
  });
});
