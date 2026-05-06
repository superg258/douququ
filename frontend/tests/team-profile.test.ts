import { describe, expect, it } from "vitest";

import { buildTeamHref } from "@/lib/team-profile";

describe("team profile helpers", () => {
  it("encodes teamKey as a stable team profile route segment", () => {
    const href = buildTeamHref("华南理工大学::华南虎");

    expect(href).toBe("/teams/%E5%8D%8E%E5%8D%97%E7%90%86%E5%B7%A5%E5%A4%A7%E5%AD%A6%3A%3A%E5%8D%8E%E5%8D%97%E8%99%8E");
  });
});
