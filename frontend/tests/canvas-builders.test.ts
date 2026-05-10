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

function officialPlaceholder(matchLabel: string, roundNumber: number, index: number): MatchRow {
  return match({
    matchLabel,
    roundNumber,
    redTeam: {
      teamKey: "",
      collegeName: `A${index}`,
      teamName: "官方槽位待确认",
      slot: `A${index}`,
    },
    blueTeam: {
      teamKey: "",
      collegeName: `A${index + 8}`,
      teamName: "官方槽位待确认",
      slot: `A${index + 8}`,
    },
    winnerTeamKey: "",
    loserTeamKey: "",
    isConfirmedMatchup: false,
    officialMatchId: `309${roundNumber}${index}`,
    scoreline: "0:0",
    pGameRed: 0.5,
    pGameBlue: 0.5,
    pSeriesRed: 0.5,
    pSeriesBlue: 0.5,
  });
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
  it("renders official placeholder slots without simulated school assignments", () => {
    const stage = buildWorkspaceStage(
      "slots",
      "south_region",
      simulation({
        slots: [
          {
            teamKey: "",
            collegeName: "A1",
            teamName: "学校队伍待确认",
            groupName: "A",
            slot: "A1",
            drawBox: "official_placeholder",
            seedTier: "tier1",
            seedRankInRegion: 1,
            mu0: 0,
            sigma0: 0,
            eloGlobalRank: 0,
          },
          {
            teamKey: "",
            collegeName: "A2",
            teamName: "学校队伍待确认",
            groupName: "A",
            slot: "A2",
            drawBox: "official_placeholder",
            seedTier: "tier2",
            seedRankInRegion: 2,
            mu0: 0,
            sigma0: 0,
            eloGlobalRank: 0,
          },
          {
            teamKey: "",
            collegeName: "A9",
            teamName: "学校队伍待确认",
            groupName: "A",
            slot: "A9",
            drawBox: "official_placeholder",
            seedTier: "unseeded",
            seedRankInRegion: 9,
            mu0: 0,
            sigma0: 0,
            eloGlobalRank: 0,
          },
        ],
      })
    );

    const slotCards = stage.cards.filter((card) => card.kind === "team");

    expect(slotCards).toHaveLength(3);
    expect(slotCards.map((card) => card.id)).toEqual(["slot-A1", "slot-A2", "slot-A9"]);
    expect(slotCards[0]).toMatchObject({
      teamKey: "",
      collegeName: "A1",
      subtitle: "学校队伍待确认",
      statLine: "第一梯队 / 学校队伍待确认",
    });
    expect(slotCards[1]).toMatchObject({ statLine: "第二梯队 / 学校队伍待确认" });
    expect(slotCards[2]).toMatchObject({ statLine: "非种子 / 学校队伍待确认" });
  });

  it("keeps every official placeholder Swiss match visible without replaying empty team keys", () => {
    const countsByRound = new Map([
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 6],
      [5, 3],
    ]);
    const matches = Array.from(countsByRound.entries()).flatMap(([roundNumber, count]) =>
      Array.from({ length: count }, (_, index) =>
        officialPlaceholder(`A-SWISS-${roundNumber}-${index + 1}`, roundNumber, index + 1)
      )
    );

    const stage = buildWorkspaceStage(
      "swiss-a",
      "south_region",
      simulation({
        matches,
        groupRankings: {
          A: [],
          B: [],
        },
      })
    );

    const matchCards = stage.cards.filter((card) => card.kind === "match");
    const placeholderSummaryCards = stage.cards.filter(
      (card) => card.kind === "team" && card.variant === "summary" && card.teamKey === ""
    );

    expect(matchCards).toHaveLength(33);
    expect(matchCards[0]).toMatchObject({
      displayLabel: "第1场",
    });
    expect(placeholderSummaryCards).toHaveLength(16);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("qualified-3-0"))).toHaveLength(2);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("qualified-3-1"))).toHaveLength(3);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("qualified-3-2"))).toHaveLength(3);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("eliminated-0-3"))).toHaveLength(2);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("eliminated-1-3"))).toHaveLength(3);
    expect(placeholderSummaryCards.filter((card) => card.id.includes("eliminated-2-3"))).toHaveLength(3);
    expect(placeholderSummaryCards).toContainEqual(
      expect.objectContaining({
        collegeName: "待确认",
        subtitle: "真实队伍待确认",
        statLine: "等待瑞士轮结果",
      })
    );
    expect(matchCards.map((card) => card.match.matchLabel)).toContain("A-SWISS-5-3");
    expect(stage.headers.map((header) => header.title)).toEqual(
      expect.arrayContaining([
        "第 1 轮 · 0-0 组",
        "第 2 轮 · 1-0 组",
        "第 2 轮 · 0-1 组",
        "第 3 轮 · 2-0 组",
        "第 3 轮 · 1-1 组",
        "第 3 轮 · 0-2 组",
        "第 4 轮 · 2-1 组",
        "第 4 轮 · 1-2 组",
        "第 5 轮 · 2-2 组",
        "3-0 晋级",
        "3-1 晋级",
        "3-2 晋级",
        "0-3 淘汰",
        "1-3 淘汰",
        "2-3 淘汰",
      ])
    );
    expect(stage.headers.filter((header) => header.title.includes("晋级") || header.title.includes("淘汰"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ subtitle: "真实队伍待确认" })])
    );
  });

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

  it("does not treat simulated unconfirmed future Swiss matches as official placeholders", () => {
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
            isConfirmedMatchup: true,
          }),
          match({
            matchLabel: "A-SWISS-2-1",
            roundNumber: 2,
            redTeam: alpha,
            blueTeam: gamma,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: gamma.teamKey,
            isConfirmedMatchup: false,
          }),
          match({
            matchLabel: "A-SWISS-3-1",
            roundNumber: 3,
            redTeam: alpha,
            blueTeam: delta,
            winnerTeamKey: alpha.teamKey,
            loserTeamKey: delta.teamKey,
            isConfirmedMatchup: false,
          }),
        ],
      })
    );

    const summaryCard = stage.cards.find(
      (card) => card.kind === "team" && card.variant === "summary" && card.teamKey === alpha.teamKey
    );

    expect(summaryCard).toMatchObject({
      collegeName: alpha.collegeName,
      statLine: "瑞士轮 3-0",
      isSimulated: true,
    });
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

  it("keeps official placeholder qualification outcomes visible before real teams are known", () => {
    const qualificationPlaceholder = (
      matchLabel: string,
      stage: string,
      roundNumber: number,
      winnerNext: string,
      loserNext: string
    ) =>
      match({
        matchLabel,
        stage,
        stageOrder: roundNumber + 3,
        roundNumber,
        groupName: "",
        redTeam: {
          teamKey: "",
          collegeName: "第67场败者",
          teamName: "晋级来源待确认",
        },
        blueTeam: {
          teamKey: "",
          collegeName: "第68场败者",
          teamName: "晋级来源待确认",
        },
        winnerTeamKey: "",
        loserTeamKey: "",
        winnerNext,
        loserNext,
        isConfirmedMatchup: false,
        officialMatchId: `3097${matchLabel.at(-1)}`,
        scoreline: "0:0",
        pGameRed: 0.5,
        pGameBlue: 0.5,
        pSeriesRed: 0.5,
        pSeriesBlue: 0.5,
      });

    const stage = buildWorkspaceStage(
      "qualification",
      "south_region",
      simulation({
        matches: [
          qualificationPlaceholder("QUAL-1-1", "qualification_round1", 1, "qualification_round2_national", "repechage_qualified"),
          qualificationPlaceholder("QUAL-1-2", "qualification_round1", 1, "qualification_round2_national", "repechage_qualified"),
          qualificationPlaceholder("QUAL-1-3", "qualification_round1", 1, "qualification_round2_national", "repechage_qualified"),
          qualificationPlaceholder("QUAL-1-4", "qualification_round1", 1, "qualification_round2_national", "repechage_qualified"),
          qualificationPlaceholder("QUAL-2-1", "qualification_round2", 2, "national_qualified", "repechage_qualified"),
          qualificationPlaceholder("QUAL-2-2", "qualification_round2", 2, "national_qualified", "repechage_qualified"),
        ],
        finalRankings: [],
      })
    );

    const matchCards = stage.cards.filter((card) => card.kind === "match");
    const placeholderOutcomeCards = stage.cards.filter(
      (card) => card.kind === "team" && card.variant === "summary" && card.teamKey === ""
    );

    expect(matchCards).toHaveLength(6);
    expect(matchCards[0]).toMatchObject({
      displayLabel: "第79场",
    });
    expect(matchCards[4]).toMatchObject({
      displayLabel: "第83场",
    });
    expect(placeholderOutcomeCards).toHaveLength(8);
    expect(placeholderOutcomeCards.filter((card) => card.id.startsWith("qualification-q1-repechage-"))).toHaveLength(4);
    expect(placeholderOutcomeCards.filter((card) => card.id.startsWith("qualification-q2-national-"))).toHaveLength(2);
    expect(placeholderOutcomeCards.filter((card) => card.id.startsWith("qualification-q2-repechage-"))).toHaveLength(2);
    expect(placeholderOutcomeCards).toContainEqual(
      expect.objectContaining({
        collegeName: "待确认",
        subtitle: "学校队伍待确认",
        statLine: "资格赛二轮胜者 / 学校队伍待确认",
      })
    );
  });

  it("renders live final ranking placeholders without simulated school assignments", () => {
    const stage = buildWorkspaceStage(
      "final-rankings",
      "south_region",
      simulation({
        finalRankings: [
          finalRow({
            teamKey: "",
            collegeName: "待确认",
            teamName: "学校队伍待确认",
            rank: 1,
            swissWins: 0,
            swissLosses: 0,
            swissGroupRank: null,
          }),
          finalRow({
            teamKey: "",
            collegeName: "待确认",
            teamName: "学校队伍待确认",
            rank: 2,
            finalBucket: "runner_up",
            swissWins: 0,
            swissLosses: 0,
            swissGroupRank: null,
          }),
        ],
      })
    );

    const rankingCard = stage.cards.find((card) => card.kind === "team" && card.variant === "ranking");
    const cardIds = stage.cards.map((card) => card.id);

    expect(rankingCard).toMatchObject({
      teamKey: "",
      collegeName: "待确认",
      subtitle: "学校队伍待确认",
      statLine: "最终排名待确认",
    });
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });
});
