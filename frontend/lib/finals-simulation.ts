import { createSeededRandom, rankFinalEventParticipantsByCurrentElo } from "@/lib/finals-schedule";
import { predictDisplayScoreline } from "@/lib/scoreline";
import type {
  FinalEventMatch,
  FinalEventParticipant,
  FinalEventSchedule,
  FinalEventSlug,
  OverviewResponse,
  SimulatedFinalMatch,
  SimulatedFinalTeam,
} from "@/lib/types";

/**
 * 全国赛 / 复活赛种子沙盘模拟器。
 *
 * 官方赛程只给出槽位骨架（抽签未定），这里用种子 RNG + Elo 胜率
 * 模拟一次完整的抽签落位与全部赛果，供 forecast-center 的「模拟」模式渲染。
 *
 * 近似说明：
 * - 官方瑞士轮第 2 轮起的配对细则未公布，沙盘按「战绩分组 + 抽签位序」
 *   依次填入官方槽位（存活队伍胜场降序、抽签槽位号升序 → 槽位号升序），
 *   不做回避重赛处理；
 * - 组内出线座次按（胜场降序、负场升序、Elo 降序、槽位升序）排名。
 */

export interface SwissStandingRow {
  team: SimulatedFinalTeam;
  wins: number;
  losses: number;
  slotIndex: number;
  /** 该队最后一场瑞士轮的轮次（用于判定出局时点） */
  lastPlayedRound: number;
}

export interface FinalsEventSimulation {
  eventSlug: FinalEventSlug;
  seed: number;
  /** 抽签槽位（如 "A1"）→ teamKey */
  drawAssignments: Record<string, string>;
  matchResults: Map<number, SimulatedFinalMatch>;
  /** 各组瑞士轮最终战绩（按抽签槽位号升序） */
  swissStandings: Record<"A" | "B", SwissStandingRow[]>;
  /** 组内出线座次槽位（如 "A-1"）→ 队伍 */
  groupQualifiers: Record<string, SimulatedFinalTeam>;
  /** 终端去向（全国赛 / 淘汰 / 冠军…）→ 队伍列表（按锁定先后排序） */
  terminalOutcomes: Map<string, SimulatedFinalTeam[]>;
  /** 复活赛：晋级全国赛的 4 队（按锁定先后排序）；全国赛为空 */
  qualifierTeamKeys: string[];
  championTeamKey: string | null;
  /** 仅由真实赛果已经数学锁定晋级的队伍。 */
  lockedQualifierTeamKeys: string[];
  /** 仅由真实赛果已经数学锁定淘汰的队伍。 */
  lockedEliminatedTeamKeys: string[];
  /** 仅吸收真实已完成赛果后的赛事 Elo；预测赛果不会写入。 */
  finalEloByTeamKey: Record<string, number>;
  /** 仅实时模式：每支队伍的真实赛果 Elo 轨迹（按时间顺序，首点 = 该队赛事起始 Elo） */
  eloTrajectoryByTeamKey: Record<string, number[]>;
}

export interface FinalsSimulationResult {
  repechage: FinalsEventSimulation;
  nationals: FinalsEventSimulation;
}

/** 各赛事抽签梯队 → 槽位组（顺序即 drawRules 中的填入顺序） */
const DRAW_SLOT_GROUPS: Record<FinalEventSlug, Array<{ tier: string; slots: string[] }>> = {
  repechage: [
    { tier: "第一梯队", slots: ["A1", "B1", "A2", "B2", "A3", "B3", "A4", "B4"] },
    { tier: "第二梯队", slots: ["A5", "B5", "A6", "B6", "A7", "B7", "A8", "B8"] },
  ],
  nationals: [
    { tier: "第一梯队", slots: ["A1", "A2", "B1"] },
    { tier: "第二梯队", slots: ["A3", "B2", "B3"] },
    { tier: "第三梯队", slots: ["A4", "A5", "B4"] },
    { tier: "第四梯队", slots: ["A6", "B5", "B6"] },
    { tier: "第五梯队", slots: ["A7", "A8", "B7", "B8"] },
    {
      tier: "非种子抽签池",
      slots: [
        "A9", "A10", "A11", "A12", "A13", "A14", "A15", "A16",
        "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16",
      ],
    },
  ],
};

