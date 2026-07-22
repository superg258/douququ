import { describe, expect, it } from "vitest";

import officialFinalsSchedule from "../../data/reference/2026_finals/schedule.json";

import { getSwissRoundNumber } from "@/lib/finals-schedule";
import { buildFinalsWorkspaceStage } from "@/lib/finals-canvas";
import { buildFinalsMatchRow, resolveFinalsTeamRating } from "@/lib/finals-match-adapter";
import { predictDisplayScoreline } from "@/lib/scoreline";
import {
  gameWinProbability,
  hasOfficialFinalMatchData,
  seriesWinProbability,
  simulateFinalEventHybrid,
  simulateFinalsEvents,
  simulateFinalsLiveEvents,
  updateFinalsEloForSeries,
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
  TeamCanvasCard,
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
    teamRatingIndex: {},
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

function withRepechageLiveResults(event: FinalEventSchedule): FinalEventSchedule {
  const results = new Map<number, [string, string, string]>([
    [5, ["南京航空航天大学金城学院", "桂林电子科技大学", "2:1"]],
    [6, ["南方科技大学", "沈阳理工大学", "0:2"]],
    [7, ["华中科技大学", "西安电子科技大学", "2:1"]],
    [8, ["深圳技术大学", "广东工业大学", "1:2"]],
    [13, ["广东工业大学", "南京航空航天大学金城学院", "2:0"]],
    [14, ["华中科技大学", "沈阳理工大学", "2:1"]],
    [15, ["南方科技大学", "西安电子科技大学", "2:0"]],
    [16, ["桂林电子科技大学", "深圳技术大学", "2:1"]],
    [20, ["华中科技大学", "广东工业大学", "1:2"]],
  ]);
  const participantByCollege = new Map(event.participants.map((participant) => [participant.collegeName, participant]));
  return {
    ...event,
    matches: event.matches.map((match) => {
      const result = results.get(match.number);
      if (!result) return match;
      const [redCollegeName, blueCollegeName, scoreline] = result;
      const red = participantByCollege.get(redCollegeName)!;
      const blue = participantByCollege.get(blueCollegeName)!;
      const [redWins, blueWins] = scoreline.split(":").map(Number);
      return {
        ...match,
        officialStatus: "DONE",
        isCompleted: true,
        isConfirmedMatchup: true,
        hasLiveScoreline: true,
        scoreline,
        result: redWins > blueWins ? "red" : "blue",
        redWins,
        blueWins,
        redTeamKey: red.teamKey,
        redCollegeName: red.collegeName,
        redTeamName: red.teamName,
        blueTeamKey: blue.teamKey,
        blueCollegeName: blue.collegeName,
        blueTeamName: blue.teamName,
      };
    }),
  };
}

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
  it("uses the latest replay Elo for the school card snapshot", () => {
    const allTeams = overview.regions.flatMap((region) => region.teams);
    const target = allTeams[3];
    const latestElo = 2300;
    const snapshot = resolveFinalsTeamRating(target.teamKey, allTeams, {
      [target.teamKey]: latestElo,
    });

    expect(snapshot).toEqual({
      currentElo: latestElo,
      seasonDelta: latestElo - target.mu0,
      globalRank: 1,
    });
  });

  it("matches the backend ordered-series Elo update", () => {
    expect(updateFinalsEloForSeries(1500, 1500, 2, 0)).toEqual({
      redDelta: 30.53049847102443,
      blueDelta: -30.53049847102443,
    });
    const update = updateFinalsEloForSeries(1700, 1650, 2, 1);
    expect(update.redDelta).toBeCloseTo(5.745321198474433, 12);
    expect(update.blueDelta).toBeCloseTo(-5.745321198474433, 12);
  });

  it("replays live repechage results and predicts only unresolved matches", () => {
    const liveEvent = withRepechageLiveResults(repechage);
    expect(hasOfficialFinalMatchData(repechage)).toBe(false);
    expect(hasOfficialFinalMatchData(liveEvent)).toBe(true);
    const simulation = simulateFinalEventHybrid(liveEvent, overview, 20260414);
    const match20 = simulation.matchResults.get(20)!;
    const match21 = simulation.matchResults.get(21)!;

    expect(match20).toMatchObject({
      isRealResult: true,
      red: { collegeName: "华中科技大学" },
      blue: { collegeName: "广东工业大学" },
      redScore: 1,
      blueScore: 2,
      winnerSide: "blue",
    });
    const match5 = simulation.matchResults.get(5)!;
    const match13 = simulation.matchResults.get(13)!;
    expect(match5.isRealResult).toBe(true);
    expect(match5.red?.collegeName).toBe("南京航空航天大学金城学院");
    expect(match13.blue?.collegeName).toBe("南京航空航天大学金城学院");
    expect(match5.redEloDelta).not.toBe(0);
    expect(match13.blueElo).toBeCloseTo(match5.redEloAfter!, 10);
    expect(match21.red?.teamKey).toBeTruthy();
    expect(match21.blue?.teamKey).toBeTruthy();
    expect(match21).toMatchObject({ isRealResult: false, isConfirmedMatchup: false });
    expect(match21.redEloDelta).toBeUndefined();
    expect(match21.blueEloDelta).toBeUndefined();

    const lockedNames = simulation.lockedQualifierTeamKeys
      .map((teamKey) => liveEvent.participants.find((participant) => participant.teamKey === teamKey)?.collegeName);
    expect(lockedNames).toEqual(expect.arrayContaining(["华中科技大学", "广东工业大学"]));
    expect(Object.values(simulation.groupQualifiers).map((team) => team.collegeName))
      .toEqual(expect.arrayContaining(["华中科技大学", "广东工业大学"]));
  });

  it("uses model probabilities rather than the seed for a confirmed live matchup", () => {
    const red = nationals.participants.find((participant) => participant.collegeName === "华南农业大学")!;
    const blue = nationals.participants.find((participant) => participant.collegeName === "武汉工程大学")!;
    const liveEvent: FinalEventSchedule = {
      ...nationals,
      matches: nationals.matches.map((match) => match.number === 1 ? {
        ...match,
        officialStatus: "PENDING",
        isCompleted: false,
        isConfirmedMatchup: true,
        redTeamKey: red.teamKey,
        redCollegeName: red.collegeName,
        redTeamName: red.teamName,
        blueTeamKey: blue.teamKey,
        blueCollegeName: blue.collegeName,
        blueTeamName: blue.teamName,
      } : match),
    };
    const first = simulateFinalEventHybrid(liveEvent, overview, 1).matchResults.get(1)!;
    const second = simulateFinalEventHybrid(liveEvent, overview, 999).matchResults.get(1)!;
    const pGameRed = gameWinProbability(first.redElo ?? null, first.blueElo ?? null);
    const expected = predictDisplayScoreline(pGameRed, seriesWinProbability(pGameRed, 3), 3).scoreline;

    expect(`${first.redScore}:${first.blueScore}`).toBe(expected);
    expect(second).toMatchObject({
      red: first.red,
      blue: first.blue,
      redScore: first.redScore,
      blueScore: first.blueScore,
      winnerSide: first.winnerSide,
    });
    expect(serializeSimulation(simulateFinalEventHybrid(liveEvent, overview, 1)))
      .toBe(serializeSimulation(simulateFinalEventHybrid(liveEvent, overview, 999)));
  });

  it("uses backend current Elo as the starting point and recomputes finals probability", () => {
    const red = nationals.participants[0];
    const blue = nationals.participants[1];
    const liveEvent: FinalEventSchedule = {
      ...nationals,
      predictionBasis: "finals_sequential_elo",
      teamRatingIndex: {
        [red.teamKey]: { currentElo: 1700, preseasonElo: 1680, eloRankSource: "live" },
        [blue.teamKey]: { currentElo: 1650, preseasonElo: 1640, eloRankSource: "live" },
      },
      matches: nationals.matches.map((match) => match.number === 1 ? {
        ...match,
        officialStatus: "PENDING",
        isCompleted: false,
        isConfirmedMatchup: true,
        redTeamKey: red.teamKey,
        redCollegeName: red.collegeName,
        redTeamName: red.teamName,
        blueTeamKey: blue.teamKey,
        blueCollegeName: blue.collegeName,
        blueTeamName: blue.teamName,
      } : match),
    };

    const result = simulateFinalEventHybrid(liveEvent, overview, 7).matchResults.get(1)!;
    const row = buildFinalsMatchRow(liveEvent, liveEvent.matches[0], result);
    const expectedPGameRed = gameWinProbability(1700, 1650);
    const expectedScoreline = predictDisplayScoreline(
      expectedPGameRed,
      seriesWinProbability(expectedPGameRed, 3),
      3,
    ).scoreline;

    expect(result).toMatchObject({
      redElo: 1700,
      blueElo: 1650,
      pGameRed: expectedPGameRed,
      deltaH2H: 0,
      predictionBasis: "finals_sequential_elo",
    });
    expect(`${result.redScore}:${result.blueScore}`).toBe(expectedScoreline);
    expect(row).toMatchObject({ pGameRed: expectedPGameRed, deltaH2H: 0, scoreline: expectedScoreline });
  });

  it("carries completed repechage Elo into nationals live prediction", () => {
    const liveRepechage = withRepechageLiveResults(repechage);
    const promoted = liveRepechage.participants.find(
      (participant) => participant.collegeName === "南京航空航天大学金城学院",
    )!;
    const replaced = nationals.participants[0];
    const inheritedParticipant = {
      ...replaced,
      schoolKey: promoted.schoolKey,
      teamKey: promoted.teamKey,
      collegeName: promoted.collegeName,
      teamName: promoted.teamName,
    };
    const liveNationals: FinalEventSchedule = {
      ...nationals,
      participants: [inheritedParticipant, ...nationals.participants.slice(1)],
      matches: nationals.matches.map((match) => match.number === 1 ? {
        ...match,
        officialStatus: "PENDING",
        isCompleted: false,
        isConfirmedMatchup: true,
        redTeamKey: inheritedParticipant.teamKey,
        redCollegeName: inheritedParticipant.collegeName,
        redTeamName: inheritedParticipant.teamName,
        blueTeamKey: nationals.participants[1].teamKey,
        blueCollegeName: nationals.participants[1].collegeName,
        blueTeamName: nationals.participants[1].teamName,
      } : match),
    };

    const simulations = simulateFinalsLiveEvents(liveRepechage, liveNationals, overview, 7);
    const repechageFinalElo = simulations.repechage.finalEloByTeamKey[promoted.teamKey];
    const nationalsMatch = simulations.nationals.matchResults.get(1)!;

    expect(repechageFinalElo).not.toBeCloseTo(overview.regions
      .flatMap((region) => region.teams)
      .find((team) => team.teamKey === promoted.teamKey)!.currentElo!, 6);
    expect(nationalsMatch.redElo).toBeCloseTo(repechageFinalElo, 10);
    expect(nationalsMatch.redEloDelta).toBeUndefined();
  });

  it("replays a canonical 32-team national round one without synthetic identities", () => {
    const promoted = repechage.participants.slice(0, 4).map((participant, index) => ({
      ...participant,
      order: nationals.participants.length + index + 1,
      drawTier: "非种子抽签池",
    }));
    const participants = [...nationals.participants, ...promoted];
    const liveNationals: FinalEventSchedule = {
      ...nationals,
      participantCount: 32,
      confirmedParticipantCount: 32,
      participants,
      matches: nationals.matches.map((match, index) => {
        if (index >= 16) return match;
        const red = participants[index * 2];
        const blue = participants[index * 2 + 1];
        const redWins = match.number % 2 === 1 ? 2 : 1;
        const blueWins = match.number % 2 === 1 ? 1 : 2;
        return {
          ...match,
          officialStatus: "DONE",
          isCompleted: true,
          isConfirmedMatchup: true,
          scoreline: `${redWins}:${blueWins}`,
          result: redWins > blueWins ? "red" : "blue",
          redWins,
          blueWins,
          redTeamKey: red.teamKey,
          redCollegeName: red.collegeName,
          redTeamName: red.teamName,
          blueTeamKey: blue.teamKey,
          blueCollegeName: blue.collegeName,
          blueTeamName: blue.teamName,
        };
      }),
    };

    const simulation = simulateFinalEventHybrid(liveNationals, overview, 7);
    const firstRoundKeys = [...Array(16)].flatMap((_, index) => {
      const result = simulation.matchResults.get(index + 1)!;
      expect(result.isRealResult).toBe(true);
      expect(result.red?.teamKey).toBe(liveNationals.matches[index].redTeamKey);
      expect(result.blue?.teamKey).toBe(liveNationals.matches[index].blueTeamKey);
      return [result.red?.teamKey, result.blue?.teamKey];
    });
    expect(new Set(firstRoundKeys).size).toBe(32);
    expect(firstRoundKeys.every((teamKey) => teamKey && !teamKey.startsWith("SYNTH-"))).toBe(true);
  });

  it("does not replace an unresolved completed fixture with a simulated tier fallback", () => {
    const invalidNationals: FinalEventSchedule = {
      ...nationals,
      matches: nationals.matches.map((match) => match.number === 1 ? {
        ...match,
        officialStatus: "DONE",
        isCompleted: true,
        isConfirmedMatchup: true,
        scoreline: "2:1",
        result: "red",
        redWins: 2,
        blueWins: 1,
        redTeamKey: "unknown::red",
        redCollegeName: "不存在的红方",
        redTeamName: "Red",
        blueTeamKey: "unknown::blue",
        blueCollegeName: "不存在的蓝方",
        blueTeamName: "Blue",
      } : match),
    };

    const result = simulateFinalEventHybrid(invalidNationals, overview, 7).matchResults.get(1)!;
    expect(result).toMatchObject({ red: null, blue: null, winnerSide: null, isConfirmedMatchup: false });
  });

  it("keeps an official in-progress score visible without treating the projection as a result", () => {
    const red = nationals.participants[0];
    const blue = nationals.participants[1];
    const liveEvent: FinalEventSchedule = {
      ...nationals,
      matches: nationals.matches.map((match) => match.number === 1 ? {
        ...match,
        officialStatus: "LIVE",
        isCompleted: false,
        isConfirmedMatchup: true,
        hasLiveScoreline: true,
        scoreline: "1:0",
        redTeamKey: red.teamKey,
        redCollegeName: red.collegeName,
        redTeamName: red.teamName,
        blueTeamKey: blue.teamKey,
        blueCollegeName: blue.collegeName,
        blueTeamName: blue.teamName,
      } : match),
    };

    const simulation = simulateFinalEventHybrid(liveEvent, overview, 7);
    const row = buildFinalsMatchRow(liveEvent, liveEvent.matches[0], simulation.matchResults.get(1));

    expect(row).toMatchObject({
      scoreline: "1:0",
      hasLiveScoreline: true,
      isRealResult: false,
      isScenarioProjection: false,
      winnerTeamKey: "",
      loserTeamKey: "",
    });
  });

  it("renders actual results, predicted match 21, and locked qualifier cards in live mode", () => {
    const liveEvent = withRepechageLiveResults(repechage);
    const simulation = simulateFinalEventHybrid(liveEvent, overview, 20260414);
    const actualRow = buildFinalsMatchRow(liveEvent, liveEvent.matches[19], simulation.matchResults.get(20));
    const predictedRow = buildFinalsMatchRow(liveEvent, liveEvent.matches[20], simulation.matchResults.get(21));
    const canvas = buildFinalsWorkspaceStage(liveEvent, "swiss-b", simulation);
    const qualifierCards = canvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.id.includes(":swiss-flow:qualified:"),
    );
    const qualificationCanvas = buildFinalsWorkspaceStage(liveEvent, "qualification", simulation);
    const terminalCards = qualificationCanvas.cards.filter(
      (card): card is TeamCanvasCard => card.kind === "team" && card.simulationKey?.kind === "destination",
    );

    expect(actualRow).toMatchObject({ isRealResult: true, scoreline: "1:2" });
    expect(actualRow.redCurrentElo).toBeCloseTo(actualRow.redMu0! + actualRow.redDelta!, 10);
    expect(actualRow.blueCurrentElo).toBeCloseTo(actualRow.blueMu0! + actualRow.blueDelta!, 10);
    expect(actualRow.pSeriesRed).not.toBe(0.5);
    expect(predictedRow.redTeam.teamKey).toBeTruthy();
    expect(predictedRow.blueTeam.teamKey).toBeTruthy();
    expect(predictedRow).toMatchObject({ isRealResult: false, isConfirmedMatchup: false });
    expect(qualifierCards.filter((card) => card.isSimulated === false).map((card) => card.collegeName))
      .toEqual(expect.arrayContaining(["华中科技大学", "广东工业大学"]));
    expect(terminalCards.every((card) => card.isSimulated === true)).toBe(true);
  });

  it("renders a qualification outcome as actual when its source match is a real result", () => {
    const liveEvent = withRepechageLiveResults(repechage);
    const simulation = simulateFinalEventHybrid(liveEvent, overview, 20260414);
    const sourceResult = simulation.matchResults.get(29)!;
    sourceResult.isRealResult = true;
    const canvas = buildFinalsWorkspaceStage(liveEvent, "qualification", simulation);
    const outcomeCard = canvas.cards.find(
      (card): card is TeamCanvasCard => card.kind === "team"
        && card.simulationKey?.kind === "matchOutcome"
        && card.simulationKey.matchNumber === 29
        && card.simulationKey.outcome === "winner",
    );

    expect(outcomeCard).toMatchObject({ isSimulated: false });
  });

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
    if (nationals.participants.length < 32) {
      for (const qualifier of simulation.repechage.qualifierTeamKeys) {
        expect(nationalsTeamKeys.has(qualifier)).toBe(true);
      }
    } else {
      for (const participant of nationals.participants) {
        expect(nationalsTeamKeys.has(participant.teamKey)).toBe(true);
      }
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
