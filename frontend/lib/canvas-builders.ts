import type {
  CanvasCard,
  CanvasConnector,
  CanvasTone,
  FinalRankingRow,
  GroupRankingRow,
  MatchCanvasCard,
  MatchRow,
  RegionSlug,
  SimulationResponse,
  SlotRow,
  TeamCanvasCard,
  WorkspaceStage,
  WorkspaceStageHeader,
  WorkspaceView,
} from "@/lib/types";
import {
  CANVAS_LAYOUT,
  connectCardGroupToCard,
  connectCardGroupToCards,
  connectHeaderBands,
  createMatchCanvasCard,
  createTeamCanvasCard,
} from "@/lib/canvas-primitives";
import {
  formatMatchLabel,
  formatSeedTierLabel,
  formatSwissRecordLabel,
  translateAdvancementLabel,
  translateFinalBucket,
  translateStageLabel,
} from "@/lib/display";
import {
  officialPlaceholderSwissBucket,
  SWISS_OFFICIAL_PLACEHOLDER_SUMMARY_COUNTS,
  SWISS_STAGE_COLUMNS,
  SWISS_STAGE_FLOWS,
  type SwissBucketKey,
  type SwissSummaryId,
} from "@/lib/swiss-canvas";

interface SwissReplayArtifacts {
  matchBuckets: Record<string, string[]>;
  summaryBuckets: Record<string, GroupRankingRow[]>;
  summaryIsSimulated: Record<string, Record<string, boolean>>;
}

const MATCH_CARD_WIDTH = CANVAS_LAYOUT.match.width;
const MATCH_CARD_HEIGHT = CANVAS_LAYOUT.match.height;
const TEAM_CARD_WIDTH = CANVAS_LAYOUT.team.width;
const TEAM_CARD_HEIGHT = CANVAS_LAYOUT.team.height;
const DETAIL_TEAM_CARD_WIDTH = CANVAS_LAYOUT.detailTeam.width;
const DETAIL_TEAM_CARD_HEIGHT = CANVAS_LAYOUT.detailTeam.height;
const SWISS_MATCH_CARD_HEIGHT = MATCH_CARD_HEIGHT;
const SWISS_MATCH_STEP = 215;
const SUMMARY_TEAM_STEP = CANVAS_LAYOUT.flow.teamStep;
const STAGE_HEADER_TO_CARD_OFFSET = CANVAS_LAYOUT.flow.headerToCardOffset;
const SWISS_SECTION_GAP = CANVAS_LAYOUT.flow.sectionGap;
const PLAYOFF_MATCH_CARD_WIDTH = 440;
const PLAYOFF_MATCH_CARD_HEIGHT = MATCH_CARD_HEIGHT;
const PLAYOFF_MATCH_STEP = 215;

function stageTone(stage: string): CanvasTone {
  if (stage === "final" || stage === "third_place") {
    return "amber";
  }
  if (stage === "qualification_round1" || stage === "qualification_round2") {
    return "emerald";
  }
  if (stage === "round_of_16" || stage === "quarterfinal" || stage === "semifinal") {
    return "cyan";
  }
  return "steel";
}

function compactMatchCode(matchLabel: string) {
  if (matchLabel.startsWith("R16-")) {
    return `16-${matchLabel.split("-")[1]}`;
  }
  if (matchLabel.startsWith("QF-")) {
    return `8-${matchLabel.split("-")[1]}`;
  }
  if (matchLabel.startsWith("SF-")) {
    return `SF-${matchLabel.split("-")[1]}`;
  }
  if (matchLabel.startsWith("FINAL")) {
    return "FIN";
  }
  if (matchLabel.startsWith("THIRD")) {
    return "3RD";
  }
  if (matchLabel.startsWith("QUAL-1-")) {
    return `Q1-${matchLabel.split("-")[2]}`;
  }
  if (matchLabel.startsWith("QUAL-2-")) {
    return `Q2-${matchLabel.split("-")[2]}`;
  }
  if (matchLabel.startsWith("QUAL-R-")) {
    return `QR-${matchLabel.split("-")[2]}`;
  }
  return matchLabel;
}

const SWISS_ROUND_START_MATCH_NUMBER: Record<number, number> = {
  1: 1,
  2: 17,
  3: 33,
  4: 49,
  5: 61,
};

const SWISS_GROUP_MATCH_COUNT: Record<number, number> = {
  1: 8,
  2: 8,
  3: 8,
  4: 6,
  5: 3,
};

function deriveRegionalMatchNumber(matchLabel: string, regionSlug: RegionSlug) {
  const swissMatch = matchLabel.match(/^([AB])-SWISS-(\d+)-(\d+)$/);
  if (swissMatch) {
    const groupName = swissMatch[1];
    const roundNumber = Number.parseInt(swissMatch[2], 10);
    const index = Number.parseInt(swissMatch[3], 10);
    const start = SWISS_ROUND_START_MATCH_NUMBER[roundNumber];
    const groupCount = SWISS_GROUP_MATCH_COUNT[roundNumber];
    if (start && groupCount && index >= 1 && index <= groupCount) {
      return start + (groupName === "B" ? groupCount : 0) + index - 1;
    }
  }

  const twoPartMatch = matchLabel.match(/^(R16|QF|SF)-(\d+)$/);
  if (twoPartMatch) {
    const stage = twoPartMatch[1];
    const index = Number.parseInt(twoPartMatch[2], 10);
    if (stage === "R16" && index >= 1 && index <= 8) {
      return 66 + index;
    }
    if (stage === "QF" && index >= 1 && index <= 4) {
      return 74 + index;
    }
    if (stage === "SF" && index >= 1 && index <= 2) {
      return (regionSlug === "north_region" ? 86 : 84) + index;
    }
  }

  const qualificationMatch = matchLabel.match(/^QUAL-(1|2|R)-(\d+)$/);
  if (qualificationMatch) {
    const round = qualificationMatch[1];
    const index = Number.parseInt(qualificationMatch[2], 10);
    if (round === "1" && index >= 1 && index <= 4) {
      return 78 + index;
    }
    if (round === "2" && index >= 1 && index <= 2) {
      return 82 + index;
    }
    if (round === "R" && regionSlug === "north_region" && index >= 1 && index <= 2) {
      return 84 + index;
    }
  }

  if (matchLabel === "THIRD-1") {
    return regionSlug === "north_region" ? 89 : 87;
  }
  if (matchLabel === "FINAL-1") {
    return regionSlug === "north_region" ? 90 : 88;
  }

  return null;
}

