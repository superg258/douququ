import { describe, expect, it } from "vitest";

import { sortTeamsForWorkspaceSearch } from "@/lib/workspace-search";
import type { OverviewTeam } from "@/lib/types";

function team(
  regionSlug: OverviewTeam["regionSlug"],
  collegeName: string,
  champion = 0.1
): OverviewTeam {
  return {
    teamKey: `${regionSlug}:${collegeName}`,
    collegeName,
    teamName: `${collegeName}战队`,
    regionSlug,
    regionName: regionSlug === "north_region" ? "北部赛区" : regionSlug === "east_region" ? "东部赛区" : "南部赛区",
    mu0: 1500,
    sigma0: 100,
    currentElo: 1500,
    eloRegionRank: 1,
    eloGlobalRank: 1,
    preseasonElo: 1500,
    eloDeltaFromPreseason: 0,
    eloRankSource: "preseason",
    seedTier: "seeded",
    seedRankInRegion: 1,
    probabilities: {
      roundOf16: 1,
      repechage: 0.2,
      national: 0.5,
      champion,
    },
  };
}

describe("workspace search sorting", () => {
  it("shows only the current region when the query is empty", () => {
    const rows = sortTeamsForWorkspaceSearch(
      [
        team("south_region", "上海交通大学"),
        team("north_region", "东北大学"),
        team("north_region", "太原工业学院"),
      ],
      "",
      "north_region"
    );

    expect(rows.map((row) => row.collegeName)).toEqual(["东北大学", "太原工业学院"]);
  });

  it("searches globally but ranks current-region matches first", () => {
    const rows = sortTeamsForWorkspaceSearch(
      [
        team("south_region", "东北林业大学", 0.8),
        team("north_region", "东北大学", 0.3),
        team("east_region", "东北石油大学", 0.9),
      ],
      "东北",
      "north_region"
    );

    expect(rows.map((row) => row.regionSlug)).toEqual(["north_region", "east_region", "south_region"]);
  });
});
