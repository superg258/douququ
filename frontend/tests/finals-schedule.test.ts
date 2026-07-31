import { describe, expect, it } from "vitest";

import officialFinalsSchedule from "../../data/reference/2026_finals/schedule.json";

import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { buildFinalsMatchRow } from "@/lib/finals-match-adapter";
import {
  buildFinalsCanvasEntry,
  buildRepechageSwissFlow,
  findNextOfficialMatch,
  getFinalsLiveUnavailableReason,
  getOfficialFinalSchedules,
  getRepechageSwissMatchHint,
  hasActualFinalMatchup,
  hasOfficialFinalSchedule,
  hasOfficialFinalScheduleSkeleton,
  isActualSchoolName,
  matchesForFinalStage,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
} from "@/lib/finals-schedule";
import type { FinalEventMatch, FinalEventResponse, FinalEventsSnapshotResponse, FinalEventSchedule, LiveSourceStatusContract, OverviewResponse, OverviewTeam, TeamCanvasCard } from "@/lib/types";

function match(number: number, startsAt: string, stage: string, overrides: Partial<FinalEventMatch> = {}): FinalEventMatch {
  const confirmedOfficialMatchup = overrides.officialMatchId && overrides.isConfirmedMatchup !== false
    ? {
        isConfirmedMatchup: true,
        redTeamKey: `red::${number}`,
        blueTeamKey: `blue::${number}`,
        redCollegeName: `红方大学 ${number}`,
        blueCollegeName: `蓝方大学 ${number}`,
      }
    : {};
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
    ...confirmedOfficialMatchup,
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
    teamRatingIndex: {},
  };
}

const activeOfficialLiveStatus: LiveSourceStatusContract = {
  sourceStatus: "active",
  sourceReason: null,
  sourceKind: "official",
  isSynthetic: false,
  sourceUpdatedAt: "2026-07-22T00:00:00+08:00",
  sourceAgeSeconds: 0,
  freshnessLabel: "fresh",
  validationState: "validated",
  scenarioId: null,
  runtimeArtifactVersion: "runtime:test",
  completedMatches: 0,
  confirmedMatches: 1,
};