function formatRegionalMatchDisplayLabel(match: MatchRow, regionSlug: RegionSlug) {
  const matchNumber = match.regionalMatchNumber ?? deriveRegionalMatchNumber(match.matchLabel, regionSlug);
  if (matchNumber) {
    return `第${matchNumber}场`;
  }
  return formatMatchLabel(match.matchLabel);
}

function stageMeta(match: MatchRow) {
  return `${translateStageLabel(match.stage)} / BO${match.bestOf}`;
}

function compareSlotOrder(left: SlotRow, right: SlotRow) {
  const leftValue = left.slot ?? "";
  const rightValue = right.slot ?? "";
  const leftNumeric = Number.parseInt(leftValue.replace(/\D/g, ""), 10);
  const rightNumeric = Number.parseInt(rightValue.replace(/\D/g, ""), 10);

  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric) && leftNumeric !== rightNumeric) {
    return leftNumeric - rightNumeric;
  }

  return leftValue.localeCompare(rightValue, "en");
}

function buildMatchCard(
  match: MatchRow,
  x: number,
  y: number,
  options?: {
    orderLabel?: string;
    displayLabel?: string;
    metaLabel?: string;
    width?: number;
    height?: number;
    variant?: MatchCanvasCard["variant"];
    showProbability?: boolean;
    regionSlug?: RegionSlug;
  }
): MatchCanvasCard {
  return createMatchCanvasCard(match, {
    x,
    y,
    width: options?.width ?? MATCH_CARD_WIDTH,
    height: options?.height ?? MATCH_CARD_HEIGHT,
    tone: stageTone(match.stage),
    orderLabel: options?.orderLabel ?? compactMatchCode(match.matchLabel),
    displayLabel: options?.displayLabel ?? (options?.regionSlug ? formatRegionalMatchDisplayLabel(match, options.regionSlug) : formatMatchLabel(match.matchLabel)),
    metaLabel: options?.metaLabel ?? stageMeta(match),
    variant: options?.variant ?? "standard",
    showProbability: options?.showProbability ?? false,
  });
}

function buildTeamCard({
  id,
  teamKey,
  collegeName,
  teamName,
  x,
  y,
  tone = "steel",
  outcome,
  variant = "team",
  orderLabel,
  subtitle,
  statLine,
  meta,
  width,
  height,
  isSimulated,
}: {
  id: string;
  teamKey: string;
  collegeName: string;
  teamName: string;
  x: number;
  y: number;
  tone?: CanvasTone;
  outcome?: TeamCanvasCard["outcome"];
  variant?: TeamCanvasCard["variant"];
  orderLabel?: string;
  subtitle?: string;
  statLine?: string;
  meta?: string[];
  width?: number;
  height?: number;
  isSimulated?: boolean;
}): TeamCanvasCard {
  return createTeamCanvasCard({
    id,
    teamKey,
    collegeName,
    teamName,
    x,
    y,
    width: width ?? TEAM_CARD_WIDTH,
    height: height ?? TEAM_CARD_HEIGHT,
    tone,
    variant,
    outcome,
    orderLabel,
    subtitle,
    statLine,
    meta,
    isSimulated,
  });
}

function isOfficialPlaceholderMatch(match: MatchRow) {
  return Boolean(match.officialMatchId) && (!match.redTeam.teamKey || !match.blueTeam.teamKey);
}

function isOfficialPlaceholderSwissMatch(match: MatchRow) {
  return match.stage === "swiss" && isOfficialPlaceholderMatch(match);
}

function replaySwissBuckets(simulation: SimulationResponse, groupName: "A" | "B"): SwissReplayArtifacts {
  const groupMatches = simulation.matches
    .filter((match) => match.stage === "swiss" && match.groupName === groupName)
    .sort((left, right) => {
      if (left.roundNumber !== right.roundNumber) {
        return left.roundNumber - right.roundNumber;
      }
      return left.matchLabel.localeCompare(right.matchLabel);
    });

  const state = new Map<string, { wins: number; losses: number; allReal: boolean }>();
  const matchBuckets: Record<string, string[]> = {};
  const teamBuckets: Record<string, string[]> = {
    "qualified-3-0": [],
    "qualified-3-1": [],
    "qualified-3-2": [],
    "eliminated-0-3": [],
    "eliminated-1-3": [],
    "eliminated-2-3": [],
  };
  const summaryIsSimulated: Record<string, Record<string, boolean>> = Object.fromEntries(
    Object.keys(teamBuckets).map((bucket) => [bucket, {}])
  );

  const ensureState = (teamKey: string) => {
    if (!state.has(teamKey)) {
      state.set(teamKey, { wins: 0, losses: 0, allReal: true });
    }
    return state.get(teamKey)!;
  };
  const officialPlaceholderCountByRound = new Map<number, number>();

  for (const match of groupMatches) {
    if (isOfficialPlaceholderSwissMatch(match)) {
      const indexInRound = officialPlaceholderCountByRound.get(match.roundNumber) ?? 0;
      officialPlaceholderCountByRound.set(match.roundNumber, indexInRound + 1);
      const bucket = officialPlaceholderSwissBucket(match.roundNumber, indexInRound);
      if (bucket) {
        const bucketKey = `${match.roundNumber}:${bucket}`;
        matchBuckets[bucketKey] ??= [];
        matchBuckets[bucketKey].push(match.matchLabel);
      }
      continue;
    }

    const redState = ensureState(match.redTeam.teamKey);
    const blueState = ensureState(match.blueTeam.teamKey);
    const bucketKey = `${match.roundNumber}:${redState.wins}-${redState.losses}`;
    matchBuckets[bucketKey] ??= [];
    matchBuckets[bucketKey].push(match.matchLabel);

    const matchIsReal = Boolean(match.isRealResult);
    redState.allReal = redState.allReal && matchIsReal;
    blueState.allReal = blueState.allReal && matchIsReal;
    redState.wins += match.winnerTeamKey === match.redTeam.teamKey ? 1 : 0;
    redState.losses += match.winnerTeamKey === match.redTeam.teamKey ? 0 : 1;
    blueState.wins += match.winnerTeamKey === match.blueTeam.teamKey ? 1 : 0;
    blueState.losses += match.winnerTeamKey === match.blueTeam.teamKey ? 0 : 1;

    for (const [teamKey, teamState] of [
      [match.redTeam.teamKey, redState],
      [match.blueTeam.teamKey, blueState],
    ] as const) {
      if (teamState.wins === 3) {
        const bucket = `qualified-3-${teamState.losses}`;
        teamBuckets[bucket].push(teamKey);
        summaryIsSimulated[bucket][teamKey] = !teamState.allReal;
      }
      if (teamState.losses === 3) {
        const bucket = `eliminated-${teamState.wins}-3`;
        teamBuckets[bucket].push(teamKey);
        summaryIsSimulated[bucket][teamKey] = !teamState.allReal;
      }
    }
  }

  const groupRankings = simulation.groupRankings[groupName];
  const rowsByKey = new Map(groupRankings.map((row) => [row.teamKey, row]));
  const summaryBuckets: Record<string, GroupRankingRow[]> = {};
  for (const [bucket, teamKeys] of Object.entries(teamBuckets)) {
    summaryBuckets[bucket] = teamKeys
      .map((teamKey) => rowsByKey.get(teamKey))
      .filter((row): row is GroupRankingRow => Boolean(row))
      .sort((left, right) => left.groupRank - right.groupRank);
  }

  return { matchBuckets, summaryBuckets, summaryIsSimulated };
}

