import { describe, expect, it } from "vitest";

import {
  buildPredictionRecap,
  explainMatchPrediction,
} from "@/lib/prediction-insights";
import type { MatchRow, OverviewRegion, SimulationResponse } from "@/lib/types";

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    matchLabel: "R16-1",
    stage: "round_of_16",
    stageOrder: 1,
    roundNumber: 1,
    groupName: "",
    bestOf: 3,
    redTeam: { teamKey: "red", collegeName: "红方大学", teamName: "Red" },
    blueTeam: { teamKey: "blue", collegeName: "蓝方大学", teamName: "Blue" },
    scoreline: "2:1",
    winnerTeamKey: "red",
    loserTeamKey: "blue",
    pGameRed: 0.58,
    pGameBlue: 0.42,
    pSeriesRed: 0.66,
    pSeriesBlue: 0.34,
    deltaH2H: 0.24,
    redMu0: 1810,
    blueMu0: 1730,
    redDelta: 15,
    blueDelta: -12,
    confidenceLabel: "high",
    winnerNext: "next",
    loserNext: "next",
    ...overrides,
  };
}

function makeSimulation(matches: MatchRow[], regionSlug: OverviewRegion["regionSlug"] = "east_region"): SimulationResponse {
  return {
    meta: {
      regionSlug,
      regionName: regionSlug === "east_region" ? "东部赛区" : regionSlug,
      seed: 20260414,
      generatedAt: "2026-04-18T10:00:00.000Z",
      samplesPerMatch: 1000,
      nationalSlots: 8,
      repechageSlots: 6,
    },
    slots: [],
    groupRankings: {},
    matches,
    finalRankings: [],
    summary: {
      champion: { teamKey: "red", collegeName: "红方大学", teamName: "Red" },
      runnerUp: { teamKey: "blue", collegeName: "蓝方大学", teamName: "Blue" },
      thirdPlace: { teamKey: "third", collegeName: "第三大学", teamName: "Third" },
      fourthPlace: { teamKey: "fourth", collegeName: "第四大学", teamName: "Fourth" },
      nationalQualifiers: [],
      repechageQualifiers: [],
      matchCountByStage: {},
    },
  };
}

describe("prediction insights", () => {
  it("explains a match with favorite, scoreline, confidence, and reasons", () => {
    const explanation = explainMatchPrediction(makeMatch());

    expect(explanation.favoriteName).toBe("红方大学");
    expect(explanation.predictedScoreline).toBe("2:1");
    expect(explanation.confidenceText).toBe("高");
    expect(explanation.reasonBullets.join(" ")).toContain("TS2");
    expect(explanation.reasonBullets.join(" ")).toContain("Elo");
  });

  it("summarizes completed prediction hit rate and upset count", () => {
    const recap = buildPredictionRecap(
      makeSimulation([
        makeMatch({ matchLabel: "hit", isRealResult: true, pSeriesRed: 0.72, pSeriesBlue: 0.28, scoreline: "2:0", winnerTeamKey: "red" }),
        makeMatch({ matchLabel: "miss", isRealResult: true, pSeriesRed: 0.82, pSeriesBlue: 0.18, scoreline: "0:2", winnerTeamKey: "blue" }),
        makeMatch({ matchLabel: "pending", isRealResult: false }),
      ]),
    );

    expect(recap.completedMatches).toBe(2);
    expect(recap.winnerHits).toBe(1);
    expect(recap.winnerHitRate).toBeCloseTo(0.5);
    expect(recap.upsetMatches).toBe(1);
    expect(recap.byConfidence.high.completedMatches).toBe(2);
  });

});
