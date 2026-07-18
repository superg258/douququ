import type {
  FinalEventMatch,
  FinalEventParticipant,
  FinalEventSchedule,
  FinalEventSlug,
  FinalEventStageFilter,
  OverviewResponse,
} from "@/lib/types";

const DRAW_TIER_ORDER = [
  "第一梯队",
  "第二梯队",
  "第三梯队",
  "第四梯队",
  "第五梯队",
  "非种子抽签池",
];

const DRAW_SLOT_PATTERN = /^(?:(?:[ⅠⅡⅢⅣⅤIVX]+)\s*-\s*)?[AB]\s*-?\s*\d+$/u;
const DERIVED_SLOT_PATTERN = /(?:胜者|败者|决赛|半决赛|待确认|待定|槽位|名额)/u;

export function isActualSchoolName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0
    && !DRAW_SLOT_PATTERN.test(normalized)
    && !DERIVED_SLOT_PATTERN.test(normalized);
}

export function hasActualFinalMatchup(match: Pick<FinalEventMatch, "redSlot" | "blueSlot">) {
  return isActualSchoolName(match.redSlot) && isActualSchoolName(match.blueSlot);
}

export const FINAL_STAGE_OPTIONS: Record<
  FinalEventSlug,
  Array<{ id: FinalEventStageFilter; label: string; shortLabel: string }>
> = {
  repechage: [
    { id: "swiss-a", label: "A 组瑞士轮", shortLabel: "A 组" },
    { id: "swiss-b", label: "B 组瑞士轮", shortLabel: "B 组" },
    { id: "qualification", label: "晋级名额争夺战", shortLabel: "名额战" },
  ],
  nationals: [
    { id: "swiss-a", label: "A 组瑞士轮", shortLabel: "A 组" },
    { id: "swiss-b", label: "B 组瑞士轮", shortLabel: "B 组" },
    { id: "round-of-16", label: "16 进 8", shortLabel: "16 进 8" },
    { id: "quarterfinal", label: "8 进 4", shortLabel: "8 进 4" },
    { id: "final-four", label: "四强与决赛", shortLabel: "四强" },
  ],
};

const SWISS_ROUND_NUMBERS: Record<string, number> = {
  第一轮: 1,
  第二轮: 2,
  第三轮: 3,
  第四轮: 4,
  第五轮: 5,
};

export function getSwissRoundNumber(stage: string) {
  const roundLabel = stage.match(/瑞士轮(第一轮|第二轮|第三轮|第四轮|第五轮)/)?.[1];
  return roundLabel ? SWISS_ROUND_NUMBERS[roundLabel] ?? null : null;
}

function swissGroupCode(stage: FinalEventStageFilter) {
  if (stage === "swiss-a") return "A" as const;
  if (stage === "swiss-b") return "B" as const;
  return null;
}

export interface RepechageSwissFlow {
  groupCode: "A" | "B";
  groupLabel: string;
  initialTeamCount: number;
  round3TeamCount: number;
  round3MatchCount: number;
  eliminatedBeforeRound3: number;
  qualificationSlots: string[];
  qualificationSlotRange: string;
  qualificationEntryCount: number;
  eliminatedAfterRound3: number;
  explanation: string;
  roundSubtitles: Record<number, string>;
}

export function buildRepechageSwissFlow(
  event: FinalEventSchedule,
  stage: FinalEventStageFilter,
): RepechageSwissFlow | null {
  if (event.slug !== "repechage") return null;
  const groupCode = swissGroupCode(stage);
  if (!groupCode) return null;

  const groupMatches = event.matches.filter(
    (match) => match.stageKey === "swiss" && match.stage.trimStart().startsWith(`${groupCode}组`),
  );
  const roundMatches = new Map<number, FinalEventMatch[]>();
  for (const match of groupMatches) {
    const roundNumber = getSwissRoundNumber(match.stage);
    if (!roundNumber) continue;
    const rows = roundMatches.get(roundNumber) ?? [];
    rows.push(match);
    roundMatches.set(roundNumber, rows);
  }

  const group = event.groups.find((candidate) => candidate.name.replace(/\s/g, "").startsWith(`${groupCode}组`));
  const initialTeamCount = group?.teamCount ?? ((roundMatches.get(1)?.length ?? 0) * 2);
  const round3Matches = roundMatches.get(3) ?? [];
  const round3MatchCount = round3Matches.length;
  const round3TeamCount = round3MatchCount * 2;
  const eliminatedBeforeRound3 = Math.max(0, initialTeamCount - round3TeamCount);

  const qualificationSlots = [...new Set(
    event.matches
      .filter((match) => match.stageKey === "repechage_qualification")
      .flatMap((match) => [match.redSlot, match.blueSlot])
      .filter((slot) => new RegExp(`^${groupCode}-\\d+$`).test(slot)),
  )].sort((left, right) => Number(left.split("-")[1]) - Number(right.split("-")[1]));
  const qualificationEntryCount = qualificationSlots.length;
  if (!round3MatchCount || !qualificationEntryCount) return null;
  const qualificationSlotRange = qualificationEntryCount
    ? `${qualificationSlots[0]}～${qualificationSlots[qualificationSlots.length - 1]}`
    : `${groupCode}-1～${groupCode}-4`;
  const eliminatedAfterRound3 = Math.max(0, round3TeamCount - qualificationEntryCount);
  const roundSubtitles: Record<number, string> = {};
  for (const [roundNumber, matches] of roundMatches) {
    const teamCount = matches.length * 2;
    roundSubtitles[roundNumber] = `${teamCount} 队 · ${matches.length} 场正式比赛`;
  }

  return {
    groupCode,
    groupLabel: `${groupCode} 组`,
    initialTeamCount,
    round3TeamCount,
    round3MatchCount,
    eliminatedBeforeRound3,
    qualificationSlots,
    qualificationSlotRange,
    qualificationEntryCount,
    eliminatedAfterRound3,
    explanation: `前两轮累计 2 败淘汰 ${eliminatedBeforeRound3} 队，第三轮剩 ${round3TeamCount} 队：2-0 组胜负双方和 1-1 组两场胜者共 ${qualificationEntryCount} 队进入 ${qualificationSlotRange} 名额战；1-1 组两场负者累计 2 败淘汰。`,
    roundSubtitles,
  };
}