export function summaryBucketTeams(
  simulation: SimulationResponse,
  bucket: string
): Array<GroupRankingRow | FinalRankingRow> {
  if (bucket.includes(":qualified-") || bucket.includes(":eliminated-")) {
    const [groupName, label] = bucket.split(":");
    const artifacts = replaySwissBuckets(simulation, groupName as "A" | "B");
    return artifacts.summaryBuckets[label] ?? [];
  }

  if (bucket === "champion") {
    return simulation.finalRankings.filter((row) => row.finalBucket === "champion");
  }
  if (bucket === "runner-up") {
    return simulation.finalRankings.filter((row) => row.finalBucket === "runner_up");
  }
  if (bucket === "third-place") {
    return simulation.finalRankings.filter((row) => row.finalBucket === "third_place");
  }
  if (bucket === "fourth-place") {
    return simulation.finalRankings.filter((row) => row.finalBucket === "fourth_place");
  }
  if (bucket === "national-qualifiers") {
    return simulation.finalRankings.filter((row) => row.advancement === "national_qualified");
  }
  if (bucket === "repechage-qualifiers") {
    return simulation.finalRankings.filter((row) => row.advancement === "repechage_qualified");
  }
  return [];
}

type QualificationOutcomeKey = "national" | "repechage" | "eliminated";
type QualificationSourceStage = "qual-1" | "qual-2" | "qual-r";

interface QualificationOutcomeRow {
  row: FinalRankingRow;
  sourceLabel: string;
  sourceStage: QualificationSourceStage;
  isSimulated: boolean;
  statLine?: string;
}