describe("finals schedule helpers", () => {
  it("prefers the live canvas only when an active validated official schedule exists", () => {
    const base = {
      schemaVersion: 1,
      season: 2026,
      timezone: "Asia/Shanghai",
      timezoneLabel: "北京时间",
      scheduleStatus: "official_schedule_draw_pending",
      verifiedAt: "2026-07-22T00:00:00+08:00",
      sources: [],
      event: event([]),
    } as FinalEventResponse;

    expect(hasOfficialFinalSchedule(base)).toBe(false);
    expect(hasOfficialFinalSchedule({
      ...base,
      liveStatus: activeOfficialLiveStatus,
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" })]),
    })).toBe(true);
    const skeletonOnly = {
      ...base,
      liveStatus: { ...activeOfficialLiveStatus, confirmedMatches: 0 },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", {
        officialMatchId: "30900",
        isConfirmedMatchup: false,
      })]),
    };
    expect(hasOfficialFinalScheduleSkeleton(skeletonOnly)).toBe(true);
    expect(hasOfficialFinalSchedule(skeletonOnly)).toBe(false);
    expect(hasOfficialFinalSchedule({
      ...base,
      liveStatus: activeOfficialLiveStatus,
      event: event([
        match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" }),
        match(2, "2026-07-31T11:00:00+08:00", "B组瑞士轮第一轮", {
          officialMatchId: "30901",
          isConfirmedMatchup: false,
        }),
      ]),
    })).toBe(false);
    expect(hasOfficialFinalSchedule({
      ...base,
      liveStatus: { ...activeOfficialLiveStatus, sourceKind: "synthetic", isSynthetic: true },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "synthetic-1" })]),
    })).toBe(false);
    for (const liveStatus of [
      { ...activeOfficialLiveStatus, sourceStatus: "missing" as const, validationState: "missing" as const },
      { ...activeOfficialLiveStatus, sourceStatus: "inactive" as const, validationState: "inactive" as const },
    ]) {
      expect(hasOfficialFinalSchedule({
        ...base,
        liveStatus,
        event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" })]),
      })).toBe(false);
    }
    expect(hasOfficialFinalSchedule({
      ...base,
      liveStatus: { ...activeOfficialLiveStatus, freshnessLabel: "stale" as const },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" })]),
    })).toBe(true);
  });

  it("describes unavailable official sources without calling reference schedules realtime", () => {
    const base = {
      schemaVersion: 1,
      season: 2026,
      timezone: "Asia/Shanghai",
      timezoneLabel: "北京时间",
      scheduleStatus: "official_schedule_draw_pending",
      verifiedAt: "2026-07-22T00:00:00+08:00",
      sources: [],
      liveStatus: {
        ...activeOfficialLiveStatus,
        sourceStatus: "missing",
        validationState: "missing",
      },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮")]),
    } as FinalEventResponse;

    expect(getFinalsLiveUnavailableReason(base)).toContain("尚未发布");
    const stale = {
      ...base,
      liveStatus: { ...activeOfficialLiveStatus, freshnessLabel: "stale" as const },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" })]),
    };
    expect(getFinalsLiveUnavailableReason(stale)).toBeNull();
    const skeleton = {
      ...stale,
      liveStatus: { ...stale.liveStatus, confirmedMatches: 0 },
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", {
        officialMatchId: "30900",
        isConfirmedMatchup: false,
      })]),
    };
    expect(getFinalsLiveUnavailableReason(skeleton)).toContain("初始抽签对阵尚未发布");
  });

  it("builds explicit homepage entries for live and simulated finals canvases", () => {
    const baseRepechage = {
      schemaVersion: 1,
      season: 2026,
      timezone: "Asia/Shanghai" as const,
      timezoneLabel: "北京时间",
      scheduleStatus: "official_schedule_draw_pending",
      verifiedAt: "2026-07-22T00:00:00+08:00",
      sources: [],
      liveStatus: activeOfficialLiveStatus,
      event: event([]),
    } as FinalEventResponse;

    const baseNationals = {
      ...baseRepechage,
      event: {
        ...event([]),
        slug: "nationals" as const,
        name: "全国赛",
        shortName: "全国赛",
        eyebrow: "RMUC 2026",
        statusLabel: "抽签待公布",
      },
    } as FinalEventResponse;

    function snapshot(repechage: FinalEventResponse, nationals: FinalEventResponse): FinalEventsSnapshotResponse {
      return {
        schemaVersion: 1,
        season: 2026,
        mode: "live",
        runtimeArtifactVersion: "test",
        events: { repechage, nationals },
      };
    }

    const testNow = "2026-07-22T12:00:00+08:00";

    // No official schedule → sim mode, no status badge.
    expect(buildFinalsCanvasEntry(snapshot(baseRepechage, baseNationals), testNow)).toEqual({
      href: "/forecast-center?event=repechage&mode=sim",
      label: "进入复活赛模拟对阵图",
      statusLabel: "暂无官方赛程 · 模拟",
    });

    // Has official schedule with upcoming match → deep link to the stage.
    const liveRepechage = {
      ...baseRepechage,
      event: event([
        match(1, "2026-07-31T10:00:00+08:00", "B组瑞士轮第一轮（BO3）", {
          officialMatchId: "30900",
          stageKey: "swiss" as const,
        }),
      ]),
    };
    expect(buildFinalsCanvasEntry(snapshot(liveRepechage, baseNationals), testNow)).toEqual({
      href: "/forecast-center?event=repechage&mode=live&stage=swiss-b",
      label: "进入复活赛 · B 组瑞士轮",
      statusLabel: "下一场",
    });

    // Has official schedule but all matches in the past → live mode, no stage param.
    const pastRepechage = {
      ...baseRepechage,
      event: event([
        match(1, "2026-07-20T10:00:00+08:00", "A组瑞士轮第一轮（BO3）", {
          officialMatchId: "30901",
          stageKey: "swiss" as const,
        }),
      ]),
    };
    expect(buildFinalsCanvasEntry(snapshot(pastRepechage, baseNationals), testNow)).toEqual({
      href: "/forecast-center?event=repechage&mode=live",
      label: "进入复活赛实时对阵图",
      statusLabel: "官方赛程 · 实时",
    });

    // Nationals next match takes priority when it is the earliest.
    const bothLive = {
      ...baseRepechage,
      event: event([
        match(1, "2026-08-05T10:00:00+08:00", "A组瑞士轮第一轮（BO3）", {
          officialMatchId: "30902",
          stageKey: "swiss" as const,
        }),
      ]),
    };
    const liveNationals = {
      ...baseNationals,
      event: {
        ...event([]),
        slug: "nationals" as const,
        name: "全国赛",
        shortName: "全国赛",
        eyebrow: "RMUC 2026",
        statusLabel: "抽签待公布",
        matches: [
          match(79, "2026-08-04T09:00:00+08:00", "16 进 8 首轮（BO5）", {
            officialMatchId: "30910",
            stageKey: "round_of_16" as const,
          }),
        ],
      },
    };
    expect(buildFinalsCanvasEntry(snapshot(bothLive, liveNationals), testNow)).toEqual({
      href: "/forecast-center?event=nationals&mode=live&stage=round-of-16",
      label: "进入全国赛 · 16 进 8",
      statusLabel: "下一场",
    });

    // Both events have schedules but all matches are past → prefer nationals
    // (the more recent event chronologically).
    const pastNationals = {
      ...baseNationals,
      event: {
        ...event([]),
        slug: "nationals" as const,
        name: "全国赛",
        shortName: "全国赛",
        eyebrow: "RMUC 2026",
        statusLabel: "抽签待公布",
        matches: [
          match(95, "2026-08-08T10:00:00+08:00", "决赛（BO5）", {
            officialMatchId: "30920",
            stageKey: "final" as const,
          }),
        ],
      },
    };
    const afterAll = "2026-08-10T12:00:00+08:00";
    expect(buildFinalsCanvasEntry(snapshot(pastRepechage, pastNationals), afterAll)).toEqual({
      href: "/forecast-center?event=nationals&mode=live",
      label: "进入全国总决赛实时对阵图",
      statusLabel: "官方赛程 · 实时",
    });

    const staleRepechage = {
      ...liveRepechage,
      liveStatus: { ...activeOfficialLiveStatus, freshnessLabel: "stale" as const },
    };
    expect(buildFinalsCanvasEntry(snapshot(staleRepechage, baseNationals), testNow)).toEqual({
      href: "/forecast-center?event=repechage&mode=live&stage=swiss-b",
      label: "进入复活赛 · B 组瑞士轮",
      statusLabel: "下一场",
    });
  });

  it("advances to the next official match when the previous start time passes", () => {
    const repechage = {
      schemaVersion: 1,
      season: 2026,
      timezone: "Asia/Shanghai",
      timezoneLabel: "北京时间",
      scheduleStatus: "official_schedule",
      verifiedAt: "2026-07-22T00:00:00+08:00",
      sources: [],
      liveStatus: activeOfficialLiveStatus,
      event: event([
        match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" }),
        match(2, "2026-07-31T11:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30901" }),
      ]),
    } as FinalEventResponse;
    const nationals = {
      ...repechage,
      event: {
        ...event([]),
        slug: "nationals" as const,
      },
    };
    const events = { repechage, nationals };

    expect(findNextOfficialMatch(events, "2026-07-31T09:59:00+08:00")?.match.number).toBe(1);
    expect(findNextOfficialMatch(events, "2026-07-31T10:01:00+08:00")?.match.number).toBe(2);
  });

  it("selects only events whose official realtime source is usable", () => {
    const repechage = {
      schemaVersion: 1,
      season: 2026,
      timezone: "Asia/Shanghai",
      timezoneLabel: "北京时间",
      scheduleStatus: "official_schedule",
      verifiedAt: "2026-07-22T00:00:00+08:00",
      sources: [],
      liveStatus: activeOfficialLiveStatus,
      event: event([match(1, "2026-07-31T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30900" })]),
    } as FinalEventResponse;
    const nationals = {
      ...repechage,
      liveStatus: {
        ...activeOfficialLiveStatus,
        sourceStatus: "inactive" as const,
        validationState: "inactive" as const,
      },
      event: {
        ...event([match(2, "2026-08-01T10:00:00+08:00", "A组瑞士轮第一轮", { officialMatchId: "30901" })]),
        slug: "nationals" as const,
      },
    };

    expect(Object.keys(getOfficialFinalSchedules({ repechage, nationals }))).toEqual(["repechage"]);
  });
  it("maps completed official finals matches into real result rows", () => {
    const payload = event([]);
    payload.participants = [
      { order: 1, schoolKey: "red-school", teamKey: "red::team", collegeName: "红方大学", teamName: "红方战队", drawTier: "第一梯队", status: "confirmed" },
      { order: 2, schoolKey: "blue-school", teamKey: "blue::team", collegeName: "蓝方大学", teamName: "蓝方战队", drawTier: "第一梯队", status: "confirmed" },
    ];
    const row = buildFinalsMatchRow(payload, match(1, "2026-07-31T19:00:00+08:00", "A组瑞士轮第一轮（BO3）", {
      officialStatus: "DONE",
      isCompleted: true,
      isConfirmedMatchup: true,
      scoreline: "2:1",
      result: "red",
      redWins: 2,
      blueWins: 1,
      redTeamKey: "red::team",
      redCollegeName: "红方大学",
      redTeamName: "红方战队",
      blueTeamKey: "blue::team",
      blueCollegeName: "蓝方大学",
      blueTeamName: "蓝方战队",
    }));

    expect(row).toMatchObject({
      isRealResult: true,
      isConfirmedMatchup: true,
      officialStatus: "DONE",
      scoreline: "2:1",
      winnerTeamKey: "red::team",
      loserTeamKey: "blue::team",
      redTeam: { teamKey: "red::team", collegeName: "红方大学", teamName: "红方战队" },
      blueTeam: { teamKey: "blue::team", collegeName: "蓝方大学", teamName: "蓝方战队" },
    });
  });

  it("carries finals audience votes for display without changing model probability", () => {
    const payload = event([]);
    payload.participants = [
      { order: 1, schoolKey: "red-school", teamKey: "red::team", collegeName: "红方大学", teamName: "红方战队", drawTier: "第一梯队", status: "confirmed" },
      { order: 2, schoolKey: "blue-school", teamKey: "blue::team", collegeName: "蓝方大学", teamName: "蓝方战队", drawTier: "第一梯队", status: "confirmed" },
    ];
    const officialMatch = match(1, "2026-07-31T19:00:00+08:00", "A组瑞士轮第一轮（BO3）", {
      officialMatchId: "31221",
      isConfirmedMatchup: true,
      redTeamKey: "red::team",
      redCollegeName: "红方大学",
      redTeamName: "红方战队",
      blueTeamKey: "blue::team",
      blueCollegeName: "蓝方大学",
      blueTeamName: "蓝方战队",
      miniProgramPrediction: {
        status: "available",
        matchId: "31221",
        redCount: 769,
        blueCount: 151,
        tieCount: 0,
        totalCount: 920,
        redRate: 769 / 920,
        blueRate: 151 / 920,
        tieRate: 0,
        fetchedAt: "2026-07-31T10:00:00+08:00",
      },
    });
    const withoutAudience = { ...officialMatch, miniProgramPrediction: undefined };

    const row = buildFinalsMatchRow(payload, officialMatch);
    const baseline = buildFinalsMatchRow(payload, withoutAudience);

    expect(row.officialMatchId).toBe("31221");
    expect(row.miniProgramPrediction).toEqual(officialMatch.miniProgramPrediction);
    expect(row.pGameRed).toBe(baseline.pGameRed);
    expect(row.pSeriesRed).toBe(baseline.pSeriesRed);
  });

  it("preserves an in-progress official finals score without marking it completed", () => {
    const row = buildFinalsMatchRow(event([]), match(2, "2026-07-31T19:40:00+08:00", "A组瑞士轮第一轮（BO3）", {
      officialStatus: "LIVE",
      isCompleted: false,
      isConfirmedMatchup: true,
      hasLiveScoreline: true,
      scoreline: "1:0",
      redTeamKey: "red::team",
      redCollegeName: "红方大学",
      redTeamName: "红方战队",
      blueTeamKey: "blue::team",
      blueCollegeName: "蓝方大学",
      blueTeamName: "蓝方战队",
    }));

    expect(row).toMatchObject({
      isRealResult: false,
      isConfirmedMatchup: true,
      hasLiveScoreline: true,
      officialStatus: "LIVE",
      scoreline: "1:0",
      winnerTeamKey: "",
      loserTeamKey: "",
    });
  });

  it("keeps the known side of a drawn matchup while the repechage side is pending", () => {
    const blue = {
      order: 1,
      schoolKey: "blue-school",
      teamKey: "blue::team",
      collegeName: "已抽中的大学",
      teamName: "已抽中的队",
      drawTier: "非种子抽签池",
      status: "confirmed" as const,
    };
    const payload = event([]);
    payload.participants = [blue];
    const row = buildFinalsMatchRow(payload, match(15, "2026-08-01T14:00:00+08:00", "B组瑞士轮第一轮（BO3）", {
      redSlot: "Ⅰ-B15",
      blueSlot: "Ⅰ-B7",
      isConfirmedMatchup: false,
      blueTeamKey: blue.teamKey,
      blueCollegeName: blue.collegeName,
      blueTeamName: blue.teamName,
    }));

    expect(row).toMatchObject({
      isRealResult: false,
      isConfirmedMatchup: false,
      redTeam: { teamKey: "", collegeName: "Ⅰ-B15" },
      blueTeam: { teamKey: blue.teamKey, collegeName: blue.collegeName, teamName: blue.teamName },
    });
  });

  it("recognizes real schools and rejects unresolved schedule slots", () => {
    expect(isActualSchoolName("广东工业大学")).toBe(true);
    expect(isActualSchoolName("DynamicX")).toBe(true);
    expect(isActualSchoolName("Ⅰ-A1")).toBe(false);
    expect(isActualSchoolName("胜者①")).toBe(false);
    expect(isActualSchoolName("待确认")).toBe(false);

    expect(hasActualFinalMatchup({ redSlot: "广东工业大学", blueSlot: "DynamicX" })).toBe(true);
    expect(hasActualFinalMatchup({ redSlot: "广东工业大学", blueSlot: "Ⅰ-A1" })).toBe(false);
    expect(hasActualFinalMatchup({
      redSlot: "Ⅰ-A1",
      blueSlot: "Ⅰ-A9",
      redTeamKey: "red::team",
      blueTeamKey: "blue::team",
    })).toBe(true);
  });

  it("filters each event stage", () => {
    const payload = event([
      match(1, "2026-07-31T09:00:00+08:00", "A组瑞士轮第一轮（BO3）"),
      match(2, "2026-07-31T09:40:00+08:00", "B组瑞士轮第一轮（BO3）"),
      match(3, "2026-08-01T09:00:00+08:00", "晋级名额争夺战（BO3）", { stageKey: "repechage_qualification" }),
    ]);

    expect(matchesForFinalStage(payload, "swiss-a").map((row) => row.number)).toEqual([1]);
    expect(matchesForFinalStage(payload, "swiss-b").map((row) => row.number)).toEqual([2]);
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
    expect(nationalsValues.reduce((sum, probability) => sum + probability.topEightRate, 0)).toBeCloseTo(8, 8);
    expect(nationalsValues.reduce((sum, probability) => sum + probability.topFourRate, 0)).toBeCloseTo(4, 8);
    expect(nationalsValues.reduce((sum, probability) => sum + probability.championRate, 0)).toBeCloseTo(1, 8);
    expect(nationalsValues.every((probability) => (
      probability.championRate <= probability.topFourRate
      && probability.topFourRate <= probability.topEightRate
      && probability.topEightRate <= probability.groupAdvancementRate
    ))).toBe(true);

    // Once the API has already materialized all four repechage entrants, the
    // probability field must remain 32 teams rather than appending another 4.
    const confirmedNationals = [
      ...nationals,
      ...repechage.slice(0, 4).map((participant) => ({
        ...participant,
        drawTier: "非种子抽签池",
      })),
    ];
    const confirmedProjection = projectFinalsStageProbabilities(
      repechage,
      confirmedNationals,
      overview,
      2_000,
    );
    const confirmedValues = [...confirmedProjection.nationals.values()];
    expect(confirmedProjection.nationals.size).toBe(32);
    expect(confirmedValues.reduce((sum, probability) => sum + probability.groupAdvancementRate, 0)).toBeCloseTo(16, 8);
    expect(confirmedValues.reduce((sum, probability) => sum + probability.topEightRate, 0)).toBeCloseTo(8, 8);
    expect(confirmedValues.reduce((sum, probability) => sum + probability.topFourRate, 0)).toBeCloseTo(4, 8);
    expect(confirmedValues.reduce((sum, probability) => sum + probability.championRate, 0)).toBeCloseTo(1, 8);
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
    expect(canvas.cards.every((card) => card.kind === "match")).toBe(true);
    // Flow lines fork at the round headers (regional style), not per match.
    // Here only 首轮→[直通战(胜)、生死战(败)] has both targets present, so one bracket fork.
    expect(canvas.connectors).toHaveLength(1);
    const fork = canvas.connectors[0];
    expect(fork.kind).toBe("bracket");
    expect(fork.tone).toBe("emerald");
    expect(fork.id).toContain(":qualification-fork:round1");
    expect(fork.branchY?.length).toBe(2);
    expect(fork.branchLabels?.map((label) => label.text)).toEqual(["胜者直通战", "败者生死战"]);
    expect(fork.appearance).toBeUndefined();
    expect(canvas.showProbability).toBe(false);
  });

  it("lists repechage qualification outcomes by deciding round instead of merging them", () => {
    const payload = event([
      match(23, "2026-08-02T09:00:00+08:00", "晋级名额争夺战（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "B-1",
        blueSlot: "A-4",
        winnerTo: "胜者①",
        loserTo: "败者①",
      }),
      match(24, "2026-08-02T09:35:00+08:00", "晋级名额争夺战（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "A-2",
        blueSlot: "B-3",
        winnerTo: "胜者②",
        loserTo: "败者②",
      }),
      match(25, "2026-08-02T10:10:00+08:00", "晋级名额争夺战（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "A-3",
        blueSlot: "B-2",
        winnerTo: "胜者③",
        loserTo: "败者③",
      }),
      match(26, "2026-08-02T10:45:00+08:00", "晋级名额争夺战（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "B-4",
        blueSlot: "A-1",
        winnerTo: "胜者④",
        loserTo: "败者④",
      }),
      match(27, "2026-08-02T14:00:00+08:00", "晋级名额争夺战败者组第一轮（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "败者①",
        blueSlot: "败者②",
        winnerTo: "胜者1",
        loserTo: "淘汰",
      }),
      match(28, "2026-08-02T14:35:00+08:00", "晋级名额争夺战败者组第一轮（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "败者④",
        blueSlot: "败者③",
        winnerTo: "胜者2",
        loserTo: "淘汰",
      }),
      match(29, "2026-08-02T16:10:00+08:00", "晋级名额争夺战胜者组（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "胜者①",
        blueSlot: "胜者②",
        winnerTo: "全国赛",
        loserTo: "败者I",
      }),
      match(30, "2026-08-02T16:45:00+08:00", "晋级名额争夺战胜者组（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "胜者④",
        blueSlot: "胜者③",
        winnerTo: "全国赛",
        loserTo: "败者II",
      }),
      match(31, "2026-08-02T19:00:00+08:00", "晋级名额争夺战败者组第二轮（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "败者I",
        blueSlot: "胜者2",
        winnerTo: "全国赛",
        loserTo: "淘汰",
      }),
      match(32, "2026-08-02T19:35:00+08:00", "晋级名额争夺战败者组第二轮（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: "胜者1",
        blueSlot: "败者II",
        winnerTo: "全国赛",
        loserTo: "淘汰",
      }),
    ]);

    const canvas = buildFinalsWorkspaceStage(payload, "qualification");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
    const flowCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes(":qualification-flow:"),
    );
    const flowSpecs = [
      {
        id: "round2-eliminated",
        title: "两败出局",
        subtitle: "第 27–28 场负者",
        sourceNumbers: [27, 28],
        tone: "steel",
        weight: "normal",
      },
      {
        id: "round3-national",
        title: "全国赛席位",
        subtitle: "第 29–30 场胜者",
        sourceNumbers: [29, 30],
        tone: "amber",
        weight: "strong",
      },
      {
        id: "round4-national",
        title: "全国赛席位",
        subtitle: "第 31–32 场胜者",
        sourceNumbers: [31, 32],
        tone: "amber",
        weight: "strong",
      },
      {
        id: "round4-eliminated",
        title: "两败出局",
        subtitle: "第 31–32 场负者",
        sourceNumbers: [31, 32],
        tone: "steel",
        weight: "normal",
      },
    ] as const;

    expect(scheduleCards).toHaveLength(10);
    expect(flowCards).toHaveLength(8);
    expect(canvas.cards.some((card) => card.id.includes(":outcome:"))).toBe(false);
    expect(canvas.headers.some((header) => header.id.endsWith(":outcome-header"))).toBe(false);

    // Destination cards remain, but are no longer wired per-card — the flow is
    // shown by header-level forks (see fork assertions below).
    for (const spec of flowSpecs) {
      const groupCards = flowCards.filter((card) => card.id.includes(`:qualification-flow:${spec.id}:`));
      const header = canvas.headers.find((candidate) => candidate.id.endsWith(`:qualification-flow:${spec.id}:header`));

      expect(header).toMatchObject({
        title: spec.title,
        subtitle: `2 队 · ${spec.subtitle}`,
        tone: spec.tone,
      });
      expect(groupCards).toHaveLength(2);
      expect(groupCards.every((card) => (
        card.collegeName === "待确认"
        && card.teamKey === ""
        && card.height === 128
        && card.tone === spec.tone
        && card.isSimulated
      ))).toBe(true);
      expect(groupCards.map((card) => card.orderLabel)).toEqual(["1", "2"]);
      expect(groupCards[1].y).toBeGreaterThan(groupCards[0].y + groupCards[0].height);
      expect(canvas.connectors.some((connector) => connector.id.endsWith(`:qualification-flow:${spec.id}:connector`))).toBe(false);
    }

    // Round-header forks (regional style): one bracket per round, splitting into
    // 胜者去向 / 败者去向 anchored at the next round or outcome header.
    const forkSpecs = [
      { fromId: "round1", tone: "emerald", labels: ["胜者直通战", "败者生死战"] },
      { fromId: "round3", tone: "amber", labels: ["胜者晋级全国赛", "败者生死战"] },
      { fromId: "round2", tone: "emerald", labels: ["胜者进末轮", "两败出局"] },
      { fromId: "round4", tone: "amber", labels: ["胜者晋级全国赛", "两败出局"] },
    ] as const;
    expect(canvas.connectors).toHaveLength(forkSpecs.length);
    expect(canvas.connectors.every((connector) => connector.kind === "bracket")).toBe(true);
    for (const spec of forkSpecs) {
      const forkConnector = canvas.connectors.find((connector) => connector.id.endsWith(`:qualification-fork:${spec.fromId}`));
      expect(forkConnector).toBeDefined();
      expect(forkConnector?.tone).toBe(spec.tone);
      expect(forkConnector?.branchY?.length).toBe(2);
      expect(forkConnector?.branchLabels?.map((label) => label.text)).toEqual(spec.labels);
    }

    const overlaps = (
      left: { x: number; y: number; width: number; height: number },
      right: { x: number; y: number; width: number; height: number },
    ) => (
      left.x < right.x + right.width
      && left.x + left.width > right.x
      && left.y < right.y + right.height
      && left.y + left.height > right.y
    );
    const flowHeaders = canvas.headers
      .filter((header) => header.id.includes(":qualification-flow:"))
      .map((header) => ({ ...header, height: 48 }));
    for (const outcomeItem of [...flowHeaders, ...flowCards]) {
      expect(scheduleCards.some((card) => overlaps(outcomeItem, card))).toBe(false);
    }

    expect(canvas.title).toContain("晋级名额去向");
    expect(canvas.description).toContain("4 张全国赛门票");
    expect(canvas.headers.find((header) => header.id.includes(":round3:header"))).toMatchObject({
      title: "直通战 · 全国赛",
      tone: "emerald",
    });
    expect(canvas.headers.find((header) => header.id.includes(":round2:header"))).toMatchObject({
      title: "生死战 · 第一轮",
      tone: "steel",
    });
    const upperCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 29);
    const lowerCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 27);
    expect(upperCard?.y).toBeLessThan(lowerCard?.y ?? 0);
  });

  it("lays out nationals 16-to-8 as upper/lower paths with eight explicit seats", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const canvas = buildFinalsWorkspaceStage(payload, "round-of-16");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
    const seatCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes("-seats:"),
    );
    const eliminatedCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes("-eliminated:"),
    );

    expect(canvas.title).toContain("16 进 8 晋级图");
    expect(canvas.description).toContain("共 8 席");
    expect(scheduleCards).toHaveLength(20);
    expect(seatCards).toHaveLength(8);
    expect(eliminatedCards).toHaveLength(8);
    expect(seatCards.map((card) => card.orderLabel)).toEqual(["I", "II", "III", "IV", "A", "B", "C", "D"]);
    expect(seatCards.every((card) => card.tone === "amber" && card.isSimulated)).toBe(true);
    expect(eliminatedCards.every((card) => card.tone === "steel" && card.isSimulated)).toBe(true);
    expect(canvas.headers.map((header) => header.title)).toEqual([
      "首轮对阵 · 16 强",
      "直通战 · 八强",
      "八强席位",
      "生死战 · 第一轮",
      "生死战 · 最后一轮",
      "八强席位",
      "两败出局",
      "两败出局",
    ]);

    const upperCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 79);
    const lowerFirstCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 75);
    expect(upperCard?.y).toBeLessThan(lowerFirstCard?.y ?? 0);
    expect(upperCard?.match.loserNext).toBe("败者I");
    // Flow lines fork at section headers, not per match: four brackets
    // (首轮 / 直通战 / 生死战首轮 / 生死战末轮), no per-seat or per-elimination lines.
    expect(canvas.connectors).toHaveLength(4);
    expect(canvas.connectors.every((connector) => connector.kind === "bracket")).toBe(true);
    for (const fromId of ["opening", "upper", "lower-first", "lower-final"]) {
      expect(canvas.connectors.some((connector) => connector.id.endsWith(`:elim-fork:${fromId}`))).toBe(true);
    }
    const upperFork = canvas.connectors.find((connector) => connector.id.endsWith(":elim-fork:upper"));
    expect(upperFork?.tone).toBe("amber");
    expect(upperFork?.branchLabels?.map((label) => label.text)).toEqual(["胜者锁八强", "败者生死战"]);
    expect(canvas.connectors.find((connector) => connector.id.endsWith(":elim-fork:opening"))?.tone).toBe("emerald");
    expect(canvas.connectors.filter((connector) => connector.id.includes("-seats:"))).toHaveLength(0);
    expect(canvas.connectors.filter((connector) => connector.id.includes("-eliminated:connector"))).toHaveLength(0);
    expect(canvas.description).toContain("生死战负者出局");
  });

  it("lays out nationals 8-to-4 as two double-elimination lanes with four explicit seats", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const canvas = buildFinalsWorkspaceStage(payload, "quarterfinal");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
    const seatCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes("-seats:"),
    );
    const eliminatedCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes("-eliminated:"),
    );

    expect(canvas.title).toContain("8 进 4 晋级图");
    expect(scheduleCards).toHaveLength(6);
    expect(seatCards).toHaveLength(4);
    expect(eliminatedCards).toHaveLength(4);
    expect(seatCards.map((card) => card.orderLabel)).toEqual(["一", "二", "壹", "贰"]);
    expect(canvas.headers.map((header) => header.title)).toEqual([
      "直通战 · 四强",
      "四强席位",
      "生死战 · 第一轮",
      "生死战 · 最后一轮",
      "四强席位",
      "两败出局",
      "两败出局",
    ]);

    const upperCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 87);
    const lowerFirstCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 89);
    expect(upperCard?.y).toBeLessThan(lowerFirstCard?.y ?? 0);
    expect(upperCard?.match.loserNext).toBe("败者一");
    // 8→4 has no opening column, so three header forks (直通战 / 生死战首轮 / 生死战末轮).
    expect(canvas.connectors).toHaveLength(3);
    expect(canvas.connectors.every((connector) => connector.kind === "bracket")).toBe(true);
    for (const fromId of ["upper", "lower-first", "lower-final"]) {
      expect(canvas.connectors.some((connector) => connector.id.endsWith(`:elim-fork:${fromId}`))).toBe(true);
    }
    const upperForkQf = canvas.connectors.find((connector) => connector.id.endsWith(":elim-fork:upper"));
    expect(upperForkQf?.tone).toBe("amber");
    expect(upperForkQf?.branchLabels?.map((label) => label.text)).toEqual(["胜者锁四强", "败者生死战"]);
    expect(canvas.connectors.filter((connector) => connector.id.includes("-seats:"))).toHaveLength(0);
    expect(canvas.connectors.filter((connector) => connector.id.includes("-eliminated:connector"))).toHaveLength(0);
  });

  it("reuses the regional Swiss record funnel for both nationals groups", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const expectedTitles = [
      "第 1 轮 · 0-0 组",
      "第 2 轮 · 1-0 组",
      "第 2 轮 · 0-1 组",
      "第 3 轮 · 2-0 组",
      "第 3 轮 · 1-1 组",
      "第 3 轮 · 0-2 组",
      "3-0 晋级",
      "第 4 轮 · 2-1 组",
      "第 4 轮 · 1-2 组",
      "0-3 淘汰",
      "3-1 晋级",
      "第 5 轮 · 2-2 组",
      "1-3 淘汰",
      "3-2 晋级",
      "2-3 淘汰",
    ];

    for (const stage of ["swiss-a", "swiss-b"] as const) {
      const canvas = buildFinalsWorkspaceStage(payload, stage);
      const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
      const resultCards = canvas.cards.filter(
        (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes(":swiss-result:"),
      );

      expect(scheduleCards).toHaveLength(33);
      expect(resultCards).toHaveLength(16);
      expect(resultCards.filter((card) => card.tone === "amber")).toHaveLength(8);
      expect(resultCards.filter((card) => card.tone === "steel")).toHaveLength(8);
      expect(canvas.headers.map((header) => header.title)).toEqual(expectedTitles);
      expect([...new Set(canvas.headers.map((header) => header.x))]).toEqual([64, 510, 956, 1402, 1848, 2294]);
      expect(canvas.connectors).toHaveLength(9);
      expect(canvas.connectors.every((connector) => connector.kind === "bracket")).toBe(true);
      expect(canvas.connectors.every((connector) => !connector.teamKey)).toBe(true);
      expect(canvas.description).toContain("3 胜晋级 16 强");
      expect(canvas.description).toContain("3 败出局");
    }
  });

  it("places the championship above the third-place match and renders all four final ranks in gold", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const canvas = buildFinalsWorkspaceStage(payload, "final-four");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
    const finalCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 96);
    const thirdPlaceCard = scheduleCards.find((card) => card.match.regionalMatchNumber === 95);
    const rankingCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes(":outcome:"),
    );
    const rankConnectors = canvas.connectors.filter((connector) => connector.id.includes(":outcome-conn:"));

    expect(finalCard?.y).toBeLessThan(thirdPlaceCard?.y ?? 0);
    expect(rankingCards.map((card) => card.collegeName)).toEqual(["冠军", "亚军", "季军", "殿军"]);
    expect(rankingCards.map((card) => card.orderLabel)).toEqual(["1", "2", "3", "4"]);
    expect(rankingCards.every((card) => (
      card.variant === "ranking"
      && card.tone === "amber"
      && card.teamKey === ""
      && !card.statLine?.includes("淘汰")
    ))).toBe(true);
    expect(rankConnectors).toHaveLength(4);
    expect(rankConnectors.every((connector) => connector.tone === "amber" && connector.weight === "strong")).toBe(true);
    expect(canvas.headers.find((header) => header.id.endsWith(":outcome-header"))).toMatchObject({
      title: "最终名次 · 1–4",
      subtitle: "",
    });
    expect(canvas.description).toContain("第 1–4 名");
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
    expect(canvas.description).toContain("名额战名单");
  });

  it("explains the repechage Swiss round-three 6-to-4/2 split", () => {
    const matches = [
      ...Array.from({ length: 4 }, (_, index) => match(index + 1, `2026-07-31T${String(9 + index).padStart(2, "0")}:00:00+08:00`, "A组瑞士轮第一轮（BO3）")),
      ...Array.from({ length: 4 }, (_, index) => match(index + 9, `2026-08-01T${String(10 + index).padStart(2, "0")}:00:00+08:00`, "A组瑞士轮第二轮（BO3）")),
      match(17, "2026-08-01T18:10:00+08:00", "A组瑞士轮第三轮（BO3）", { redSlot: "Ⅲ-A1", blueSlot: "Ⅲ-A2" }),
      match(18, "2026-08-01T18:45:00+08:00", "A组瑞士轮第三轮（BO3）", { redSlot: "Ⅲ-A3", blueSlot: "Ⅲ-A6" }),
      match(19, "2026-08-01T19:20:00+08:00", "A组瑞士轮第三轮（BO3）", { redSlot: "Ⅲ-A4", blueSlot: "Ⅲ-A5" }),
      ...Array.from({ length: 4 }, (_, index) => match(23 + index, `2026-08-02T${String(9 + index).padStart(2, "0")}:00:00+08:00`, "晋级名额争夺战（BO3）", {
        stageKey: "repechage_qualification",
        redSlot: `A-${index + 1}`,
        blueSlot: `B-${index + 1}`,
      })),
    ];
    const payload = event(matches);
    const flow = buildRepechageSwissFlow(payload, "swiss-a");

    expect(flow).toMatchObject({
      initialTeamCount: 8,
      round3MatchCount: 3,
      round3TeamCount: 6,
      eliminatedBeforeRound3: 2,
      qualificationSlots: ["A-1", "A-2", "A-3", "A-4"],
      qualificationSlotRange: "A-1～A-4",
      qualificationEntryCount: 4,
      eliminatedAfterRound3: 2,
    });
    expect(flow?.roundSubtitles[3]).toBe("6 队 · 3 场");
    expect(getRepechageSwissMatchHint(matches[8])?.routeLabel).toBe("2-0组：胜负均进名额战");
    expect(getRepechageSwissMatchHint(matches[9])?.routeLabel).toBe("1-1组：胜进名额战 · 负淘汰");

    const canvas = buildFinalsWorkspaceStage(payload, "swiss-a");
    const flowCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes(":swiss-flow:"),
    );
    expect(flowCards).toHaveLength(8);
    expect(flowCards.filter((card) => card.id.includes(":before-round3-eliminated:"))).toHaveLength(2);
    expect(flowCards.filter((card) => card.id.includes(":qualified:"))).toHaveLength(4);
    expect(flowCards.filter((card) => card.id.includes(":after-round3-eliminated:"))).toHaveLength(2);
    expect(flowCards.every((card) => card.collegeName === "待确认")).toBe(true);
    expect(flowCards.filter((card) => card.id.includes(":qualified:")).map((card) => card.orderLabel)).toEqual([
      "A-1",
      "A-2",
      "A-3",
      "A-4",
    ]);
    expect(flowCards.filter((card) => card.id.includes(":qualified:")).every((card) => card.tone === "amber")).toBe(true);
    expect(flowCards.filter((card) => card.id.includes(":after-round3-eliminated:")).every((card) => card.tone === "steel")).toBe(true);
    expect(canvas.headers.find((header) => header.id.includes(":before-round3-header"))).toMatchObject({
      title: "前两轮后淘汰",
      subtitle: "2 队 · 0-2 组",
    });
    expect(canvas.headers.find((header) => header.id.includes(":qualified-header"))).toMatchObject({
      title: "第三轮后晋级",
      subtitle: "4 队 · A-1～A-4",
    });
    expect(canvas.headers.find((header) => header.id.includes(":eliminated-header"))).toMatchObject({
      title: "第三轮后淘汰",
      subtitle: "2 队 · 累计 2 败",
    });
    ["before-round3", "qualified", "after-round3"].forEach((flowId) => {
      const connector = canvas.connectors.find((candidate) => candidate.id.endsWith(`:swiss-flow:${flowId}`));
      expect(connector).toBeDefined();
      expect(connector?.branchLabels).toBeUndefined();
    });

    const groupCenter = (headerId: string, groupCards: Array<{ y: number; height: number }>) => {
      const header = canvas.headers.find((item) => item.id.includes(headerId));
      if (!header) throw new Error(`missing header: ${headerId}`);
      const top = Math.min(header.y, ...groupCards.map((card) => card.y));
      const bottom = Math.max(header.y + 48, ...groupCards.map((card) => card.y + card.height));
      return (top + bottom) / 2;
    };
    const round3Cards = canvas.cards.filter((card) => card.kind === "match" && card.match.stage.includes("第三轮"));
    const qualificationCards = flowCards.filter((card) => card.id.includes(":qualified:"));
    const eliminatedCards = flowCards.filter((card) => card.id.includes(":after-round3-eliminated:"));
    const beforeRound3Cards = flowCards.filter((card) => card.id.includes(":before-round3-eliminated:"));
    const beforeRound3Header = canvas.headers.find((header) => header.id.includes(":before-round3-header"));
    const qualificationHeader = canvas.headers.find((header) => header.id.includes(":qualified-header"));
    const eliminatedHeader = canvas.headers.find((header) => header.id.includes(":eliminated-header"));

    expect(groupCenter(":header:2", round3Cards)).toBeCloseTo(groupCenter(":qualified-header", qualificationCards), 5);
    expect(beforeRound3Header).toBeDefined();
    expect(qualificationHeader).toBeDefined();
    expect(eliminatedHeader).toBeDefined();
    expect(beforeRound3Header?.width).toBe(beforeRound3Cards[0].width);
    expect(beforeRound3Cards[1].x).toBe(beforeRound3Cards[0].x);
    expect(beforeRound3Cards[1].y).toBeGreaterThan(beforeRound3Cards[0].y + beforeRound3Cards[0].height);
    expect(eliminatedHeader?.x).toBe(qualificationHeader?.x);
    expect(eliminatedCards[0].x).toBe(qualificationCards[0].x);
    expect(eliminatedCards[1].x).toBe(eliminatedCards[0].x);
    expect(eliminatedHeader?.y).toBeGreaterThan(
      Math.max(...qualificationCards.map((card) => card.y + card.height)),
    );
    expect(eliminatedCards[0].y).toBeGreaterThan(eliminatedHeader?.y ?? 0);
    expect(eliminatedCards[1].y).toBeGreaterThan(eliminatedCards[0].y + eliminatedCards[0].height);
  });

  it("centers shorter official Swiss-round columns like the regional canvas", () => {
    const stageGroups = [
      ["第一轮", 8],
      ["第二轮", 8],
      ["第三轮", 8],
      ["第四轮", 6],
      ["第五轮", 3],
    ] as const;
    let number = 1;
    const matches = stageGroups.flatMap(([round, count]) => (
      Array.from({ length: count }, (_, index) => {
        const currentNumber = number;
        number += 1;
        return match(
          currentNumber,
          `2026-08-0${Math.min(7, Math.max(1, Math.ceil(currentNumber / 8)))}T09:00:00+08:00`,
          `A组瑞士轮${round}（BO3）`,
          { redSlot: `A${index + 1}`, blueSlot: `A${index + 9}` },
        );
      })
    ));

    const canvas = buildFinalsWorkspaceStage(event(matches), "swiss-a");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "match");
    const columns = new Map<number, typeof scheduleCards>();
    for (const card of scheduleCards) {
      const rows = columns.get(card.x) ?? [];
      rows.push(card);
      columns.set(card.x, rows);
    }
    const columnMetrics = [...columns.values()].map((cards) => {
      const top = Math.min(...cards.map((card) => card.y));
      const bottom = Math.max(...cards.map((card) => card.y));
      return { count: cards.length, center: (top + bottom) / 2, top };
    });

    expect(scheduleCards).toHaveLength(33);
    expect(scheduleCards.every((card) => card.width === 400 && card.height === 188)).toBe(true);
    expect(canvas.headers.slice(0, 5).map((header) => header.title)).toEqual([
      "第 1 轮",
      "第 2 轮",
      "第 3 轮",
      "第 4 轮",
      "第 5 轮",
    ]);
    expect(columnMetrics.map((column) => column.count)).toEqual([8, 8, 8, 6, 3]);
    expect(columnMetrics.every((column) => Math.abs(column.center - columnMetrics[0].center) < 0.01)).toBe(true);
    expect(columnMetrics[4].top).toBeGreaterThan(columnMetrics[0].top);
  });
});