export interface RepechageSwissMatchHint {
  routeLabel: string;
  title: string;
}

export function getRepechageSwissMatchHint(match: FinalEventMatch): RepechageSwissMatchHint | null {
  if (match.stageKey !== "swiss" || getSwissRoundNumber(match.stage) !== 3) return null;

  const thirdRoundSlotNumbers = [match.redSlot, match.blueSlot]
    .map((slot) => slot.replace(/\s/g, "").match(/^Ⅲ-[AB](\d+)$/u)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const isTwoZeroPool = thirdRoundSlotNumbers.includes(1) && thirdRoundSlotNumbers.includes(2);
  return isTwoZeroPool
    ? {
        routeLabel: "2-0组：胜负均进名额战",
        title: "2-0 组：本场胜者与负者都进入晋级名额争夺战。",
      }
    : {
        routeLabel: "1-1组：胜进名额战 · 负淘汰",
        title: "1-1 组：本场胜者进入晋级名额争夺战，本场负者累计 2 败淘汰。",
      };
}

export function formatFinalsDate(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 8)));
}

export function formatFinalsDateRange(start: string, end: string) {
  return `${formatFinalsDate(start).replace(/周./, "")} - ${formatFinalsDate(end).replace(/周./, "")}`;
}

export function groupMatchesByDate(matches: FinalEventMatch[]) {
  const groups = new Map<string, FinalEventMatch[]>();
  for (const match of [...matches].sort((left, right) => left.startsAt.localeCompare(right.startsAt))) {
    const date = match.startsAt.slice(0, 10);
    const rows = groups.get(date) ?? [];
    rows.push(match);
    groups.set(date, rows);
  }
  return [...groups.entries()].map(([date, rows]) => ({ date, matches: rows }));
}

export function groupMatchesByStage(matches: FinalEventMatch[]) {
  const groups = new Map<string, FinalEventMatch[]>();
  for (const match of matches) {
    const rows = groups.get(match.stage) ?? [];
    rows.push(match);
    groups.set(match.stage, rows);
  }
  return [...groups.entries()].map(([stage, rows]) => ({ stage, matches: rows }));
}

export function groupParticipantsByTier(participants: FinalEventParticipant[]) {
  const groups = new Map<string, FinalEventParticipant[]>();
  for (const participant of participants) {
    const rows = groups.get(participant.drawTier) ?? [];
    rows.push(participant);
    groups.set(participant.drawTier, rows);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = DRAW_TIER_ORDER.indexOf(left);
      const rightIndex = DRAW_TIER_ORDER.indexOf(right);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    })
    .map(([tier, rows]) => ({ tier, participants: rows }));
}

export interface RankedFinalEventParticipant extends FinalEventParticipant {
  currentElo: number | null;
  eloGlobalRank: number | null;
}

export interface RepechageStageProbability {
  advancementRate: number;
}

export interface NationalsStageProbability {
  groupAdvancementRate: number;
  topFourRate: number;
  championRate: number;
}

export interface FinalsStageProbabilityProjection {
  iterations: number;
  repechage: Map<string, RepechageStageProbability>;
  nationals: Map<string, NationalsStageProbability>;
}

const ELO_GUMBEL_SCALE = 400 / Math.log(10);
const DEFAULT_FINALS_PROJECTION_ITERATIONS = 10_000;

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sampleEloPerformance(currentElo: number, random: () => number) {
  const uniform = Math.min(Math.max(random(), Number.EPSILON), 1 - Number.EPSILON);
  return currentElo - ELO_GUMBEL_SCALE * Math.log(-Math.log(uniform));
}

function incrementCounter(counter: Map<string, number>, teamKey: string) {
  counter.set(teamKey, (counter.get(teamKey) ?? 0) + 1);
}

