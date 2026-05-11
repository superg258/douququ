import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCORE_LABEL_CLASS,
  OFFICIAL_PLACEHOLDER_SCORE_LABEL_CLASS,
  PREDICTION_MATCH_VISUAL_CLASSES,
  deriveMatchCardState,
  deriveTeamCardState,
  formatMatchCardScheduleTime,
} from "@/components/canvas-card";
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
  it("exposes compact planned start time for the match card top bar", () => {
    expect(formatMatchCardScheduleTime("2026-05-16T17:30:00+08:00")).toBe("05-16 17:30");
    expect(formatMatchCardScheduleTime("2026-05-13T00:10:00Z")).toBe("05-13 08:10");
    expect(deriveMatchCardState(match({ plannedStartAt: "2026-05-16T17:30:00+08:00" }), "live")).toMatchObject({
      scheduleTimeLabel: "05-16 17:30",
    });
    expect(deriveMatchCardState(match({ plannedStartAt: "2026-05-01T23:05:00+00:00" }), "live")).toMatchObject({
      scheduleTimeLabel: "05-02 07:05",
    });
  });

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

  it("does not call official placeholder matches scheduled before teams are confirmed", () => {
    expect(
      deriveMatchCardState(
        match({
          officialMatchId: "30900",
          officialStatus: "WAITING",
          plannedStartAt: "2026-05-13T00:10:00+00:00",
          isConfirmedMatchup: false,
          redTeam: { teamKey: "", collegeName: "A1", teamName: "官方槽位待确认", slot: "A1" },
          blueTeam: { teamKey: "", collegeName: "A9", teamName: "官方槽位待确认", slot: "A9" },
        }),
        "live"
      )
    ).toMatchObject({
      statusLabel: "队伍待定",
      isOfficialPlaceholder: true,
      isOfficialScheduled: false,
    });
  });

  it("keeps predicted future matchups with official schedule ids out of placeholder mode", () => {
    expect(
      deriveMatchCardState(
        match({
          officialMatchId: "30916",
          officialStatus: "WAITING",
          plannedStartAt: "2026-05-13T12:00:00+00:00",
          isConfirmedMatchup: false,
          redTeam: { teamKey: "red::predicted", collegeName: "预测红方", teamName: "Red" },
          blueTeam: { teamKey: "blue::predicted", collegeName: "预测蓝方", teamName: "Blue" },
        }),
        "live"
      )
    ).toMatchObject({
      statusLabel: "预测",
      isOfficialPlaceholder: false,
      isOfficialScheduled: false,
      isPrediction: true,
    });
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

  it("keeps prediction match visual tokens deliberately dim", () => {
    expect(PREDICTION_MATCH_VISUAL_CLASSES.container).toContain("border-rm-blue/8");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.container).toContain("bg-black/60");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.statusBadge).toContain("text-rm-blue/40");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.sideAccent).toBe("opacity-[0.12]");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.redScorePanel).toContain("rgba(232,48,42,0.12)");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.redScorePanel).toContain("text-white/30");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.dividerBackground).toContain("rgba(232,48,42,0.12)");
  });

  it("uses a solid frame for the prediction score label", () => {
    expect(PREDICTION_MATCH_VISUAL_CLASSES.scoreLabel).toContain("border ");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.scoreLabel).toContain("border-current");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.scoreLabel).toContain("text-rm-blue/55");
    expect(PREDICTION_MATCH_VISUAL_CLASSES.scoreLabel).not.toContain("border-dashed");
  });

  it("uses the score label text color for the default score label frame", () => {
    expect(DEFAULT_SCORE_LABEL_CLASS).toContain("border-current");
    expect(DEFAULT_SCORE_LABEL_CLASS).toContain("text-rm-metal-text");
    expect(DEFAULT_SCORE_LABEL_CLASS).not.toContain("border-white");
  });

  it("uses a solid frame for the official placeholder pending score label", () => {
    expect(OFFICIAL_PLACEHOLDER_SCORE_LABEL_CLASS).toContain("border ");
    expect(OFFICIAL_PLACEHOLDER_SCORE_LABEL_CLASS).not.toContain("border-dashed");
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