function buildQualificationOutcomeRows(simulation: SimulationResponse) {
  const rowsByKey = new Map(simulation.finalRankings.filter((row) => row.teamKey).map((row) => [row.teamKey, row]));
  const groupRowsByKey = new Map(
    [...simulation.groupRankings.A, ...simulation.groupRankings.B]
      .filter((row) => row.teamKey)
      .map((row) => [row.teamKey, row])
  );
  const outcomes: Record<QualificationOutcomeKey, QualificationOutcomeRow[]> = {
    national: [],
    repechage: [],
    eliminated: [],
  };
  const seen = new Set<string>();
  let placeholderIndex = 0;
  let derivedIndex = 0;

  const outcomeAdvancement = (bucket: QualificationOutcomeKey) => {
    if (bucket === "national") return "national_qualified";
    if (bucket === "repechage") return "repechage_qualified";
    return "group_eliminated";
  };

  const matchTeam = (teamKey: string, match: MatchRow) => {
    if (match.redTeam.teamKey === teamKey) return match.redTeam;
    if (match.blueTeam.teamKey === teamKey) return match.blueTeam;
    return null;
  };

  const resolveOutcomeRow = (
    teamKey: string,
    bucket: QualificationOutcomeKey,
    sourceLabel: string,
    match: MatchRow
  ): { row: FinalRankingRow; statLine?: string } | null => {
    const finalRow = rowsByKey.get(teamKey);
    if (finalRow) {
      return { row: finalRow };
    }

    const groupRow = groupRowsByKey.get(teamKey);
    const team = groupRow ?? matchTeam(teamKey, match);
    if (!team) {
      return null;
    }

    derivedIndex += 1;
    const advancement = outcomeAdvancement(bucket);
    return {
      row: {
        teamKey: team.teamKey,
        collegeName: team.collegeName,
        teamName: team.teamName,
        slot: team.slot,
        rank: groupRow?.finalRank || 1000 + derivedIndex,
        groupName: "",
        seedTier: "simulation_proxy",
        seedRankInRegion: 0,
        swissWins: groupRow?.wins ?? 0,
        swissLosses: groupRow?.losses ?? 0,
        swissGroupRank: groupRow?.groupRank ?? null,
        mu0: 0,
        finalBucket: advancement,
        advancement,
      },
      statLine: groupRow ? undefined : `${sourceLabel} / 预测去向`,
    };
  };

  const pushOutcome = (
    teamKey: string,
    bucket: QualificationOutcomeKey,
    sourceLabel: string,
    sourceStage: QualificationSourceStage,
    isSimulated: boolean,
    match: MatchRow
  ) => {
    const resolved = resolveOutcomeRow(teamKey, bucket, sourceLabel, match);
    if (!resolved) {
      return;
    }
    const id = `${bucket}:${teamKey}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    outcomes[bucket].push({ row: resolved.row, sourceLabel, sourceStage, isSimulated, statLine: resolved.statLine });
  };

  const pushPlaceholderOutcome = (
    bucket: QualificationOutcomeKey,
    sourceLabel: string,
    sourceStage: QualificationSourceStage
  ) => {
    placeholderIndex += 1;
    outcomes[bucket].push({
      row: {
        teamKey: "",
        collegeName: "待确认",
        teamName: "学校队伍待确认",
        slot: null,
        rank: 1000 + placeholderIndex,
        groupName: "",
        seedTier: "official_placeholder",
        seedRankInRegion: 0,
        swissWins: 0,
        swissLosses: 0,
        swissGroupRank: null,
        mu0: 0,
        finalBucket: bucket === "national" ? "national_qualified" : bucket === "repechage" ? "repechage_qualified" : "group_eliminated",
        advancement: bucket === "national" ? "national_qualified" : bucket === "repechage" ? "repechage_qualified" : "group_eliminated",
      },
      sourceLabel,
      sourceStage,
      isSimulated: true,
      statLine: `${sourceLabel} / 学校队伍待确认`,
    });
  };

  const pushDestination = (
    destination: string,
    teamKey: string,
    sideLabel: string,
    sourceStage: QualificationSourceStage,
    isSimulated: boolean,
    isPlaceholder: boolean,
    match: MatchRow
  ) => {
    if (destination === "national_qualified") {
      if (isPlaceholder) {
        pushPlaceholderOutcome("national", sideLabel, sourceStage);
      } else {
        pushOutcome(teamKey, "national", sideLabel, sourceStage, isSimulated, match);
      }
    }
    if (destination === "repechage_qualified") {
      if (isPlaceholder) {
        pushPlaceholderOutcome("repechage", sideLabel, sourceStage);
      } else {
        pushOutcome(teamKey, "repechage", sideLabel, sourceStage, isSimulated, match);
      }
    }
    if (destination === "eliminated") {
      if (isPlaceholder) {
        pushPlaceholderOutcome("eliminated", sideLabel, sourceStage);
      } else {
        pushOutcome(teamKey, "eliminated", sideLabel, sourceStage, isSimulated, match);
      }
    }
  };

  simulation.matches
    .filter((match) => match.matchLabel.startsWith("QUAL-"))
    .forEach((match) => {
      const sourceStage: QualificationSourceStage = match.matchLabel.startsWith("QUAL-1-")
        ? "qual-1"
        : match.matchLabel.startsWith("QUAL-2-")
          ? "qual-2"
          : "qual-r";
      const stagePrefix = match.matchLabel.startsWith("QUAL-1-")
        ? "资格赛一轮"
        : match.matchLabel.startsWith("QUAL-2-")
          ? "资格赛二轮"
          : "复活赛突围战";

      const isPlaceholder = isOfficialPlaceholderMatch(match);
      pushDestination(
        match.winnerNext,
        match.winnerTeamKey,
        `${stagePrefix}胜者`,
        sourceStage,
        !match.isRealResult,
        isPlaceholder,
        match
      );
      pushDestination(
        match.loserNext,
        match.loserTeamKey,
        `${stagePrefix}负者`,
        sourceStage,
        !match.isRealResult,
        isPlaceholder,
        match
      );
    });

  (Object.keys(outcomes) as QualificationOutcomeKey[]).forEach((bucket) => {
    outcomes[bucket].sort((left, right) => left.row.rank - right.row.rank);
  });

  return outcomes;
}

function pickQualificationRows(
  outcomes: Record<QualificationOutcomeKey, QualificationOutcomeRow[]>,
  bucket: QualificationOutcomeKey,
  sourceStage: QualificationSourceStage
) {
  return outcomes[bucket].filter((entry) => entry.sourceStage === sourceStage);
}

function buildSlotsStage(simulation: SimulationResponse): WorkspaceStage {
  const groups: Array<["A" | "B", SlotRow[]]> = [
    [
      "A",
      [...simulation.slots]
        .filter((slot) => slot.groupName === "A")
        .sort(compareSlotOrder),
    ],
    [
      "B",
      [...simulation.slots]
        .filter((slot) => slot.groupName === "B")
        .sort(compareSlotOrder),
    ],
  ];

  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  groups.forEach(([groupName, slots], groupIndex) => {
    const x = 88 + groupIndex * 520;
    headers.push({
      id: `slots-${groupName}`,
      x,
      y: 82,
      width: 400,
      title: `${groupName} 组抽签落位`,
      subtitle: "",
      tone: "cyan",
    });
    slots.forEach((slot, index) => {
      const isOfficialPlaceholder = !slot.teamKey;
      cards.push(
        buildTeamCard({
          id: `slot-${slot.teamKey || slot.slot || `${groupName}-${index + 1}`}`,
          teamKey: slot.teamKey,
          collegeName: slot.collegeName,
          teamName: slot.teamName,
          x,
          y: 134 + index * 96,
          orderLabel: slot.slot ?? "--",
          subtitle: slot.teamName,
          statLine: isOfficialPlaceholder
            ? `${formatSeedTierLabel(slot.seedTier)} / 学校队伍待确认`
            : `${formatSeedTierLabel(slot.seedTier)} / Elo #${slot.eloGlobalRank}`,
          tone: "cyan",
        })
      );
    });
  });

  return {
    id: "slots",
    label: "抽签落位",
    title: "小组抽签落位",
    description: "先看两组抽签位置、梯队标记与 Elo 顺位，再进入后续赛程。",
    width: 1160,
    height: 1040,
    headers,
    cards,
    connectors: [],
  };
}

