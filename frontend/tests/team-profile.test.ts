import { describe, expect, it } from "vitest";

import { resolveTeamProfileRequest } from "@/components/team-profile-page";
import { buildTeamHref, formatTeamProfileSubtitle } from "@/lib/team-profile";

describe("team profile helpers", () => {
  it("encodes teamKey as a stable team profile route segment", () => {
    const href = buildTeamHref("华南理工大学::华南虎");

    expect(href).toBe("/teams/%E5%8D%8E%E5%8D%97%E7%90%86%E5%B7%A5%E5%A4%A7%E5%AD%A6%3A%3A%E5%8D%8E%E5%8D%97%E8%99%8E");
  });

  it("omits slot text until an official live slot exists", () => {
    expect(formatTeamProfileSubtitle("Main", null)).toBe("Main");
    expect(formatTeamProfileSubtitle("Main", { slot: "A1" })).toBe("Main · A1");
  });
});

describe("resolveTeamProfileRequest", () => {
  it("falls back to the live default context when params are missing", () => {
    expect(resolveTeamProfileRequest(null, null)).toEqual({ seed: 20260414, mode: "live" });
  });

  it("reads seed and mode from the URL query", () => {
    expect(resolveTeamProfileRequest("12345", "sim")).toEqual({ seed: 12345, mode: "sim" });
  });

  it("rejects invalid seed and mode values", () => {
    expect(resolveTeamProfileRequest("abc", "sandbox")).toEqual({ seed: 20260414, mode: "live" });
    expect(resolveTeamProfileRequest("-3", "live")).toEqual({ seed: 20260414, mode: "live" });
  });
});
