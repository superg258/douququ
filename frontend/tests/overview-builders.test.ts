import { describe, expect, it } from "vitest";

import { buildOverviewDashboard } from "@/lib/overview-builders";
import type { OverviewResponse, OverviewTeam } from "@/lib/types";

function makeTeam(
  teamKey: string,
  collegeName: string,
  regionSlug: "east_region" | "south_region" | "north_region",
  regionName: string,
  mu0: number,
  national: number,
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
    regionSlug,
    regionName,
    probabilities: {
      roundOf16: 0.9,
      repechage: 0.1,
      national,
      champion,
    },
  };
}

function makeOverview(): OverviewResponse {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    regions: [
      {
        regionSlug: "east_region",
        regionName: "东部赛区",
        nationalSlots: 2,
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
          makeTeam("alpha", "甲校", "east_region", "东部赛区", 1800, 0.76, 0.4),
          makeTeam("beta", "乙校", "east_region", "东部赛区", 1760, 0.7, 0.28),
          makeTeam("gamma", "丙校", "east_region", "东部赛区", 1720, 0.69, 0.18),
          makeTeam("delta", "丁校", "east_region", "东部赛区", 1680, 0.4, 0.08),
        ],
      },
    ],
  };
}

function makeRegionStrengthOverview(): OverviewResponse {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    regions: [
      {
        regionSlug: "south_region",
        regionName: "南部赛区",
        nationalSlots: 3,
        repechageSlots: 2,
        monteCarlo: {
          aggregationMode: "seed_average",
          seedCount: 4,
          iterationsPerSeed: 100,
          effectiveIterations: 400,
          seeds: [1, 2, 3, 4],
          pairProbabilitySamples: 5000,
        },
        teams: [
          makeTeam("south-a", "南甲", "south_region", "南部赛区", 1880, 0.83, 0.36),
          makeTeam("south-b", "南乙", "south_region", "南部赛区", 1840, 0.72, 0.18),
          makeTeam("south-c", "南丙", "south_region", "南部赛区", 1810, 0.66, 0.1),
          makeTeam("south-d", "南丁", "south_region", "南部赛区", 1790, 0.58, 0.07),
          makeTeam("south-e", "南戊", "south_region", "南部赛区", 1760, 0.46, 0.04),
          makeTeam("south-f", "南己", "south_region", "南部赛区", 1740, 0.4, 0.03),
          makeTeam("south-g", "南庚", "south_region", "南部赛区", 1720, 0.32, 0.02),
          makeTeam("south-h", "南辛", "south_region", "南部赛区", 1700, 0.26, 0.01),
        ],
      },
      {
        regionSlug: "east_region",
        regionName: "东部赛区",
        nationalSlots: 3,
        repechageSlots: 2,
        monteCarlo: {
          aggregationMode: "seed_average",
          seedCount: 4,
          iterationsPerSeed: 100,
          effectiveIterations: 400,
          seeds: [1, 2, 3, 4],
          pairProbabilitySamples: 5000,
        },
        teams: [
          makeTeam("east-a", "东甲", "east_region", "东部赛区", 1900, 0.82, 0.34),
          makeTeam("east-b", "东乙", "east_region", "东部赛区", 1860, 0.74, 0.26),
          makeTeam("east-c", "东丙", "east_region", "东部赛区", 1840, 0.64, 0.2),
          makeTeam("east-d", "东丁", "east_region", "东部赛区", 1800, 0.5, 0.09),
          makeTeam("east-e", "东戊", "east_region", "东部赛区", 1660, 0.36, 0.03),
          makeTeam("east-f", "东己", "east_region", "东部赛区", 1640, 0.29, 0.02),
          makeTeam("east-g", "东庚", "east_region", "东部赛区", 1620, 0.23, 0.01),
          makeTeam("east-h", "东辛", "east_region", "东部赛区", 1600, 0.18, 0.01),
        ],
      },
      {
        regionSlug: "north_region",
        regionName: "北部赛区",
        nationalSlots: 3,
        repechageSlots: 2,
        monteCarlo: {
          aggregationMode: "seed_average",
          seedCount: 4,
          iterationsPerSeed: 100,
          effectiveIterations: 400,
          seeds: [1, 2, 3, 4],
          pairProbabilitySamples: 5000,
        },
        teams: [
          makeTeam("north-a", "北甲", "north_region", "北部赛区", 1910, 0.85, 0.32),
          makeTeam("north-b", "北乙", "north_region", "北部赛区", 1870, 0.79, 0.2),
          makeTeam("north-c", "北丙", "north_region", "北部赛区", 1830, 0.73, 0.15),
          makeTeam("north-d", "北丁", "north_region", "北部赛区", 1800, 0.61, 0.08),
          makeTeam("north-e", "北戊", "north_region", "北部赛区", 1780, 0.49, 0.05),
          makeTeam("north-f", "北己", "north_region", "北部赛区", 1760, 0.42, 0.04),
          makeTeam("north-g", "北庚", "north_region", "北部赛区", 1740, 0.35, 0.03),
          makeTeam("north-h", "北辛", "north_region", "北部赛区", 1720, 0.28, 0.02),
        ],
      },
    ],
  };
}

describe("buildOverviewDashboard", () => {
  it("treats 70 percent national probability as locked for region copy and counts", () => {
    const dashboard = buildOverviewDashboard(makeOverview());
    const region = dashboard.regions[0];

    expect(region.nationalLocks.map((team) => team.collegeName)).toEqual(["甲校", "乙校"]);
    expect(region.nationalRace.locksCount).toBe(2);
    expect(region.summarySentence).toContain("已有2队稳进国赛");
    expect(region.summarySentence).toContain("乙校正守在最后一张国赛席位上");
  });

  it("gives head-heavy east region a stronger composite score than a depth-only formula would", () => {
    const dashboard = buildOverviewDashboard(makeRegionStrengthOverview());
    const east = dashboard.regionStrength.find((row) => row.regionSlug === "east_region");
    const south = dashboard.regionStrength.find((row) => row.regionSlug === "south_region");

    expect(east?.powerIndex).toBeGreaterThan(south?.powerIndex ?? 0);
  });
});