function buildSwissStage(groupName: "A" | "B", regionSlug: RegionSlug, simulation: SimulationResponse, view: WorkspaceView): WorkspaceStage {
  const artifacts = replaySwissBuckets(simulation, groupName);
  const matchMap = new Map(simulation.matches.map((match) => [match.matchLabel, match]));
  const hasOfficialPlaceholderSchedule = simulation.matches.some(
    (match) => match.stage === "swiss" && match.groupName === groupName && isOfficialPlaceholderSwissMatch(match)
  );
  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  const headersBySection = new Map<string, WorkspaceStageHeader>();

  SWISS_STAGE_COLUMNS.forEach((column) => {
    let nextSectionBottom = 0;

    column.sections.forEach((section) => {
      if (section.kind === "matches") {
        const bucketKey = `${section.round}:${section.bucket}`;
        const matchLabels = artifacts.matchBuckets[bucketKey] ?? [];
        if (!matchLabels.length) {
          return;
        }

        const sectionY = nextSectionBottom ? Math.max(section.y, nextSectionBottom + SWISS_SECTION_GAP) : section.y;
        const header: WorkspaceStageHeader = {
          id: `${groupName}-${section.id}`,
          x: column.x,
          y: sectionY,
          width: MATCH_CARD_WIDTH,
          title: section.title,
          subtitle: "",
          tone: section.tone,
        };
        headers.push(header);
        headersBySection.set(section.id, header);

        matchLabels.forEach((matchLabel, index) => {
          const match = matchMap.get(matchLabel);
          if (!match) {
            return;
          }
          cards.push(
            buildMatchCard(match, column.x, sectionY + STAGE_HEADER_TO_CARD_OFFSET + index * SWISS_MATCH_STEP, {
              orderLabel: `${index + 1}`,
              regionSlug,
              metaLabel: `BO${match.bestOf}`,
              height: SWISS_MATCH_CARD_HEIGHT,
              variant: "compact",
              showProbability: false,
            })
          );
        });
        nextSectionBottom =
          sectionY + STAGE_HEADER_TO_CARD_OFFSET + (matchLabels.length - 1) * SWISS_MATCH_STEP + SWISS_MATCH_CARD_HEIGHT;
        return;
      }

      const rows = artifacts.summaryBuckets[section.summaryId] ?? [];
      if (!rows.length && !hasOfficialPlaceholderSchedule) {
        return;
      }

      const sectionY = nextSectionBottom ? Math.max(section.y, nextSectionBottom + SWISS_SECTION_GAP) : section.y;
      const header: WorkspaceStageHeader = {
        id: `${groupName}-${section.id}`,
        x: column.x,
        y: sectionY,
        width: DETAIL_TEAM_CARD_WIDTH,
        title: section.title,
        subtitle: rows.length ? "" : "真实队伍待确认",
        tone: section.tone,
      };
      headers.push(header);
      headersBySection.set(section.id, header);

      if (!rows.length && hasOfficialPlaceholderSchedule) {
        const placeholderCount = SWISS_OFFICIAL_PLACEHOLDER_SUMMARY_COUNTS[section.summaryId];
        Array.from({ length: placeholderCount }, (_, index) => {
          cards.push(
            buildTeamCard({
              id: `${groupName}-${section.id}-placeholder-${index + 1}`,
              teamKey: "",
              collegeName: "待确认",
              teamName: "排期待确认",
              x: column.x,
              y: sectionY + STAGE_HEADER_TO_CARD_OFFSET + index * SUMMARY_TEAM_STEP,
              orderLabel: `${index + 1}`,
              subtitle: "真实队伍待确认",
              statLine: "等待瑞士轮结果",
              tone: section.tone,
              variant: "summary",
              width: DETAIL_TEAM_CARD_WIDTH,
              height: DETAIL_TEAM_CARD_HEIGHT,
              isSimulated: true,
            })
          );
        });
        nextSectionBottom =
          sectionY + STAGE_HEADER_TO_CARD_OFFSET + (placeholderCount - 1) * SUMMARY_TEAM_STEP + DETAIL_TEAM_CARD_HEIGHT;
        return;
      }

      rows.forEach((row, index) => {
        cards.push(
          buildTeamCard({
            id: `${groupName}-${section.id}-${row.teamKey}`,
            teamKey: row.teamKey,
            collegeName: row.collegeName,
            teamName: row.teamName,
            x: column.x,
            y: sectionY + STAGE_HEADER_TO_CARD_OFFSET + index * SUMMARY_TEAM_STEP,
            orderLabel: `${row.groupRank}`,
            subtitle: row.teamName,
            statLine: formatSwissRecordLabel(row.wins, row.losses),
            tone: section.tone,
            variant: "summary",
            width: DETAIL_TEAM_CARD_WIDTH,
            height: DETAIL_TEAM_CARD_HEIGHT,
            isSimulated: artifacts.summaryIsSimulated[section.summaryId]?.[row.teamKey] ?? true,
          })
        );
      });
      nextSectionBottom = sectionY + STAGE_HEADER_TO_CARD_OFFSET + (rows.length - 1) * SUMMARY_TEAM_STEP + DETAIL_TEAM_CARD_HEIGHT;
    });
  });

  const connectors = SWISS_STAGE_FLOWS.map(({ sourceId, targetIds, tone }) =>
    connectHeaderBands(
      headersBySection.has(sourceId) ? [headersBySection.get(sourceId)!] : [],
      targetIds.map((targetId) => headersBySection.get(targetId)).filter((header): header is WorkspaceStageHeader => Boolean(header)),
      `${groupName}-${sourceId}->${targetIds.join("+")}`,
      tone
    )
  ).filter((connector): connector is CanvasConnector => Boolean(connector));

  const maxBottom = Math.max(
    cards.reduce((max, card) => Math.max(max, card.y + card.height), 0),
    headers.reduce((max, header) => Math.max(max, header.y + 78), 0)
  );

  return {
    id: view,
    label: `${groupName} 组瑞士轮`,
    title: `${groupName} 组瑞士轮`,
    description: "从首轮一路看到出线与出局节点，每轮结束后都会即时标出下一步去向。",
    width: 2740,
    height: Math.max(1600, maxBottom + 124),
    viewport: {
      align: "left",
      minScale: 0.72,
      paddingX: 48,
      paddingY: 48,
    },
    headers,
    cards,
    connectors,
  };
}

