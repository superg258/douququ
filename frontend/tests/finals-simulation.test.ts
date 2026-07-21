import { describe, expect, it } from "vitest";

import officialFinalsSchedule from "../../data/reference/2026_finals/schedule.json";

import { getSwissRoundNumber } from "@/lib/finals-schedule";
import {
  simulateFinalsEvents,
  swissFlowPlaceholderTeams,
  swissRecordBucketTeams,
  type FinalsEventSimulation,
} from "@/lib/finals-simulation";
import type {
  FinalEventMatch,
  FinalEventParticipant,
  FinalEventSchedule,
  FinalEventSlug,
  OverviewResponse,
  OverviewTeam,
} from "@/lib/types";

/** 与后端 finals_schedule 的 teamKey 规则对齐：`学校::队名（去空格）` */
function synthesizeTeamKey(collegeName: string, teamName: string) {
  return `${collegeName}::${teamName.replace(/\s+/g, "")}`;
}

function buildEvent(slug: FinalEventSlug): FinalEventSchedule {
  const raw = (officialFinalsSchedule.events as Record<string, any>)[slug];
  const participants: FinalEventParticipant[] = raw.participants.map((participant: any, index: number) => ({
    order: index + 1,
    schoolKey: participant.collegeName,
    teamKey: synthesizeTeamKey(participant.collegeName, participant.teamName),
    collegeName: participant.collegeName,
    teamName: participant.teamName,
    drawTier: participant.drawTier,
    status: "confirmed" as const,
  }));
  const matches: FinalEventMatch[] = raw.matches
    .filter((match: any) => match.kind === "formal")
    .map((match: any) => ({
      number: match.number,
      stageKey: match.stageKey,
      stage: match.stage,
      bestOf: match.bestOf,
      redSlot: match.redSlot,
      blueSlot: match.blueSlot,
      winnerTo: match.winnerTo,
      loserTo: match.loserTo,
      startTime: match.startTime,
      endTime: match.endTime,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
    }));
  return {
    slug,
    name: raw.name,
    shortName: raw.shortName,
    eyebrow: raw.eyebrow,
    statusLabel: raw.statusLabel,
    dateRange: raw.dateRange,
    competitionRange: raw.competitionRange,
    participantCount: participants.length,
    confirmedParticipantCount: participants.length,
    advancementSlots: raw.advancementSlots ?? null,
    formalMatchCount: matches.length,
    groups: raw.groups,
    participants,
    drawRules: raw.drawRules,
    matches,
  };
}

function buildOverview(events: FinalEventSchedule[]): OverviewResponse {
  const teams: OverviewTeam[] = events
    .flatMap((event) => event.participants)
    .map((participant, index) => ({
      teamKey: participant.teamKey,
      collegeName: participant.collegeName,
      teamName: participant.teamName,
      mu0: 1500 + (index % 17) * 12,
      currentElo: 1500 + (index % 17) * 12,
      sigma0: 60,
      eloGlobalRank: index + 1,
      eloRegionRank: index + 1,
      seedTier: "第一梯队",
      seedRankInRegion: index + 1,
      regionSlug: "south_region" as const,
      regionName: "南部赛区",
      probabilities: { roundOf16: 0, repechage: 0, national: 0, champion: 0 },
    }));
  return {
    generatedAt: "2026-07-20T00:00:00+08:00",
    regions: [
      {
        regionSlug: "south_region",
        regionName: "南部赛区",
        nationalSlots: 10,
        repechageSlots: 6,
        monteCarlo: {
          aggregationMode: "multi-seed",
          seedCount: 1,
          iterationsPerSeed: 1,
          effectiveIterations: 1,
          seeds: [1],
          pairProbabilitySamples: 1,
        },
        teams,
      },
    ],
  };
}

const repechage = buildEvent("repechage");
const nationals = buildEvent("nationals");
const overview = buildOverview([repechage, nationals]);

function serializeSimulation(simulation: FinalsEventSimulation) {
  return JSON.stringify(
    [...simulation.matchResults.entries()].map(([number, result]) => [
      number,
      result.red?.teamKey ?? null,
      result.blue?.teamKey ?? null,
      result.redScore,
      result.blueScore,
      result.winnerSide,
    ]),
  );
}

