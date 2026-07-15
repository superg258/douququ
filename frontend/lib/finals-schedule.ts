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