interface SwissRules {
  /** 达到该胜场即出线 */
  advanceWins: number;
  /** 达到该负场即淘汰 */
  eliminateLosses: number;
  /** 出线后是否继续排赛（复活赛 2-0 组第 3 轮仍交手；全国赛 3 胜即停） */
  playAfterClinch: boolean;
}

const SWISS_RULES: Record<FinalEventSlug, SwissRules> = {
  repechage: { advanceWins: 2, eliminateLosses: 2, playAfterClinch: true },
  nationals: { advanceWins: 3, eliminateLosses: 3, playAfterClinch: false },
};

const SWISS_POOL_SLOT_PATTERN = /^([ⅠⅡⅢⅣⅤ])-([AB])(\d+)$/u;
const GROUP_QUALIFIER_SLOT_PATTERN = /^([AB])-(\d+)$/u;

/** 官方流向标签与下游槽位写法不一致（如 "胜者A（八强）" vs "胜者A"），统一去掉括号后缀再匹配 */
function normalizeFlowLabel(label: string) {
  return label.replace(/（[^）]*）$/u, "");
}
const ROMAN_TO_ROUND: Record<string, number> = { "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5 };

interface SimTeam extends SimulatedFinalTeam {
  slot: string;
  slotIndex: number;
  group: "A" | "B";
  tier: string;
}

interface TeamRecord {
  wins: number;
  losses: number;
}

function shuffled<T>(rows: T[], random: () => number): T[] {
  const copy = [...rows];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function parseSwissPoolSlot(slot: string): { round: number; group: "A" | "B"; index: number } | null {
  const matched = slot.match(SWISS_POOL_SLOT_PATTERN);
  if (!matched) return null;
  const round = ROMAN_TO_ROUND[matched[1]];
  return round ? { round, group: matched[2] as "A" | "B", index: Number(matched[3]) } : null;
}

function gameWinProbability(redElo: number | null, blueElo: number | null) {
  if (redElo === null || blueElo === null) return 0.5;
  const delta = Math.max(-300, Math.min(300, redElo - blueElo));
  return 1 / (1 + 10 ** (-delta / 400));
}

const FINALS_ELO_K = 64;

function seriesOutcomeSequences(redWins: number, blueWins: number) {
  const rows: number[][] = [];
  const visit = (redLeft: number, blueLeft: number, sequence: number[]) => {
    if (redLeft === 0 && blueLeft === 0) {
      rows.push(sequence);
      return;
    }
    if (redLeft > 0) visit(redLeft - 1, blueLeft, [...sequence, 1]);
    if (blueLeft > 0) visit(redLeft, blueLeft - 1, [...sequence, 0]);
  };
  visit(Math.max(0, redWins), Math.max(0, blueWins), []);
  return rows;
}

/** 与后端 average_ordered_series_update 相同：枚举局序后取平均。 */
export function updateFinalsEloForSeries(
  redElo: number,
  blueElo: number,
  redWins: number,
  blueWins: number,
) {
  const completedGames = redWins + blueWins;
  if (completedGames <= 0) return { redDelta: 0, blueDelta: 0 };
  const sequences = seriesOutcomeSequences(redWins, blueWins);
  const kPerGame = FINALS_ELO_K / completedGames;
  let redDeltaTotal = 0;
  let blueDeltaTotal = 0;
  for (const sequence of sequences) {
    let currentRed = redElo;
    let currentBlue = blueElo;
    for (const actualRed of sequence) {
      const expectedRed = gameWinProbability(currentRed, currentBlue);
      currentRed += kPerGame * (actualRed - expectedRed);
      currentBlue += kPerGame * ((1 - actualRed) - (1 - expectedRed));
    }
    redDeltaTotal += currentRed - redElo;
    blueDeltaTotal += currentBlue - blueElo;
  }
  return {
    redDelta: redDeltaTotal / sequences.length,
    blueDelta: blueDeltaTotal / sequences.length,
  };
}

/** 与 sampleSeries 相同的「先到 N 胜」规则，求红方赢下整个系列的概率。 */
export function seriesWinProbability(pGameRed: number, bestOf: number) {
  const p = Math.max(0, Math.min(1, pGameRed));
  const q = 1 - p;
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  // 负二项分布：红方 N 胜、蓝方 k 胜（k < N）的概率之和
  let total = 0;
  for (let k = 0; k < winsNeeded; k += 1) {
    total += binomial(winsNeeded - 1 + k, k) * p ** winsNeeded * q ** k;
  }
  return Math.max(0, Math.min(1, total));
}

function binomial(n: number, k: number) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

export { gameWinProbability };

/** 逐局伯努利采样，先拿到 BO 胜场者胜，同时产出与 BO 一致的比分。 */
function sampleSeries(
  bestOf: number,
  pGameRed: number,
  random: () => number,
): { redScore: number; blueScore: number; winnerSide: "red" | "blue" } {
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  let redScore = 0;
  let blueScore = 0;
  while (redScore < winsNeeded && blueScore < winsNeeded) {
    if (random() < pGameRed) redScore += 1;
    else blueScore += 1;
  }
  return { redScore, blueScore, winnerSide: redScore > blueScore ? "red" : "blue" };
}

function emptyResult(matchNumber: number): SimulatedFinalMatch {
  return { matchNumber, red: null, blue: null, redScore: 0, blueScore: 0, winnerSide: null };
}

interface SimulationOptions {
  replayOfficialResults?: boolean;
  /** 实时混合推演按模型概率选择最可能比分；沙盘模拟仍逐局随机抽样。 */
  projectMostLikelyResults?: boolean;
  /** 上一赛事真实赛果更新后的 Elo，例如全国赛继承复活赛。 */
  initialEloByTeamKey?: ReadonlyMap<string, number>;
}

const COMPLETED_STATUSES = new Set(["DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"]);

function isOfficiallyCompleted(match: FinalEventMatch) {
  return match.isCompleted === true
    || COMPLETED_STATUSES.has(String(match.officialStatus ?? "").trim().toUpperCase());
}

export function hasOfficialFinalMatchData(event: FinalEventSchedule) {
  return event.matches.some((match) => (
    isOfficiallyCompleted(match)
    || Boolean(match.redTeamKey && match.blueTeamKey)
    || Boolean(match.redCollegeName && match.blueCollegeName)
  ));
}

function officialParticipantForSide(
  match: FinalEventMatch,
  side: "red" | "blue",
  participantByKey: Map<string, FinalEventParticipant>,
  participantByIdentity: Map<string, FinalEventParticipant>,
) {
  const teamKey = String(match[`${side}TeamKey`] ?? "").trim();
  if (teamKey && participantByKey.has(teamKey)) return participantByKey.get(teamKey) ?? null;
  const collegeName = String(match[`${side}CollegeName`] ?? "").trim();
  const teamName = String(match[`${side}TeamName`] ?? "").trim();
  return participantByIdentity.get(`${collegeName}\u0000${teamName}`)
    ?? [...participantByIdentity.values()].find((participant) => participant.collegeName === collegeName)
    ?? null;
}

function officialWinnerSide(match: FinalEventMatch, redScore: number, blueScore: number): "red" | "blue" | null {
  const result = String(match.result ?? "").trim().toLowerCase();
  if (result === "red" || result === "blue") return result;
  if (redScore === blueScore) return null;
  return redScore > blueScore ? "red" : "blue";
}

function officialScore(match: FinalEventMatch): { redScore: number; blueScore: number } | null {
  if (typeof match.redWins === "number" && typeof match.blueWins === "number") {
    return { redScore: match.redWins, blueScore: match.blueWins };
  }
  const matched = String(match.scoreline ?? "").match(/^(\d+):(\d+)$/);
  if (!matched) return null;
  return { redScore: Number(matched[1]), blueScore: Number(matched[2]) };
}

function simulateEvent(
  event: FinalEventSchedule,
  participants: FinalEventParticipant[],
  overview: OverviewResponse,
  random: () => number,
  options: SimulationOptions = {},
): FinalsEventSimulation {
  const rules = SWISS_RULES[event.slug];
  const eloByTeamKey = new Map(
    rankFinalEventParticipantsByCurrentElo(participants, overview).map((row) => [row.teamKey, row.currentElo]),
  );
  for (const [pairKey, prediction] of Object.entries(event.predictionMatrix ?? {})) {
    const [redKey, blueKey] = pairKey.split("|||");
    if (redKey) eloByTeamKey.set(redKey, prediction.redCurrentElo);
    if (blueKey) eloByTeamKey.set(blueKey, prediction.blueCurrentElo);
  }
  for (const [teamKey, elo] of options.initialEloByTeamKey ?? []) eloByTeamKey.set(teamKey, elo);
  // 轨迹：每队从赛事入场 Elo（经历区域赛后）开始，非季前 Elo。
  // 仅展示赛事期内的 Elo 波动，区域赛阶段的变动不反映在轨迹中。
  const trajectories = new Map<string, number[]>();
  for (const [teamKey, elo] of eloByTeamKey) {
    if (elo == null) continue;
    trajectories.set(teamKey, [elo]);
  }
  const teamByKey = new Map<string, SimTeam>();
  const participantByKey = new Map(participants.map((participant) => [participant.teamKey, participant]));
  const participantByIdentity = new Map(
    participants.map((participant) => [`${participant.collegeName}\u0000${participant.teamName}`, participant]),
  );

  // ── 抽签：梯队内洗牌后按 drawRules 顺序填入槽位组 ──
  const drawAssignments: Record<string, string> = {};
  if (options.replayOfficialResults) {
    for (const match of event.matches) {
      const redSlot = parseSwissPoolSlot(match.redSlot);
      const blueSlot = parseSwissPoolSlot(match.blueSlot);
      if (redSlot?.round === 1) {
        const participant = officialParticipantForSide(match, "red", participantByKey, participantByIdentity);
        if (participant) drawAssignments[`${redSlot.group}${redSlot.index}`] = participant.teamKey;
      }
      if (blueSlot?.round === 1) {
        const participant = officialParticipantForSide(match, "blue", participantByKey, participantByIdentity);
        if (participant) drawAssignments[`${blueSlot.group}${blueSlot.index}`] = participant.teamKey;
      }
    }
  }
  const assignedTeamKeys = new Set(Object.values(drawAssignments));
  for (const { tier, slots } of DRAW_SLOT_GROUPS[event.slug]) {
    const eligibleTierTeams = participants
      .filter((participant) => participant.drawTier === tier && !assignedTeamKeys.has(participant.teamKey));
    const tierTeams = options.projectMostLikelyResults
      ? [...eligibleTierTeams].sort((left, right) => left.order - right.order)
      : shuffled(eligibleTierTeams, random);
    let nextTeamIndex = 0;
    slots.forEach((slot) => {
      const knownTeamKey = drawAssignments[slot];
      const participant = knownTeamKey ? participantByKey.get(knownTeamKey) : tierTeams[nextTeamIndex++];
      if (!participant) return;
      drawAssignments[slot] = participant.teamKey;
      assignedTeamKeys.add(participant.teamKey);
      teamByKey.set(participant.teamKey, {
        teamKey: participant.teamKey,
        collegeName: participant.collegeName,
        teamName: participant.teamName,
        slot,
        slotIndex: Number(slot.slice(1)),
        group: slot.slice(0, 1) as "A" | "B",
        tier: participant.drawTier,
      });
    });
  }

  const matchResults = new Map<number, SimulatedFinalMatch>();
  const lastPlayedRoundByTeam = new Map<string, number>();
  const records = new Map<string, TeamRecord>();
  const officialRecords = new Map<string, TeamRecord>();
  for (const teamKey of teamByKey.keys()) {
    records.set(teamKey, { wins: 0, losses: 0 });
    officialRecords.set(teamKey, { wins: 0, losses: 0 });
  }

  const playMatch = (match: FinalEventMatch, red: SimulatedFinalTeam | null, blue: SimulatedFinalTeam | null) => {
    const officialRedParticipant = options.replayOfficialResults
      ? officialParticipantForSide(match, "red", participantByKey, participantByIdentity)
      : null;
    const officialBlueParticipant = options.replayOfficialResults
      ? officialParticipantForSide(match, "blue", participantByKey, participantByIdentity)
      : null;
    const officialRed = officialRedParticipant ? teamByKey.get(officialRedParticipant.teamKey) ?? null : null;
    const officialBlue = officialBlueParticipant ? teamByKey.get(officialBlueParticipant.teamKey) ?? null : null;
    const hasOfficialMatchup = Boolean(officialRed && officialBlue);
    const resolvedRed = officialRed ?? red;
    const resolvedBlue = officialBlue ?? blue;
    const result = emptyResult(match.number);
    result.red = resolvedRed ? { teamKey: resolvedRed.teamKey, collegeName: resolvedRed.collegeName, teamName: resolvedRed.teamName } : null;
    result.blue = resolvedBlue ? { teamKey: resolvedBlue.teamKey, collegeName: resolvedBlue.collegeName, teamName: resolvedBlue.teamName } : null;
    result.isConfirmedMatchup = options.replayOfficialResults ? hasOfficialMatchup : true;
    if (resolvedRed && resolvedBlue) {
      const redElo = eloByTeamKey.get(resolvedRed.teamKey) ?? null;
      const blueElo = eloByTeamKey.get(resolvedBlue.teamKey) ?? null;
      result.redElo = redElo;
      result.blueElo = blueElo;
      const pGameRed = gameWinProbability(redElo, blueElo);
      const pSeriesRed = seriesWinProbability(pGameRed, match.bestOf);
      result.pGameRed = pGameRed;
      result.pSeriesRed = pSeriesRed;
      result.deltaH2H = 0;
      result.predictionBasis = "finals_sequential_elo";
      const official = isOfficiallyCompleted(match) && hasOfficialMatchup ? officialScore(match) : null;
      const projected = official
        ? null
        : options.projectMostLikelyResults
          ? predictDisplayScoreline(pGameRed, pSeriesRed, match.bestOf)
          : sampleSeries(match.bestOf, pGameRed, random);
      const [projectedRedScore, projectedBlueScore] = projected && "scoreline" in projected
        ? projected.scoreline.split(":").map(Number)
        : [projected?.redScore ?? 0, projected?.blueScore ?? 0];
      const redScore = official?.redScore ?? projectedRedScore;
      const blueScore = official?.blueScore ?? projectedBlueScore;
      const winnerSide = official
        ? officialWinnerSide(match, redScore, blueScore)
        : redScore > blueScore ? "red" : "blue";
      result.redScore = redScore;
      result.blueScore = blueScore;
      result.winnerSide = winnerSide;
      result.isRealResult = Boolean(official && winnerSide);
      if (result.isRealResult && redElo !== null && blueElo !== null) {
        const update = updateFinalsEloForSeries(redElo, blueElo, redScore, blueScore);
        result.redEloDelta = update.redDelta;
        result.blueEloDelta = update.blueDelta;
        result.redEloAfter = redElo + update.redDelta;
        result.blueEloAfter = blueElo + update.blueDelta;
        eloByTeamKey.set(resolvedRed.teamKey, result.redEloAfter);
        eloByTeamKey.set(resolvedBlue.teamKey, result.blueEloAfter);
        // 追加轨迹点
        const redTraj = trajectories.get(resolvedRed.teamKey);
        if (redTraj) redTraj.push(result.redEloAfter);
        const blueTraj = trajectories.get(resolvedBlue.teamKey);
        if (blueTraj) blueTraj.push(result.blueEloAfter);
      }
      // records 只累计瑞士轮战绩（出线排名、出局时点都只看瑞士轮）
      if (match.stageKey === "swiss" && winnerSide) {
        const winnerKey = winnerSide === "red" ? resolvedRed.teamKey : resolvedBlue.teamKey;
        const loserKey = winnerSide === "red" ? resolvedBlue.teamKey : resolvedRed.teamKey;
        const winnerRecord = records.get(winnerKey);
        const loserRecord = records.get(loserKey);
        if (winnerRecord) winnerRecord.wins += 1;
        if (loserRecord) loserRecord.losses += 1;
        if (result.isRealResult) {
          const officialWinnerRecord = officialRecords.get(winnerKey);
          const officialLoserRecord = officialRecords.get(loserKey);
          if (officialWinnerRecord) officialWinnerRecord.wins += 1;
          if (officialLoserRecord) officialLoserRecord.losses += 1;
        }
      }
    }
    matchResults.set(match.number, result);
    return result;
  };

  // ── 瑞士轮：按组、按轮推进 ──
  const swissMatches = event.matches.filter((match) => match.stageKey === "swiss");
  const roundsByGroup = new Map<"A" | "B", Map<number, FinalEventMatch[]>>();
  for (const match of swissMatches) {
    const parsed = parseSwissPoolSlot(match.redSlot);
    if (!parsed) continue;
    const groupRounds = roundsByGroup.get(parsed.group) ?? new Map<number, FinalEventMatch[]>();
    const roundMatches = groupRounds.get(parsed.round) ?? [];
    roundMatches.push(match);
    groupRounds.set(parsed.round, roundMatches);
    roundsByGroup.set(parsed.group, groupRounds);
  }

  for (const [group, groupRounds] of roundsByGroup) {
    const groupTeams = [...teamByKey.values()].filter((team) => team.group === group);
    const maxRound = Math.max(...groupRounds.keys());
    for (let round = 1; round <= maxRound; round += 1) {
      const roundMatches = [...(groupRounds.get(round) ?? [])].sort((left, right) => left.number - right.number);
      if (!roundMatches.length) continue;

      let slotTeamMap: Map<string, SimTeam>;
      if (round === 1) {
        slotTeamMap = new Map(
          groupTeams.map((team) => [`Ⅰ-${team.slot}`, team] as const),
        );
      } else {
        const alive = groupTeams
          .filter((team) => {
            const record = records.get(team.teamKey)!;
            if (record.losses >= rules.eliminateLosses) return false;
            return rules.playAfterClinch || record.wins < rules.advanceWins;
          })
          .sort((left, right) => {
            const leftRecord = records.get(left.teamKey)!;
            const rightRecord = records.get(right.teamKey)!;
            if (rightRecord.wins !== leftRecord.wins) return rightRecord.wins - leftRecord.wins;
            return left.slotIndex - right.slotIndex;
          });
        const poolSlots = [...new Set(roundMatches.flatMap((match) => [match.redSlot, match.blueSlot]))]
          .sort((left, right) => (parseSwissPoolSlot(left)?.index ?? 0) - (parseSwissPoolSlot(right)?.index ?? 0));
        slotTeamMap = new Map(
          poolSlots.map((slot, index) => [slot, alive[index] ?? null] as const)
            .filter((entry): entry is [string, SimTeam] => entry[1] !== null),
        );
      }

      for (const match of roundMatches) {
        const result = playMatch(match, slotTeamMap.get(match.redSlot) ?? null, slotTeamMap.get(match.blueSlot) ?? null);
        if (result.red) lastPlayedRoundByTeam.set(result.red.teamKey, round);
        if (result.blue) lastPlayedRoundByTeam.set(result.blue.teamKey, round);
      }
    }
  }

  // ── 组内出线座次：胜场 → 负场 → Elo → 槽位 ──
  const qualifierSlotTeam = new Map<string, SimTeam>();
  for (const group of ["A", "B"] as const) {
    const ranked = [...teamByKey.values()]
      .filter((team) => team.group === group)
      .filter((team) => (records.get(team.teamKey)?.wins ?? 0) >= rules.advanceWins)
      .sort((left, right) => {
        const leftRecord = records.get(left.teamKey)!;
        const rightRecord = records.get(right.teamKey)!;
        const leftElo = eloByTeamKey.get(left.teamKey) ?? 0;
        const rightElo = eloByTeamKey.get(right.teamKey) ?? 0;
        if (rightRecord.wins !== leftRecord.wins) return rightRecord.wins - leftRecord.wins;
        if (leftRecord.losses !== rightRecord.losses) return leftRecord.losses - rightRecord.losses;
        if (rightElo !== leftElo) return rightElo - leftElo;
        return left.slotIndex - right.slotIndex;
      });
    ranked.forEach((team, index) => {
      qualifierSlotTeam.set(`${group}-${index + 1}`, team);
    });
  }

  // ── 淘汰赛 / 名额战：沿 winnerTo / loserTo 流向传播 ──
  const allEventSlots = new Set<string>();
  for (const match of event.matches) {
    allEventSlots.add(normalizeFlowLabel(match.redSlot));
    allEventSlots.add(normalizeFlowLabel(match.blueSlot));
  }
  const flowByDestination = new Map<string, { number: number; outcome: "winner" | "loser" }>();
  for (const match of event.matches) {
    if (match.winnerTo) flowByDestination.set(normalizeFlowLabel(match.winnerTo), { number: match.number, outcome: "winner" });
    if (match.loserTo) flowByDestination.set(normalizeFlowLabel(match.loserTo), { number: match.number, outcome: "loser" });
  }
  const resolveFlowSlot = (slot: string): SimulatedFinalTeam | null => {
    if (GROUP_QUALIFIER_SLOT_PATTERN.test(slot)) return qualifierSlotTeam.get(slot) ?? null;
    const flow = flowByDestination.get(normalizeFlowLabel(slot));
    if (!flow) return null;
    const parent = matchResults.get(flow.number);
    if (!parent || !parent.winnerSide) return null;
    const side = flow.outcome === "winner" ? parent.winnerSide : parent.winnerSide === "red" ? "blue" : "red";
    return side === "red" ? parent.red : parent.blue;
  };

  const qualifierTeamKeys: string[] = [];
  const terminalOutcomes = new Map<string, SimulatedFinalTeam[]>();
  let championTeamKey: string | null = null;
  const recordTerminal = (destination: string | null, team: SimulatedFinalTeam | null) => {
    if (!destination || !team) return;
    if (allEventSlots.has(normalizeFlowLabel(destination))) return;
    const rows = terminalOutcomes.get(destination) ?? [];
    rows.push(team);
    terminalOutcomes.set(destination, rows);
  };
  const bracketMatches = event.matches
    .filter((match) => match.stageKey !== "swiss")
    .sort((left, right) => left.number - right.number);
  for (const match of bracketMatches) {
    const result = playMatch(match, resolveFlowSlot(match.redSlot), resolveFlowSlot(match.blueSlot));
    const winner = result.winnerSide ? (result.winnerSide === "red" ? result.red : result.blue) : null;
    const loser = result.winnerSide ? (result.winnerSide === "red" ? result.blue : result.red) : null;
    recordTerminal(match.winnerTo, winner);
    recordTerminal(match.loserTo, loser);
    if (match.winnerTo === "全国赛" && winner) qualifierTeamKeys.push(winner.teamKey);
    if (match.winnerTo === "冠军" && winner) championTeamKey = winner.teamKey;
  }

  const groupQualifiers: Record<string, SimulatedFinalTeam> = {};
  for (const [slot, team] of qualifierSlotTeam) {
    groupQualifiers[slot] = { teamKey: team.teamKey, collegeName: team.collegeName, teamName: team.teamName };
  }

  const swissStandings: Record<"A" | "B", SwissStandingRow[]> = { A: [], B: [] };
  for (const team of [...teamByKey.values()].sort((left, right) => left.slotIndex - right.slotIndex)) {
    const record = records.get(team.teamKey) ?? { wins: 0, losses: 0 };
    swissStandings[team.group].push({
      team: { teamKey: team.teamKey, collegeName: team.collegeName, teamName: team.teamName },
      wins: record.wins,
      losses: record.losses,
      slotIndex: team.slotIndex,
      lastPlayedRound: lastPlayedRoundByTeam.get(team.teamKey) ?? 0,
    });
  }

  const lockedQualifierTeamKeys = [...officialRecords]
    .filter(([, record]) => record.wins >= rules.advanceWins)
    .map(([teamKey]) => teamKey);
  const lockedEliminatedTeamKeys = [...officialRecords]
    .filter(([, record]) => record.losses >= rules.eliminateLosses)
    .map(([teamKey]) => teamKey);

  return {
    eventSlug: event.slug,
    seed: 0, // 由外层统一设置
    drawAssignments,
    matchResults,
    swissStandings,
    groupQualifiers,
    terminalOutcomes,
    qualifierTeamKeys,
    championTeamKey,
    lockedQualifierTeamKeys,
    lockedEliminatedTeamKeys,
    finalEloByTeamKey: Object.fromEntries(
      [...eloByTeamKey].filter((entry): entry is [string, number] => entry[1] !== null),
    ),
    eloTrajectoryByTeamKey: Object.fromEntries(trajectories),
  };
}

/**
 * 区域赛 live 模式同语义的混合推演：官方对阵/赛果优先回放，只有尚未完成的
 * 场次才按当前战绩与 Elo 继续推演。
 */
export function simulateFinalEventHybrid(
  event: FinalEventSchedule,
  overview: OverviewResponse,
  seed: number,
  initialEloByTeamKey?: ReadonlyMap<string, number>,
): FinalsEventSimulation {
  const simulation = simulateEvent(event, event.participants, overview, createSeededRandom(seed), {
    replayOfficialResults: true,
    projectMostLikelyResults: true,
    initialEloByTeamKey,
  });
  simulation.seed = seed;
  return simulation;
}

/** 实时复活赛与全国赛共用一条 Elo 链；只有真实已完成赛果会写入。 */
export function simulateFinalsLiveEvents(
  repechage: FinalEventSchedule,
  nationals: FinalEventSchedule,
  overview: OverviewResponse,
  seed: number,
): FinalsSimulationResult {
  const repechageSimulation = simulateFinalEventHybrid(repechage, overview, seed);
  const inheritedElo = new Map(Object.entries(repechageSimulation.finalEloByTeamKey));
  const nationalsSimulation = simulateFinalEventHybrid(nationals, overview, seed, inheritedElo);
  return { repechage: repechageSimulation, nationals: nationalsSimulation };
}

export function simulateFinalsEvents(
  repechage: FinalEventSchedule,
  nationals: FinalEventSchedule,
  overview: OverviewResponse,
  seed: number,
): FinalsSimulationResult {
  const random = createSeededRandom(seed);
  const repechageSimulation = simulateEvent(repechage, repechage.participants, overview, random);

  // 全国赛参赛池 = 已确认名单 + 复活赛模拟晋级的 4 队（归入非种子抽签池）
  const repechageInfoByKey = new Map(repechage.participants.map((participant) => [participant.teamKey, participant]));
  const confirmedNationalsTeamKeys = new Set(nationals.participants.map((participant) => participant.teamKey));
  const nationalsFieldSize = nationals.groups.reduce((sum, group) => sum + group.teamCount, 0);
  const openNationalsSlots = Math.max(0, nationalsFieldSize - nationals.participants.length);
  const nationalsField: FinalEventParticipant[] = [
    ...nationals.participants,
    ...repechageSimulation.qualifierTeamKeys
      .filter((teamKey) => !confirmedNationalsTeamKeys.has(teamKey))
      .slice(0, openNationalsSlots)
      .map((teamKey, index) => {
      const source = repechageInfoByKey.get(teamKey);
      return {
        order: nationals.participants.length + index + 1,
        schoolKey: source?.schoolKey ?? "",
        teamKey,
        collegeName: source?.collegeName ?? teamKey,
        teamName: source?.teamName ?? teamKey,
        drawTier: "非种子抽签池",
        status: "confirmed" as const,
      };
      }),
  ];
  const nationalsSimulation = simulateEvent(nationals, nationalsField, overview, random, {
    initialEloByTeamKey: new Map(Object.entries(repechageSimulation.finalEloByTeamKey)),
  });

  repechageSimulation.seed = seed;
  nationalsSimulation.seed = seed;
  return { repechage: repechageSimulation, nationals: nationalsSimulation };
}

/** 复活赛瑞士轮流向占位卡：按出局时点（第 2 轮后 / 第 3 轮后）解析具体队伍 */
export function swissFlowPlaceholderTeams(
  simulation: FinalsEventSimulation,
  group: "A" | "B",
  phase: "beforeRound3" | "afterRound3",
): SimulatedFinalTeam[] {
  return simulation.swissStandings[group]
    .filter((row) => row.losses >= 2
      && (phase === "beforeRound3" ? row.lastPlayedRound <= 2 : row.lastPlayedRound >= 3))
    .map((row) => row.team);
}

/** 全国赛瑞士轮战绩桶（如 "qualified-3-0" / "eliminated-2-3"）解析具体队伍 */
export function swissRecordBucketTeams(
  simulation: FinalsEventSimulation,
  group: "A" | "B",
  bucket: string,
): SimulatedFinalTeam[] {
  const matched = bucket.match(/^(?:qualified|eliminated)-(\d+)-(\d+)$/);
  if (!matched) return [];
  const wins = Number(matched[1]);
  const losses = Number(matched[2]);
  return simulation.swissStandings[group]
    .filter((row) => row.wins === wins && row.losses === losses)
    .map((row) => row.team);
}
