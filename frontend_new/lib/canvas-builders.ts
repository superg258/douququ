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
  formatSwissRecordLabel,
  translateAdvancementLabel,
  translateFinalBucket,
  translateStageLabel,
} from "@/lib/display";

type SwissBucketKey = `${number}-${number}`;

interface SwissReplayArtifacts {
  matchBuckets: Record<string, string[]>;
  summaryBuckets: Record<string, GroupRankingRow[]>;
}

const MATCH_CARD_WIDTH = 338;
const MATCH_CARD_HEIGHT = 144;
const TEAM_CARD_WIDTH = 338;
const TEAM_CARD_HEIGHT = 88;
const DETAIL_TEAM_CARD_WIDTH = 338;
const DETAIL_TEAM_CARD_HEIGHT = 104;
const SWISS_MATCH_CARD_HEIGHT = 144;
const SWISS_MATCH_STEP = 156;
const SUMMARY_TEAM_STEP = 112;
const STAGE_HEADER_TO_CARD_OFFSET = 92;
const SWISS_SECTION_GAP = 78;
const PLAYOFF_MATCH_CARD_WIDTH = 392;
const PLAYOFF_MATCH_CARD_HEIGHT = 144;
const PLAYOFF_MATCH_STEP = 148;
const HEADER_CONNECTOR_ANCHOR_Y = 10;

type SwissSummaryId =
  | "qualified-3-0"
  | "qualified-3-1"
  | "qualified-3-2"
  | "eliminated-0-3"
  | "eliminated-1-3"
  | "eliminated-2-3";

type SwissStageColumnId = "round1" | "round2" | "round3" | "round4-band" | "round5-band" | "final-band";

type SwissStageSection =
  | {
      kind: "matches";
      id: string;
      round: number;
      bucket: SwissBucketKey;
      title: string;
      y: number;
      tone: CanvasTone;
    }
  | {
      kind: "summary";
      id: string;
      summaryId: SwissSummaryId;
      title: string;
      y: number;
      tone: CanvasTone;
    };

const SWISS_STAGE_COLUMNS: Array<{ id: SwissStageColumnId; x: number; sections: SwissStageSection[] }> = [
  {
    id: "round1",
    x: 64,
    sections: [{ kind: "matches", id: "r1-0-0", round: 1, bucket: "0-0", title: "第 1 轮 · 0-0 组", y: 184, tone: "cyan" }],
  },
  {
    id: "round2",
    x: 448,
    sections: [
      { kind: "matches", id: "r2-1-0", round: 2, bucket: "1-0", title: "第 2 轮 · 1-0 组", y: 92, tone: "cyan" },
      { kind: "matches", id: "r2-0-1", round: 2, bucket: "0-1", title: "第 2 轮 · 0-1 组", y: 700, tone: "cyan" },
    ],
  },
  {
    id: "round3",
    x: 832,
    sections: [
      { kind: "matches", id: "r3-2-0", round: 3, bucket: "2-0", title: "第 3 轮 · 2-0 组", y: 44, tone: "cyan" },
      { kind: "matches", id: "r3-1-1", round: 3, bucket: "1-1", title: "第 3 轮 · 1-1 组", y: 468, tone: "cyan" },
      { kind: "matches", id: "r3-0-2", round: 3, bucket: "0-2", title: "第 3 轮 · 0-2 组", y: 1032, tone: "cyan" },
    ],
  },
  {
    id: "round4-band",
    x: 1216,
    sections: [
      { kind: "summary", id: "qualified-3-0", summaryId: "qualified-3-0", title: "3-0 晋级", y: 44, tone: "amber" },
      { kind: "matches", id: "r4-2-1", round: 4, bucket: "2-1", title: "第 4 轮 · 2-1 组", y: 330, tone: "cyan" },
      { kind: "matches", id: "r4-1-2", round: 4, bucket: "1-2", title: "第 4 轮 · 1-2 组", y: 772, tone: "cyan" },
      { kind: "summary", id: "eliminated-0-3", summaryId: "eliminated-0-3", title: "0-3 淘汰", y: 1230, tone: "steel" },
    ],
  },
  {
    id: "round5-band",
    x: 1600,
    sections: [
      { kind: "summary", id: "qualified-3-1", summaryId: "qualified-3-1", title: "3-1 晋级", y: 132, tone: "amber" },
      { kind: "matches", id: "r5-2-2", round: 5, bucket: "2-2", title: "第 5 轮 · 2-2 组", y: 546, tone: "cyan" },
      { kind: "summary", id: "eliminated-1-3", summaryId: "eliminated-1-3", title: "1-3 淘汰", y: 1018, tone: "steel" },
    ],
  },
  {
    id: "final-band",
    x: 1984,
    sections: [
      { kind: "summary", id: "qualified-3-2", summaryId: "qualified-3-2", title: "3-2 晋级", y: 300, tone: "amber" },
      { kind: "summary", id: "eliminated-2-3", summaryId: "eliminated-2-3", title: "2-3 淘汰", y: 780, tone: "steel" },
    ],
  },
];

