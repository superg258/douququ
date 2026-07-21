import { describe, expect, it } from "vitest";

import { resolveFinalEventParam } from "@/components/finals-elo-rankings";

describe("resolveFinalEventParam", () => {
  it("defaults to nationals when the event param is missing", () => {
    expect(resolveFinalEventParam(null)).toBe("nationals");
  });

  it("accepts repechage and nationals", () => {
    expect(resolveFinalEventParam("repechage")).toBe("repechage");
    expect(resolveFinalEventParam("nationals")).toBe("nationals");
  });

  it("falls back to nationals for unknown values", () => {
    expect(resolveFinalEventParam("group")).toBe("nationals");
    expect(resolveFinalEventParam("")).toBe("nationals");
  });
});
