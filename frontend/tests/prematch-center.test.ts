import { describe, expect, it } from "vitest";

import {
  buildPrematchHref,
  formatEmptyStateCount,
  getDataSourceLabel,
  formatPrematchTime,
  buildRegionRankingHref,
  EMPTY_STATE_REGION_LINKS,
  getTimeBlockLabel,
  groupByTimeBlock,
  formatPrematchDate,
  getNoScheduledStateCopy,
  groupByDate,
  isPrematchCompleteState,
  selectSpotlightMatches,
  sortPrematchMatchesByTime,
  getTimelineStateLabel,
} from "@/lib/prematch-center";
import type { PrematchCenterMatch } from "@/lib/types";

function buildMockMatch(overrides: Partial<PrematchCenterMatch> = {}): PrematchCenterMatch {
  return {
    id: "south_region:match-1",
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
    plannedStartAt: "2026-04-14T10:00:00+08:00",
    plannedLocalDate: "2026-04-14",
    officialMatchId: "OFFICIAL-1",
    officialStatus: "scheduled",
    redTeam: {
      teamKey: "red-team",
      collegeName: "红方大学",
      teamName: "红方战队",
    },
    blueTeam: {
      teamKey: "blue-team",
      collegeName: "蓝方大学",
      teamName: "蓝方战队",
    },
    pGameRed: 0.62,
    pGameBlue: 0.38,
    pSeriesRed: 0.68,
    pSeriesBlue: 0.32,
    favoriteRate: 0.68,
    margin: 0.36,
    predictedWinnerSide: "red",
    predictedWinnerTeamKey: "red-team",
    predictedWinnerName: "红方大学",
    predictedScoreline: "2:1",
    confidenceLabel: "medium",
    confidenceText: "中等置信",
    audience: {
      status: "available",
      available: true,
      redRate: 0.44,
      blueRate: 0.56,
      tieRate: null,
      totalCount: 120,
      favoriteSide: "blue",
      label: "120 票",
      fetchedAt: "2026-04-14T00:00:00Z",
    },
    modelAudienceDivergence: {
      available: true,
      redDelta: -0.24,
      absoluteDelta: 0.24,
      label: "明显分歧",
      audienceFavoriteSide: "blue",
    },
    upsetRisk: {
      score: 0.38,
      label: "中",
      reason: "下位方有可观胜率，需关注临场波动",
    },
    redTeamGlobalRank: 48,
    blueTeamGlobalRank: 48,
    strongTeamInvolved: false,
    priorUpsetTeamKeys: [],
    hasPriorUpsetTeam: false,
    redCurrentElo: 1680,
    blueCurrentElo: 1620,
    redPreseasonElo: 1680,
    bluePreseasonElo: 1620,
    redEloDeltaFromPreseason: 0,
    blueEloDeltaFromPreseason: 0,
    redSeasonOverperformer: false,
    blueSeasonOverperformer: false,
    seasonOverperformerTeamKeys: [],
    hasSeasonOverperformerTeam: false,
    ...overrides,
  };
}

