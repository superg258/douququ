import { describe, expect, it } from "vitest";

import { buildWorkspaceStage } from "@/lib/canvas-builders";
import type { SlotRow } from "@/lib/types";

function slot(overrides: Partial<SlotRow> = {}): SlotRow {
  return {
    teamKey: "alpha",
    collegeName: "甲校",
    teamName: "甲校战队",
    slot: "A1",
    groupName: "A",
    drawBox: "A",
    seedTier: "tier1",
    seedRankInRegion: 1,
    mu0: 1800,
    sigma0: 80,
    eloGlobalRank: 1,
    ...overrides,
  };
}

describe("user-facing display labels", () => {
  it("renders slot seed tiers in Chinese instead of internal tier codes", () => {
    const stage = buildWorkspaceStage("slots", "south_region", {
      meta: {
        regionSlug: "south_region",
        regionName: "南部赛区",
        seed: 20260414,
        generatedAt: "2026-05-02T00:00:00.000Z",
        samplesPerMatch: 32,
        nationalSlots: 3,
        repechageSlots: 2,
      },
      slots: [slot(), slot({ teamKey: "beta", collegeName: "乙校", teamName: "乙校战队", slot: "A2", seedTier: "unseeded" })],
      groupRankings: { A: [], B: [] },
      matches: [],
      finalRankings: [],
      summary: {
        champion: { teamKey: "alpha", collegeName: "甲校", teamName: "甲校战队" },
        runnerUp: { teamKey: "beta", collegeName: "乙校", teamName: "乙校战队" },
        thirdPlace: { teamKey: "gamma", collegeName: "丙校", teamName: "丙校战队" },
        fourthPlace: { teamKey: "delta", collegeName: "丁校", teamName: "丁校战队" },
        nationalQualifiers: [],
        repechageQualifiers: [],
        matchCountByStage: {},
      },
    });

    const statLines = stage.cards
      .filter((card) => card.kind === "team")
      .map((card) => card.statLine)
      .join(" ");

    expect(statLines).toContain("一档种子");
    expect(statLines).toContain("非种子");
    expect(statLines).not.toContain("tier1");
    expect(statLines).not.toContain("unseeded");
  });

  it("renders match cards with readable match labels instead of raw schedule ids", () => {
    const stage = buildWorkspaceStage("playoff", "south_region", {
      meta: {
        regionSlug: "south_region",
        regionName: "南部赛区",
        seed: 20260414,
        generatedAt: "2026-05-02T00:00:00.000Z",
        samplesPerMatch: 32,
        nationalSlots: 3,
        repechageSlots: 2,
      },
      slots: [],
      groupRankings: { A: [], B: [] },
      matches: [
        {
          matchLabel: "R16-1",
          stage: "round_of_16",
          stageOrder: 4,
          roundNumber: 1,
          groupName: "",
          bestOf: 3,
          isRealResult: false,
          isConfirmedMatchup: true,
          redTeam: { teamKey: "alpha", collegeName: "甲校", teamName: "甲校战队" },
          blueTeam: { teamKey: "beta", collegeName: "乙校", teamName: "乙校战队" },
          scoreline: "2:0",
          winnerTeamKey: "alpha",
          loserTeamKey: "beta",
          pGameRed: 0.6,
          pGameBlue: 0.4,
          pSeriesRed: 0.65,
          pSeriesBlue: 0.35,
          deltaH2H: 0,
          confidenceLabel: "medium",
          winnerNext: "next",
          loserNext: "next",
        },
      ],
      finalRankings: [],
      summary: {
        champion: { teamKey: "alpha", collegeName: "甲校", teamName: "甲校战队" },
        runnerUp: { teamKey: "beta", collegeName: "乙校", teamName: "乙校战队" },
        thirdPlace: { teamKey: "gamma", collegeName: "丙校", teamName: "丙校战队" },
        fourthPlace: { teamKey: "delta", collegeName: "丁校", teamName: "丁校战队" },
        nationalQualifiers: [],
        repechageQualifiers: [],
        matchCountByStage: {},
      },
    });

    const matchCard = stage.cards.find((card) => card.kind === "match");

    expect(matchCard).toMatchObject({ displayLabel: "16 进 8 第 1 场" });
    expect(matchCard?.displayLabel).not.toContain("R16-1");
  });
});
