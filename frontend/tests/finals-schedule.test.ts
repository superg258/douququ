import { describe, expect, it } from "vitest";

import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import {
  buildFinalEventDays,
  groupParticipantsByTier,
  hasActualFinalMatchup,
  isActualSchoolName,
  matchesForFinalStage,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
} from "@/lib/finals-schedule";
import type { FinalEventMatch, FinalEventSchedule, OverviewResponse, OverviewTeam } from "@/lib/types";

function match(number: number, startsAt: string, stage: string, overrides: Partial<FinalEventMatch> = {}): FinalEventMatch {
  return {
    number,
    stageKey: "swiss",
    stage,
    bestOf: 3,
    redSlot: "A1",
    blueSlot: "A2",
    winnerTo: null,
    loserTo: null,
    startTime: startsAt.slice(11, 16),
    endTime: "10:00",
    startsAt,
    endsAt: `${startsAt.slice(0, 11)}10:00:00+08:00`,
    ...overrides,
  };
}

function event(matches: FinalEventMatch[]): FinalEventSchedule {
  return {
    slug: "repechage",
    name: "复活赛",
    shortName: "复活赛",
    eyebrow: "RMUC 2026",
    statusLabel: "抽签待公布",
    dateRange: { start: "2026-07-31", end: "2026-08-02" },
    competitionRange: { start: "2026-07-31", end: "2026-08-02" },
    participantCount: 16,
    confirmedParticipantCount: 16,
    advancementSlots: 4,
    formalMatchCount: matches.length,
    groups: [],
    participants: [],
    drawRules: [],
    matches,
  };
}