describe("prematch-center helpers", () => {
  /* ── Data source labels ── */
  it("returns correct Chinese labels for all data sources", () => {
    expect(getDataSourceLabel("official_live")).toBe("官方实时");
    expect(getDataSourceLabel("simulation")).toBe("模拟预测");
    expect(getDataSourceLabel("simulation_proxy")).toBe("模拟代理");
  });

  it("returns Chinese labels for timeline states", () => {
    expect(getTimelineStateLabel("live_now")).toBe("正在进行");
    expect(getTimelineStateLabel("up_next")).toBe("即将开赛");
    expect(getTimelineStateLabel("today_pending")).toBe("尚未开赛");
    expect(getTimelineStateLabel("overdue_unresolved")).toBe("已过期未同步");
    expect(getTimelineStateLabel("simulation_unassigned")).toBe("待排期");
    expect(getTimelineStateLabel("review_pending")).toBe("已完赛");
  });

  /* ── buildPrematchHref ── */
  it("does not generate a pseudo-live href for simulation_proxy data source", () => {
    const match = buildMockMatch({ dataSource: "simulation_proxy" });
    const href = buildPrematchHref(match);

    expect(href).toContain("mode=sim");
    expect(href).not.toContain("mode=live");
    expect(href).toContain("view=swiss-a");
    expect(href).toContain("highlight=red-team");
    expect(href).toContain("seed=20260414");
  });

  it("uses mode=sim for simulation data source", () => {
    const match = buildMockMatch({ dataSource: "simulation" });
    const href = buildPrematchHref(match);

    expect(href).toContain("mode=sim");
    expect(href).not.toContain("mode=live");
  });

  it("uses mode=live for official_live data source", () => {
    const match = buildMockMatch({ dataSource: "official_live" });
    const href = buildPrematchHref(match);

    expect(href).toContain("mode=live");
  });

  it("generates correct region path and workspace view in href", () => {
    const match = buildMockMatch({
      regionSlug: "east_region",
      workspaceView: "playoff",
    });
    const href = buildPrematchHref(match);

    expect(href).toMatch(/^\/regions\/east_region\?/);
    expect(href).toContain("view=playoff");
  });

  /* ── Empty state ── */
  it("formats empty state count text correctly", () => {
    expect(formatEmptyStateCount(266)).toBe(
      "已完赛 266 场。可以进入赛区沙盘查看实时回放、预测命中情况与最终排名。"
    );
  });

  it("does not treat an empty not-yet-started schedule as completed", () => {
    expect(isPrematchCompleteState({ completedMatchCount: 0, pendingMatchCount: 0 })).toBe(false);
    expect(isPrematchCompleteState({ completedMatchCount: 12, pendingMatchCount: 0 })).toBe(true);
    expect(isPrematchCompleteState({ completedMatchCount: 12, pendingMatchCount: 3 })).toBe(false);
  });

  it("describes zero official schedule activity as not started", () => {
    expect(getNoScheduledStateCopy(0)).toEqual({
      title: "官方赛程尚未开始同步",
      description:
        "当前还没有接入已排期或已开赛的官方赛程。待官方同步排期后，这里会展示下一场、焦点战和实时预测入口。",
    });
    expect(getNoScheduledStateCopy(3)).toEqual({
      title: "暂无已排期赛程",
      description: "当前 3 场未赛均为模拟推演。待官方同步赛程后，已排期场次将在此展示。",
    });
  });

  it("provides three empty-state region links in order", () => {
    expect(EMPTY_STATE_REGION_LINKS).toHaveLength(3);
    expect(EMPTY_STATE_REGION_LINKS[0].label).toBe("南部赛区最终排名");
    expect(EMPTY_STATE_REGION_LINKS[1].label).toBe("东部赛区最终排名");
    expect(EMPTY_STATE_REGION_LINKS[2].label).toBe("北部赛区最终排名");
    EMPTY_STATE_REGION_LINKS.forEach((link) => {
      expect(link.href).toContain("view=final-rankings");
    });
  });

  it("builds region ranking href with final-rankings view", () => {
    const href = buildRegionRankingHref("south_region");
    expect(href).toContain("/regions/south_region");
    expect(href).toContain("view=final-rankings");
  });

  /* ── Time formatting ── */
  it("formats ISO datetime to HH:MM in Beijing time", () => {
    expect(formatPrematchTime("2026-04-14T10:00:00+08:00")).toBe("10:00");
    expect(formatPrematchTime("2026-04-14T18:30:00+08:00")).toBe("18:30");
    expect(formatPrematchTime("2026-05-13T00:10:00Z")).toBe("08:10");
  });

  it("returns null for missing or invalid times", () => {
    expect(formatPrematchTime(null)).toBeNull();
    expect(formatPrematchTime("not-a-date")).toBeNull();
  });

  /* ── Match card data integrity ── */
  it("preserves probability values on round trip through mock", () => {
    const match = buildMockMatch();
    expect(match.pSeriesRed).toBeGreaterThan(match.pSeriesBlue);
    expect(match.pSeriesRed + match.pSeriesBlue).toBeCloseTo(1.0, 1);
    expect(match.favoriteRate).toBe(match.pSeriesRed);
  });

  /* ── Time block helpers ── */
  it("classifies time blocks correctly", () => {
    expect(getTimeBlockLabel("2026-04-14T00:00:00Z")).toBe("上午");
    expect(getTimeBlockLabel("2026-04-14T08:00:00+08:00")).toBe("上午");
    expect(getTimeBlockLabel("2026-04-14T11:59:59+08:00")).toBe("上午");
    expect(getTimeBlockLabel("2026-04-14T12:00:00+08:00")).toBe("下午");
    expect(getTimeBlockLabel("2026-04-14T17:59:59+08:00")).toBe("下午");
    expect(getTimeBlockLabel("2026-04-14T18:00:00+08:00")).toBe("晚间");
    expect(getTimeBlockLabel("2026-04-14T23:30:00+08:00")).toBe("晚间");
  });

  it("returns null for invalid time block input", () => {
    expect(getTimeBlockLabel(null)).toBeNull();
    expect(getTimeBlockLabel("not-a-date")).toBeNull();
  });

  it("groups items by time block in correct order", () => {
    const items = [
      buildMockMatch({ id: "1", plannedStartAt: "2026-04-14T18:00:00+08:00" }),
      buildMockMatch({ id: "2", plannedStartAt: "2026-04-14T09:00:00+08:00" }),
      buildMockMatch({ id: "3", plannedStartAt: "2026-04-14T14:00:00+08:00" }),
      buildMockMatch({ id: "4", plannedStartAt: "2026-04-14T08:00:00+08:00" }),
    ];
    const groups = groupByTimeBlock(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].block).toBe("上午");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].block).toBe("下午");
    expect(groups[1].items).toHaveLength(1);
    expect(groups[2].block).toBe("晚间");
    expect(groups[2].items).toHaveLength(1);
  });

  it("defaults null start time to 上午 in grouping", () => {
    const items = [
      buildMockMatch({ id: "1", plannedStartAt: null }),
      buildMockMatch({ id: "2", plannedStartAt: "2026-04-14T15:00:00+08:00" }),
    ];
    const groups = groupByTimeBlock(items);
    expect(groups[0].block).toBe("上午");
    expect(groups[0].items).toHaveLength(1);
  });

  /* ── Date formatting helpers ── */
  it("formats date labels correctly", () => {
    const result = formatPrematchDate("2026-04-14");
    expect(result?.dateLabel).toBe("4月14日");
    expect(result?.weekday).toBe("周二");
  });

  it("returns null for invalid date input", () => {
    expect(formatPrematchDate(null)).toBeNull();
  });

  it("groups items by date", () => {
    const items = [
      buildMockMatch({ id: "1", plannedLocalDate: "2026-04-15" }),
      buildMockMatch({ id: "2", plannedLocalDate: "2026-04-14" }),
      buildMockMatch({ id: "3", plannedLocalDate: "2026-04-14" }),
    ];
    const groups = groupByDate(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(1); // 4月15日
    expect(groups[1].items).toHaveLength(2); // 4月14日
  });

  it("sorts scheduled prematch cards by planned start time with undated matches last", () => {
    const items = [
      buildMockMatch({ id: "late", plannedStartAt: "2026-04-14T18:00:00+08:00" }),
      buildMockMatch({ id: "unknown", plannedStartAt: null, matchLabel: "UNKNOWN" }),
      buildMockMatch({ id: "early", plannedStartAt: "2026-04-14T09:00:00+08:00" }),
      buildMockMatch({ id: "mid", plannedStartAt: "2026-04-14T14:00:00+08:00" }),
    ];

    expect(sortPrematchMatchesByTime(items).map((match) => match.id)).toEqual([
      "early",
      "mid",
      "late",
      "unknown",
    ]);
  });

  it("treats top-32 teams as strong signals for spotlight selection", () => {
    const items = [
      buildMockMatch({
        id: "south-china-tigers-vs-imca",
        redTeamGlobalRank: 10,
        blueTeamGlobalRank: 28,
        margin: 0.48,
      }),
      buildMockMatch({
        id: "single-top-32",
        redTeamGlobalRank: 24,
        blueTeamGlobalRank: 48,
        margin: 0.12,
      }),
    ];

    expect(selectSpotlightMatches(items).map((match) => match.id)).toEqual([
      "south-china-tigers-vs-imca",
    ]);
  });

  it("prioritizes bilateral strong-team and season-overperformer signals", () => {
    const items = [
      buildMockMatch({
        id: "close-only",
        plannedStartAt: "2026-04-14T08:00:00+08:00",
        margin: 0.02,
        favoriteRate: 0.51,
      }),
      buildMockMatch({
        id: "single-strong",
        plannedStartAt: "2026-04-14T09:00:00+08:00",
        redTeamGlobalRank: 3,
        strongTeamInvolved: true,
        margin: 0.08,
        favoriteRate: 0.54,
      }),
      buildMockMatch({
        id: "two-overperformers",
        plannedStartAt: "2026-04-14T10:00:00+08:00",
        redEloDeltaFromPreseason: 32,
        blueEloDeltaFromPreseason: 84,
        redSeasonOverperformer: true,
        blueSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["red-team", "blue-team"],
        margin: 0.64,
        favoriteRate: 0.82,
      }),
      buildMockMatch({
        id: "strong-and-overperformer",
        plannedStartAt: "2026-04-14T11:00:00+08:00",
        strongTeamInvolved: true,
        redTeamGlobalRank: 10,
        blueEloDeltaFromPreseason: 46,
        blueSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["blue-team"],
        margin: 0.25,
        favoriteRate: 0.625,
      }),
      buildMockMatch({
        id: "two-strongs",
        plannedStartAt: "2026-04-14T12:00:00+08:00",
        strongTeamInvolved: true,
        redTeamGlobalRank: 15,
        blueTeamGlobalRank: 14,
        redEloDeltaFromPreseason: 20.5,
        redSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["red-team"],
        margin: 0.024,
        favoriteRate: 0.512,
      }),
      buildMockMatch({
        id: "lopsided-strong-vs-overperformer",
        plannedStartAt: "2026-04-14T13:00:00+08:00",
        redTeamGlobalRank: 1,
        strongTeamInvolved: true,
        blueEloDeltaFromPreseason: 34,
        blueSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["blue-team"],
        margin: 0.96,
        favoriteRate: 0.98,
      }),
    ];

    expect(selectSpotlightMatches(items).map((match) => match.id)).toEqual([
      "two-overperformers",
      "strong-and-overperformer",
      "two-strongs",
    ]);
  });

  it("does not fill spotlight slots with one-sided or close-only signals", () => {
    const items = [
      buildMockMatch({
        id: "close-only",
        plannedStartAt: "2026-04-14T09:00:00+08:00",
        margin: 0.01,
        favoriteRate: 0.505,
      }),
      buildMockMatch({
        id: "single-strong",
        plannedStartAt: "2026-04-14T10:00:00+08:00",
        strongTeamInvolved: true,
        redTeamGlobalRank: 4,
        margin: 0.08,
        favoriteRate: 0.54,
      }),
      buildMockMatch({
        id: "single-overperformer",
        plannedStartAt: "2026-04-14T11:00:00+08:00",
        redEloDeltaFromPreseason: 88,
        redSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["red-team"],
        margin: 0.12,
        favoriteRate: 0.56,
      }),
      buildMockMatch({
        id: "valid-bilateral",
        plannedStartAt: "2026-04-14T12:00:00+08:00",
        redTeamGlobalRank: 7,
        strongTeamInvolved: true,
        blueEloDeltaFromPreseason: 22,
        blueSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["blue-team"],
        margin: 0.44,
        favoriteRate: 0.72,
      }),
    ];

    expect(selectSpotlightMatches(items).map((match) => match.id)).toEqual(["valid-bilateral"]);
  });

  it("caps spotlight matches at three games and displays selected games by time", () => {
    const items = [
      buildMockMatch({
        id: "low-earliest",
        plannedStartAt: "2026-04-14T08:00:00+08:00",
        redTeamGlobalRank: 16,
        blueTeamGlobalRank: 15,
        strongTeamInvolved: true,
        margin: 0.76,
      }),
      buildMockMatch({
        id: "mid-early",
        plannedStartAt: "2026-04-14T09:00:00+08:00",
        redTeamGlobalRank: 8,
        blueEloDeltaFromPreseason: 22,
        blueSeasonOverperformer: true,
        strongTeamInvolved: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["blue-team"],
        margin: 0.22,
      }),
      buildMockMatch({
        id: "mid-late",
        plannedStartAt: "2026-04-14T10:00:00+08:00",
        redEloDeltaFromPreseason: 42,
        blueEloDeltaFromPreseason: 24,
        redSeasonOverperformer: true,
        blueSeasonOverperformer: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["red-team", "blue-team"],
        margin: 0.35,
      }),
      buildMockMatch({
        id: "solid-fifth",
        plannedStartAt: "2026-04-14T11:00:00+08:00",
        redTeamGlobalRank: 12,
        blueTeamGlobalRank: 20,
        strongTeamInvolved: true,
        margin: 0.1,
      }),
      buildMockMatch({
        id: "solid-sixth",
        plannedStartAt: "2026-04-14T11:30:00+08:00",
        redTeamGlobalRank: 18,
        blueTeamGlobalRank: 22,
        strongTeamInvolved: true,
        margin: 0.2,
      }),
      buildMockMatch({
        id: "high-latest",
        plannedStartAt: "2026-04-14T12:00:00+08:00",
        redTeamGlobalRank: 3,
        blueEloDeltaFromPreseason: 72,
        blueSeasonOverperformer: true,
        strongTeamInvolved: true,
        hasSeasonOverperformerTeam: true,
        seasonOverperformerTeamKeys: ["blue-team"],
        margin: 0.2,
      }),
    ];

    expect(selectSpotlightMatches(items).map((match) => match.id)).toEqual([
      "mid-early",
      "mid-late",
      "high-latest",
    ]);
  });
});
