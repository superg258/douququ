import { describe, expect, it } from "vitest";

import { predictScoreline } from "@/components/canvas-card";
import { derivePredictionVerdict, predictMatchScoreline } from "@/lib/prediction-insights";
import { parseScoreline } from "@/lib/scoreline";
import type { MatchRow } from "@/lib/types";

describe("scoreline prediction", () => {
  it("uses calibrated BO3 scoreline thresholds instead of exact-score modal picks", () => {
    expect(predictScoreline(0.626451, 0.685633, 3).scoreline).toBe("2:0");
    expect(predictScoreline(0.570535, 0.605101, 3).scoreline).toBe("2:1");
    expect(predictScoreline(0.442718, 0.414453, 3).scoreline).toBe("1:2");
    expect(predictScoreline(0.358709, 0.293705, 3).scoreline).toBe("0:2");
    expect(predictMatchScoreline(0.626451, 0.685633, 3).scoreline).toBe("2:0");
    expect(predictMatchScoreline(0.570535, 0.605101, 3).scoreline).toBe("2:1");
    expect(predictMatchScoreline(0.442718, 0.414453, 3).scoreline).toBe("1:2");
    expect(predictMatchScoreline(0.358709, 0.293705, 3).scoreline).toBe("0:2");
  });

  it("uses conservative BO5 scoreline thresholds for display picks", () => {
    expect(predictScoreline(0.62, 0.67, 5).scoreline).toBe("3:2");
    expect(predictScoreline(0.64, 0.70, 5).scoreline).toBe("3:1");
    expect(predictScoreline(0.70, 0.86, 5).scoreline).toBe("3:1");
    expect(predictScoreline(0.72, 0.90, 5).scoreline).toBe("3:0");
    expect(predictMatchScoreline(0.45, 0.33, 5).scoreline).toBe("2:3");
    expect(predictMatchScoreline(0.40, 0.14, 5).scoreline).toBe("1:3");
    expect(predictMatchScoreline(0.35, 0.10, 5).scoreline).toBe("0:3");
  });
});

describe("parseScoreline", () => {
  it("parses red and blue games from a scoreline string", () => {
    expect(parseScoreline("2:1")).toEqual([2, 1]);
    expect(parseScoreline("0:3")).toEqual([0, 3]);
  });

  it("falls back to 0:0 for empty values", () => {
    expect(parseScoreline(undefined)).toEqual([0, 0]);
    expect(parseScoreline(null)).toEqual([0, 0]);
    expect(parseScoreline("")).toEqual([0, 0]);
  });
});

describe("derivePredictionVerdict", () => {
  function makeMatch(overrides: Partial<MatchRow>): MatchRow {
    return {
      matchLabel: "M1",
      stage: "playoff",
      stageOrder: 1,
      roundNumber: 1,
      groupName: "",
      bestOf: 3,
      redTeam: { teamKey: "red", collegeName: "红方", teamName: "红方队" },
      blueTeam: { teamKey: "blue", collegeName: "蓝方", teamName: "蓝方队" },
      scoreline: "0:0",
      winnerTeamKey: "red",
      loserTeamKey: "blue",
      pGameRed: 0.6,
      pGameBlue: 0.4,
      pSeriesRed: 0.65,
      pSeriesBlue: 0.35,
      deltaH2H: 0,
      confidenceLabel: "medium",
      winnerNext: "",
      loserNext: "",
      ...overrides,
    };
  }

  it("returns null for matches without a real result", () => {
    expect(derivePredictionVerdict(makeMatch({ isRealResult: false, scoreline: "0:0" }), "2:0")).toBeNull();
  });

  it("flags an upset when the predicted winner loses", () => {
    expect(derivePredictionVerdict(makeMatch({ isRealResult: true, scoreline: "1:2" }), "2:0")).toBe("upset");
  });

  it("flags a deviation when the winner matches but the scoreline differs", () => {
    expect(derivePredictionVerdict(makeMatch({ isRealResult: true, scoreline: "2:1" }), "2:0")).toBe("deviation");
  });

  it("flags an exact hit when the scoreline matches", () => {
    expect(derivePredictionVerdict(makeMatch({ isRealResult: true, scoreline: "2:0" }), "2:0")).toBe("exact");
  });
});
