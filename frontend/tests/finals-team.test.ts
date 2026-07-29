import { describe, expect, it } from "vitest";

import {
  buildFinalsTeamPath,
  findFinalsOfficialSlot,
  findFinalsParticipation,
  hasFinalsStageData,
  resolveFinalsStageRates,
  resolveFinalsTeamOutcome,
  resolveLockedTeamOutcome,
  resolveTeamFinalsCardModel,
} from "@/lib/finals-team";
import type { FinalsStageProbabilityProjection } from "@/lib/finals-schedule";
import type { FinalsEventSimulation } from "@/lib/finals-simulation";
import type {
  FinalEventMatch,
  FinalEventParticipant,
  FinalEventResponse,
  FinalEventSchedule,
  FinalEventSlug,
  OverviewResponse,
  SimulatedFinalMatch,
  SimulatedFinalTeam,
} from "@/lib/types";

function team(collegeName: string, teamName = "战队"): SimulatedFinalTeam {
  return { teamKey: `${collegeName}::${teamName}`, collegeName, teamName };
}

const alpha = team("甲大学");
const beta = team("乙大学");
const gamma = team("丙大学");

function buildParticipant(order: number, side: SimulatedFinalTeam): FinalEventParticipant {
  return {
    order,
    schoolKey: side.collegeName,
    teamKey: side.teamKey,
    collegeName: side.collegeName,
    teamName: side.teamName,
    drawTier: "第一梯队",
    status: "confirmed",
  };
}

function buildMatch(number: number): FinalEventMatch {
  return {
    number,
    stageKey: "swiss",
    stage: `瑞士轮第 ${number} 轮`,
    bestOf: 3,
    redSlot: `R${number}`,
    blueSlot: `B${number}`,
    winnerTo: null,
    loserTo: null,
    startTime: "",
    endTime: "",
    startsAt: `2026-07-2${number}T10:00:00+08:00`,
    endsAt: `2026-07-2${number}T11:00:00+08:00`,
  };
}

function buildEvent(
  slug: FinalEventSlug,
  participants: FinalEventParticipant[],
  matches: FinalEventMatch[],
): FinalEventSchedule {
  return {
    slug,
    name: slug,
    shortName: slug,
    eyebrow: "",
    statusLabel: "",
    dateRange: { start: "", end: "" },
    competitionRange: { start: "", end: "" },
    participantCount: participants.length,
    confirmedParticipantCount: participants.length,
    advancementSlots: null,
    formalMatchCount: matches.length,
    groups: [],
    participants,
    drawRules: [],
    matches,
    teamRatingIndex: {},
  };
}

function wrapEvent(event: FinalEventSchedule): FinalEventResponse {
  return {
    schemaVersion: 1,
    season: 2026,
    timezone: "Asia/Shanghai",
    timezoneLabel: "北京时间",
    scheduleStatus: "official",
    verifiedAt: "2026-07-20T00:00:00+08:00",
    sources: [],
    event,
  };
}

function simulatedResult(
  matchNumber: number,
  red: SimulatedFinalTeam,
  blue: SimulatedFinalTeam,
  flags: Pick<SimulatedFinalMatch, "isRealResult" | "isConfirmedMatchup">,
): SimulatedFinalMatch {
  return {
    matchNumber,
    red,
    blue,
    redScore: 2,
    blueScore: 1,
    winnerSide: "red",
    ...flags,
  };
}

function buildSimulation(overrides: Partial<FinalsEventSimulation>): FinalsEventSimulation {
  return {
    eventSlug: "repechage",
    seed: 1,
    drawAssignments: {},
    matchResults: new Map(),
    swissStandings: { A: [], B: [] },
    groupQualifiers: {},
    terminalOutcomes: new Map(),
    qualifierTeamKeys: [],
    championTeamKey: null,
    lockedQualifierTeamKeys: [],
    lockedEliminatedTeamKeys: [],
    finalEloByTeamKey: {},
    eloTrajectoryByTeamKey: {},
    ...overrides,
  };
}

