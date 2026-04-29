import { describe, expect, it } from "vitest";

import { buildWorkspaceStage } from "@/lib/canvas-builders";
import type { FinalRankingRow, GroupRankingRow, RegionSlug, SimulationResponse, SlotRow } from "@/lib/types";

function makeSlot(teamKey: string, groupName: "A" | "B", slot: string): SlotRow {
  return {
    teamKey,
    collegeName: `${teamKey} College`,
    teamName: teamKey,
    groupName,
    drawBox: groupName === "A" ? "upper" : "lower",
    slot,
    seedTier: "S1",
    seedRankInRegion: 1,
    mu0: 1700,
    sigma0: 80,
    eloGlobalRank: 1,
  };
}

function makeGroupRanking(teamKey: string, groupRank: number, wins: number, losses: number): GroupRankingRow {
  return {
    teamKey,
    collegeName: `${teamKey} College`,
    teamName: teamKey,
    groupRank,
    wins,
    losses,
    status: wins === 3 ? "qualified" : losses === 3 ? "eliminated" : "alive",
    finalRank: groupRank,
  };
}

function makeFinalRanking(teamKey: string, rank: number, advancement: string, finalBucket: string): FinalRankingRow {
  return {
    teamKey,
    collegeName: `${teamKey} College`,
    teamName: teamKey,
    rank,
    groupName: rank % 2 === 0 ? "B" : "A",
    seedTier: "S1",
    seedRankInRegion: rank,
    swissWins: Math.max(0, 4 - rank),
    swissLosses: Math.max(0, rank - 1),
    swissGroupRank: rank <= 8 ? rank : null,
    mu0: 1700 - rank,
    finalBucket,
    advancement,
  };
}

function makeSimulation(regionSlug: RegionSlug, labels: string[]): SimulationResponse {
  const matches = labels.map((label, index) => {
    const isSwiss = label.startsWith("A-SWISS") || label.startsWith("B-SWISS");
    const groupName = label.startsWith("A-") ? "A" : label.startsWith("B-") ? "B" : "";
    const stage =
      isSwiss
        ? "swiss"
        : label.startsWith("R16")
          ? "round_of_16"
          : label.startsWith("QF")
            ? "quarterfinal"
            : label.startsWith("QUAL-1")
              ? "qualification_round1"
              : label.startsWith("QUAL")
                ? "qualification_round2"
                : label.startsWith("SF")
                  ? "semifinal"
                  : label.startsWith("THIRD")
                    ? "third_place"
                    : "final";

    const roundNumber = isSwiss
      ? Number(label.split("-")[2])
      : label.startsWith("R16")
        ? 1
        : label.startsWith("QF")
          ? 2
          : label.startsWith("SF")
            ? 3
            : label.startsWith("QUAL-1")
              ? 2
              : label.startsWith("QUAL")
                ? 3
                : 4;

    return {
      matchLabel: label,
      stage,
      stageOrder: isSwiss ? roundNumber : index + 1,
      roundNumber,
      groupName,
      bestOf: 3,
      redTeam: { teamKey: `${label}-R`, collegeName: `${label}-R College`, teamName: "Red" },
      blueTeam: { teamKey: `${label}-B`, collegeName: `${label}-B College`, teamName: "Blue" },
      scoreline: "2:1",
      winnerTeamKey: `${label}-R`,
      loserTeamKey: `${label}-B`,
      pGameRed: 0.54,
      pGameBlue: 0.46,
      pSeriesRed: 0.58,
      pSeriesBlue: 0.42,
      deltaH2H: 0.12,
      confidenceLabel: "medium",
      winnerNext: "next",
      loserNext: "next",
    };
  });

  return {
    meta: {
      regionSlug,
      regionName: regionSlug,
      seed: 1,
      generatedAt: new Date().toISOString(),
      samplesPerMatch: 10,
      nationalSlots: 8,
      repechageSlots: 6,
    },
    slots: [
      makeSlot("A1", "A", "A1"),
      makeSlot("A2", "A", "A2"),
      makeSlot("B1", "B", "B1"),
      makeSlot("B2", "B", "B2"),
    ],
    groupRankings: {
      A: [
        makeGroupRanking("A-Q1", 1, 3, 0),
        makeGroupRanking("A-Q2", 2, 3, 1),
        makeGroupRanking("A-Q3", 3, 3, 2),
        makeGroupRanking("A-E1", 4, 2, 3),
        makeGroupRanking("A-E2", 5, 1, 3),
        makeGroupRanking("A-E3", 6, 0, 3),
      ],
      B: [
        makeGroupRanking("B-Q1", 1, 3, 0),
        makeGroupRanking("B-Q2", 2, 3, 1),
        makeGroupRanking("B-Q3", 3, 3, 2),
        makeGroupRanking("B-E1", 4, 2, 3),
        makeGroupRanking("B-E2", 5, 1, 3),
        makeGroupRanking("B-E3", 6, 0, 3),
      ],
    },
    finalRankings: [
      makeFinalRanking("CHAMP", 1, "national_qualified", "champion"),
      makeFinalRanking("RUNNER", 2, "national_qualified", "runner_up"),
      makeFinalRanking("THIRD", 3, "national_qualified", "third_place"),
      makeFinalRanking("FOURTH", 4, "national_qualified", "fourth_place"),
      makeFinalRanking("NAT5", 5, "national_qualified", "top8"),
      makeFinalRanking("NAT6", 6, "national_qualified", "top8"),
      makeFinalRanking("REP7", 7, "repechage_qualified", "top8"),
      makeFinalRanking("REP8", 8, "repechage_qualified", "top8"),
      makeFinalRanking("TAIL9", 9, "eliminated", "swiss_out"),
    ],
    summary: {
      champion: { teamKey: "CHAMP", collegeName: "CHAMP College", teamName: "CHAMP" },
      runnerUp: { teamKey: "RUNNER", collegeName: "RUNNER College", teamName: "RUNNER" },
      thirdPlace: { teamKey: "THIRD", collegeName: "THIRD College", teamName: "THIRD" },
      fourthPlace: { teamKey: "FOURTH", collegeName: "FOURTH College", teamName: "FOURTH" },
      nationalQualifiers: ["CHAMP", "RUNNER", "THIRD", "FOURTH", "NAT5", "NAT6"],
      repechageQualifiers: ["REP7", "REP8"],
      matchCountByStage: {},
    },
    matches,
  };
}

