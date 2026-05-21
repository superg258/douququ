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
});