describe("buildFinalsTeamPath", () => {
  // 场次号乱序存放，验证输出按场次号升序
  const matches = [buildMatch(3), buildMatch(1), buildMatch(4), buildMatch(2)];
  const event = buildEvent("repechage", [], matches);
  const simulation = buildSimulation({
    matchResults: new Map([
      // 真实赛果且目标队伍在场 → 保留
      [1, simulatedResult(1, alpha, beta, { isRealResult: true, isConfirmedMatchup: true })],
      // 官方已确认对阵（尚无赛果）且目标队伍在场 → 保留
      [2, simulatedResult(2, gamma, alpha, { isRealResult: false, isConfirmedMatchup: true })],
      // 真实赛果但目标队伍不在场 → 过滤
      [3, simulatedResult(3, beta, gamma, { isRealResult: true, isConfirmedMatchup: true })],
      // 沙盘推演但尚未官方确认的对阵，即使目标队伍在场 → 过滤
      [4, simulatedResult(4, alpha, gamma, { isRealResult: false, isConfirmedMatchup: false })],
    ]),
  });

  it("keeps only real results and confirmed matchups featuring the team, sorted by match number", () => {
    const path = buildFinalsTeamPath(event, simulation, alpha.teamKey);

    expect(path.map((row) => row.matchLabel)).toEqual(["repechage:1", "repechage:2"]);
    expect(path[0]).toMatchObject({
      isRealResult: true,
      redTeam: { teamKey: alpha.teamKey },
      blueTeam: { teamKey: beta.teamKey },
    });
    expect(path[1]).toMatchObject({
      isRealResult: false,
      isConfirmedMatchup: true,
      blueTeam: { teamKey: alpha.teamKey },
    });
  });

  it("filters out a purely simulated matchup even when the team plays in it", () => {
    const path = buildFinalsTeamPath(event, simulation, gamma.teamKey);

    // gamma 在场的已确认场次：2（已确认对阵）、3（真实赛果）；4 为未确认推演被过滤
    expect(path.map((row) => row.matchLabel)).toEqual(["repechage:2", "repechage:3"]);
  });

  it("keeps purely simulated matchups when includeProjected is set (sim mode)", () => {
    const path = buildFinalsTeamPath(event, simulation, alpha.teamKey, { includeProjected: true });

    // 4 号场为未确认推演，includeProjected 下保留，形成完整模拟路径
    expect(path.map((row) => row.matchLabel)).toEqual(["repechage:1", "repechage:2", "repechage:4"]);
  });

  it("drops matches missing from the simulation results", () => {
    const partial = buildSimulation({
      matchResults: new Map([[2, simulation.matchResults.get(2)!]]),
    });

    expect(buildFinalsTeamPath(event, partial, alpha.teamKey).map((row) => row.matchLabel))
      .toEqual(["repechage:2"]);
  });

  it("returns an empty path for a team with no confirmed fixtures", () => {
    expect(buildFinalsTeamPath(event, simulation, "缺席大学::战队")).toEqual([]);
  });
});

describe("resolveFinalsTeamOutcome", () => {
  const simulation = buildSimulation({
    terminalOutcomes: new Map([
      ["全国赛", [alpha, beta]],
      ["淘汰", [gamma]],
    ]),
  });

  it("returns the destination containing the team", () => {
    expect(resolveFinalsTeamOutcome(simulation, beta.teamKey)).toBe("全国赛");
    expect(resolveFinalsTeamOutcome(simulation, gamma.teamKey)).toBe("淘汰");
  });

  it("returns null when the team is absent from every destination", () => {
    expect(resolveFinalsTeamOutcome(simulation, "缺席大学::战队")).toBeNull();
  });
});

describe("resolveFinalsStageRates", () => {
  const projection: FinalsStageProbabilityProjection = {
    iterations: 100,
    repechage: new Map([[alpha.teamKey, { advancementRate: 0.42 }]]),
    nationals: new Map([[beta.teamKey, {
      groupAdvancementRate: 0.6,
      topEightRate: 0.3,
      topFourRate: 0.12,
      championRate: 0.05,
    }]]),
  };

  it("maps the repechage slug to advancementRate", () => {
    expect(resolveFinalsStageRates(projection, "repechage", alpha.teamKey))
      .toEqual({ advancementRate: 0.42 });
    expect(resolveFinalsStageRates(projection, "repechage", beta.teamKey)).toEqual({});
  });

  it("maps the nationals slug to the knockout stage rates", () => {
    expect(resolveFinalsStageRates(projection, "nationals", beta.teamKey)).toEqual({
      groupAdvancementRate: 0.6,
      topEightRate: 0.3,
      topFourRate: 0.12,
      championRate: 0.05,
    });
    expect(resolveFinalsStageRates(projection, "nationals", alpha.teamKey)).toEqual({});
  });

  it("returns an empty object when the projection is null", () => {
    expect(resolveFinalsStageRates(null, "repechage", alpha.teamKey)).toEqual({});
    expect(resolveFinalsStageRates(null, "nationals", beta.teamKey)).toEqual({});
  });
});