describe("buildWorkspaceStage", () => {
  it("keeps east playoff match cards aligned with known labels", () => {
    const labels = [
      "R16-1", "R16-2", "R16-3", "R16-4", "R16-5", "R16-6", "R16-7", "R16-8",
      "QF-1", "QF-2", "QF-3", "QF-4",
      "QUAL-1-1", "QUAL-1-2", "QUAL-1-3", "QUAL-1-4",
      "QUAL-2-1", "QUAL-2-2",
      "SF-1", "SF-2", "THIRD-1", "FINAL-1",
    ];
    const stage = buildWorkspaceStage("playoff", "east_region", makeSimulation("east_region", labels));
    const boundLabels = stage.cards
      .filter((card) => card.kind === "match")
      .map((card) => card.match.matchLabel);

    expect(boundLabels.every((label) => !label.startsWith("QUAL-"))).toBe(true);
    expect(stage.cards.every((card) => card.kind === "match")).toBe(true);
    expect(stage.cards.every((card) => card.kind === "match" && card.showProbability === false)).toBe(true);
    expect(stage.connectors.some((connector) => connector.id === "R16-1+R16-2=>QF-1")).toBe(true);
    expect(stage.connectors.some((connector) => connector.id === "SF-1+SF-2=>FINAL-1")).toBe(true);
  });

  it("builds north qualification stage with direct national and repechage split", () => {
    const labels = [
      "R16-1", "R16-2", "R16-3", "R16-4", "R16-5", "R16-6", "R16-7", "R16-8",
      "QF-1", "QF-2", "QF-3", "QF-4",
      "QUAL-1-1", "QUAL-1-2", "QUAL-1-3", "QUAL-1-4",
      "QUAL-2-1", "QUAL-2-2",
      "SF-1", "SF-2", "THIRD-1", "FINAL-1",
    ];
    const stage = buildWorkspaceStage("qualification", "north_region", makeSimulation("north_region", labels));

    expect(stage.cards.some((card) => card.kind === "match" && card.match.matchLabel === "QUAL-R-1")).toBe(false);
    expect(stage.cards.some((card) => card.kind === "match" && card.match.matchLabel === "FINAL-1")).toBe(false);
    expect(stage.connectors.some((connector) => connector.id === "qualification-q1-split")).toBe(true);
    expect(stage.connectors.find((connector) => connector.id === "qualification-q1-split")?.branchLabels?.map((label) => label.text)).toEqual([
      "败者进复活赛",
      "胜者进第二轮",
    ]);
    expect(stage.cards.every((card) => card.kind !== "match" || card.showProbability === false)).toBe(true);
    expect(stage.headers.some((header) => header.title === "资格赛第二轮")).toBe(true);
  });

  it("builds south qualification stage with separate repechage playoff matches", () => {
    const labels = [
      "R16-1", "R16-2", "R16-3", "R16-4", "R16-5", "R16-6", "R16-7", "R16-8",
      "QF-1", "QF-2", "QF-3", "QF-4",
      "QUAL-1-1", "QUAL-1-2", "QUAL-1-3", "QUAL-1-4",
      "QUAL-2-1", "QUAL-2-2", "QUAL-R-1", "QUAL-R-2",
      "SF-1", "SF-2", "THIRD-1", "FINAL-1",
    ];
    const stage = buildWorkspaceStage("qualification", "south_region", makeSimulation("south_region", labels));

    expect(stage.cards.some((card) => card.kind === "match" && card.match.matchLabel === "QUAL-R-1")).toBe(true);
    expect(stage.headers.some((header) => header.title === "复活赛席位战")).toBe(true);
    expect(stage.headers.some((header) => header.title === "国赛席位战")).toBe(true);
  });

  it("builds slot stage cards from slot assignments", () => {
    const stage = buildWorkspaceStage("slots", "north_region", makeSimulation("north_region", []));

    expect(stage.headers).toHaveLength(2);
    expect(stage.cards).toHaveLength(4);
    expect(stage.cards.every((card) => card.kind === "team")).toBe(true);
  });

  it("builds swiss stage headers and cards for group A", () => {
    const swissLabels = [
      "A-SWISS-1-1",
      "A-SWISS-2-1",
      "A-SWISS-2-2",
      "A-SWISS-3-1",
      "A-SWISS-3-2",
      "A-SWISS-3-3",
      "A-SWISS-4-1",
      "A-SWISS-4-2",
      "A-SWISS-5-1",
    ];
    const stage = buildWorkspaceStage("swiss-a", "east_region", makeSimulation("east_region", swissLabels));

    expect(stage.headers.some((header) => header.title === "第 1 轮 · 0-0 组")).toBe(true);
    expect(stage.cards.some((card) => card.kind === "match" && card.orderLabel === "1")).toBe(true);
    expect(stage.cards.every((card) => card.kind !== "match" || card.showProbability === false)).toBe(true);
    expect(stage.width).toBeGreaterThan(2000);
  });

  it("builds final rankings stage with podium and tail sections", () => {
    const stage = buildWorkspaceStage("final-rankings", "east_region", makeSimulation("east_region", []));
    const firstTeamCard = stage.cards.find((card) => card.kind === "team");

    expect(stage.headers.map((header) => header.title)).toEqual(["领奖台", "国赛名单", "复活赛名单", "其余名次"]);
    expect(stage.cards.some((card) => card.kind === "team" && card.orderLabel === "1")).toBe(true);
    expect(stage.cards.some((card) => card.kind === "team" && card.teamKey === "TAIL9")).toBe(true);
    expect(firstTeamCard && "statLine" in firstTeamCard ? firstTeamCard.statLine : "").toContain("瑞士轮");
    expect(firstTeamCard && "meta" in firstTeamCard ? firstTeamCard.meta : []).toContain("冠军");
    expect(firstTeamCard && "meta" in firstTeamCard ? firstTeamCard.meta : []).toContain("晋级国赛");
  });
});
