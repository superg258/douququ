import { matchesForFinalStage } from "@/lib/finals-schedule";
import type {
  CanvasConnector,
  FinalEventMatch,
  FinalEventSchedule,
  FinalEventStageFilter,
  ScheduleCanvasCard,
  WorkspaceStage,
  WorkspaceStageHeader,
} from "@/lib/types";

const CARD_WIDTH = 320;
const CARD_HEIGHT = 164;
const COLUMN_GAP = 132;
const ROW_GAP = 34;
const START_X = 64;
const START_Y = 100;

type MatchRelation = {
  parent: FinalEventMatch;
  outcome: "winner" | "loser";
};

function relationForSlot(matches: FinalEventMatch[], match: FinalEventMatch, slot: string): MatchRelation | null {
  const earlier = matches.filter((candidate) => candidate.number < match.number).reverse();
  for (const candidate of earlier) {
    if (candidate.winnerTo === slot) return { parent: candidate, outcome: "winner" };
    if (candidate.loserTo === slot) return { parent: candidate, outcome: "loser" };
  }
  return null;
}

function swissColumnLabel(match: FinalEventMatch) {
  return match.stage
    .replace(/^\s*[AB]组瑞士轮/, "")
    .replace(/（BO\d）/g, "")
    .trim();
}

function buildColumnAssignments(matches: FinalEventMatch[], stage: FinalEventStageFilter) {
  if (stage === "swiss-a" || stage === "swiss-b") {
    const labels: string[] = [];
    return {
      columnByMatch: new Map(
        matches.map((match) => {
          const label = swissColumnLabel(match);
          if (!labels.includes(label)) labels.push(label);
          return [match.number, labels.indexOf(label)] as const;
        }),
      ),
      labels,
    };
  }

  const columnByMatch = new Map<number, number>();
  for (const match of matches) {
    const parents = [
      relationForSlot(matches, match, match.redSlot),
      relationForSlot(matches, match, match.blueSlot),
    ].filter((relation): relation is MatchRelation => relation !== null);
    const parentColumns = parents.map((relation) => columnByMatch.get(relation.parent.number) ?? 0);
    columnByMatch.set(match.number, parentColumns.length ? Math.max(...parentColumns) + 1 : 0);
  }
  const columnCount = Math.max(0, ...columnByMatch.values()) + 1;
  const fallbackLabels = stage === "final-four"
    ? ["半决赛", "奖牌争夺战"]
    : stage === "quarterfinal"
      ? ["八强起始对阵", "四强席位决战"]
      : ["起始对阵", "胜败分流", "晋级决战"];
  return {
    columnByMatch,
    labels: Array.from({ length: columnCount }, (_, index) => fallbackLabels[index] ?? `第 ${index + 1} 阶段`),
  };
}

function cardForMatch(event: FinalEventSchedule, match: FinalEventMatch, x: number, y: number): ScheduleCanvasCard {
  return {
    id: `${event.slug}:${match.number}`,
    kind: "schedule",
    eventSlug: event.slug,
    match,
    displayLabel: `第 ${match.number} 场`,
    x,
    y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    tone: match.stageKey === "final" ? "amber" : "cyan",
  };
}

export function buildFinalsWorkspaceStage(event: FinalEventSchedule, stage: FinalEventStageFilter): WorkspaceStage {
  const matches = matchesForFinalStage(event, stage);
  const { columnByMatch, labels } = buildColumnAssignments(matches, stage);
  const matchesByColumn = new Map<number, FinalEventMatch[]>();
  for (const match of matches) {
    const column = columnByMatch.get(match.number) ?? 0;
    const rows = matchesByColumn.get(column) ?? [];
    rows.push(match);
    matchesByColumn.set(column, rows);
  }

  const cardByMatch = new Map<number, ScheduleCanvasCard>();
  const cards: ScheduleCanvasCard[] = [];
  for (const [column, rows] of [...matchesByColumn.entries()].sort(([left], [right]) => left - right)) {
    rows.forEach((match, row) => {
      const card = cardForMatch(
        event,
        match,
        START_X + column * (CARD_WIDTH + COLUMN_GAP),
        START_Y + row * (CARD_HEIGHT + ROW_GAP),
      );
      cards.push(card);
      cardByMatch.set(match.number, card);
    });
  }

  const connectors: CanvasConnector[] = [];
  for (const match of matches) {
    const target = cardByMatch.get(match.number);
    if (!target) continue;
    const relations = [
      relationForSlot(matches, match, match.redSlot),
      relationForSlot(matches, match, match.blueSlot),
    ].filter((relation): relation is MatchRelation => relation !== null);
    relations.forEach((relation, index) => {
      const source = cardByMatch.get(relation.parent.number);
      if (!source) return;
      connectors.push({
        id: `${event.slug}:${relation.parent.number}:${match.number}:${relation.outcome}`,
        fromX: source.x + source.width,
        fromY: source.y + source.height / 2,
        toX: target.x,
        toY: target.y + (index === 0 ? target.height * 0.35 : target.height * 0.68),
        tone: relation.outcome === "winner" ? "emerald" : "steel",
        weight: relation.outcome === "winner" ? "strong" : "normal",
      });
    });
  }

  const headers: WorkspaceStageHeader[] = labels.map((label, column) => ({
    id: `${event.slug}:${stage}:header:${column}`,
    x: START_X + column * (CARD_WIDTH + COLUMN_GAP),
    y: 32,
    width: CARD_WIDTH,
    title: label,
    subtitle: `${matchesByColumn.get(column)?.length ?? 0} 场正式比赛`,
    tone: column === labels.length - 1 && stage === "final-four" ? "amber" : "cyan",
  }));
  const maxRows = Math.max(1, ...[...matchesByColumn.values()].map((rows) => rows.length));

  return {
    id: stage,
    label: `${event.shortName}赛程`,
    title: `${event.name} · ${labels.join(" / ")}`,
    description: "官方场序画布；抽签完成前以槽位与胜败来源展示，不生成虚构对阵或预测概率。",
    width: START_X * 2 + labels.length * CARD_WIDTH + Math.max(0, labels.length - 1) * COLUMN_GAP,
    height: START_Y + maxRows * (CARD_HEIGHT + ROW_GAP) + 40,
    viewport: { align: "left", minScale: 0.52, paddingX: 48, paddingY: 36 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}