describe("findFinalsParticipation", () => {
  const events = {
    repechage: wrapEvent(buildEvent("repechage", [buildParticipant(1, alpha)], [])),
    nationals: wrapEvent(buildEvent("nationals", [buildParticipant(1, beta)], [])),
  };

  it("finds the team in each event roster independently", () => {
    expect(findFinalsParticipation(events, alpha.teamKey)).toEqual({
      repechage: buildParticipant(1, alpha),
      nationals: null,
    });
    expect(findFinalsParticipation(events, beta.teamKey)).toEqual({
      repechage: null,
      nationals: buildParticipant(1, beta),
    });
  });

  it("returns nulls when the team is in neither roster", () => {
    expect(findFinalsParticipation(events, "缺席大学::战队"))
      .toEqual({ repechage: null, nationals: null });
  });

  it("returns nulls when the events are missing", () => {
    expect(findFinalsParticipation({}, alpha.teamKey))
      .toEqual({ repechage: null, nationals: null });
    expect(findFinalsParticipation({ repechage: events.repechage }, alpha.teamKey))
      .toEqual({ repechage: buildParticipant(1, alpha), nationals: null });
  });
});

describe("hasFinalsStageData", () => {
  const overview: OverviewResponse = { generatedAt: "", regions: [] };
  const events = {
    repechage: wrapEvent(buildEvent("repechage", [], [])),
    nationals: wrapEvent(buildEvent("nationals", [], [])),
  };

  it("两项赛事快照与总览齐全时决赛区块可用", () => {
    expect(hasFinalsStageData(events, overview)).toBe(true);
  });

  it("决赛快照拉取失败（事件缺失）时降级隐藏决赛区块", () => {
    expect(hasFinalsStageData({}, overview)).toBe(false);
    expect(hasFinalsStageData({ repechage: events.repechage }, overview)).toBe(false);
  });

  it("总览拉取失败时降级隐藏决赛区块", () => {
    expect(hasFinalsStageData(events, null)).toBe(false);
    expect(hasFinalsStageData(events, undefined)).toBe(false);
  });
});

describe("findFinalsOfficialSlot", () => {
  const event = buildEvent("repechage", [], [
    { ...buildMatch(1), redTeamKey: alpha.teamKey },
    { ...buildMatch(2), blueTeamKey: beta.teamKey },
  ]);

  it("finds the official slot from placed match sides", () => {
    expect(findFinalsOfficialSlot(event, alpha.teamKey)).toBe("R1");
    expect(findFinalsOfficialSlot(event, beta.teamKey)).toBe("B2");
  });

  it("returns null when the team has no official placement", () => {
    expect(findFinalsOfficialSlot(event, gamma.teamKey)).toBeNull();
  });
});

describe("resolveTeamFinalsCardModel", () => {
  const rates = {
    repechage: { advancementRate: 0.42 },
    nationals: {
      groupAdvancementRate: 0.6,
      topEightRate: 0.3,
      topFourRate: 0.12,
      championRate: 0.05,
    },
  };

  it("复活赛队伍 → 晋级率(蓝) + 国赛四强/冠军率(金)", () => {
    const model = resolveTeamFinalsCardModel(
      { repechage: buildParticipant(1, alpha), nationals: null },
      rates,
    );

    expect(model).toEqual([
      { key: "advancement", label: "复活赛晋级率", tone: "blue", value: 0.42 },
      { key: "topFour", label: "国赛四强率", tone: "gold", value: 0.12 },
      { key: "champion", label: "国赛冠军率", tone: "gold", value: 0.05 },
    ]);
  });

  it("全国赛队伍 → 十六强率(蓝) + 四强/冠军率(金)", () => {
    const model = resolveTeamFinalsCardModel(
      { repechage: null, nationals: buildParticipant(1, beta) },
      rates,
    );

    expect(model).toEqual([
      { key: "groupAdvancement", label: "十六强率", tone: "blue", value: 0.6 },
      { key: "topFour", label: "四强率", tone: "gold", value: 0.12 },
      { key: "champion", label: "冠军率", tone: "gold", value: 0.05 },
    ]);
  });

  it("概率投影未就绪时卡片值保留为 undefined（页面显示 --）", () => {
    const model = resolveTeamFinalsCardModel(
      { repechage: buildParticipant(1, alpha), nationals: null },
      { repechage: {}, nationals: {} },
    );

    expect(model?.map((card) => card.value)).toEqual([undefined, undefined, undefined]);
  });

  it("未晋级决赛阶段 → null（保持区域赛四卡）", () => {
    expect(resolveTeamFinalsCardModel({ repechage: null, nationals: null }, rates)).toBeNull();
  });
});


