import { describe, expect, it } from "vitest";

import { buildWorkspaceStage } from "@/lib/canvas-builders";
import type { FinalRankingRow, GroupRankingRow, MatchRow, SimulationResponse, TeamRef } from "@/lib/types";

function team(teamKey: string, collegeName: string): TeamRef {
  return {
    teamKey,
    collegeName,
    teamName: `${collegeName}战队`,
    slot: teamKey.toUpperCase(),
  };
}

const alpha = team("alpha", "甲校");
const beta = team("beta", "乙校");
const gamma = team("gamma", "丙校");
const delta = team("delta", "丁校");

function match(overrides: Partial<MatchRow> & Pick<MatchRow, "matchLabel" | "roundNumber" | "redTeam" | "blueTeam" | "winnerTeamKey" | "loserTeamKey">): MatchRow {
  return {
    stage: "swiss",
    stageOrder: 1,
    groupName: "A",
    bestOf: 3,
    isRealResult: false,
    isConfirmedMatchup: true,
    scoreline: "2:0",
    pGameRed: 0.62,
    pGameBlue: 0.38,
    pSeriesRed: 0.68,
    pSeriesBlue: 0.32,
    deltaH2H: 0,
    confidenceLabel: "balanced",
    winnerNext: "A-Swiss-R2",
    loserNext: "A-Swiss-R2",
    ...overrides,
  };
}

function groupRow(row: Partial<GroupRankingRow> & Pick<GroupRankingRow, "teamKey" | "collegeName" | "teamName">): GroupRankingRow {
  return {
    groupRank: 1,
    wins: 3,
    losses: 0,
    status: "qualified",
    finalRank: 1,
    ...row,
  };
}

function finalRow(row: Partial<FinalRankingRow> & Pick<FinalRankingRow, "teamKey" | "collegeName" | "teamName">): FinalRankingRow {
  return {
    rank: 1,
    groupName: "A",
    seedTier: "S1",
    seedRankInRegion: 1,
    swissWins: 3,
    swissLosses: 0,
    swissGroupRank: 1,
    mu0: 1800,
    finalBucket: "champion",
    advancement: "national_qualified",
    ...row,
  };
}

function simulation(overrides: Partial<SimulationResponse> = {}): SimulationResponse {
  return {
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
    groupRankings: {
      A: [groupRow(alpha)],
      B: [],
    },
    matches: [],
    finalRankings: [finalRow(alpha)],
    summary: {
      champion: alpha,
      runnerUp: beta,
      thirdPlace: gamma,
      fourthPlace: delta,
      nationalQualifiers: [alpha.teamKey],
      repechageQualifiers: [],
      matchCountByStage: {},
    },
    ...overrides,
  };
}

describe("buildWorkspaceStage live outcome certainty", () => {
  it("keeps a Swiss advancement card predictive when the decisive win is simulated after earlier real results", () => {
    const stage = buildWorkspaceStage(
      "swiss-a",
      "south_region",
      simulation({
        matches: [
          match({
            matchLabel: "A-SWISS-1-1",
            roundNumber: 1,
            redTeam: alpha,
            blueTeam: beta,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: beta.teamKey,
            isRealResult: true,
          }),
          match({
            matchLabel: "A-SWISS-2-1",
            roundNumber: 2,
            redTeam: alpha,
            blueTeam: gamma,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: gamma.teamKey,
            isRealResult: true,
          }),
          match({
            matchLabel: "A-SWISS-3-1",
            roundNumber: 3,
            redTeam: alpha,
            blueTeam: delta,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: delta.teamKey,
            isRealResult: false,
          }),
        ],
      })
    );

    const summaryCard = stage.cards.find((card) => card.kind === "team" && card.variant === "summary" && card.teamKey === alpha.teamKey);

    expect(summaryCard).toMatchObject({ isSimulated: true });
  });

  it("keeps a qualification berth predictive when its source match has not finished", () => {
    const stage = buildWorkspaceStage(
      "qualification",
      "south_region",
      simulation({
        matches: [
          match({
            matchLabel: "QUAL-1-1",
            stage: "qualification_round1",
            stageOrder: 4,
            roundNumber: 1,
            redTeam: alpha,
            blueTeam: beta,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: beta.teamKey,
            winnerNext: "qualification_round2",
            loserNext: "repechage_qualified",
            isRealResult: true,
          }),
          match({
            matchLabel: "QUAL-2-1",
            stage: "qualification_round2",
            stageOrder: 5,
            roundNumber: 2,
            redTeam: alpha,
            blueTeam: gamma,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: gamma.teamKey,
            winnerNext: "national_qualified",
            loserNext: "repechage_qualified",
            isRealResult: false,
          }),
        ],
        finalRankings: [
          finalRow(alpha),
          finalRow({ ...gamma, rank: 2, advancement: "repechage_qualified", finalBucket: "repechage_qualified" }),
          finalRow({ ...beta, rank: 3, advancement: "repechage_qualified", finalBucket: "repechage_qualified" }),
        ],
      })
    );

    const nationalCard = stage.cards.find((card) => card.kind === "team" && card.id === "qualification-q2-national-alpha");
    const firstRoundRepechageCard = stage.cards.find((card) => card.kind === "team" && card.id === "qualification-q1-repechage-beta");

    expect(nationalCard).toMatchObject({ isSimulated: true });
    expect(firstRoundRepechageCard).toMatchObject({ isSimulated: false });
  });
});