export function rankFinalEventParticipantsByCurrentElo(
  participants: FinalEventParticipant[],
  overview: OverviewResponse,
): RankedFinalEventParticipant[] {
  const teamIndex = new Map(
    overview.regions.flatMap((region) => region.teams).map((team) => [team.teamKey, team]),
  );

  return participants
    .filter((participant) => participant.status === "confirmed")
    .map((participant) => {
      const team = teamIndex.get(participant.teamKey);
      return {
        ...participant,
        currentElo: team ? (team.currentElo ?? team.mu0) : null,
        eloGlobalRank: team?.eloGlobalRank ?? null,
      };
    })
    .sort((left, right) => {
      if (left.currentElo === null && right.currentElo !== null) return 1;
      if (left.currentElo !== null && right.currentElo === null) return -1;
      if (left.currentElo !== null && right.currentElo !== null && right.currentElo !== left.currentElo) {
        return right.currentElo - left.currentElo;
      }
      if (left.eloGlobalRank !== null && right.eloGlobalRank !== null && left.eloGlobalRank !== right.eloGlobalRank) {
        return left.eloGlobalRank - right.eloGlobalRank;
      }
      return left.order - right.order;
    });
}

export function projectFinalsStageProbabilities(
  repechageParticipants: FinalEventParticipant[],
  nationalsParticipants: FinalEventParticipant[],
  overview: OverviewResponse,
  iterations = DEFAULT_FINALS_PROJECTION_ITERATIONS,
): FinalsStageProbabilityProjection {
  const repechage = rankFinalEventParticipantsByCurrentElo(repechageParticipants, overview)
    .filter((participant) => participant.currentElo !== null);
  const nationals = rankFinalEventParticipantsByCurrentElo(nationalsParticipants, overview)
    .filter((participant) => participant.currentElo !== null);
  const advancementCounts = new Map<string, number>();
  const groupAdvancementCounts = new Map<string, number>();
  const topFourCounts = new Map<string, number>();
  const championCounts = new Map<string, number>();
  const random = createSeededRandom(20260714);
  const safeIterations = Math.max(1, Math.floor(iterations));

  for (let iteration = 0; iteration < safeIterations; iteration += 1) {
    const projectedRepechageQualifiers = repechage
      .map((participant) => ({
        participant,
        performance: sampleEloPerformance(participant.currentElo as number, random),
      }))
      .sort((left, right) => right.performance - left.performance)
      .slice(0, Math.min(4, repechage.length))
      .map(({ participant }) => participant);

    for (const participant of projectedRepechageQualifiers) {
      incrementCounter(advancementCounts, participant.teamKey);
    }

    const projectedNationalsField = [...nationals, ...projectedRepechageQualifiers]
      .map((participant) => ({
        participant,
        performance: sampleEloPerformance(participant.currentElo as number, random),
      }))
      .sort((left, right) => right.performance - left.performance);

    const groupAdvancers = projectedNationalsField.slice(0, Math.min(16, projectedNationalsField.length));
    const topFour = projectedNationalsField.slice(0, Math.min(4, projectedNationalsField.length));
    const champion = projectedNationalsField[0];

    for (const { participant } of groupAdvancers) {
      incrementCounter(groupAdvancementCounts, participant.teamKey);
    }
    for (const { participant } of topFour) {
      incrementCounter(topFourCounts, participant.teamKey);
    }
    if (champion) incrementCounter(championCounts, champion.participant.teamKey);
  }

  return {
    iterations: safeIterations,
    repechage: new Map(repechage.map((participant) => [
      participant.teamKey,
      { advancementRate: (advancementCounts.get(participant.teamKey) ?? 0) / safeIterations },
    ])),
    nationals: new Map(
      [...nationals, ...repechage].map((participant) => [
        participant.teamKey,
        {
          groupAdvancementRate: (groupAdvancementCounts.get(participant.teamKey) ?? 0) / safeIterations,
          topFourRate: (topFourCounts.get(participant.teamKey) ?? 0) / safeIterations,
          championRate: (championCounts.get(participant.teamKey) ?? 0) / safeIterations,
        },
      ]),
    ),
  };
}

export function matchesForFinalStage(event: FinalEventSchedule, stage: FinalEventStageFilter) {
  if (stage === "swiss-a") {
    return event.matches.filter((match) => match.stageKey === "swiss" && match.stage.trimStart().startsWith("A组"));
  }
  if (stage === "swiss-b") {
    return event.matches.filter((match) => match.stageKey === "swiss" && match.stage.trimStart().startsWith("B组"));
  }
  if (stage === "qualification") {
    return event.matches.filter((match) => match.stageKey === "repechage_qualification");
  }
  if (stage === "round-of-16") {
    return event.matches.filter((match) => match.stageKey === "round_of_16");
  }
  if (stage === "quarterfinal") {
    return event.matches.filter((match) => match.stageKey === "quarterfinal");
  }
  return event.matches.filter((match) => ["semifinal", "third_place", "final"].includes(match.stageKey));
}

export function buildFinalEventDays(event: FinalEventSchedule, stage: FinalEventStageFilter) {
  return groupMatchesByDate(matchesForFinalStage(event, stage)).map(({ date, matches }) => ({
    date,
    stages: groupMatchesByStage(matches),
    matchCount: matches.length,
  }));
}