function swissRecords(event: FinalEventSchedule, simulation: FinalsEventSimulation) {
  const records = new Map<string, { wins: number; losses: number; rounds: number[] }>();
  const track = (teamKey: string | undefined, won: boolean, round: number | null) => {
    if (!teamKey || round === null) return;
    const record = records.get(teamKey) ?? { wins: 0, losses: 0, rounds: [] };
    if (won) record.wins += 1;
    else record.losses += 1;
    record.rounds.push(round);
    records.set(teamKey, record);
  };
  for (const match of event.matches) {
    if (match.stageKey !== "swiss") continue;
    const result = simulation.matchResults.get(match.number);
    if (!result?.winnerSide) continue;
    const round = getSwissRoundNumber(match.stage);
    track(result.red?.teamKey, result.winnerSide === "red", round);
    track(result.blue?.teamKey, result.winnerSide === "blue", round);
  }
  return records;
}

describe("finals sandbox simulation", () => {
  it("is deterministic for the same seed and diverges across seeds", () => {
    const first = simulateFinalsEvents(repechage, nationals, overview, 42);
    const second = simulateFinalsEvents(repechage, nationals, overview, 42);
    expect(serializeSimulation(first.repechage)).toBe(serializeSimulation(second.repechage));
    expect(serializeSimulation(first.nationals)).toBe(serializeSimulation(second.nationals));

    const other = simulateFinalsEvents(repechage, nationals, overview, 7);
    expect(serializeSimulation(other.nationals)).not.toBe(serializeSimulation(first.nationals));
  });

  it("respects draw tier slot pools", () => {
    const simulation = simulateFinalsEvents(repechage, nationals, overview, 20260801);
    const repechageTierByKey = new Map(repechage.participants.map((p) => [p.teamKey, p.drawTier]));
    for (const [slot, teamKey] of Object.entries(simulation.repechage.drawAssignments)) {
      const slotIndex = Number(slot.slice(1));
      expect(repechageTierByKey.get(teamKey)).toBe(slotIndex <= 4 ? "第一梯队" : "第二梯队");
    }
    const nationalsTierByKey = new Map(nationals.participants.map((p) => [p.teamKey, p.drawTier]));
    const expectedTiers: Array<[string[], string]> = [
      [["A1", "A2", "B1"], "第一梯队"],
      [["A3", "B2", "B3"], "第二梯队"],
      [["A4", "A5", "B4"], "第三梯队"],
      [["A6", "B5", "B6"], "第四梯队"],
      [["A7", "A8", "B7", "B8"], "第五梯队"],
    ];
    for (const [slots, tier] of expectedTiers) {
      for (const slot of slots) {
        expect(nationalsTierByKey.get(simulation.nationals.drawAssignments[slot])).toBe(tier);
      }
    }
  });

  it("resolves every repechage match and sends 4 teams to nationals", () => {
    const simulation = simulateFinalsEvents(repechage, nationals, overview, 99).repechage;
    expect(simulation.matchResults.size).toBe(32);
    for (const match of repechage.matches) {
      const result = simulation.matchResults.get(match.number)!;
      expect(result.red).not.toBeNull();
      expect(result.blue).not.toBeNull();
      expect(result.winnerSide).not.toBeNull();
      const winnerScore = result.winnerSide === "red" ? result.redScore : result.blueScore;
      const loserScore = result.winnerSide === "red" ? result.blueScore : result.redScore;
      expect(winnerScore).toBe(Math.floor(match.bestOf / 2) + 1);
      expect(loserScore).toBeLessThan(winnerScore);
    }
    expect(new Set(simulation.qualifierTeamKeys).size).toBe(4);
  });

  it("chains repechage qualifiers into a 32-team nationals field and crowns a champion", () => {
    const simulation = simulateFinalsEvents(repechage, nationals, overview, 2026);
    expect(simulation.nationals.matchResults.size).toBe(96);
    for (const match of nationals.matches) {
      const result = simulation.nationals.matchResults.get(match.number)!;
      expect(result.winnerSide, `match ${match.number}`).not.toBeNull();
    }
    const nationalsTeamKeys = new Set(
      [...simulation.nationals.matchResults.values()].flatMap((result) => [
        result.red?.teamKey,
        result.blue?.teamKey,
      ]),
    );
    for (const qualifier of simulation.repechage.qualifierTeamKeys) {
      expect(nationalsTeamKeys.has(qualifier)).toBe(true);
    }
    expect(simulation.nationals.championTeamKey).not.toBeNull();

    // 画布落位数据：出线座次与终端去向
    expect(Object.keys(simulation.nationals.groupQualifiers)).toHaveLength(16);
    expect(Object.keys(simulation.repechage.groupQualifiers)).toHaveLength(8);
    expect(simulation.nationals.terminalOutcomes.get("冠军")).toHaveLength(1);
    expect(simulation.nationals.terminalOutcomes.get("冠军")?.[0]?.teamKey)
      .toBe(simulation.nationals.championTeamKey);
    expect(simulation.repechage.terminalOutcomes.get("全国赛")).toHaveLength(4);
    expect(
      simulation.repechage.terminalOutcomes.get("全国赛")?.map((team) => team.teamKey),
    ).toEqual(simulation.repechage.qualifierTeamKeys);

    // 瑞士轮战绩桶（全国赛 2/3/3/3/3/2）与复活赛出局时点占位卡
    for (const group of ["A", "B"] as const) {
      expect(swissRecordBucketTeams(simulation.nationals, group, "qualified-3-0")).toHaveLength(2);
      expect(swissRecordBucketTeams(simulation.nationals, group, "qualified-3-1")).toHaveLength(3);
      expect(swissRecordBucketTeams(simulation.nationals, group, "qualified-3-2")).toHaveLength(3);
      expect(swissRecordBucketTeams(simulation.nationals, group, "eliminated-2-3")).toHaveLength(3);
      expect(swissRecordBucketTeams(simulation.nationals, group, "eliminated-1-3")).toHaveLength(3);
      expect(swissRecordBucketTeams(simulation.nationals, group, "eliminated-0-3")).toHaveLength(2);
      expect(swissFlowPlaceholderTeams(simulation.repechage, group, "beforeRound3")).toHaveLength(2);
      expect(swissFlowPlaceholderTeams(simulation.repechage, group, "afterRound3")).toHaveLength(2);
    }
  });

  it("stops nationals teams at 3 wins or 3 losses with exactly 8 advancers per group", () => {
    const simulation = simulateFinalsEvents(repechage, nationals, overview, 5).nationals;
    const records = swissRecords(nationals, simulation);
    const draw = simulation.drawAssignments;
    const groupWins = { A: 0, B: 0 };
    for (const [teamKey, record] of records) {
      expect(record.wins).toBeLessThanOrEqual(3);
      expect(record.losses).toBeLessThanOrEqual(3);
      // 达到 3 胜 / 3 负后不再排赛：最后一轮战绩即最终战绩
      const lastRound = Math.max(...record.rounds);
      if (lastRound < 5) {
        expect(record.wins === 3 || record.losses === 3).toBe(true);
      }
      const slot = Object.entries(draw).find(([, key]) => key === teamKey)?.[0] ?? "";
      if (record.wins === 3) groupWins[slot.slice(0, 1) as "A" | "B"] += 1;
    }
    expect(groupWins.A).toBe(8);
    expect(groupWins.B).toBe(8);
  });

  it("eliminates repechage teams at 2 losses and advances 4 per group", () => {
    const simulation = simulateFinalsEvents(repechage, nationals, overview, 11).repechage;
    const records = swissRecords(repechage, simulation);
    const draw = simulation.drawAssignments;
    const groupAdvancers = { A: 0, B: 0 };
    for (const [teamKey, record] of records) {
      expect(record.losses).toBeLessThanOrEqual(2);
      if (record.losses === 2) {
        expect(Math.max(...record.rounds)).toBeLessThanOrEqual(3);
      }
      const slot = Object.entries(draw).find(([, key]) => key === teamKey)?.[0] ?? "";
      if (record.wins >= 2) groupAdvancers[slot.slice(0, 1) as "A" | "B"] += 1;
    }
    expect(groupAdvancers.A).toBe(4);
    expect(groupAdvancers.B).toBe(4);
  });
});
