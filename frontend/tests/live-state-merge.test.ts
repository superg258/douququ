import { describe, expect, it } from "vitest";

import { mergeRegionLiveStates } from "@/lib/live-state-merge";
import type { LiveStateResponse, RegionSlug } from "@/lib/types";

function state(regionSlug: RegionSlug, revision: string): LiveStateResponse {
  return {
    regionSlug,
    dataRevision: revision,
  } as LiveStateResponse;
}

describe("mergeRegionLiveStates", () => {
  it("updates successful regions while preserving last-known failed regions", () => {
    const current = [
      state("south_region", "south-old"),
      state("east_region", "east-old"),
      state("north_region", "north-old"),
    ];

    const merged = mergeRegionLiveStates(current, [
      state("south_region", "south-new"),
      state("north_region", "north-new"),
    ]);

    expect(merged.map((item) => [item.regionSlug, item.dataRevision])).toEqual([
      ["south_region", "south-new"],
      ["east_region", "east-old"],
      ["north_region", "north-new"],
    ]);
  });

  it("keeps published region order when the first successful load is partial", () => {
    const merged = mergeRegionLiveStates([], [
      state("north_region", "north-new"),
      state("south_region", "south-new"),
    ]);

    expect(merged.map((item) => item.regionSlug)).toEqual([
      "south_region",
      "north_region",
    ]);
  });
});
