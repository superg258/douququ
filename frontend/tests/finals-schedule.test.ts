import { describe, expect, it } from "vitest";

import officialFinalsSchedule from "../../data/reference/2026_finals/schedule.json";

import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import {
  buildFinalEventDays,
  buildRepechageSwissFlow,
  groupParticipantsByTier,
  getRepechageSwissMatchHint,
  hasActualFinalMatchup,
  isActualSchoolName,
  matchesForFinalStage,
  projectFinalsStageProbabilities,
  rankFinalEventParticipantsByCurrentElo,
} from "@/lib/finals-schedule";
import type { FinalEventMatch, FinalEventSchedule, OverviewResponse, OverviewTeam, TeamCanvasCard } from "@/lib/types";

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
    const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
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

    for (const spec of flowSpecs) {
      const groupCards = flowCards.filter((card) => card.id.includes(`:qualification-flow:${spec.id}:`));
      const header = canvas.headers.find((candidate) => candidate.id.endsWith(`:qualification-flow:${spec.id}:header`));
      const connector = canvas.connectors.find((candidate) => candidate.id.endsWith(`:qualification-flow:${spec.id}:connector`));
      const sourceCards = scheduleCards.filter((card) => (
        spec.sourceNumbers.some((number) => number === card.match.number)
      ));

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
      expect(connector).toMatchObject({
        kind: "merge-split",
        tone: spec.tone,
        weight: spec.weight,
        branchY: sourceCards.map((card) => card.y + card.height / 2),
        targetBranchY: groupCards.map((card) => card.y + card.height / 2),
      });
      expect(connector?.branchLabels).toBeUndefined();
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
    const upperCard = scheduleCards.find((card) => card.match.number === 29);
    const lowerCard = scheduleCards.find((card) => card.match.number === 27);
    expect(upperCard?.y).toBeLessThan(lowerCard?.y ?? 0);
  });

  it("lays out nationals 16-to-8 as upper/lower paths with eight explicit seats", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const canvas = buildFinalsWorkspaceStage(payload, "round-of-16");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
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

    const upperCard = scheduleCards.find((card) => card.match.number === 79);
    const lowerFirstCard = scheduleCards.find((card) => card.match.number === 75);
    expect(upperCard?.y).toBeLessThan(lowerFirstCard?.y ?? 0);
    expect(canvas.connectors.find((connector) => connector.id.endsWith("78:winner:83"))).toMatchObject({
      tone: "emerald",
      weight: "strong",
    });
    expect(canvas.connectors.find((connector) => connector.id.endsWith("79:loser:83"))).toMatchObject({
      tone: "steel",
      weight: "normal",
    });
    expect(upperCard?.loserFlowLabel).toBe("负 → 第 83 场");
    expect(canvas.connectors.filter((connector) => connector.id.includes("-seats:"))).toHaveLength(8);
    expect(canvas.connectors.filter((connector) => connector.id.includes("-eliminated:connector"))).toHaveLength(2);
    expect(canvas.description).toContain("生死战负者出局");
  });

  it("lays out nationals 8-to-4 as two double-elimination lanes with four explicit seats", () => {
    const payload = officialFinalsSchedule.events.nationals as unknown as FinalEventSchedule;
    const canvas = buildFinalsWorkspaceStage(payload, "quarterfinal");
    const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
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

    const upperCard = scheduleCards.find((card) => card.match.number === 87);
    const lowerFirstCard = scheduleCards.find((card) => card.match.number === 89);
    expect(upperCard?.y).toBeLessThan(lowerFirstCard?.y ?? 0);
    expect(canvas.connectors.find((connector) => connector.id.endsWith("89:winner:91"))).toMatchObject({
      tone: "emerald",
      weight: "strong",
    });
    expect(canvas.connectors.find((connector) => connector.id.endsWith("88:loser:91"))).toMatchObject({
      tone: "steel",
      weight: "normal",
    });
    expect(upperCard?.loserFlowLabel).toBe("负 → 第 92 场");
    expect(canvas.connectors.filter((connector) => connector.id.includes("-seats:"))).toHaveLength(4);
    expect(canvas.connectors.filter((connector) => connector.id.includes("-eliminated:connector"))).toHaveLength(2);
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
      const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
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
    const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
    const finalCard = scheduleCards.find((card) => card.match.number === 96);
    const thirdPlaceCard = scheduleCards.find((card) => card.match.number === 95);
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
    const round3Cards = canvas.cards.filter((card) => card.kind === "schedule" && card.match.stage.includes("第三轮"));
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
    const scheduleCards = canvas.cards.filter((card) => card.kind === "schedule");
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
