import { describe, expect, it } from "vitest";

import { deriveMatchCardState, deriveTeamCardState } from "@/components/canvas-card";
import type { MatchRow, TeamCanvasCard } from "@/lib/types";

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    matchLabel: "B-SWISS-4-5",
    stage: "swiss",
    stageOrder: 1,
    roundNumber: 4,
    groupName: "B",
    bestOf: 3,
    isRealResult: false,
    isConfirmedMatchup: true,
    redTeam: {
      teamKey: "red",
      collegeName: "红方大学",
      teamName: "红方",
      slot: "B11",
    },
    blueTeam: {
      teamKey: "blue",
      collegeName: "蓝方大学",
      teamName: "蓝方",
      slot: "B14",
    },
    scoreline: "2:0",
    winnerTeamKey: "red",
    loserTeamKey: "blue",
    pGameRed: 0.6,
    pGameBlue: 0.4,
    pSeriesRed: 0.65,
    pSeriesBlue: 0.35,
    deltaH2H: 0,
    confidenceLabel: "balanced",
    winnerNext: "next",
    loserNext: "next",
    ...overrides,
  };
}

function teamCard(overrides: Partial<TeamCanvasCard> = {}): TeamCanvasCard {
  return {
    id: "eliminated-alpha",
    kind: "team",
    variant: "summary",
    teamKey: "alpha",
    collegeName: "甲校",
    teamName: "甲校战队",
    x: 0,
    y: 0,
    width: 400,
    height: 128,
    tone: "steel",
    isSimulated: true,
    ...overrides,
  };
}

describe("deriveMatchCardState", () => {
  it("treats live simulated branch matches without official ids as predictions", () => {
    expect(deriveMatchCardState(match(), "live").statusLabel).toBe("预测");
  });

  it("treats only official pending matches as scheduled in live mode", () => {
    expect(
      deriveMatchCardState(
        match({
          officialMatchId: "MOCK-SOUTH-054",
          officialStatus: "PENDING",
          plannedStartAt: "2026-05-01T23:05:00+00:00",
        }),
        "live"
      ).statusLabel
    ).toBe("已排期");
  });

  it("keeps pure simulation mode out of the scheduled status", () => {
    expect(deriveMatchCardState(match(), "sim").statusLabel).toBe("模拟战果");
  });

  it("uses actual-result visual semantics for pure simulation mode", () => {
    expect(deriveMatchCardState(match({ isRealResult: false }), "sim")).toMatchObject({
      statusLabel: "模拟战果",
      showsResolvedScoreline: true,
      usesActualResultVisuals: true,
    });
  });
});

describe("deriveTeamCardState", () => {
  it("uses separate labels and visual tiers for actual and predicted eliminated schools", () => {
    expect(deriveTeamCardState(teamCard({ isSimulated: false }), "live")).toMatchObject({
      summaryLabel: "实际淘汰",
      visualTier: "actual-eliminated",
      hasDashedFrame: false,
    });
    expect(deriveTeamCardState(teamCard({ isSimulated: true }), "live")).toMatchObject({
      summaryLabel: "预期淘汰",
      visualTier: "predicted-eliminated",
      hasDashedFrame: true,
    });
  });

  it("uses dashed frames for every predicted summary outcome", () => {
    expect(deriveTeamCardState(teamCard({ tone: "amber", isSimulated: true }), "live")).toMatchObject({
      summaryLabel: "预期晋级",
      visualTier: "predicted-safe",
      hasDashedFrame: true,
    });
    expect(deriveTeamCardState(teamCard({ tone: "steel", isSimulated: true }), "live")).toMatchObject({
      summaryLabel: "预期淘汰",
      visualTier: "predicted-eliminated",
      hasDashedFrame: true,
    });
  });

  it("uses actual outcome visuals for summary cards in pure simulation mode", () => {
    expect(deriveTeamCardState(teamCard({ tone: "amber", isSimulated: true }), "sim")).toMatchObject({
      isSimulated: false,
      summaryLabel: "实际晋级",
      visualTier: "actual-safe",
      hasDashedFrame: false,
    });
    expect(deriveTeamCardState(teamCard({ tone: "steel", isSimulated: true }), "sim")).toMatchObject({
      isSimulated: false,
      summaryLabel: "实际淘汰",
      visualTier: "actual-eliminated",
      hasDashedFrame: false,
    });
  });
});