function buildPlayoffStage(regionSlug: RegionSlug, simulation: SimulationResponse): WorkspaceStage {
  const matches = simulation.matches.filter((match) => match.stage !== "swiss");
  const cards: CanvasCard[] = [];
  const headers: WorkspaceStageHeader[] = [];
  const cardMap = new Map<string, CanvasCard>();

  const addMatch = (match: MatchRow, x: number, y: number) => {
    const card = buildMatchCard(match, x, y, {
      width: PLAYOFF_MATCH_CARD_WIDTH,
      height: PLAYOFF_MATCH_CARD_HEIGHT,
      variant: "playoff",
      showProbability: false,
      regionSlug,
    });
    cards.push(card);
    cardMap.set(match.matchLabel, card);
  };

  const stageGroups = {
    round_of_16: matches.filter((match) => match.stage === "round_of_16").sort((a, b) => a.matchLabel.localeCompare(b.matchLabel)),
    quarterfinal: matches.filter((match) => match.stage === "quarterfinal").sort((a, b) => a.matchLabel.localeCompare(b.matchLabel)),
    semifinal: matches.filter((match) => match.stage === "semifinal").sort((a, b) => a.matchLabel.localeCompare(b.matchLabel)),
    final: matches.filter((match) => match.stage === "final").sort((a, b) => a.matchLabel.localeCompare(b.matchLabel)),
    third_place: matches.filter((match) => match.stage === "third_place").sort((a, b) => a.matchLabel.localeCompare(b.matchLabel)),
  };

  const x = {
    r16: 80,
    qf: 600,
    sf: 1120,
    finals: 1640,
  };
  const y = {
    bandMain: 82,
    headerMain: 198,
    r16: 250,
    qf: 358,
    sf: 573,
    finalHeader: 703,
    final: 763,
    thirdHeader: 1183,
    third: 1243,
  };

  headers.push(
    {
      id: "playoff-main-band",
      x: 80,
      y: y.bandMain,
      width: 2040,
      title: "主淘汰链",
      subtitle: "",
      tone: "cyan",
    },
    {
      id: "playoff-r16",
      x: x.r16,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "16 进 8",
      subtitle: "",
      tone: "cyan",
    },
    {
      id: "playoff-qf",
      x: x.qf,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "8 进 4",
      subtitle: "",
      tone: "cyan",
    },
    {
      id: "playoff-sf",
      x: x.sf,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "半决赛",
      subtitle: "",
      tone: "cyan",
    },
    {
      id: "playoff-final",
      x: x.finals,
      y: y.finalHeader,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "冠军战",
      subtitle: "",
      tone: "amber",
    },
    {
      id: "playoff-third",
      x: x.finals,
      y: y.thirdHeader,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "季军战",
      subtitle: "",
      tone: "amber",
    }
  );

  stageGroups.round_of_16.forEach((match, index) => addMatch(match, x.r16, y.r16 + index * PLAYOFF_MATCH_STEP));
  stageGroups.quarterfinal.forEach((match, index) => addMatch(match, x.qf, y.qf + index * PLAYOFF_MATCH_STEP * 2));
  stageGroups.semifinal.forEach((match, index) => addMatch(match, x.sf, y.sf + index * PLAYOFF_MATCH_STEP * 4));
  stageGroups.final.forEach((match) => addMatch(match, x.finals, y.final));
  stageGroups.third_place.forEach((match) => addMatch(match, x.finals, y.third));

  const mainEdges: Array<{ sources: string[]; target: string; tone: CanvasTone }> = [
    { sources: ["R16-1", "R16-2"], target: "QF-1", tone: "cyan" },
    { sources: ["R16-3", "R16-4"], target: "QF-2", tone: "cyan" },
    { sources: ["R16-5", "R16-6"], target: "QF-3", tone: "cyan" },
    { sources: ["R16-7", "R16-8"], target: "QF-4", tone: "cyan" },
    { sources: ["SF-1", "SF-2"], target: "FINAL-1", tone: "amber" },
    { sources: ["SF-1", "SF-2"], target: "THIRD-1", tone: "amber" },
  ];

  const connectors = [
    ...mainEdges.map(({ sources, target, tone }) =>
      connectCardGroupToCard(sources.map((source) => cardMap.get(source)), cardMap.get(target), `${sources.join("+")}=>${target}`, tone)
    ),
    connectCardGroupToCards(
      ["QF-1", "QF-2", "QF-3", "QF-4"].map((source) => cardMap.get(source)),
      ["SF-1", "SF-2"].map((target) => cardMap.get(target)),
      "QF-band=>SF-band",
      "cyan"
    ),
  ].filter((connector): connector is CanvasConnector => Boolean(connector));

  const maxBottom = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0);

  return {
    id: "playoff",
    label: "主淘汰赛",
    title: "主淘汰赛",
    description: "这里只保留主淘汰链，方便连续查看每一轮晋级走势；资格赛请切到上方资格赛页签查看。",
    width: 2120,
    height: Math.max(1240, maxBottom + 160),
    viewport: {
      align: "left",
      minScale: 0.76,
      paddingX: 48,
      paddingY: 48,
    },
    headers,
    cards,
    connectors,
  };
}