describe("finals schedule helpers", () => {
  it("recognizes real schools and rejects unresolved schedule slots", () => {
    expect(isActualSchoolName("广东工业大学")).toBe(true);
    expect(isActualSchoolName("DynamicX")).toBe(true);
    expect(isActualSchoolName("Ⅰ-A1")).toBe(false);
    expect(isActualSchoolName("胜者①")).toBe(false);
    expect(isActualSchoolName("待确认")).toBe(false);

    expect(hasActualFinalMatchup({ redSlot: "广东工业大学", blueSlot: "DynamicX" })).toBe(true);
    expect(hasActualFinalMatchup({ redSlot: "广东工业大学", blueSlot: "Ⅰ-A1" })).toBe(false);
  });

  it("filters each event stage and groups formal matches by Beijing date", () => {
    const payload = event([
      match(1, "2026-07-31T09:00:00+08:00", "A组瑞士轮第一轮（BO3）"),
      match(2, "2026-07-31T09:40:00+08:00", "B组瑞士轮第一轮（BO3）"),
      match(3, "2026-08-01T09:00:00+08:00", "晋级名额争夺战（BO3）", { stageKey: "repechage_qualification" }),
    ]);

    expect(matchesForFinalStage(payload, "swiss-a").map((row) => row.number)).toEqual([1]);
    expect(matchesForFinalStage(payload, "swiss-b").map((row) => row.number)).toEqual([2]);
    expect(buildFinalEventDays(payload, "qualification")).toMatchObject([
      { date: "2026-08-01", matchCount: 1 },
    ]);
  });

  it("keeps confirmed draw tiers in official order", () => {
    const groups = groupParticipantsByTier([
      { order: 1, schoolKey: "b", teamKey: "b::B", collegeName: "乙", teamName: "B", drawTier: "第二梯队", status: "confirmed" },
      { order: 2, schoolKey: "a", teamKey: "a::A", collegeName: "甲", teamName: "A", drawTier: "第一梯队", status: "confirmed" },
    ]);

    expect(groups.map((group) => group.tier)).toEqual(["第一梯队", "第二梯队"]);
  });

  it("ranks confirmed finals participants by current Elo", () => {
    const makeTeam = (teamKey: string, currentElo: number, eloGlobalRank: number): OverviewTeam => ({
      teamKey,
      collegeName: teamKey,
      teamName: teamKey,
      mu0: currentElo - 10,
      currentElo,
      sigma0: 1,
      eloGlobalRank,
      eloRegionRank: eloGlobalRank,
      seedTier: "第一梯队",
      seedRankInRegion: eloGlobalRank,
      regionSlug: "east_region",
      regionName: "东部赛区",
      probabilities: { roundOf16: 0, repechage: 0, national: 0, champion: 0 },
    });
    const overview: OverviewResponse = {
      generatedAt: "2026-07-14T00:00:00+08:00",
      regions: [{
        regionSlug: "east_region",
        regionName: "东部赛区",
        nationalSlots: 0,
        repechageSlots: 0,
        monteCarlo: {
          aggregationMode: "test",
          seedCount: 0,
          iterationsPerSeed: 0,
          effectiveIterations: 0,
          seeds: [],
          pairProbabilitySamples: 0,
        },
        teams: [makeTeam("甲::A", 1600, 2), makeTeam("乙::B", 1700, 1)],
      }],
    };
    const ranked = rankFinalEventParticipantsByCurrentElo([
      { order: 1, schoolKey: "a", teamKey: "甲::A", collegeName: "甲", teamName: "A", drawTier: "第一梯队", status: "confirmed" },
      { order: 2, schoolKey: "b", teamKey: "乙::B", collegeName: "乙", teamName: "B", drawTier: "第一梯队", status: "confirmed" },
    ], overview);

    expect(ranked.map((participant) => [participant.collegeName, participant.currentElo])).toEqual([
      ["乙", 1700],
      ["甲", 1600],
    ]);
  });

  it("projects nested finals stage probabilities with exact slot totals", () => {
    const makeTeam = (teamKey: string, currentElo: number, index: number): OverviewTeam => ({
      teamKey,
      collegeName: teamKey,
      teamName: teamKey,
      mu0: currentElo,
      currentElo,
      sigma0: 1,
      eloGlobalRank: index + 1,
      eloRegionRank: index + 1,
      seedTier: "第一梯队",
      seedRankInRegion: index + 1,
      regionSlug: "east_region",
      regionName: "东部赛区",
      probabilities: { roundOf16: 0, repechage: 0, national: 0, champion: 0 },
    });
    const participants = (prefix: string, count: number, offset: number) => Array.from({ length: count }, (_, index) => ({
      order: index + 1,
      schoolKey: `${prefix}-${index}`,
      teamKey: `${prefix}-${index}::team`,
      collegeName: `${prefix}-${index}`,
      teamName: "team",
      drawTier: "第一梯队",
      status: "confirmed" as const,
      currentElo: 1900 - (offset + index) * 10,
    }));
    const repechage = participants("rep", 16, 0);
    const nationals = participants("nat", 28, 16);
    const teams = [...repechage, ...nationals].map((participant, index) => (
      makeTeam(participant.teamKey, participant.currentElo, index)
    ));
    const overview: OverviewResponse = {
      generatedAt: "2026-07-14T00:00:00+08:00",
      regions: [{
        regionSlug: "east_region",
        regionName: "东部赛区",
        nationalSlots: 0,
        repechageSlots: 0,
        monteCarlo: {
          aggregationMode: "test",
          seedCount: 0,
          iterationsPerSeed: 0,
          effectiveIterations: 0,
          seeds: [],
          pairProbabilitySamples: 0,
        },
        teams,
      }],
    };
    const projection = projectFinalsStageProbabilities(repechage, nationals, overview, 2_000);
    const repechageTotal = [...projection.repechage.values()]
      .reduce((sum, probability) => sum + probability.advancementRate, 0);
    const nationalsValues = [...projection.nationals.values()];

    expect(repechageTotal).toBeCloseTo(4, 8);
    expect(nationalsValues.reduce((sum, probability) => sum + probability.groupAdvancementRate, 0)).toBeCloseTo(16, 8);
    expect(nationalsValues.reduce((sum, probability) => sum + probability.topFourRate, 0)).toBeCloseTo(4, 8);
    expect(nationalsValues.reduce((sum, probability) => sum + probability.championRate, 0)).toBeCloseTo(1, 8);
    expect(nationalsValues.every((probability) => (
      probability.championRate <= probability.topFourRate
      && probability.topFourRate <= probability.groupAdvancementRate
    ))).toBe(true);
  });

  it("builds winner and loser routes without inventing matchup probabilities", () => {
    const payload = event([
      match(23, "2026-08-01T09:00:00+08:00", "晋级名额争夺战", {
        stageKey: "repechage_qualification",
        redSlot: "B-1",
        blueSlot: "A-4",
        winnerTo: "胜者①",
        loserTo: "败者①",
      }),
      match(27, "2026-08-01T10:00:00+08:00", "晋级名额争夺战败者组第一轮", {
        stageKey: "repechage_qualification",
        redSlot: "败者①",
        blueSlot: "败者②",
      }),
      match(29, "2026-08-01T11:00:00+08:00", "晋级名额争夺战胜者组", {
        stageKey: "repechage_qualification",
        redSlot: "胜者①",
        blueSlot: "胜者②",
      }),
    ]);

    const canvas = buildFinalsWorkspaceStage(payload, "qualification");
    expect(canvas.cards).toHaveLength(3);
    expect(canvas.cards.every((card) => card.kind === "schedule")).toBe(true);
    expect(canvas.connectors.map((connector) => connector.tone)).toEqual(["steel", "emerald"]);
    expect(canvas.connectors.every((connector) => connector.kind === "merge")).toBe(true);
    // Grouped connectors no longer force "subtle" — they inherit default rendering
    // so appearance is undefined (same visual effect as "default").
    expect(canvas.connectors.every((connector) => !connector.appearance)).toBe(true);
    expect(canvas.connectors.every((connector) => (connector.branchY?.length ?? 0) >= 1)).toBe(true);
    // Winner routes (emerald) upgraded to strong; loser routes (steel) stay normal.
    expect(canvas.connectors.map((connector) => connector.weight)).toEqual(["normal", "strong"]);
    expect(canvas.showProbability).toBe(false);
  });

  it("connects Swiss rounds through neutral re-pairing pools without inventing fixed match routes", () => {
    const payload = event([
      match(1, "2026-07-31T09:00:00+08:00", "A组瑞士轮第一轮（BO3）"),
      match(2, "2026-07-31T09:35:00+08:00", "A组瑞士轮第一轮（BO3）"),
      match(9, "2026-08-01T09:00:00+08:00", "A组瑞士轮第二轮（BO3）"),
      match(10, "2026-08-01T09:35:00+08:00", "A组瑞士轮第二轮（BO3）"),
      match(17, "2026-08-02T09:00:00+08:00", "A组瑞士轮第三轮（BO3）"),
    ]);

    const canvas = buildFinalsWorkspaceStage(payload, "swiss-a");
    expect(canvas.connectors).toHaveLength(2);
    expect(canvas.connectors.every((connector) => connector.kind === "merge-split")).toBe(true);
    expect(canvas.connectors.every((connector) => connector.tone === "cyan")).toBe(true);
    // connectCardGroupToCards doesn't set appearance — default rendering applies.
    expect(canvas.connectors.every((connector) => !connector.appearance)).toBe(true);
    expect(canvas.connectors.map((connector) => connector.branchY?.length)).toEqual([2, 2]);
    expect(canvas.connectors.map((connector) => connector.targetBranchY?.length)).toEqual([2, 1]);
    expect(canvas.description).toContain("不预设固定的单场胜败去向");
  });
});
