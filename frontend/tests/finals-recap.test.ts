import { describe, expect, it } from "vitest";

import { buildFinalsPredictionRecap } from "@/lib/finals-recap";
import type { FinalsSimulationResult } from "@/lib/finals-simulation";
import type { FinalEventSchedule, FinalEventSlug, SimulatedFinalMatch, SimulatedFinalTeam } from "@/lib/types";

function team(collegeName: string): SimulatedFinalTeam {
  return { teamKey: `${collegeName}::T`, collegeName, teamName: "T" };
}

function realMatch(partial: Partial<SimulatedFinalMatch> & { matchNumber: number }): SimulatedFinalMatch {
  return {
    red: team("红方大学"),
    blue: team("蓝方大学"),
    redScore: 2,
    blueScore: 0,
    winnerSide: "red",
    isRealResult: true,
    pGameRed: 0.7,
    pSeriesRed: 0.9,
    ...partial,
  };
}

function buildEvent(slug: FinalEventSlug, bestOf: 2 | 3 | 5 = 3): FinalEventSchedule {
  return {
    slug,
    name: slug,
    shortName: slug === "repechage" ? "复活赛" : "全国赛",
    eyebrow: "",
    statusLabel: "",
    dateRange: { start: "2026-07-30", end: "2026-08-10" },
    competitionRange: { start: "2026-07-30", end: "2026-08-10" },
    participantCount: 0,
    confirmedParticipantCount: 0,
    advancementSlots: null,
    formalMatchCount: 2,
    groups: [],
    participants: [],
    drawRules: [],
    teamRatingIndex: {},
    matches: [1, 2].map((number) => ({
      number,
      stageKey: "swiss" as const,
      stage: `第 ${number} 场`,
      bestOf,
      redSlot: "A1",
      blueSlot: "A2",
      winnerTo: null,
      loserTo: null,
      startTime: "",
      endTime: "",
      startsAt: `2026-07-30T0${number}:00:00+08:00`,
      endsAt: `2026-07-30T0${number}:40:00+08:00`,
    })),
  };
}

function buildSimulation(
  repechageMatches: SimulatedFinalMatch[],
  nationalsMatches: SimulatedFinalMatch[] = [],
): FinalsSimulationResult {
  const toMap = (rows: SimulatedFinalMatch[]) => new Map(rows.map((row) => [row.matchNumber, row]));
  return {
    repechage: { matchResults: toMap(repechageMatches) } as FinalsSimulationResult["repechage"],
    nationals: { matchResults: toMap(nationalsMatches) } as FinalsSimulationResult["nationals"],
  };
}

describe("buildFinalsPredictionRecap", () => {
  it("模拟结果为 null 时全部归零", () => {
    const recap = buildFinalsPredictionRecap(null, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.summary.completedMatches).toBe(0);
    expect(recap.summary.winnerHitRate).toBeNull();
    expect(recap.summary.scorelineHitRate).toBeNull();
    expect(recap.byEvent.repechage.completedMatches).toBe(0);
    expect(recap.byEvent.nationals.completedMatches).toBe(0);
    expect(recap.notableMatches).toEqual([]);
  });

  it("只统计真实赛果，预测场次不计入", () => {
    const simulation = buildSimulation([
      realMatch({ matchNumber: 1 }),
      realMatch({ matchNumber: 2, isRealResult: false }),
    ]);
    const recap = buildFinalsPredictionRecap(simulation, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.summary.completedMatches).toBe(1);
    expect(recap.summary.winnerHits).toBe(1);
    expect(recap.summary.winnerHitRate).toBe(1);
  });

  it("胜负命中且比分命中时不计入偏离清单", () => {
    // pGameRed 0.7 → 预测比分 2:0，与实际一致
    const simulation = buildSimulation([realMatch({ matchNumber: 1 })]);
    const recap = buildFinalsPredictionRecap(simulation, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.summary.scorelineHits).toBe(1);
    expect(recap.summary.upsetMisses).toBe(0);
    expect(recap.notableMatches).toEqual([]);
  });

  it("爆冷场次计入 upsetMisses 并排在偏离清单最前", () => {
    const upset = realMatch({
      matchNumber: 1,
      winnerSide: "blue",
      redScore: 1,
      blueScore: 2,
      pSeriesRed: 0.95,
      pGameRed: 0.8,
    });
    const scorelineMiss = realMatch({
      matchNumber: 2,
      redScore: 2,
      blueScore: 1,
      pSeriesRed: 0.6,
      pGameRed: 0.55, // 预测比分 2:1，与实际 2:1 一致 → 比分命中
    });
    const simulation = buildSimulation([scorelineMiss, upset]);
    const recap = buildFinalsPredictionRecap(simulation, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.summary.completedMatches).toBe(2);
    expect(recap.summary.upsetMisses).toBe(1);
    expect(recap.summary.winnerHitRate).toBe(0.5);
    expect(recap.notableMatches[0]?.deviationType).toBe("upset_miss");
    expect(recap.notableMatches[0]?.actualWinnerName).toBe("蓝方大学");
    expect(recap.notableMatches[0]?.favoriteRate).toBe(0.95);
  });

  it("比分偏离（胜负命中但比分不同）计入 scoreline_miss", () => {
    const simulation = buildSimulation([
      realMatch({ matchNumber: 1, redScore: 2, blueScore: 1, pGameRed: 0.7, pSeriesRed: 0.9 }),
    ]);
    const recap = buildFinalsPredictionRecap(simulation, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.summary.winnerHits).toBe(1);
    expect(recap.summary.scorelineHits).toBe(0);
    expect(recap.notableMatches).toHaveLength(1);
    expect(recap.notableMatches[0]?.deviationType).toBe("scoreline_miss");
  });

  it("按赛事分组统计复活赛与全国赛", () => {
    const simulation = buildSimulation(
      [realMatch({ matchNumber: 1 })],
      [realMatch({ matchNumber: 2, winnerSide: "blue", redScore: 0, blueScore: 2, pSeriesRed: 0.9, pGameRed: 0.7 })],
    );
    const recap = buildFinalsPredictionRecap(simulation, {
      repechage: buildEvent("repechage"),
      nationals: buildEvent("nationals"),
    });
    expect(recap.byEvent.repechage.completedMatches).toBe(1);
    expect(recap.byEvent.repechage.winnerHitRate).toBe(1);
    expect(recap.byEvent.nationals.completedMatches).toBe(1);
    expect(recap.byEvent.nationals.upsetMisses).toBe(1);
    expect(recap.summary.completedMatches).toBe(2);
  });
});
