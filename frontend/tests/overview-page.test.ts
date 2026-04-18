import { describe, expect, it } from "vitest";

import * as overviewPage from "@/components/overview-page";

describe("nationalRaceChipLabel", () => {
  it("shows chase-group wording instead of reusing the steady-advance label", () => {
    expect(typeof overviewPage["nationalRaceChipLabel"]).toBe("function");
    expect(overviewPage["nationalRaceChipLabel"](2)).toBe("追赶 2 队");
  });
});
