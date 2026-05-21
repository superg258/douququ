import { describe, expect, it } from "vitest";

import { predictScoreline } from "@/components/canvas-card";
import { predictMatchScoreline } from "@/lib/prediction-insights";

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