function buildQualificationStage(regionSlug: RegionSlug, simulation: SimulationResponse): WorkspaceStage {
  const matches = simulation.matches.filter((match) => match.stage !== "swiss");
  const qualificationRound1 = matches.filter((match) => match.matchLabel.startsWith("QUAL-1-")).sort((a, b) => a.matchLabel.localeCompare(b.matchLabel));
  const qualificationRound2 = matches.filter((match) => match.matchLabel.startsWith("QUAL-2-")).sort((a, b) => a.matchLabel.localeCompare(b.matchLabel));
  const qualificationRepechage = matches.filter((match) => match.matchLabel.startsWith("QUAL-R-")).sort((a, b) => a.matchLabel.localeCompare(b.matchLabel));
  const outcomeRows = buildQualificationOutcomeRows(simulation);
  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  const headerMap = new Map<string, WorkspaceStageHeader>();
  const headerList = (...ids: string[]) =>
    ids.map((id) => headerMap.get(id)).filter((header): header is WorkspaceStageHeader => Boolean(header));

  const addHeader = (id: string, x: number, y: number, width: number, title: string, subtitle: string, tone: CanvasTone) => {
    const header: WorkspaceStageHeader = { id, x, y, width, title, subtitle, tone };
    headers.push(header);
    headerMap.set(id, header);
    return header;
  };

  const addMatchSection = (id: string, x: number, y: number, title: string, subtitle: string, tone: CanvasTone, sectionMatches: MatchRow[]) => {
    if (!sectionMatches.length) {
      return { bottom: y };
    }
    addHeader(id, x, y, PLAYOFF_MATCH_CARD_WIDTH, title, subtitle, tone);
    sectionMatches.forEach((match, index) => {
      cards.push(
        buildMatchCard(match, x, y + STAGE_HEADER_TO_CARD_OFFSET + index * PLAYOFF_MATCH_STEP, {
          width: PLAYOFF_MATCH_CARD_WIDTH,
          height: PLAYOFF_MATCH_CARD_HEIGHT,
          variant: "playoff",
          showProbability: false,
          regionSlug,
        })
      );
    });
    return {
      bottom: y + STAGE_HEADER_TO_CARD_OFFSET + (sectionMatches.length - 1) * PLAYOFF_MATCH_STEP + PLAYOFF_MATCH_CARD_HEIGHT,
    };
  };

  const addOutcomeSection = (
    id: string,
    x: number,
    y: number,
    title: string,
    tone: CanvasTone,
    rows: QualificationOutcomeRow[],
    subtitle: string
  ) => {
    if (!rows.length) {
      return { bottom: y };
    }
    addHeader(id, x, y, DETAIL_TEAM_CARD_WIDTH, title, subtitle, tone);
    rows.forEach(({ row, sourceLabel, isSimulated, statLine }, index) => {
      cards.push(
        buildTeamCard({
          id: `${id}-${row.teamKey || `placeholder-${index + 1}`}`,
          teamKey: row.teamKey,
          collegeName: row.collegeName,
          teamName: row.teamName,
          x,
          y: y + STAGE_HEADER_TO_CARD_OFFSET + index * SUMMARY_TEAM_STEP,
          orderLabel: row.teamKey ? `${row.rank}` : `${index + 1}`,
          subtitle: row.teamName,
          statLine: statLine ?? `${sourceLabel} / ${formatSwissRecordLabel(row.swissWins, row.swissLosses)}`,
          tone,
          outcome: row.advancement === "group_eliminated" ? "eliminated" : "qualified",
          variant: "summary",
          width: DETAIL_TEAM_CARD_WIDTH,
          height: DETAIL_TEAM_CARD_HEIGHT,
          isSimulated,
        })
      );
    });
    return {
      bottom: y + STAGE_HEADER_TO_CARD_OFFSET + (rows.length - 1) * SUMMARY_TEAM_STEP + DETAIL_TEAM_CARD_HEIGHT,
    };
  };

  const stageWidth = 1560;
  const x = {
    left: 80,
    middle: 560,
    right: 1040,
  };
  const connectors: Array<CanvasConnector | null> = [];
  let maxBottom = 0;

  addHeader("qualification-band", 80, 82, 1322, "资格赛去向", "", "emerald");

  if (regionSlug === "east_region") {
    const q1RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-1");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const q2EliminatedRows = pickQualificationRows(outcomeRows, "eliminated", "qual-2");
    const q1 = addMatchSection("qualification-q1", x.left, 198, "资格赛第一轮", "", "emerald", qualificationRound1);
    const q1Repechage = addOutcomeSection(
      "qualification-q1-repechage",
      x.middle,
      198,
      "拿到复活赛席位",
      "cyan",
      q1RepechageRows,
      ""
    );
    const q2 = addMatchSection(
      "qualification-q2",
      x.middle,
      Math.max(514, q1Repechage.bottom + 96),
      "资格赛第二轮",
      "",
      "emerald",
      qualificationRound2
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      198,
      "拿到复活赛席位",
      "cyan",
      q2RepechageRows,
      ""
    );
    const q2Eliminated = addOutcomeSection(
      "qualification-q2-eliminated",
      x.right,
      Math.max(518, q2Repechage.bottom + 86),
      "本站止步",
      "steel",
      q2EliminatedRows,
      ""
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q1-repechage", "qualification-q2"),
        "qualification-q1-split",
        "emerald",
        ["胜者进复活赛", "败者进第二轮"]
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-repechage", "qualification-q2-eliminated"),
        "qualification-q2-split",
        "emerald",
        ["胜者进复活赛", "败者本站止步"]
      )
    );

    maxBottom = Math.max(q1.bottom, q1Repechage.bottom, q2.bottom, q2Repechage.bottom, q2Eliminated.bottom);
  }

  if (regionSlug === "north_region") {
    const q2NationalRows = pickQualificationRows(outcomeRows, "national", "qual-2");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const qualrRepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-r");
    const qualrEliminatedRows = pickQualificationRows(outcomeRows, "eliminated", "qual-r");
    const q1 = addMatchSection("qualification-q1", x.left, 198, "资格赛第一轮", "", "emerald", qualificationRound1);
    const q2 = addMatchSection(
      "qualification-q2",
      x.middle,
      198,
      "资格赛第二轮",
      "",
      "amber",
      qualificationRound2
    );
    const q2National = addOutcomeSection(
      "qualification-q2-national",
      x.right,
      198,
      "拿到国赛席位",
      "amber",
      q2NationalRows,
      ""
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      Math.max(518, q2National.bottom + 86),
      "拿到复活赛席位",
      "cyan",
      q2RepechageRows,
      ""
    );
    const qualr = addMatchSection(
      "qualification-qualr",
      x.middle,
      Math.max(514, q2.bottom + 96),
      "复活赛突围战",
      "",
      "cyan",
      qualificationRepechage
    );
    const qualrRepechage = addOutcomeSection(
      "qualification-qualr-repechage",
      x.right,
      Math.max(850, q2Repechage.bottom + 86),
      "拿到复活赛席位",
      "cyan",
      qualrRepechageRows,
      ""
    );
    const qualrEliminated = addOutcomeSection(
      "qualification-qualr-eliminated",
      x.right,
      Math.max(1200, qualrRepechage.bottom + 86),
      "本站止步",
      "steel",
      qualrEliminatedRows,
      ""
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q2", "qualification-qualr"),
        "qualification-q1-split",
        "emerald",
        ["胜者争国赛", "败者争复活赛"]
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-national", "qualification-q2-repechage"),
        "qualification-q2-split",
        "amber",
        ["胜者进国赛", "败者进复活赛"]
      ),
      connectHeaderBands(
        headerList("qualification-qualr"),
        headerList("qualification-qualr-repechage", "qualification-qualr-eliminated"),
        "qualification-qualr-split",
        "emerald",
        ["胜者进复活赛", "败者本站止步"]
      )
    );

    maxBottom = Math.max(q1.bottom, q2.bottom, qualr.bottom, q2National.bottom, q2Repechage.bottom, qualrRepechage.bottom, qualrEliminated.bottom);
  }

    if (regionSlug === "south_region") {
    const q1RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-1");
    const q2NationalRows = pickQualificationRows(outcomeRows, "national", "qual-2");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const q1 = addMatchSection(
      "qualification-q1",
      x.left,
      198,
      "资格赛第一轮",
      "",
      "emerald",
      qualificationRound1
    );
    const q1Repechage = addOutcomeSection(
      "qualification-q1-repechage",
      x.middle,
      198,
      "拿到复活赛席位",
      "cyan",
      q1RepechageRows,
      ""
    );
    const q2 = addMatchSection(
      "qualification-q2",
      x.middle,
      Math.max(514, q1Repechage.bottom + 96),
      "国赛席位战",
      "",
      "amber",
      qualificationRound2
    );
    const q2National = addOutcomeSection(
      "qualification-q2-national",
      x.right,
      198,
      "拿到国赛席位",
      "amber",
      q2NationalRows,
      ""
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      Math.max(518, q2National.bottom + 86),
      "拿到复活赛席位",
      "cyan",
      q2RepechageRows,
      ""
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q2", "qualification-q1-repechage"),
        "qualification-q1-split",
        "emerald",
        ["胜者争国赛", "败者进复活赛"]
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-national", "qualification-q2-repechage"),
        "qualification-q2-split",
        "amber",
        ["胜者进国赛", "败者进复活赛"]
      )
    );

    maxBottom = Math.max(q1.bottom, q1Repechage.bottom, q2.bottom, q2National.bottom, q2Repechage.bottom);
  }
  return {
    id: "qualification",
    label: "资格赛",
    title: "资格赛去向",
    description: "逐轮看清资格赛的名额变化，谁直通国赛，谁转入复活赛，谁在这里止步。",
    width: stageWidth,
    height: Math.max(1460, maxBottom + 140),
    viewport: {
      align: "left",
      minScale: 0.82,
      paddingX: 48,
      paddingY: 48,
    },
    headers,
    cards,
    connectors: connectors.filter((connector): connector is CanvasConnector => Boolean(connector)),
  };
}