describe("resolveLockedTeamOutcome", () => {
  function bracketMatch(
    number: number,
    overrides: Partial<FinalEventMatch> = {},
  ): FinalEventMatch {
    return {
      ...buildMatch(number),
      stageKey: "repechage_qualification",
      redSlot: `槽位R${number}`,
      blueSlot: `槽位B${number}`,
      winnerTo: "全国赛",
      loserTo: "淘汰",
      ...overrides,
    };
  }

  it("只有推演结果（非真实赛果）→ null，不展示预测去向", () => {
    const event = buildEvent("repechage", [], [bracketMatch(1)]);
    const simulation = buildSimulation({
      matchResults: new Map([
        [1, simulatedResult(1, alpha, beta, { isRealResult: false, isConfirmedMatchup: true })],
      ]),
      // 推演产生的 terminalOutcomes 不应影响判定
      terminalOutcomes: new Map([["全国赛", [alpha]]]),
    });

    expect(resolveLockedTeamOutcome(event, simulation, alpha.teamKey)).toBeNull();
  });

  it("真实赛果胜者进入终点 → 返回 winnerTo 目的地", () => {
    const event = buildEvent("repechage", [], [bracketMatch(1)]);
    const simulation = buildSimulation({
      matchResults: new Map([
        [1, simulatedResult(1, alpha, beta, { isRealResult: true, isConfirmedMatchup: true })],
      ]),
    });

    expect(resolveLockedTeamOutcome(event, simulation, alpha.teamKey)).toBe("全国赛");
  });

  it("真实赛果败者进入终点 → 返回 loserTo 目的地", () => {
    const event = buildEvent("repechage", [], [bracketMatch(1)]);
    const simulation = buildSimulation({
      matchResults: new Map([
        [1, simulatedResult(1, alpha, beta, { isRealResult: true, isConfirmedMatchup: true })],
      ]),
    });

    expect(resolveLockedTeamOutcome(event, simulation, beta.teamKey)).toBe("淘汰");
  });

  it("带括号后缀的流向下游槽位不算终点（normalize 后命中槽位）", () => {
    const event = buildEvent("repechage", [], [
      bracketMatch(1, { winnerTo: "胜者A（四强）", loserTo: null }),
      bracketMatch(2, { redSlot: "胜者A", winnerTo: null, loserTo: null }),
    ]);
    const simulation = buildSimulation({
      matchResults: new Map([
        [1, simulatedResult(1, alpha, beta, { isRealResult: true, isConfirmedMatchup: true })],
      ]),
    });

    expect(resolveLockedTeamOutcome(event, simulation, alpha.teamKey)).toBeNull();
  });

  it("多个真实终点时取最深场次", () => {
    const event = buildEvent("repechage", [], [
      bracketMatch(1, { winnerTo: "全国赛", loserTo: null }),
      bracketMatch(5, { winnerTo: null, loserTo: "淘汰" }),
    ]);
    const simulation = buildSimulation({
      matchResults: new Map([
        [1, simulatedResult(1, alpha, beta, { isRealResult: true, isConfirmedMatchup: true })],
        // alpha 在场次 5 以 blue 身份真实落败
        [5, { ...simulatedResult(5, gamma, alpha, { isRealResult: true, isConfirmedMatchup: true }), winnerSide: "red" as const }],
      ]),
    });

    expect(resolveLockedTeamOutcome(event, simulation, alpha.teamKey)).toBe("淘汰");
  });

  it("瑞士轮数学锁定晋级回退：复活赛 → 全国赛；全国赛 → 十六强", () => {
    const repechageEvent = buildEvent("repechage", [], []);
    const nationalsEvent = buildEvent("nationals", [], []);
    const simulation = buildSimulation({ lockedQualifierTeamKeys: [alpha.teamKey] });

    expect(resolveLockedTeamOutcome(repechageEvent, simulation, alpha.teamKey)).toBe("全国赛");
    expect(resolveLockedTeamOutcome(nationalsEvent, simulation, alpha.teamKey)).toBe("十六强");
  });

  it("瑞士轮数学锁定淘汰回退 → 淘汰", () => {
    const event = buildEvent("repechage", [], []);
    const simulation = buildSimulation({ lockedEliminatedTeamKeys: [alpha.teamKey] });

    expect(resolveLockedTeamOutcome(event, simulation, alpha.teamKey)).toBe("淘汰");
  });
});