const SWISS_STAGE_FLOWS: Array<{ sourceId: string; targetIds: string[]; tone: CanvasTone }> = [
  { sourceId: "r1-0-0", targetIds: ["r2-1-0", "r2-0-1"], tone: "cyan" },
  { sourceId: "r2-1-0", targetIds: ["r3-2-0", "r3-1-1"], tone: "cyan" },
  { sourceId: "r2-0-1", targetIds: ["r3-1-1", "r3-0-2"], tone: "cyan" },
  { sourceId: "r3-2-0", targetIds: ["qualified-3-0", "r4-2-1"], tone: "amber" },
  { sourceId: "r3-1-1", targetIds: ["r4-2-1", "r4-1-2"], tone: "cyan" },
  { sourceId: "r3-0-2", targetIds: ["r4-1-2", "eliminated-0-3"], tone: "steel" },
  { sourceId: "r4-2-1", targetIds: ["qualified-3-1", "r5-2-2"], tone: "amber" },
  { sourceId: "r4-1-2", targetIds: ["r5-2-2", "eliminated-1-3"], tone: "steel" },
  { sourceId: "r5-2-2", targetIds: ["qualified-3-2", "eliminated-2-3"], tone: "amber" },
];

function splitScoreline(scoreline: string) {
  const [left = "0", right = "0"] = scoreline.split(":");
  return [left, right] as const;
}

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
  }
): MatchCanvasCard {
  const [redScore, blueScore] = splitScoreline(match.scoreline);
  return {
    id: match.matchLabel,
    kind: "match",
    x,
    y,
    width: options?.width ?? MATCH_CARD_WIDTH,
    height: options?.height ?? MATCH_CARD_HEIGHT,
    tone: stageTone(match.stage),
    orderLabel: options?.orderLabel ?? compactMatchCode(match.matchLabel),
    displayLabel: options?.displayLabel ?? match.matchLabel,
    metaLabel: options?.metaLabel ?? stageMeta(match),
    variant: options?.variant ?? "standard",
    showProbability: options?.showProbability ?? true,
    match,
    redSide: {
      teamKey: match.redTeam.teamKey,
      collegeName: match.redTeam.collegeName,
      teamName: match.redTeam.teamName,
      score: redScore,
      probability: match.pSeriesRed,
      side: "red",
      isWinner: match.winnerTeamKey === match.redTeam.teamKey,
    },
    blueSide: {
      teamKey: match.blueTeam.teamKey,
      collegeName: match.blueTeam.collegeName,
      teamName: match.blueTeam.teamName,
      score: blueScore,
      probability: match.pSeriesBlue,
      side: "blue",
      isWinner: match.winnerTeamKey === match.blueTeam.teamKey,
    },
  };
}