function buildFinalRankingsStage(simulation: SimulationResponse): WorkspaceStage {
  const cards: CanvasCard[] = [];
  const headers: WorkspaceStageHeader[] = [
    { id: "final-podium", x: 80, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "领奖台", subtitle: "", tone: "amber" },
    { id: "final-national", x: 520, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "国赛名单", subtitle: "", tone: "amber" },
    { id: "final-repechage", x: 960, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "复活赛名单", subtitle: "", tone: "cyan" },
    { id: "final-tail", x: 1400, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "其余名次", subtitle: "", tone: "steel" },
  ];

  const podiumRows = simulation.finalRankings.filter((row) => row.rank <= 4);
  const nationalRows = simulation.finalRankings.filter((row) => row.advancement === "national_qualified");
  const repechageRows = simulation.finalRankings.filter((row) => row.advancement === "repechage_qualified");
  const tailRows = simulation.finalRankings.filter(
    (row) => row.advancement !== "national_qualified" && row.advancement !== "repechage_qualified" && row.rank > 4
  );

  const pushRows = (rows: FinalRankingRow[], x: number, tone: CanvasTone) => {
    rows.forEach((row, index) => {
      cards.push(
        buildTeamCard({
          id: `final-${x}-${row.teamKey || `rank-${row.rank}`}`,
          teamKey: row.teamKey,
          collegeName: row.collegeName,
          teamName: row.teamName,
          x,
          y: 134 + index * SUMMARY_TEAM_STEP,
          orderLabel: `${row.rank}`,
          subtitle: row.teamName,
          statLine: row.teamKey ? formatSwissRecordLabel(row.swissWins, row.swissLosses) : "最终排名待确认",
          meta: [translateFinalBucket(row.finalBucket), translateAdvancementLabel(row.advancement)],
          tone,
          variant: "ranking",
          width: DETAIL_TEAM_CARD_WIDTH,
          height: DETAIL_TEAM_CARD_HEIGHT,
        })
      );
    });
  };

  pushRows(podiumRows, 80, "amber");
  pushRows(nationalRows, 520, "amber");
  pushRows(repechageRows, 960, "cyan");
  pushRows(tailRows, 1400, "steel");

  const maxBottom = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0);

  return {
    id: "final-rankings",
    label: "最终排名",
    title: "最终排名",
    description: "把本次模拟的最终名次、瑞士轮战绩和晋级去向放在同一页回看。",
    width: 1842,
    height: Math.max(1120, maxBottom + 140),
    viewport: {
      align: "left",
      minScale: 0.68,
      paddingX: 48,
      paddingY: 48,
    },
    headers,
    cards,
    connectors: [],
  };
}

export function buildWorkspaceStage(view: WorkspaceView, regionSlug: RegionSlug, simulation: SimulationResponse): WorkspaceStage {
  if (view === "slots") {
    return buildSlotsStage(simulation);
  }
  if (view === "swiss-a") {
    return buildSwissStage("A", regionSlug, simulation, view);
  }
  if (view === "swiss-b") {
    return buildSwissStage("B", regionSlug, simulation, view);
  }
  if (view === "qualification") {
    return buildQualificationStage(regionSlug, simulation);
  }
  if (view === "playoff") {
    return buildPlayoffStage(regionSlug, simulation);
  }
  return buildFinalRankingsStage(simulation);
}
