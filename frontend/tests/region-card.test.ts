import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RegionCard } from "@/components/region-card";
import { buildOverviewDashboard } from "@/lib/overview-builders";
import type { OverviewResponse, OverviewTeam } from "@/lib/types";

function team(
  teamKey: string,
  collegeName: string,
  mu0: number,
  national: number,
  repechage: number,
  champion: number,
): OverviewTeam {
  return {
    teamKey,
    collegeName,
    teamName: `${collegeName}战队`,
    mu0,
    sigma0: 80,
    eloGlobalRank: 1,
    eloRegionRank: 1,
    seedTier: "S1",
    seedRankInRegion: 1,
    regionSlug: "east_region",
    regionName: "东部赛区",
    probabilities: {
      roundOf16: 0.9,
      repechage,
      national,
      champion,
    },
  };
}

function overview(): OverviewResponse {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    regions: [
      {
        regionSlug: "east_region",
        regionName: "东部赛区",
        nationalSlots: 1,
        repechageSlots: 1,
        monteCarlo: {
          aggregationMode: "seed_average",
          seedCount: 4,
          iterationsPerSeed: 100,
          effectiveIterations: 400,
          seeds: [1, 2, 3, 4],
          pairProbabilitySamples: 5000,
        },
        teams: [
          team("alpha", "甲校", 1800, 0.7, 0.05, 0.4),
          team("beta", "乙校", 1760, 0.3, 0.2, 0.2),
          team("gamma", "丙校", 1720, 0.08, 0.37, 0.1),
          team("delta", "丁校", 1680, 0.05, 0.1, 0.05),
        ],
      },
    ],
  };
}

describe("RegionCard", () => {
  it("uses national-or-repechage probability consistently in the repechage race", () => {
    const region = buildOverviewDashboard(overview()).regions[0];
    const markup = renderToStaticMarkup(createElement(RegionCard, { region, entryHref: null }));

    expect(region.repechageRace.cutoffTeam?.collegeName).toBe("乙校");
    expect(region.repechageRace.chasingTeams[0]?.collegeName).toBe("丙校");
    expect(markup).toContain("守位 50.0%");
    expect(markup).toContain("45.0%");
    expect(markup).not.toContain("37.0%");
  });

  it("renders repechage chasers with national plus repechage probability", () => {
    const response = overview();
    response.regions[0].teams = [
      team("alpha", "甲校", 1800, 0.9, 0.05, 0.7),
      team("beta", "乙校", 1760, 0.2, 0.2, 0.2),
      team("gamma", "丙校", 1720, 0.19, 0.05, 0.1),
    ];

    const region = buildOverviewDashboard(response).regions[0];
    const markup = renderToStaticMarkup(createElement(RegionCard, { region, entryHref: null }));

    expect(markup).toMatch(/复活赛卡位战圈[\s\S]*乙校[\s\S]*守位 40\.0%/);
    expect(markup).toMatch(/复活赛卡位战圈[\s\S]*丙校[\s\S]*24\.0%/);
    expect(markup).not.toMatch(/复活赛卡位战圈[\s\S]*丙校[\s\S]*5\.0%/);
  });

  it("renders every team in the strength matrix instead of truncating after six schools", () => {
    const response = overview();
    response.regions[0].teams = [
      team("alpha", "甲校", 1800, 0.9, 0.05, 0.7),
      team("beta", "乙校", 1760, 0.5, 0.2, 0.2),
      team("gamma", "丙校", 1720, 0.3, 0.2, 0.1),
      team("delta", "丁校", 1680, 0.2, 0.1, 0.05),
      team("epsilon", "戊校", 1640, 0.12, 0.1, 0.03),
      team("zeta", "己校", 1600, 0.08, 0.09, 0.02),
      team("eta", "庚校", 1560, 0.05, 0.08, 0.01),
      team("theta", "辛校", 1520, 0.03, 0.07, 0.005),
    ];

    const region = buildOverviewDashboard(response).regions[0];
    const markup = renderToStaticMarkup(createElement(RegionCard, { region, entryHref: null }));

    expect(markup).toContain("庚校");
    expect(markup).toContain("辛校");
    expect(markup).not.toContain("进入沙盘查看完整数据");
  });
});
