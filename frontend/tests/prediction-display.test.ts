import { describe, expect, it } from "vitest";

import {
  formatProbability,
  getPredictedAdvantageLabel,
} from "@/lib/prediction-display";

describe("prediction display helpers", () => {
  it("keeps an advantage label when rounded card rates both display as 50%", () => {
    expect(getPredictedAdvantageLabel({ pSeriesRed: 0.5004, pSeriesBlue: 0.4996, predictedScoreline: "2:1" })).toBe("红方占优");
    expect(getPredictedAdvantageLabel({ pSeriesRed: 0.4996, pSeriesBlue: 0.5004, predictedScoreline: "1:2" })).toBe("蓝方占优");
  });

  it("falls back to predicted scoreline when probabilities are exactly tied", () => {
    expect(getPredictedAdvantageLabel({ pSeriesRed: 0.5, pSeriesBlue: 0.5, predictedScoreline: "2:1" })).toBe("红方占优");
    expect(getPredictedAdvantageLabel({ pSeriesRed: 0.5, pSeriesBlue: 0.5, predictedScoreline: "1:2" })).toBe("蓝方占优");
  });

  it("can format detail probabilities with higher precision", () => {
    expect(formatProbability(0.5004, 2)).toBe("50.04%");
    expect(formatProbability(0.4996, 2)).toBe("49.96%");
  });
});