function buildTeamCard({
  id,
  teamKey,
  collegeName,
  teamName,
  x,
  y,
  tone = "steel",
  variant = "team",
  orderLabel,
  subtitle,
  statLine,
  meta,
  width,
  height,
}: {
  id: string;
  teamKey: string;
  collegeName: string;
  teamName: string;
  x: number;
  y: number;
  tone?: CanvasTone;
  variant?: TeamCanvasCard["variant"];
  orderLabel?: string;
  subtitle?: string;
  statLine?: string;
  meta?: string[];
  width?: number;
  height?: number;
}): TeamCanvasCard {
  return {
    id,
    kind: "team",
    variant,
    teamKey,
    collegeName,
    teamName,
    x,
    y,
    width: width ?? TEAM_CARD_WIDTH,
    height: height ?? TEAM_CARD_HEIGHT,
    tone,
    orderLabel,
    subtitle,
    statLine,
    meta,
  };
}

function cardLeftMid(card: CanvasCard) {
  return { x: card.x - 6, y: card.y + card.height / 2 };
}

function connectHeaderBands(
  sourceHeaders: WorkspaceStageHeader[],
  targetHeaders: WorkspaceStageHeader[],
  id: string,
  tone: CanvasTone = "steel"
): CanvasConnector | null {
  if (!sourceHeaders.length || !targetHeaders.length) {
    return null;
  }

  const sourceRight = Math.max(...sourceHeaders.map((header) => header.x + header.width));
  const sourceY =
    sourceHeaders.reduce((sum, header) => sum + header.y + HEADER_CONNECTOR_ANCHOR_Y, 0) /
    sourceHeaders.length;
  const targetLeft = Math.min(...targetHeaders.map((header) => header.x));
  const targetY =
    targetHeaders.reduce((sum, header) => sum + header.y + HEADER_CONNECTOR_ANCHOR_Y, 0) /
    targetHeaders.length;
  const gap = Math.max(18, targetLeft - sourceRight);

  return {
    id,
    kind: "bracket",
    fromX: sourceRight + 6,
    fromY: sourceY,
    toX: targetLeft - 12,
    toY: targetY,
    viaX: sourceRight + Math.max(18, Math.min(36, gap * 0.5)),
    branchY: targetHeaders.map((header) => header.y + HEADER_CONNECTOR_ANCHOR_Y),
    tone,
    weight: tone === "amber" ? "strong" : "normal",
  };
}

