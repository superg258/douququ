import { describe, expect, it } from "vitest";

import { buildLiveCommandCenter } from "@/lib/live-command-center";
import type { CommandCenterResponse } from "@/lib/types";

const baseMatch = {
  id: "south_region:NEXT-1",
  regionSlug: "south_region",
  regionName: "南部赛区",
  seed: 20260414,
  mode: "live",
  dataSource: "official_live",
  scheduleState: "scheduled",
  workspaceView: "swiss-a",
  matchLabel: "NEXT-1",
  stage: "swiss",
  stageLabel: "A 组瑞士轮",
  stageOrder: 1,
  roundNumber: 1,
  groupName: "A",
  bestOf: 3,
  plannedStartAt: "2099-01-01T09:00:00+08:00",
  plannedLocalDate: "2099-01-01",
  officialMatchId: "NEXT-1",
  officialStatus: "PENDING",
  redTeam: { teamKey: "red", collegeName: "红方大学", teamName: "Red" },
  blueTeam: { teamKey: "blue", collegeName: "蓝方大学", teamName: "Blue" },
  pGameRed: 0.6,
  pGameBlue: 0.4,
  pSeriesRed: 0.66,
  pSeriesBlue: 0.34,
  favoriteRate: 0.66,
  margin: 0.32,
  predictedWinnerSide: "red",
  predictedWinnerTeamKey: "red",
  predictedWinnerName: "红方大学",
  predictedScoreline: "2:1",
  confidenceLabel: "medium",
  confidenceText: "中等置信",
  audience: {
    status: "unavailable",
    available: false,
    redRate: null,
    blueRate: null,
    tieRate: null,
    totalCount: null,
    favoriteSide: null,
    label: "暂无观众预测",
    fetchedAt: null,
  },
  modelAudienceDivergence: {
    available: false,
    redDelta: null,
    absoluteDelta: null,
    label: "暂无观众预测",
    audienceFavoriteSide: null,
  },
  upsetRisk: { score: 0.2, label: "低", reason: "模型优势较清楚" },
  timelineState: "up_next",
} satisfies CommandCenterResponse["timelineBuckets"]["upNext"][number];

describe("live command center", () => {
  function buildCommand(overrides: Partial<CommandCenterResponse> = {}): CommandCenterResponse {
    return {
      generatedAt: "2026-05-06T00:00:00+00:00",
      seed: 20260414,
      targetDate: "2099-01-01",
      timezone: "Asia/Shanghai",
      source: {
        requestedMode: "live",
        effectiveMode: "live",
        regionStatuses: [],
      },
      sourceFreshness: {
        serviceGeneratedAt: "2026-05-06T00:00:00+00:00",
        modelGeneratedAt: "2026-05-06T00:00:00+00:00",
        officialScheduleUpdatedAt: "2026-05-06T00:00:00+00:00",
        liveEloUpdatedAt: null,
        officialScheduleAgeMinutes: 30,
        liveEloStatus: "missing",
        activeRegionCount: 1,
        totalRegionCount: 3,
        coverageLabel: "南部官方实时，东部/北部模拟代理",
        regionStatuses: [],
      },
      completedMatchCount: 0,
      pendingMatchCount: 1,
      confirmedPendingMatchCount: 1,
      scheduledPendingMatchCount: 1,
      nextActionMatch: baseMatch,
      timelineBuckets: {
        liveNow: [],
        upNext: [baseMatch],
        todayPending: [],
        confirmedUpcoming: [],
        overdueUnresolved: [],
        simulationUnassigned: [{ ...baseMatch, id: "south_region:SIM-TBD", matchLabel: "SIM-TBD" }],
        reviewPending: [{ ...baseMatch, id: "south_region:DONE-1", matchLabel: "DONE-1", timelineState: "review_pending" }],
      },
      ...overrides,
    };
  }

  it("builds populated sections from command center timeline buckets", () => {
    const command = buildLiveCommandCenter(buildCommand());

    expect(command.hasOfficialSchedule).toBe(true);
    expect(command.sections.find((section) => section.id === "up-next")?.items).toHaveLength(1);
    expect(command.sections.find((section) => section.id === "up-next")?.items[0].matchLabel).toBe("NEXT-1");
    expect(command.sections.map((section) => section.id)).not.toContain("simulation-unassigned");
    expect(command.sections.map((section) => String(section.id))).not.toContain("simulation-predictions");
    expect(command.sections.map((section) => section.id)).not.toContain("review-pending");
    expect(command.unavailableReason).toBe("");
  });

  it("does not surface simulation proxy matches in the live command center", () => {
    const predictedShell = {
      ...baseMatch,
      id: "south_region:PREDICTED-1",
      matchLabel: "PREDICTED-1",
      dataSource: "simulation_proxy",
      scheduleState: "simulation_proxy",
      timelineState: "simulation_unassigned",
    } satisfies CommandCenterResponse["timelineBuckets"]["simulationUnassigned"][number];

    const command = buildLiveCommandCenter(
      buildCommand({
        timelineBuckets: {
          liveNow: [],
          upNext: [],
          todayPending: [],
          confirmedUpcoming: [],
          overdueUnresolved: [],
          simulationUnassigned: [predictedShell],
          reviewPending: [],
        },
      })
    );

    expect(command.sections.map((item) => String(item.id))).not.toContain("simulation-predictions");
    expect(command.sections.flatMap((item) => item.items.map((match) => match.matchLabel))).not.toContain(
      "PREDICTED-1"
    );
  });

  it("keeps only the source unavailable reason when all live data is proxied", () => {
    const command = buildLiveCommandCenter(
      buildCommand({
        source: {
          requestedMode: "live",
          effectiveMode: "simulation_proxy",
          regionStatuses: [],
        },
        sourceFreshness: {
          serviceGeneratedAt: "2026-05-06T00:00:00+00:00",
          modelGeneratedAt: "2026-05-06T00:00:00+00:00",
          officialScheduleUpdatedAt: null,
          liveEloUpdatedAt: null,
          officialScheduleAgeMinutes: null,
          liveEloStatus: "missing",
          activeRegionCount: 0,
          totalRegionCount: 3,
          coverageLabel: "官方实时源未接入，全部使用模拟代理",
          regionStatuses: [],
        },
      })
    );

    expect(command.hasOfficialSchedule).toBe(false);
    expect(command.unavailableReason).toBe("官方实时源未接入");
  });
});
