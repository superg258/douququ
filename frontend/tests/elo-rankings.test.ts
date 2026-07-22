import { describe, expect, it } from "vitest";

import {
  resolveFinalEventFieldSize,
  resolveFinalEventParam,
} from "@/components/finals-elo-rankings";

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

describe("resolveFinalEventFieldSize", () => {
  it("uses the formal field capacity when only part of the field is confirmed", () => {
    expect(resolveFinalEventFieldSize({ fieldCapacity: 32, participantCount: 28 })).toBe(32);
  });

  it("falls back to the participant count for legacy payloads", () => {
    expect(resolveFinalEventFieldSize({ participantCount: 16 })).toBe(16);
  });
});