function connectCardGroupToCard(
  sourceCards: Array<CanvasCard | undefined>,
  targetCard: CanvasCard | undefined,
  id: string,
  tone: CanvasTone = "steel"
): CanvasConnector | null {
  const resolvedSources = sourceCards.filter((card): card is CanvasCard => Boolean(card));
  if (!resolvedSources.length || !targetCard) {
    return null;
  }

  const fromX = Math.max(...resolvedSources.map((card) => card.x + card.width)) + 6;
  const branchY = resolvedSources.map((card) => card.y + card.height / 2);
  const to = cardLeftMid(targetCard);
  const gap = Math.max(24, to.x - fromX);

  return {
    id,
    kind: "merge",
    fromX,
    fromY: branchY.reduce((sum, y) => sum + y, 0) / branchY.length,
    toX: to.x,
    toY: to.y,
    viaX: fromX + Math.max(24, Math.min(88, gap * 0.42)),
    branchY,
    tone,
    weight: tone === "amber" ? "strong" : "normal",
  };
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

  const state = new Map<string, { wins: number; losses: number }>();
  const matchBuckets: Record<string, string[]> = {};
  const teamBuckets: Record<string, string[]> = {
    "qualified-3-0": [],
    "qualified-3-1": [],
    "qualified-3-2": [],
    "eliminated-0-3": [],
    "eliminated-1-3": [],
    "eliminated-2-3": [],
  };

  const ensureState = (teamKey: string) => {
    if (!state.has(teamKey)) {
      state.set(teamKey, { wins: 0, losses: 0 });
    }
    return state.get(teamKey)!;
  };

  for (const match of groupMatches) {
    const redState = ensureState(match.redTeam.teamKey);
    const blueState = ensureState(match.blueTeam.teamKey);
    const bucketKey = `${match.roundNumber}:${redState.wins}-${redState.losses}`;
    matchBuckets[bucketKey] ??= [];
    matchBuckets[bucketKey].push(match.matchLabel);

    redState.wins += match.winnerTeamKey === match.redTeam.teamKey ? 1 : 0;
    redState.losses += match.winnerTeamKey === match.redTeam.teamKey ? 0 : 1;
    blueState.wins += match.winnerTeamKey === match.blueTeam.teamKey ? 1 : 0;
    blueState.losses += match.winnerTeamKey === match.blueTeam.teamKey ? 0 : 1;

    for (const [teamKey, teamState] of [
      [match.redTeam.teamKey, redState],
      [match.blueTeam.teamKey, blueState],
    ] as const) {
      if (teamState.wins === 3) {
        teamBuckets[`qualified-3-${teamState.losses}`].push(teamKey);
      }
      if (teamState.losses === 3) {
        teamBuckets[`eliminated-${teamState.wins}-3`].push(teamKey);
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

  return { matchBuckets, summaryBuckets };
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
}

function buildQualificationOutcomeRows(simulation: SimulationResponse) {
  const rowsByKey = new Map(simulation.finalRankings.map((row) => [row.teamKey, row]));
  const outcomes: Record<QualificationOutcomeKey, QualificationOutcomeRow[]> = {
    national: [],
    repechage: [],
    eliminated: [],
  };
  const seen = new Set<string>();

  const pushOutcome = (
    teamKey: string,
    bucket: QualificationOutcomeKey,
    sourceLabel: string,
    sourceStage: QualificationSourceStage
  ) => {
    const row = rowsByKey.get(teamKey);
    if (!row) {
      return;
    }
    const id = `${bucket}:${teamKey}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    outcomes[bucket].push({ row, sourceLabel, sourceStage });
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

      if (match.winnerNext === "national_qualified") {
        pushOutcome(match.winnerTeamKey, "national", `${stagePrefix}胜者`, sourceStage);
      }
      if (match.loserNext === "national_qualified") {
        pushOutcome(match.loserTeamKey, "national", `${stagePrefix}负者`, sourceStage);
      }
      if (match.winnerNext === "repechage_qualified") {
        pushOutcome(match.winnerTeamKey, "repechage", `${stagePrefix}胜者`, sourceStage);
      }
      if (match.loserNext === "repechage_qualified") {
        pushOutcome(match.loserTeamKey, "repechage", `${stagePrefix}负者`, sourceStage);
      }
      if (match.winnerNext === "eliminated") {
        pushOutcome(match.winnerTeamKey, "eliminated", `${stagePrefix}胜者`, sourceStage);
      }
      if (match.loserNext === "eliminated") {
        pushOutcome(match.loserTeamKey, "eliminated", `${stagePrefix}负者`, sourceStage);
      }
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
      width: 380,
      title: `${groupName} 组抽签落位`,
      subtitle: `${slots.length} 支队伍`,
      tone: "steel",
    });
    slots.forEach((slot, index) => {
      cards.push(
        buildTeamCard({
          id: `slot-${slot.teamKey}`,
          teamKey: slot.teamKey,
          collegeName: slot.collegeName,
          teamName: slot.teamName,
          x,
          y: 182 + index * 96,
          orderLabel: slot.slot ?? "--",
          subtitle: slot.teamName,
          statLine: `${slot.seedTier} / Elo #${slot.eloGlobalRank}`,
          tone: "steel",
        })
      );
    });
  });

  return {
    id: "slots",
    label: "抽签落位",
    title: "小组抽签落位",
    description: "先看两组抽签位置、种子档位与 Elo 顺位，再进入后续赛程。",
    width: 1160,
    height: 1040,
    headers,
    cards,
    connectors: [],
  };
}

