import {
  connectCardGroupToCard,
  connectCardGroupToCards,
} from "@/lib/canvas-builders";
import { matchesForFinalStage } from "@/lib/finals-schedule";
import type {
  CanvasCard,
  CanvasConnector,
  FinalEventMatch,
  FinalEventSchedule,
  FinalEventStageFilter,
  ScheduleCanvasCard,
  TeamCanvasCard,
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
  const isSwissStage = stage === "swiss-a" || stage === "swiss-b";
  const { columnByMatch, labels } = buildColumnAssignments(matches, stage);
  const matchesByColumn = new Map<number, FinalEventMatch[]>();
  for (const match of matches) {
    const column = columnByMatch.get(match.number) ?? 0;
    const rows = matchesByColumn.get(column) ?? [];
    rows.push(match);
    matchesByColumn.set(column, rows);
  }

  const cardByMatch = new Map<number, ScheduleCanvasCard>();
  const cards: CanvasCard[] = [];
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
  if (isSwissStage) {
    for (let column = 0; column < labels.length - 1; column += 1) {
      const sourceCards = (matchesByColumn.get(column) ?? [])
        .map((match) => cardByMatch.get(match.number))
        .filter((card): card is ScheduleCanvasCard => Boolean(card));
      const targetCards = (matchesByColumn.get(column + 1) ?? [])
        .map((match) => cardByMatch.get(match.number))
        .filter((card): card is ScheduleCanvasCard => Boolean(card));
      if (!sourceCards.length || !targetCards.length) continue;

      const poolConnector = connectCardGroupToCards(
        sourceCards,
        targetCards,
        `${event.slug}:${stage}:swiss-pool:${column}:${column + 1}`,
        "cyan",
      );
      if (poolConnector) {
        connectors.push(poolConnector);
      }
    }
  } else {
    // Group incoming relations by target match number so multiple
    // parent→child routes merge into a single grouped connector, matching
    // the visual style of region workspace playoff brackets.
    const incomingByTarget = new Map<
      number,
      Array<{ sourceCard: ScheduleCanvasCard; outcome: "winner" | "loser" }>
    >();

    for (const match of matches) {
      const target = cardByMatch.get(match.number);
      if (!target) continue;
      const relations = [
        relationForSlot(matches, match, match.redSlot),
        relationForSlot(matches, match, match.blueSlot),
      ].filter((relation): relation is MatchRelation => relation !== null);

      for (const relation of relations) {
        const source = cardByMatch.get(relation.parent.number);
        if (!source) continue;
        const sources = incomingByTarget.get(match.number) ?? [];
        sources.push({ sourceCard: source, outcome: relation.outcome });
        incomingByTarget.set(match.number, sources);
      }
    }

    for (const [targetNumber, sources] of incomingByTarget) {
      const target = cardByMatch.get(targetNumber);
      if (!target) continue;

      const sourceCards = sources.map((entry) => entry.sourceCard);
      const allWinners = sources.every((entry) => entry.outcome === "winner");
      const allLosers = sources.every((entry) => entry.outcome === "loser");
      const tone: CanvasConnector["tone"] = allWinners
        ? "emerald"
        : allLosers
          ? "steel"
          : "cyan";
      const parentNumbers = sources
        .map((entry) => entry.sourceCard.match.number)
        .join("+");

      const connector = connectCardGroupToCard(
        sourceCards,
        target,
        `${event.slug}:${parentNumbers}:${targetNumber}`,
        tone,
      );
      if (connector) {
        connectors.push({
          ...connector,
          weight: tone === "emerald" ? "strong" : connector.weight,
        });
      }
    }
  }

  // ── Terminal outcome / destination cards ──
  // Cross-reference every slot in the full event so we can tell terminal
  // destinations (e.g. "全国赛", "淘汰", "冠军") apart from feeder slots
  // that lead into the next canvas stage.
  const allEventSlots = new Set<string>();
  for (const m of event.matches) {
    allEventSlots.add(m.redSlot);
    allEventSlots.add(m.blueSlot);
  }

  // Some winnerTo / loserTo values carry stage qualifiers (e.g.
  // "胜者A（八强）") while the corresponding slot in the next stage omits
  // the suffix ("胜者A").  Normalise both sides before comparison.
  function stripStageSuffix(name: string) {
    return name.replace(/（[^）]+）$/g, "");
  }

  function isTerminalDestination(dest: string) {
    if (!dest) return false;
    if (allEventSlots.has(dest)) return false;
    const normalized = stripStageSuffix(dest);
    if (normalized === dest) return true;
    // If stripping changed the string, check whether the stripped form
    // matches any real slot in the event.
    return ![...allEventSlots].some(
      (slot) => stripStageSuffix(slot) === normalized,
    );
  }

  type TerminalGroup = {
    destination: string;
    sourceCards: ScheduleCanvasCard[];
    kind: "winner" | "loser";
  };
  const terminalGroups = new Map<string, TerminalGroup>();

  for (const match of matches) {
    const card = cardByMatch.get(match.number);
    if (!card) continue;
    if (match.winnerTo && isTerminalDestination(match.winnerTo)) {
      const key = `winner:${match.winnerTo}`;
      const g = terminalGroups.get(key) ?? {
        destination: match.winnerTo,
        sourceCards: [],
        kind: "winner",
      };
      g.sourceCards.push(card);
      terminalGroups.set(key, g);
    }
    if (match.loserTo && isTerminalDestination(match.loserTo)) {
      const key = `loser:${match.loserTo}`;
      const g = terminalGroups.get(key) ?? {
        destination: match.loserTo,
        sourceCards: [],
        kind: "loser",
      };
      g.sourceCards.push(card);
      terminalGroups.set(key, g);
    }
  }

  const TERMINAL_LABEL_MAP: Record<string, string> = {
    "全国赛": "晋级全国赛",
    "淘汰": "本站止步",
    "冠军": "冠军",
    "亚军": "亚军",
    "季军": "季军",
    "殿军": "殿军",
  };

  let outcomeColumnCount = 0;
  if (terminalGroups.size > 0) {
    outcomeColumnCount = 1;
    const outcomeColX =
      START_X + labels.length * (CARD_WIDTH + COLUMN_GAP);
    let outcomeY = START_Y;

    const sorted = [...terminalGroups.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "winner" ? -1 : 1;
      return a.destination.localeCompare(b.destination);
    });

    for (const group of sorted) {
      const count = group.sourceCards.length;
      const isAdvancement = group.kind === "winner";
      const tone: CanvasConnector["tone"] = isAdvancement
        ? "amber"
        : "steel";
      const label =
        TERMINAL_LABEL_MAP[group.destination] ?? group.destination;

      const outcomeCard: TeamCanvasCard = {
        id: `${event.slug}:${stage}:outcome:${group.destination}`,
        kind: "team",
        variant: "summary",
        teamKey: `outcome:${group.kind}:${group.destination}`,
        collegeName: label,
        teamName: `${count} 支队伍`,
        x: outcomeColX,
        y: outcomeY,
        width: CARD_WIDTH,
        height: 108,
        tone,
        orderLabel: `${count}`,
        subtitle: `${count} 支队伍`,
        statLine: isAdvancement
          ? `胜者晋级 · ${group.destination}`
          : `败者淘汰 · ${group.destination}`,
        isSimulated: false,
      };
      cards.push(outcomeCard);

      const oc = connectCardGroupToCard(
        group.sourceCards,
        outcomeCard,
        `${event.slug}:${stage}:outcome-conn:${group.destination}`,
        tone,
      );
      if (oc) {
        connectors.push({
          ...oc,
          weight: isAdvancement ? "strong" : "normal",
        });
      }

      outcomeY += 108 + ROW_GAP;
    }
  }

  const totalColumns = labels.length + outcomeColumnCount;

  const headers: WorkspaceStageHeader[] = labels.map((label, column) => ({
    id: `${event.slug}:${stage}:header:${column}`,
    x: START_X + column * (CARD_WIDTH + COLUMN_GAP),
    y: 32,
    width: CARD_WIDTH,
    title: label,
    subtitle: `${matchesByColumn.get(column)?.length ?? 0} 场正式比赛`,
    tone: column === labels.length - 1 && stage === "final-four" ? "amber" : "cyan",
  }));

  if (outcomeColumnCount > 0) {
    headers.push({
      id: `${event.slug}:${stage}:outcome-header`,
      x: START_X + labels.length * (CARD_WIDTH + COLUMN_GAP),
      y: 32,
      width: CARD_WIDTH,
      title: "最终去向",
      subtitle: `${terminalGroups.size} 个去向`,
      tone: "amber",
    });
  }
  const maxRows = Math.max(
    1,
    ...[...matchesByColumn.values()].map((rows) => rows.length),
    terminalGroups.size > 0
      ? terminalGroups.size
      : 1,
  );

  return {
    id: stage,
    label: `${event.shortName}赛程`,
    title: `${event.name} · ${labels.join(" / ")}`,
    description: isSwissStage
      ? "瑞士轮战绩池重配对流程；连线表示整轮赛果进入下一轮配对池，不预设固定的单场胜败去向。"
      : "官方场序画布；抽签完成前以槽位与胜败来源展示，不生成虚构对阵或预测概率。",
    width:
      START_X * 2 +
      totalColumns * CARD_WIDTH +
      Math.max(0, totalColumns - 1) * COLUMN_GAP,
    height: START_Y + maxRows * (CARD_HEIGHT + ROW_GAP) + 40,
    viewport: { align: "left", minScale: 0.52, paddingX: 48, paddingY: 36 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}
