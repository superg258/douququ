import { describe, expect, it } from "vitest";

import { buildScheduleShareUrl } from "@/lib/share-link";

describe("schedule share links", () => {
  it("keeps semantic regional state without viewport coordinates", () => {
    const url = new URL(buildScheduleShareUrl({
      origin: "https://schedule.example",
      pathname: "/regions/south_region",
      mode: "live",
      seed: 20260414,
      state: { view: "playoff", highlight: "team:1" },
    }));
    expect(url.searchParams.get("view")).toBe("playoff");
    expect(url.searchParams.get("highlight")).toBe("team:1");
    expect(url.searchParams.get("mode")).toBe("live");
    expect(url.searchParams.has("seed")).toBe(false);
    expect(url.searchParams.has("x")).toBe(false);
  });

  it("requires and preserves the effective simulation seed", () => {
    const url = new URL(buildScheduleShareUrl({
      origin: "https://schedule.example",
      pathname: "/forecast-center",
      mode: "sim",
      seed: 20260729,
      state: { event: "nationals", stage: "swiss-a" },
    }));
    expect(url.searchParams.get("seed")).toBe("20260729");
    expect(() => buildScheduleShareUrl({
      origin: "https://schedule.example",
      pathname: "/forecast-center",
      mode: "sim",
      seed: null,
      state: {},
    })).toThrow("缺少有效种子");
  });
});