function buildSwissStage(groupName: "A" | "B", simulation: SimulationResponse, view: WorkspaceView): WorkspaceStage {
  const artifacts = replaySwissBuckets(simulation, groupName);
  const matchMap = new Map(simulation.matches.map((match) => [match.matchLabel, match]));
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
          subtitle: `${matchLabels.length} 场对阵`,
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
              displayLabel: `第 ${index + 1} 场`,
              metaLabel: `BO${match.bestOf}`,
              height: SWISS_MATCH_CARD_HEIGHT,
              variant: "compact",
              showProbability: true,
            })
          );
        });
        nextSectionBottom =
          sectionY + STAGE_HEADER_TO_CARD_OFFSET + (matchLabels.length - 1) * SWISS_MATCH_STEP + SWISS_MATCH_CARD_HEIGHT;
        return;
      }

      const rows = artifacts.summaryBuckets[section.summaryId] ?? [];
      if (!rows.length) {
        return;
      }

      const sectionY = nextSectionBottom ? Math.max(section.y, nextSectionBottom + SWISS_SECTION_GAP) : section.y;
      const header: WorkspaceStageHeader = {
        id: `${groupName}-${section.id}`,
        x: column.x,
        y: sectionY,
        width: DETAIL_TEAM_CARD_WIDTH,
        title: section.title,
        subtitle: `${rows.length} 支队伍`,
        tone: section.tone,
      };
      headers.push(header);
      headersBySection.set(section.id, header);

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
    width: 2398,
    height: Math.max(1560, maxBottom + 116),
    viewport: {
      align: "left",
      minScale: 0.68,
      paddingX: 48,
      paddingY: 48,
    },
    headers,
    cards,
    connectors,
  };
}

function buildPlayoffStage(_regionSlug: RegionSlug, simulation: SimulationResponse): WorkspaceStage {
  const matches = simulation.matches.filter((match) => match.stage !== "swiss");
  const cards: CanvasCard[] = [];
  const headers: WorkspaceStageHeader[] = [];
  const cardMap = new Map<string, CanvasCard>();

  const addMatch = (match: MatchRow, x: number, y: number) => {
    const card = buildMatchCard(match, x, y, {
      width: PLAYOFF_MATCH_CARD_WIDTH,
      height: PLAYOFF_MATCH_CARD_HEIGHT,
      variant: "playoff",
      showProbability: true,
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
    qf: 540,
    sf: 1000,
    finals: 1460,
  };
  const y = {
    bandMain: 82,
    headerMain: 198,
    r16: 300,
    qf: 374,
    sf: 522,
    finalHeader: 316,
    final: 412,
    thirdHeader: 742,
    third: 838,
  };

  headers.push(
    {
      id: "playoff-main-band",
      x: 80,
      y: y.bandMain,
      width: 1772,
      title: "主淘汰链",
      subtitle: "从 16 进 8 一路打到冠军战与季军战",
      tone: "cyan",
    },
    {
      id: "playoff-r16",
      x: x.r16,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "16 进 8",
      subtitle: `${stageGroups.round_of_16.length} 场 / 败者转入资格赛`,
      tone: "cyan",
    },
    {
      id: "playoff-qf",
      x: x.qf,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "8 进 4",
      subtitle: `${stageGroups.quarterfinal.length} 场 / 败者锁定国赛席位`,
      tone: "cyan",
    },
    {
      id: "playoff-sf",
      x: x.sf,
      y: y.headerMain,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "半决赛",
      subtitle: `${stageGroups.semifinal.length} 场 / 胜者进冠军战，败者进季军战`,
      tone: "cyan",
    },
    {
      id: "playoff-final",
      x: x.finals,
      y: y.finalHeader,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "冠军战",
      subtitle: "半决赛胜者会师",
      tone: "amber",
    },
    {
      id: "playoff-third",
      x: x.finals,
      y: y.thirdHeader,
      width: PLAYOFF_MATCH_CARD_WIDTH,
      title: "季军战",
      subtitle: "半决赛败者再战",
      tone: "amber",
    }
  );

  stageGroups.round_of_16.forEach((match, index) => addMatch(match, x.r16, y.r16 + index * PLAYOFF_MATCH_STEP));
  stageGroups.quarterfinal.forEach((match, index) => addMatch(match, x.qf, y.qf + index * PLAYOFF_MATCH_STEP * 2));
  stageGroups.semifinal.forEach((match, index) => addMatch(match, x.sf, y.sf + index * PLAYOFF_MATCH_STEP * 3));
  stageGroups.final.forEach((match) => addMatch(match, x.finals, y.final));
  stageGroups.third_place.forEach((match) => addMatch(match, x.finals, y.third));

  const mainEdges: Array<{ sources: string[]; target: string; tone: CanvasTone }> = [
    { sources: ["R16-1", "R16-2"], target: "QF-1", tone: "cyan" },
    { sources: ["R16-3", "R16-4"], target: "QF-2", tone: "cyan" },
    { sources: ["R16-5", "R16-6"], target: "QF-3", tone: "cyan" },
    { sources: ["R16-7", "R16-8"], target: "QF-4", tone: "cyan" },
    { sources: ["QF-1", "QF-2"], target: "SF-1", tone: "cyan" },
    { sources: ["QF-3", "QF-4"], target: "SF-2", tone: "cyan" },
    { sources: ["SF-1", "SF-2"], target: "FINAL-1", tone: "amber" },
    { sources: ["SF-1", "SF-2"], target: "THIRD-1", tone: "amber" },
  ];

  const connectors = mainEdges
    .map(({ sources, target, tone }) =>
      connectCardGroupToCard(sources.map((source) => cardMap.get(source)), cardMap.get(target), `${sources.join("+")}=>${target}`, tone)
    )
    .filter((connector): connector is CanvasConnector => Boolean(connector));

  const maxBottom = cards.reduce((max, card) => Math.max(max, card.y + card.height), 0);

  return {
    id: "playoff",
    label: "主淘汰赛",
    title: "主淘汰赛",
    description: "这里只保留主淘汰链，方便连续查看每一轮晋级走势；资格赛请切到上方资格赛页签查看。",
    width: 1938,
    height: Math.max(1240, maxBottom + 140),
    viewport: {
      align: "left",
      minScale: 0.74,
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
          showProbability: true,
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
    rows.forEach(({ row, sourceLabel }, index) => {
      cards.push(
        buildTeamCard({
          id: `${id}-${row.teamKey}`,
          teamKey: row.teamKey,
          collegeName: row.collegeName,
          teamName: row.teamName,
          x,
          y: y + STAGE_HEADER_TO_CARD_OFFSET + index * SUMMARY_TEAM_STEP,
          orderLabel: `${row.rank}`,
          subtitle: row.teamName,
          statLine: `${sourceLabel} / ${formatSwissRecordLabel(row.swissWins, row.swissLosses)}`,
          tone,
          variant: "summary",
          width: DETAIL_TEAM_CARD_WIDTH,
          height: DETAIL_TEAM_CARD_HEIGHT,
        })
      );
    });
    return {
      bottom: y + STAGE_HEADER_TO_CARD_OFFSET + (rows.length - 1) * SUMMARY_TEAM_STEP + DETAIL_TEAM_CARD_HEIGHT,
    };
  };

  const stageWidth = 1518;
  const x = {
    left: 80,
    middle: 560,
    right: 1040,
  };
  const connectors: Array<CanvasConnector | null> = [];
  let maxBottom = 0;

  addHeader("qualification-band", 80, 82, 1322, "资格赛去向", "每一轮结束后都会即时标出继续前进、转入复活赛或就此止步的队伍。", "emerald");

  if (regionSlug === "east_region") {
    const q1RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-1");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const q2EliminatedRows = pickQualificationRows(outcomeRows, "eliminated", "qual-2");
    const q1 = addMatchSection("qualification-q1", x.left, 198, "资格赛第一轮", "4 场 / 胜者先拿到复活赛席位，败者进入第二轮", "emerald", qualificationRound1);
    const q1Repechage = addOutcomeSection(
      "qualification-q1-repechage",
      x.middle,
      198,
      "拿到复活赛席位",
      "emerald",
      q1RepechageRows,
      `${q1RepechageRows.length} 队 / 来自资格赛第一轮胜者`
    );
    const q2 = addMatchSection(
      "qualification-q2",
      x.middle,
      Math.max(514, q1Repechage.bottom + 96),
      "资格赛第二轮",
      "2 场 / 决出剩余复活赛席位与止步队伍",
      "emerald",
      qualificationRound2
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      198,
      "拿到复活赛席位",
      "emerald",
      q2RepechageRows,
      `${q2RepechageRows.length} 队 / 来自资格赛第二轮胜者`
    );
    const q2Eliminated = addOutcomeSection(
      "qualification-q2-eliminated",
      x.right,
      Math.max(518, q2Repechage.bottom + 86),
      "本站止步",
      "steel",
      q2EliminatedRows,
      `${q2EliminatedRows.length} 队 / 来自资格赛第二轮败者`
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q1-repechage", "qualification-q2"),
        "qualification-q1-split",
        "emerald"
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-repechage", "qualification-q2-eliminated"),
        "qualification-q2-split",
        "emerald"
      )
    );

    maxBottom = Math.max(q1.bottom, q1Repechage.bottom, q2.bottom, q2Repechage.bottom, q2Eliminated.bottom);
  }

  if (regionSlug === "north_region") {
    const q1RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-1");
    const q2NationalRows = pickQualificationRows(outcomeRows, "national", "qual-2");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const q1 = addMatchSection("qualification-q1", x.left, 198, "资格赛第一轮", "4 场 / 败者先进入复活赛，胜者继续争夺国赛", "emerald", qualificationRound1);
    const q1Repechage = addOutcomeSection(
      "qualification-q1-repechage",
      x.middle,
      198,
      "拿到复活赛席位",
      "emerald",
      q1RepechageRows,
      `${q1RepechageRows.length} 队 / 来自资格赛第一轮败者`
    );
    const q2 = addMatchSection(
      "qualification-q2",
      x.middle,
      Math.max(514, q1Repechage.bottom + 96),
      "资格赛第二轮",
      "2 场 / 直接分出国赛与复活赛",
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
      `${q2NationalRows.length} 队 / 来自资格赛第二轮胜者`
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      Math.max(518, q2National.bottom + 86),
      "拿到复活赛席位",
      "emerald",
      q2RepechageRows,
      `${q2RepechageRows.length} 队 / 来自资格赛第二轮败者`
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q1-repechage", "qualification-q2"),
        "qualification-q1-split",
        "emerald"
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-national", "qualification-q2-repechage"),
        "qualification-q2-split",
        "amber"
      )
    );

    maxBottom = Math.max(q1.bottom, q1Repechage.bottom, q2.bottom, q2National.bottom, q2Repechage.bottom);
  }

  if (regionSlug === "south_region") {
    const q2NationalRows = pickQualificationRows(outcomeRows, "national", "qual-2");
    const q2RepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-2");
    const qualrRepechageRows = pickQualificationRows(outcomeRows, "repechage", "qual-r");
    const qualrEliminatedRows = pickQualificationRows(outcomeRows, "eliminated", "qual-r");
    const q1 = addMatchSection(
      "qualification-q1",
      x.left,
      198,
      "资格赛第一轮",
      "4 场 / 胜者去争国赛，败者去争复活赛",
      "emerald",
      qualificationRound1
    );
    const q2 = addMatchSection("qualification-q2", x.middle, 198, "国赛席位战", "2 场 / 胜者拿到国赛，败者转入复活赛", "amber", qualificationRound2);
    const q2National = addOutcomeSection(
      "qualification-q2-national",
      x.right,
      198,
      "拿到国赛席位",
      "amber",
      q2NationalRows,
      `${q2NationalRows.length} 队 / 来自国赛席位战胜者`
    );
    const q2Repechage = addOutcomeSection(
      "qualification-q2-repechage",
      x.right,
      Math.max(518, q2National.bottom + 86),
      "拿到复活赛席位",
      "emerald",
      q2RepechageRows,
      `${q2RepechageRows.length} 队 / 来自国赛席位战败者`
    );
    const qualr = addMatchSection(
      "qualification-qualr",
      x.middle,
      Math.max(894, q2.bottom + 120),
      "复活赛席位战",
      "2 场 / 胜者保留希望，败者就此止步",
      "emerald",
      qualificationRepechage
    );
    const qualrRepechage = addOutcomeSection(
      "qualification-qualr-repechage",
      x.right,
      Math.max(972, q2Repechage.bottom + 160),
      "拿到复活赛席位",
      "emerald",
      qualrRepechageRows,
      `${qualrRepechageRows.length} 队 / 来自复活赛席位战胜者`
    );
    const qualrEliminated = addOutcomeSection(
      "qualification-qualr-eliminated",
      x.right,
      Math.max(1292, qualrRepechage.bottom + 86),
      "本站止步",
      "steel",
      qualrEliminatedRows,
      `${qualrEliminatedRows.length} 队 / 来自复活赛席位战败者`
    );

    connectors.push(
      connectHeaderBands(
        headerList("qualification-q1"),
        headerList("qualification-q2", "qualification-qualr"),
        "qualification-q1-split",
        "emerald"
      ),
      connectHeaderBands(
        headerList("qualification-q2"),
        headerList("qualification-q2-national", "qualification-q2-repechage"),
        "qualification-q2-split",
        "amber"
      ),
      connectHeaderBands(
        headerList("qualification-qualr"),
        headerList("qualification-qualr-repechage", "qualification-qualr-eliminated"),
        "qualification-qualr-split",
        "emerald"
      )
    );

    maxBottom = Math.max(
      q1.bottom,
      q2.bottom,
      q2National.bottom,
      q2Repechage.bottom,
      qualr.bottom,
      qualrRepechage.bottom,
      qualrEliminated.bottom
    );
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
      minScale: 0.72,
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
    { id: "final-podium", x: 80, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "领奖台", subtitle: "前四名次", tone: "amber" },
    { id: "final-national", x: 520, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "国赛名单", subtitle: "直接晋级队伍", tone: "amber" },
    { id: "final-repechage", x: 960, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "复活赛名单", subtitle: "保留希望队伍", tone: "emerald" },
    { id: "final-tail", x: 1400, y: 82, width: DETAIL_TEAM_CARD_WIDTH, title: "其余名次", subtitle: "未晋级队伍", tone: "steel" },
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
          id: `final-${x}-${row.teamKey}`,
          teamKey: row.teamKey,
          collegeName: row.collegeName,
          teamName: row.teamName,
          x,
          y: 182 + index * SUMMARY_TEAM_STEP,
          orderLabel: `${row.rank}`,
          subtitle: row.teamName,
          statLine: formatSwissRecordLabel(row.swissWins, row.swissLosses),
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
  pushRows(repechageRows, 960, "emerald");
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
      minScale: 0.62,
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
    return buildSwissStage("A", simulation, view);
  }
  if (view === "swiss-b") {
    return buildSwissStage("B", simulation, view);
  }
  if (view === "qualification") {
    return buildQualificationStage(regionSlug, simulation);
  }
  if (view === "playoff") {
    return buildPlayoffStage(regionSlug, simulation);
  }
  return buildFinalRankingsStage(simulation);
}
