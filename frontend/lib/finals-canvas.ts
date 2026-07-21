import {
  connectCardGroupToCard,
  connectCardGroupToCards,
  connectHeaderBands,
  officialPlaceholderSwissBucket,
  SWISS_OFFICIAL_PLACEHOLDER_SUMMARY_COUNTS,
  SWISS_STAGE_COLUMNS,
  SWISS_STAGE_FLOWS,
} from "@/lib/canvas-builders";
import {
  buildRepechageSwissFlow,
  matchesForFinalStage,
} from "@/lib/finals-schedule";
import { buildFinalsMatchCard } from "@/lib/finals-match-adapter";
import type { FinalsEventSimulation } from "@/lib/finals-simulation";
import { swissFlowPlaceholderTeams, swissRecordBucketTeams } from "@/lib/finals-simulation";
import type {
  CanvasCard,
  CanvasConnector,
  FinalEventMatch,
  FinalEventSchedule,
  FinalEventStageFilter,
  MatchCanvasCard,
  SimulatedFinalTeam,
  TeamCanvasCard,
  TeamCardSimulationKey,
  WorkspaceStage,
  WorkspaceStageHeader,
} from "@/lib/types";

const CARD_WIDTH = 400;
const CARD_HEIGHT = 188;
const COLUMN_GAP = 46;
const ROW_GAP = 27;
const START_X = 64;
const START_Y = 120;
const HEADER_TO_CARD_GAP = 20;
const HEADER_HEIGHT = 48;
const FLOW_TEAM_CARD_HEIGHT = 128;
const FLOW_TEAM_STEP = 148;
const FLOW_HEADER_TO_CARD_OFFSET = 52;
const FLOW_SECTION_GAP = 88;

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
  const label = match.stage
    .replace(/^\s*[AB]组瑞士轮/, "")
    .replace(/（BO\d）/g, "")
    .trim();
  const roundLabel: Record<string, string> = {
    第一轮: "第 1 轮",
    第二轮: "第 2 轮",
    第三轮: "第 3 轮",
    第四轮: "第 4 轮",
    第五轮: "第 5 轮",
  };
  return roundLabel[label] ?? label;
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
      ? ["四强起始对阵", "败者组分流", "四强席位决战"]
      : stage === "round-of-16"
        ? ["十六强首轮", "胜败分流", "八强席位决战"]
        : stage === "qualification"
          ? ["名额赛首轮", "败者组分流", "全国赛席位决战"]
          : ["起始对阵", "胜败分流", "晋级决战"];
  return {
    columnByMatch,
    labels: Array.from({ length: columnCount }, (_, index) => fallbackLabels[index] ?? `第 ${index + 1} 阶段`),
  };
}

function cardForMatch(
  event: FinalEventSchedule,
  match: FinalEventMatch,
  x: number,
  y: number,
  simulation?: FinalsEventSimulation | null,
): MatchCanvasCard {
  return buildFinalsMatchCard(event, match, x, y, simulation?.matchResults.get(match.number) ?? null);
}

function buildOutcomeAwareEliminationConnectors(
  matches: FinalEventMatch[],
  cardByMatch: Map<number, MatchCanvasCard>,
) {
  const connectors: CanvasConnector[] = [];

  for (const match of matches) {
    const target = cardByMatch.get(match.number);
    if (!target) continue;

    const relations = [
      relationForSlot(matches, match, match.redSlot),
      relationForSlot(matches, match, match.blueSlot),
    ].filter((relation): relation is MatchRelation => relation !== null);

    for (const outcome of ["winner", "loser"] as const) {
      const sources = relations
        .filter((relation) => relation.outcome === outcome)
        .map((relation) => cardByMatch.get(relation.parent.number))
        .filter((card): card is MatchCanvasCard => Boolean(card));
      if (!sources.length) continue;

      const tone: CanvasConnector["tone"] = outcome === "winner" ? "emerald" : "steel";
      const connector = connectCardGroupToCard(
        sources,
        target,
        `${sources.map((source) => source.match.regionalMatchNumber).join("+")}:${outcome}:${match.number}`,
        tone,
      );
      if (!connector) continue;

      connectors.push({
        ...connector,
        // When one match receives both a winner and a loser, offset the
        // loser trunk so the two route meanings stay visibly distinct.
        viaX: (connector.viaX ?? connector.fromX) + (outcome === "loser" ? 18 : 0),
        // Regional canvas language keeps every route solid: winner routes
        // stay emerald/strong, loser drops stay steel/normal — the same
        // style as the elimination-terminal connectors.
        weight: outcome === "winner" ? "strong" : "normal",
      });
    }
  }

  return connectors;
}

function destinationOrderLabel(destination: string, fallback: number) {
  const normalized = destination.replace(/（[^）]+）$/g, "").replace(/^胜者/, "").trim();
  return normalized && normalized !== destination ? normalized : `${fallback}`;
}

function buildRepechageQualificationStage(
  event: FinalEventSchedule,
  matches: FinalEventMatch[],
  stage: FinalEventStageFilter,
  simulation?: FinalsEventSimulation | null,
): WorkspaceStage {
  const orderedMatches = [...matches].sort((left, right) => left.number - right.number);
  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  const connectors: CanvasConnector[] = [];
  const cardByMatch = new Map<number, MatchCanvasCard>();
  const columnStep = CARD_WIDTH + COLUMN_GAP;
  const matchStep = CARD_HEIGHT + ROW_GAP;
  const topHeaderY = Math.max(32, START_Y - HEADER_HEIGHT - HEADER_TO_CARD_GAP);
  const columnX = (column: number) => START_X + column * columnStep;
  const sortByNumber = (rows: FinalEventMatch[]) => [...rows].sort((left, right) => left.number - right.number);

  const firstRoundMatches = orderedMatches.filter((match) => (
    !relationForSlot(orderedMatches, match, match.redSlot)
    && !relationForSlot(orderedMatches, match, match.blueSlot)
  ));
  const secondRoundMatches = orderedMatches.filter((match) => match.stage.includes("败者组第一轮"));
  const thirdRoundMatches = orderedMatches.filter((match) => (
    match.stage.includes("胜者组") && !match.stage.includes("败者组")
  ));
  const fourthRoundMatches = orderedMatches.filter((match) => match.stage.includes("败者组第二轮"));
  const assignedMatchNumbers = new Set([
    ...firstRoundMatches,
    ...secondRoundMatches,
    ...thirdRoundMatches,
    ...fourthRoundMatches,
  ].map((match) => match.number));
  const unclassifiedMatches = orderedMatches.filter((match) => !assignedMatchNumbers.has(match.number));
  fourthRoundMatches.push(...unclassifiedMatches);

  const addHeader = (
    id: string,
    x: number,
    y: number,
    title: string,
    subtitle: string,
    tone: CanvasConnector["tone"],
  ) => {
    headers.push({ id, x, y, width: CARD_WIDTH, title, subtitle, tone });
  };

  const addMatchSection = (
    id: string,
    x: number,
    y: number,
    title: string,
    sectionMatches: FinalEventMatch[],
    subtitle: string,
    tone: CanvasConnector["tone"],
  ) => {
    const rows = sortByNumber(sectionMatches);
    if (!rows.length) return { bottom: y, cards: [] as MatchCanvasCard[] };
    addHeader(
      `${event.slug}:${stage}:qualification:${id}:header`,
      x,
      y,
      title,
      subtitle,
      tone,
    );
    const sectionCards = rows.map((match, index) => {
      const card = cardForMatch(
        event,
        match,
        x,
        y + HEADER_HEIGHT + HEADER_TO_CARD_GAP + index * matchStep,
        simulation,
      );
      cards.push(card);
      cardByMatch.set(match.number, card);
      return card;
    });
    return {
      bottom: sectionCards.at(-1)!.y + CARD_HEIGHT,
      cards: sectionCards,
    };
  };

  const addOutcomeSection = ({
    id,
    x,
    y,
    title,
    subtitle,
    sourceMatches,
    sourceOutcome,
    destination,
    statLine,
    tone,
  }: {
    id: string;
    x: number;
    y: number;
    title: string;
    subtitle: string;
    sourceMatches: FinalEventMatch[];
    sourceOutcome: "winner" | "loser";
    destination: string;
    statLine: string;
    tone: CanvasConnector["tone"];
  }) => {
    const sourceCards = sortByNumber(sourceMatches)
      .filter((match) => (
        sourceOutcome === "winner"
          ? match.winnerTo === destination
          : match.loserTo === destination
      ))
      .map((match) => cardByMatch.get(match.number))
      .filter((card): card is MatchCanvasCard => Boolean(card));
    if (!sourceCards.length) return { bottom: y, cards: [] as TeamCanvasCard[] };

    addHeader(
      `${event.slug}:${stage}:qualification-flow:${id}:header`,
      x,
      y,
      title,
      `${sourceCards.length} 队 · ${subtitle}`,
      tone,
    );
    const outcomeCards = sourceCards.map((sourceCard, index): TeamCanvasCard => {
      const card: TeamCanvasCard = {
        id: `${event.slug}:${stage}:qualification-flow:${id}:${index + 1}`,
        kind: "team",
        variant: "summary",
        teamKey: "",
        collegeName: "待确认",
        teamName: "学校队伍待确认",
        x,
        y: y + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
        width: CARD_WIDTH,
        height: FLOW_TEAM_CARD_HEIGHT,
        tone,
        orderLabel: `${index + 1}`,
        subtitle: title,
        statLine,
        meta: [`第 ${sourceCard.match.regionalMatchNumber} 场赛果确认后显示学校队伍`],
        isSimulated: true,
        simulationKey: { kind: "matchOutcome", matchNumber: sourceCard.match.regionalMatchNumber!, outcome: sourceOutcome },
      };
      cards.push(card);
      return card;
    });
    const connector = connectCardGroupToCards(
      sourceCards,
      outcomeCards,
      `${event.slug}:${stage}:qualification-flow:${id}:connector`,
      tone,
    );
    if (connector) {
      connectors.push({
        ...connector,
        weight: tone === "amber" ? "strong" : "normal",
      });
    }
    return {
      bottom: outcomeCards.at(-1)!.y + FLOW_TEAM_CARD_HEIGHT,
      cards: outcomeCards,
    };
  };

  const firstRound = addMatchSection(
    "round1",
    columnX(0),
    topHeaderY,
    "首轮对阵 · 8 队",
    firstRoundMatches,
    "第 23–26 场",
    "cyan",
  );
  const thirdRound = addMatchSection(
    "round3",
    columnX(1),
    topHeaderY,
    "直通战 · 全国赛",
    thirdRoundMatches,
    "第 29–30 场",
    "emerald",
  );
  addOutcomeSection({
    id: "round3-national",
    x: columnX(2),
    y: topHeaderY,
    title: "全国赛席位",
    subtitle: "第 29–30 场胜者",
    sourceMatches: thirdRoundMatches,
    sourceOutcome: "winner",
    destination: "全国赛",
    statLine: "胜者晋级全国赛",
    tone: "amber",
  });

  const lowerLaneY = Math.max(
    topHeaderY + 2 * matchStep + FLOW_SECTION_GAP,
    Math.min(firstRound.bottom, thirdRound.bottom + FLOW_SECTION_GAP),
  );
  const secondRound = addMatchSection(
    "round2",
    columnX(1),
    lowerLaneY,
    "生死战 · 第一轮",
    secondRoundMatches,
    "第 27–28 场",
    "steel",
  );
  const fourthRound = addMatchSection(
    "round4",
    columnX(2),
    lowerLaneY,
    "生死战 · 最后一轮",
    fourthRoundMatches,
    "第 31–32 场",
    "emerald",
  );
  const fourthRoundNational = addOutcomeSection({
    id: "round4-national",
    x: columnX(3),
    y: lowerLaneY,
    title: "全国赛席位",
    subtitle: "第 31–32 场胜者",
    sourceMatches: fourthRoundMatches,
    sourceOutcome: "winner",
    destination: "全国赛",
    statLine: "胜者晋级全国赛",
    tone: "amber",
  });
  const lowerDecisionY = Math.max(secondRound.bottom, fourthRound.bottom) + FLOW_SECTION_GAP;
  addOutcomeSection({
    id: "round2-eliminated",
    x: columnX(2),
    y: lowerDecisionY,
    title: "两败出局",
    subtitle: "第 27–28 场负者",
    sourceMatches: secondRoundMatches,
    sourceOutcome: "loser",
    destination: "淘汰",
    statLine: "第 27–28 场负者",
    tone: "steel",
  });
  addOutcomeSection({
    id: "round4-eliminated",
    x: columnX(3),
    y: fourthRoundNational.cards.length
      ? fourthRoundNational.bottom + FLOW_SECTION_GAP
      : lowerLaneY,
    title: "两败出局",
    subtitle: "第 31–32 场负者",
    sourceMatches: fourthRoundMatches,
    sourceOutcome: "loser",
    destination: "淘汰",
    statLine: "第 31–32 场负者",
    tone: "steel",
  });

  connectors.push(...buildOutcomeAwareEliminationConnectors(orderedMatches, cardByMatch));

  const contentBottom = cards.reduce(
    (bottom, card) => Math.max(bottom, card.y + card.height),
    START_Y,
  );
  return {
    id: stage,
    label: `${event.shortName}赛程`,
    title: `${event.name} · 晋级名额去向`,
    description: "8 队争夺 4 张全国赛门票，两败出局。",
    width: START_X * 2 + 4 * CARD_WIDTH + 3 * COLUMN_GAP,
    height: contentBottom + 80,
    viewport: { align: "left", minScale: 0.52, paddingX: 48, paddingY: 36 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}

function nationalsSwissRoundNumber(match: FinalEventMatch) {
  const matchResult = swissColumnLabel(match).match(/第\s*(\d+)\s*轮/);
  return matchResult ? Number(matchResult[1]) : 0;
}

function buildNationalsSwissStage(
  event: FinalEventSchedule,
  matches: FinalEventMatch[],
  stage: "swiss-a" | "swiss-b",
  simulation?: FinalsEventSimulation | null,
): WorkspaceStage {
  const orderedMatches = [...matches].sort((left, right) => left.number - right.number);
  const matchesByBucket = new Map<string, FinalEventMatch[]>();
  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  const headersBySection = new Map<string, WorkspaceStageHeader>();

  const matchesByRound = new Map<number, FinalEventMatch[]>();
  for (const match of orderedMatches) {
    const roundNumber = nationalsSwissRoundNumber(match);
    if (!roundNumber) continue;
    const roundMatches = matchesByRound.get(roundNumber) ?? [];
    roundMatches.push(match);
    matchesByRound.set(roundNumber, roundMatches);
  }

  for (const [roundNumber, roundMatches] of matchesByRound) {
    roundMatches
      .sort((left, right) => left.number - right.number)
      .forEach((match, index) => {
        const bucket = officialPlaceholderSwissBucket(roundNumber, index);
        if (!bucket) return;
        const bucketKey = `${roundNumber}:${bucket}`;
        const bucketMatches = matchesByBucket.get(bucketKey) ?? [];
        bucketMatches.push(match);
        matchesByBucket.set(bucketKey, bucketMatches);
      });
  }

  for (const column of SWISS_STAGE_COLUMNS) {
    let nextSectionBottom = 0;

    for (const section of column.sections) {
      const sectionY = nextSectionBottom
        ? Math.max(section.y, nextSectionBottom + FLOW_SECTION_GAP)
        : section.y;
      const header: WorkspaceStageHeader = {
        id: `${event.slug}:${stage}:swiss-bucket:${section.id}:header`,
        x: column.x,
        y: sectionY,
        width: CARD_WIDTH,
        title: section.title,
        subtitle: section.kind === "summary" ? "真实队伍待确认" : "",
        tone: section.tone,
      };

      if (section.kind === "matches") {
        const bucketMatches = matchesByBucket.get(`${section.round}:${section.bucket}`) ?? [];
        if (!bucketMatches.length) continue;
        headers.push(header);
        headersBySection.set(section.id, header);
        bucketMatches.forEach((match, index) => {
          cards.push(cardForMatch(
            event,
            match,
            column.x,
            sectionY + FLOW_HEADER_TO_CARD_OFFSET + index * (CARD_HEIGHT + ROW_GAP),
            simulation,
          ));
        });
        nextSectionBottom =
          sectionY
          + FLOW_HEADER_TO_CARD_OFFSET
          + (bucketMatches.length - 1) * (CARD_HEIGHT + ROW_GAP)
          + CARD_HEIGHT;
        continue;
      }

      const placeholderCount = SWISS_OFFICIAL_PLACEHOLDER_SUMMARY_COUNTS[section.summaryId];
      headers.push(header);
      headersBySection.set(section.id, header);
      const qualified = section.summaryId.startsWith("qualified-");
      const record = section.summaryId.replace(/^qualified-|^eliminated-/, "");
      Array.from({ length: placeholderCount }, (_, index) => {
        const destinationCard: TeamCanvasCard = {
          id: `${event.slug}:${stage}:swiss-result:${section.id}:${index + 1}`,
          kind: "team",
          variant: "summary",
          teamKey: "",
          collegeName: "待确认",
          teamName: "学校队伍待确认",
          x: column.x,
          y: sectionY + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
          width: CARD_WIDTH,
          height: FLOW_TEAM_CARD_HEIGHT,
          tone: section.tone,
          orderLabel: `${index + 1}`,
          subtitle: qualified ? "晋级 16 强" : "止步瑞士轮",
          statLine: `${record} 战绩 · ${qualified ? "晋级" : "淘汰"}`,
          meta: ["赛果确认后显示学校队伍"],
          isSimulated: true,
          simulationKey: { kind: "recordBucket", bucket: section.summaryId, index },
        };
        cards.push(destinationCard);
      });
      nextSectionBottom =
        sectionY
        + FLOW_HEADER_TO_CARD_OFFSET
        + (placeholderCount - 1) * FLOW_TEAM_STEP
        + FLOW_TEAM_CARD_HEIGHT;
    }
  }

  const connectors = SWISS_STAGE_FLOWS.map(({ sourceId, targetIds, tone }) => (
    connectHeaderBands(
      headersBySection.has(sourceId) ? [headersBySection.get(sourceId)!] : [],
      targetIds
        .map((targetId) => headersBySection.get(targetId))
        .filter((header): header is WorkspaceStageHeader => Boolean(header)),
      `${event.slug}:${stage}:swiss-flow:${sourceId}->${targetIds.join("+")}`,
      tone,
    )
  )).filter((connector): connector is CanvasConnector => Boolean(connector));

  const maxBottom = Math.max(
    cards.reduce((bottom, card) => Math.max(bottom, card.y + card.height), 0),
    headers.reduce((bottom, header) => Math.max(bottom, header.y + HEADER_HEIGHT), 0),
  );
  const groupName = stage === "swiss-a" ? "A" : "B";

  return {
    id: stage,
    label: `${groupName} 组瑞士轮`,
    title: `${event.name} · ${groupName} 组瑞士轮`,
    description: "五轮按战绩配对，3 胜晋级 16 强、3 败出局。",
    width: 2740,
    height: Math.max(1600, maxBottom + 124),
    viewport: { align: "left", minScale: 0.52, paddingX: 48, paddingY: 48 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}

function buildNationalsDoubleEliminationStage(
  event: FinalEventSchedule,
  matches: FinalEventMatch[],
  stage: "round-of-16" | "quarterfinal",
  simulation?: FinalsEventSimulation | null,
): WorkspaceStage {
  const orderedMatches = [...matches].sort((left, right) => left.number - right.number);
  const headers: WorkspaceStageHeader[] = [];
  const cards: CanvasCard[] = [];
  const connectors: CanvasConnector[] = [];
  const cardByMatch = new Map<number, MatchCanvasCard>();
  const columnStep = CARD_WIDTH + COLUMN_GAP;
  const matchStep = CARD_HEIGHT + ROW_GAP;
  const topHeaderY = Math.max(32, START_Y - HEADER_HEIGHT - HEADER_TO_CARD_GAP);
  const columnX = (column: number) => START_X + column * columnStep;
  const sortByNumber = (rows: FinalEventMatch[]) => [...rows].sort((left, right) => left.number - right.number);

  const lowerFirstMatches = orderedMatches.filter((match) => match.stage.includes("败者组第一轮"));
  const lowerFinalMatches = orderedMatches.filter((match) => match.stage.includes("败者组第二轮"));
  const upperMatches = orderedMatches.filter((match) => (
    match.stage.includes("胜者组") && !match.stage.includes("败者组")
  ));
  const groupedNumbers = new Set([
    ...lowerFirstMatches,
    ...lowerFinalMatches,
    ...upperMatches,
  ].map((match) => match.number));
  const openingMatches = orderedMatches.filter((match) => !groupedNumbers.has(match.number));

  const addHeader = (
    id: string,
    x: number,
    y: number,
    title: string,
    subtitle: string,
    tone: CanvasConnector["tone"],
  ) => {
    headers.push({ id, x, y, width: CARD_WIDTH, title, subtitle, tone });
  };

  const addMatchSection = ({
    id,
    x,
    y,
    title,
    subtitle,
    tone,
    sectionMatches,
  }: {
    id: string;
    x: number;
    y: number;
    title: string;
    subtitle: string;
    tone: CanvasConnector["tone"];
    sectionMatches: FinalEventMatch[];
  }) => {
    const rows = sortByNumber(sectionMatches);
    if (!rows.length) return { bottom: y, cards: [] as MatchCanvasCard[] };
    addHeader(`${event.slug}:${stage}:${id}:header`, x, y, title, subtitle, tone);
    const sectionCards = rows.map((match, index) => {
      const card = cardForMatch(
        event,
        match,
        x,
        y + HEADER_HEIGHT + HEADER_TO_CARD_GAP + index * matchStep,
        simulation,
      );
      cards.push(card);
      cardByMatch.set(match.number, card);
      return card;
    });
    return {
      bottom: sectionCards.at(-1)!.y + CARD_HEIGHT,
      cards: sectionCards,
    };
  };

  const addSeatSection = ({
    id,
    x,
    y,
    title,
    subtitle,
    seatName,
    sourceMatches,
  }: {
    id: string;
    x: number;
    y: number;
    title: string;
    subtitle: string;
    seatName: string;
    sourceMatches: FinalEventMatch[];
  }) => {
    const sources = sortByNumber(sourceMatches)
      .map((match) => ({ match, card: cardByMatch.get(match.number) }))
      .filter((entry): entry is { match: FinalEventMatch; card: MatchCanvasCard } => Boolean(entry.card));
    if (!sources.length) return { bottom: y, cards: [] as TeamCanvasCard[] };

    addHeader(`${event.slug}:${stage}:${id}:header`, x, y, title, subtitle, "amber");
    const seatCards = sources.map(({ match, card: sourceCard }, index): TeamCanvasCard => {
      const destination = match.winnerTo ?? seatName;
      const seatCard: TeamCanvasCard = {
        id: `${event.slug}:${stage}:${id}:${match.number}`,
        kind: "team",
        variant: "summary",
        teamKey: "",
        collegeName: "待确认",
        teamName: "学校队伍待确认",
        x,
        y: y + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
        width: CARD_WIDTH,
        height: FLOW_TEAM_CARD_HEIGHT,
        tone: "amber",
        orderLabel: destinationOrderLabel(destination, index + 1),
        subtitle: destination,
        statLine: `第 ${match.number} 场胜者`,
        meta: ["赛果确认后显示学校队伍"],
        isSimulated: true,
        simulationKey: { kind: "matchOutcome", matchNumber: match.number, outcome: "winner" },
      };
      cards.push(seatCard);

      const connector = connectCardGroupToCard(
        [sourceCard],
        seatCard,
        `${event.slug}:${stage}:${id}:${match.number}:connector`,
        "amber",
      );
      if (connector) connectors.push({ ...connector, weight: "strong" });
      return seatCard;
    });
    return {
      bottom: seatCards.at(-1)!.y + FLOW_TEAM_CARD_HEIGHT,
      cards: seatCards,
    };
  };

  const addEliminationSection = ({
    id,
    x,
    y,
    title,
    subtitle,
    sourceMatches,
  }: {
    id: string;
    x: number;
    y: number;
    title: string;
    subtitle: string;
    sourceMatches: FinalEventMatch[];
  }) => {
    const sources = sortByNumber(sourceMatches)
      .filter((match) => match.loserTo === "淘汰")
      .map((match) => ({ match, card: cardByMatch.get(match.number) }))
      .filter((entry): entry is { match: FinalEventMatch; card: MatchCanvasCard } => Boolean(entry.card));
    if (!sources.length) return { bottom: y, cards: [] as TeamCanvasCard[] };

    addHeader(
      `${event.slug}:${stage}:${id}:header`,
      x,
      y,
      title,
      `${sources.length} 队 · ${subtitle}`,
      "steel",
    );
    const eliminatedCards = sources.map(({ match }, index): TeamCanvasCard => {
      const eliminatedCard: TeamCanvasCard = {
        id: `${event.slug}:${stage}:${id}:${match.number}`,
        kind: "team",
        variant: "summary",
        teamKey: "",
        collegeName: "待确认",
        teamName: "学校队伍待确认",
        x,
        y: y + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
        width: CARD_WIDTH,
        height: FLOW_TEAM_CARD_HEIGHT,
        tone: "steel",
        orderLabel: `${index + 1}`,
        subtitle: "两败出局",
        statLine: `第 ${match.number} 场负者`,
        meta: ["赛果确认后显示学校队伍"],
        isSimulated: true,
        simulationKey: { kind: "matchOutcome", matchNumber: match.number, outcome: "loser" },
      };
      cards.push(eliminatedCard);
      return eliminatedCard;
    });
    const connector = connectCardGroupToCards(
      sources.map(({ card }) => card),
      eliminatedCards,
      `${event.slug}:${stage}:${id}:connector`,
      "steel",
    );
    if (connector) connectors.push(connector);

    return {
      bottom: eliminatedCards.at(-1)!.y + FLOW_TEAM_CARD_HEIGHT,
      cards: eliminatedCards,
    };
  };

  let contentColumnCount = 4;
  if (stage === "round-of-16") {
    addMatchSection({
      id: "opening",
      x: columnX(0),
      y: topHeaderY,
      title: "首轮对阵 · 16 强",
      subtitle: "第 67–74 场",
      tone: "amber",
      sectionMatches: openingMatches,
    });
    const upper = addMatchSection({
      id: "upper",
      x: columnX(1),
      y: topHeaderY,
      title: "直通战 · 八强",
      subtitle: "第 79–82 场",
      tone: "emerald",
      sectionMatches: upperMatches,
    });
    const upperSeats = addSeatSection({
      id: "upper-seats",
      x: columnX(2),
      y: topHeaderY,
      title: "八强席位",
      subtitle: "第 79–82 场胜者",
      seatName: "八强席位",
      sourceMatches: upperMatches,
    });
    const lowerLaneY = Math.max(upper.bottom, upperSeats.bottom) + FLOW_SECTION_GAP;
    const lowerFirst = addMatchSection({
      id: "lower-first",
      x: columnX(1),
      y: lowerLaneY,
      title: "生死战 · 第一轮",
      subtitle: "第 75–78 场",
      tone: "steel",
      sectionMatches: lowerFirstMatches,
    });
    const lowerFinal = addMatchSection({
      id: "lower-final",
      x: columnX(2),
      y: lowerLaneY,
      title: "生死战 · 最后一轮",
      subtitle: "第 83–86 场",
      tone: "emerald",
      sectionMatches: lowerFinalMatches,
    });
    const lowerSeats = addSeatSection({
      id: "lower-seats",
      x: columnX(3),
      y: lowerLaneY,
      title: "八强席位",
      subtitle: "第 83–86 场胜者",
      seatName: "八强席位",
      sourceMatches: lowerFinalMatches,
    });
    addEliminationSection({
      id: "lower-first-eliminated",
      x: columnX(2),
      y: Math.max(lowerFirst.bottom, lowerFinal.bottom) + FLOW_SECTION_GAP,
      title: "两败出局",
      subtitle: "第 75–78 场负者",
      sourceMatches: lowerFirstMatches,
    });
    addEliminationSection({
      id: "lower-final-eliminated",
      x: columnX(3),
      y: lowerSeats.bottom + FLOW_SECTION_GAP,
      title: "两败出局",
      subtitle: "第 83–86 场负者",
      sourceMatches: lowerFinalMatches,
    });
  } else {
    contentColumnCount = 3;
    const upper = addMatchSection({
      id: "upper",
      x: columnX(0),
      y: topHeaderY,
      title: "直通战 · 四强",
      subtitle: "第 87–88 场",
      tone: "emerald",
      sectionMatches: upperMatches,
    });
    const upperSeats = addSeatSection({
      id: "upper-seats",
      x: columnX(1),
      y: topHeaderY,
      title: "四强席位",
      subtitle: "第 87–88 场胜者",
      seatName: "四强席位",
      sourceMatches: upperMatches,
    });
    const lowerLaneY = Math.max(upper.bottom, upperSeats.bottom) + FLOW_SECTION_GAP;
    const lowerFirst = addMatchSection({
      id: "lower-first",
      x: columnX(0),
      y: lowerLaneY,
      title: "生死战 · 第一轮",
      subtitle: "第 89–90 场",
      tone: "steel",
      sectionMatches: lowerFirstMatches,
    });
    const lowerFinal = addMatchSection({
      id: "lower-final",
      x: columnX(1),
      y: lowerLaneY,
      title: "生死战 · 最后一轮",
      subtitle: "第 91–92 场",
      tone: "emerald",
      sectionMatches: lowerFinalMatches,
    });
    const lowerSeats = addSeatSection({
      id: "lower-seats",
      x: columnX(2),
      y: lowerLaneY,
      title: "四强席位",
      subtitle: "第 91–92 场胜者",
      seatName: "四强席位",
      sourceMatches: lowerFinalMatches,
    });
    addEliminationSection({
      id: "lower-first-eliminated",
      x: columnX(1),
      y: Math.max(lowerFirst.bottom, lowerFinal.bottom) + FLOW_SECTION_GAP,
      title: "两败出局",
      subtitle: "第 89–90 场负者",
      sourceMatches: lowerFirstMatches,
    });
    addEliminationSection({
      id: "lower-final-eliminated",
      x: columnX(2),
      y: lowerSeats.bottom + FLOW_SECTION_GAP,
      title: "两败出局",
      subtitle: "第 91–92 场负者",
      sourceMatches: lowerFinalMatches,
    });
  }

  connectors.unshift(...buildOutcomeAwareEliminationConnectors(orderedMatches, cardByMatch));
  const contentBottom = cards.reduce(
    (bottom, card) => Math.max(bottom, card.y + card.height),
    START_Y,
  );
  const seatCount = stage === "round-of-16" ? 8 : 4;

  return {
    id: stage,
    label: `${event.shortName}赛程`,
    title: `${event.name} · ${stage === "round-of-16" ? "16 进 8" : "8 进 4"} 晋级图`,
    description: `直通战胜者锁定${stage === "round-of-16" ? "八强" : "四强"}，生死战负者出局；共 ${seatCount} 席。`,
    width: START_X * 2 + contentColumnCount * CARD_WIDTH + (contentColumnCount - 1) * COLUMN_GAP,
    height: contentBottom + 80,
    viewport: { align: "left", minScale: stage === "round-of-16" ? 0.46 : 0.52, paddingX: 48, paddingY: 36 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}

function buildFinalsWorkspaceStageBase(
  event: FinalEventSchedule,
  stage: FinalEventStageFilter,
  simulation?: FinalsEventSimulation | null,
): WorkspaceStage {
  const matches = matchesForFinalStage(event, stage);
  if (event.slug === "repechage" && stage === "qualification") {
    return buildRepechageQualificationStage(event, matches, stage, simulation);
  }
  if (event.slug === "nationals" && (stage === "swiss-a" || stage === "swiss-b")) {
    return buildNationalsSwissStage(event, matches, stage, simulation);
  }
  if (event.slug === "nationals" && (stage === "round-of-16" || stage === "quarterfinal")) {
    return buildNationalsDoubleEliminationStage(event, matches, stage, simulation);
  }
  const isSwissStage = stage === "swiss-a" || stage === "swiss-b";
  const matchCardHeight = simulation ? CARD_HEIGHT : 96;
  const repechageSwissFlow = buildRepechageSwissFlow(event, stage);
  const { columnByMatch, labels } = buildColumnAssignments(matches, stage);
  const matchesByColumn = new Map<number, FinalEventMatch[]>();
  for (const match of matches) {
    const column = columnByMatch.get(match.number) ?? 0;
    const rows = matchesByColumn.get(column) ?? [];
    rows.push(match);
    matchesByColumn.set(column, rows);
  }
  if (stage === "final-four") {
    const medalMatches = matchesByColumn.get(1);
    medalMatches?.sort((left, right) => {
      const priority: Record<string, number> = { final: 0, third_place: 1 };
      return (priority[left.stageKey] ?? 2) - (priority[right.stageKey] ?? 2);
    });
  }

  const maxColumnHeight = Math.max(
    matchCardHeight,
    ...[...matchesByColumn.values()].map((rows) =>
      rows.length * matchCardHeight + Math.max(0, rows.length - 1) * ROW_GAP,
    ),
  );
  const columnTopByColumn = new Map<number, number>();
  for (const [column, rows] of matchesByColumn) {
    const columnHeight = rows.length * matchCardHeight + Math.max(0, rows.length - 1) * ROW_GAP;
    columnTopByColumn.set(
      column,
      START_Y + Math.max(0, (maxColumnHeight - columnHeight) / 2),
    );
  }

  const cardByMatch = new Map<number, MatchCanvasCard>();
  const cards: CanvasCard[] = [];
  for (const [column, rows] of [...matchesByColumn.entries()].sort(([left], [right]) => left - right)) {
    const columnTop = columnTopByColumn.get(column) ?? START_Y;
    rows.forEach((match, row) => {
      const card = cardForMatch(
        event,
        match,
        START_X + column * (CARD_WIDTH + COLUMN_GAP),
        columnTop + row * (matchCardHeight + ROW_GAP),
        simulation,
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
        .filter((card): card is MatchCanvasCard => Boolean(card));
      const targetCards = (matchesByColumn.get(column + 1) ?? [])
        .map((match) => cardByMatch.get(match.number))
        .filter((card): card is MatchCanvasCard => Boolean(card));
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
      Array<{ sourceCard: MatchCanvasCard; outcome: "winner" | "loser" }>
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
        .map((entry) => entry.sourceCard.match.regionalMatchNumber)
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
    sourceCards: MatchCanvasCard[];
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
  const destinationCards: TeamCanvasCard[] = [];
  let swissFlowLayout: {
    preRound3HeaderY: number;
    qualificationHeaderY: number;
    eliminatedHeaderY: number;
  } | null = null;
  if (terminalGroups.size > 0) {
    outcomeColumnCount = 1;
    const outcomeColX =
      START_X + labels.length * (CARD_WIDTH + COLUMN_GAP);
    const outcomeHeight = terminalGroups.size * 108 + Math.max(0, terminalGroups.size - 1) * ROW_GAP;
    let outcomeY = START_Y + Math.max(0, (maxColumnHeight - outcomeHeight) / 2);

    const finalRankByDestination: Record<string, number> = {
      冠军: 1,
      亚军: 2,
      季军: 3,
      殿军: 4,
    };
    const sorted = [...terminalGroups.values()].sort((a, b) => {
      if (stage === "final-four") {
        return (finalRankByDestination[a.destination] ?? 99)
          - (finalRankByDestination[b.destination] ?? 99);
      }
      if (a.kind !== b.kind) return a.kind === "winner" ? -1 : 1;
      return a.destination.localeCompare(b.destination);
    });

    for (const group of sorted) {
      const count = group.sourceCards.length;
      const isAdvancement = group.kind === "winner";
      const isFinalRanking = stage === "final-four";
      const finalRank = finalRankByDestination[group.destination];
      const tone: CanvasConnector["tone"] = isFinalRanking || isAdvancement ? "amber" : "steel";
      const label =
        TERMINAL_LABEL_MAP[group.destination] ?? group.destination;

      const outcomeCard: TeamCanvasCard = {
        id: `${event.slug}:${stage}:outcome:${group.destination}`,
        kind: "team",
        variant: isFinalRanking ? "ranking" : "summary",
        teamKey: isFinalRanking ? "" : `outcome:${group.kind}:${group.destination}`,
        collegeName: label,
        teamName: `${count} 支队伍`,
        x: outcomeColX,
        y: outcomeY,
        width: CARD_WIDTH,
        height: 108,
        tone,
        orderLabel: isFinalRanking ? `${finalRank}` : `${count}`,
        subtitle: isFinalRanking ? `最终第 ${finalRank} 名` : `${count} 支队伍`,
        statLine: isFinalRanking
          ? `第 ${group.sourceCards[0]?.match.regionalMatchNumber ?? "-"} 场${group.kind === "winner" ? "胜者" : "负者"}`
          : isAdvancement
            ? `胜者晋级 · ${group.destination}`
            : `败者淘汰 · ${group.destination}`,
        isSimulated: false,
        simulationKey: { kind: "destination", destination: group.destination },
      };
      cards.push(outcomeCard);
      destinationCards.push(outcomeCard);

      const oc = connectCardGroupToCard(
        group.sourceCards,
        outcomeCard,
        `${event.slug}:${stage}:outcome-conn:${group.destination}`,
        tone,
      );
      if (oc) {
        connectors.push({
          ...oc,
          weight: isFinalRanking || isAdvancement ? "strong" : "normal",
        });
      }

      outcomeY += 108 + ROW_GAP;
    }
  }

  if (repechageSwissFlow) {
    const round3Column = labels.length - 1;
    const round3Sources = (matchesByColumn.get(round3Column) ?? [])
      .map((match) => cardByMatch.get(match.number))
      .filter((card): card is MatchCanvasCard => Boolean(card));
    const round2Sources = (matchesByColumn.get(Math.max(0, round3Column - 1)) ?? [])
      .map((match) => cardByMatch.get(match.number))
      .filter((card): card is MatchCanvasCard => Boolean(card));
    const round3Bottom = round3Sources.reduce(
      (bottom, card) => Math.max(bottom, card.y + card.height),
      START_Y,
    );
    const preRound3HeaderY = round3Bottom + FLOW_SECTION_GAP;
    const preRound3CardY = preRound3HeaderY + FLOW_HEADER_TO_CARD_OFFSET;
    const flowColumnStart = labels.length + (terminalGroups.size > 0 ? 1 : 0);
    const qualificationColumn = flowColumnStart;
    const qualificationX = START_X + qualificationColumn * (CARD_WIDTH + COLUMN_GAP);
    // Keep every main Swiss column centered on the same visual horizontal
    // axis. The regional canvas uses the same rule when a later column has
    // fewer cards; destination headers must be centered as a group rather
    // than pinned to the round-three card top.
    const swissMainAxisY =
      START_Y
      + maxColumnHeight / 2
      - (HEADER_HEIGHT + HEADER_TO_CARD_GAP) / 2;
    const flowGroupHeight = (cardCount: number) =>
      FLOW_HEADER_TO_CARD_OFFSET
      + Math.max(0, cardCount - 1) * FLOW_TEAM_STEP
      + FLOW_TEAM_CARD_HEIGHT;
    const qualificationHeaderY =
      swissMainAxisY - flowGroupHeight(repechageSwissFlow.qualificationSlots.length) / 2;
    const eliminatedHeaderY =
      qualificationHeaderY
      + flowGroupHeight(repechageSwissFlow.qualificationSlots.length)
      + FLOW_SECTION_GAP;

    const makePlaceholderCard = ({
      id,
      x,
      y,
      orderLabel,
      subtitle,
      statLine,
      tone,
    }: {
      id: string;
      x: number;
      y: number;
      orderLabel: string;
      subtitle: string;
      statLine: string;
      tone: TeamCanvasCard["tone"];
    }): TeamCanvasCard => ({
      id,
      kind: "team",
      variant: "summary",
      teamKey: "",
      collegeName: "待确认",
      teamName: "学校队伍待确认",
      x,
      y,
      width: CARD_WIDTH,
      height: FLOW_TEAM_CARD_HEIGHT,
      tone,
      orderLabel,
      subtitle,
      statLine,
      meta: ["赛果确认后显示学校队伍"],
      isSimulated: true,
    });

    const preRound3EliminationCards = Array.from(
      { length: repechageSwissFlow.eliminatedBeforeRound3 },
      (_, index) => ({
        ...makePlaceholderCard({
          id: `${event.slug}:${stage}:swiss-flow:before-round3-eliminated:${index + 1}`,
          x: START_X + round3Column * (CARD_WIDTH + COLUMN_GAP),
          y: preRound3CardY + index * FLOW_TEAM_STEP,
          orderLabel: `${index + 1}`,
          subtitle: "第二轮后淘汰",
          statLine: "0-2 组",
          tone: "steel",
        }),
        simulationKey: { kind: "swissFlow", phase: "beforeRound3", index } as TeamCardSimulationKey,
      }),
    );
    const qualificationCards = repechageSwissFlow.qualificationSlots.map((slot, index) => ({
      ...makePlaceholderCard({
        id: `${event.slug}:${stage}:swiss-flow:qualified:${slot}`,
        x: qualificationX,
        y: qualificationHeaderY + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
        orderLabel: slot,
        subtitle: `${slot} 名额战`,
        statLine: "第三轮晋级",
        tone: "amber",
      }),
      simulationKey: { kind: "slot", slot } as TeamCardSimulationKey,
    }));
    const postRound3EliminationCards = Array.from(
      { length: repechageSwissFlow.eliminatedAfterRound3 },
      (_, index) => ({
        ...makePlaceholderCard({
          id: `${event.slug}:${stage}:swiss-flow:after-round3-eliminated:${index + 1}`,
          x: qualificationX,
          y: eliminatedHeaderY + FLOW_HEADER_TO_CARD_OFFSET + index * FLOW_TEAM_STEP,
          orderLabel: `${index + 1}`,
          subtitle: "第三轮后淘汰",
          statLine: "1-1 组负者 · 累计 2 败",
          tone: "steel",
        }),
        simulationKey: { kind: "swissFlow", phase: "afterRound3", index } as TeamCardSimulationKey,
      }),
    );
    const flowCards = [
      ...preRound3EliminationCards,
      ...qualificationCards,
      ...postRound3EliminationCards,
    ];
    cards.push(...flowCards);
    destinationCards.push(...flowCards);
    outcomeColumnCount = Math.max(outcomeColumnCount, flowColumnStart + 1 - labels.length);

    const preRound3Connector = connectCardGroupToCards(
      round2Sources,
      preRound3EliminationCards,
      `${event.slug}:${stage}:swiss-flow:before-round3`,
      "steel",
    );
    if (preRound3Connector) {
      connectors.push(preRound3Connector);
    }

    const qualificationConnector = connectCardGroupToCards(
      round3Sources,
      qualificationCards,
      `${event.slug}:${stage}:swiss-flow:qualified`,
      "amber",
    );
    if (qualificationConnector) {
      connectors.push({
        ...qualificationConnector,
        weight: "strong",
      });
    }

    const postRound3Connector = connectCardGroupToCards(
      round3Sources,
      postRound3EliminationCards,
      `${event.slug}:${stage}:swiss-flow:after-round3`,
      "steel",
    );
    if (postRound3Connector) {
      connectors.push(postRound3Connector);
    }

    // Keep the extra destinations as individual regional-style cards. Their
    // team identity is intentionally blank until the official draw/results
    // resolve the Swiss record pools.
    swissFlowLayout = {
      preRound3HeaderY,
      qualificationHeaderY,
      eliminatedHeaderY,
    };
  }

  const totalColumns = labels.length + outcomeColumnCount;

  const headers: WorkspaceStageHeader[] = labels.map((label, column) => {
    const columnTop = columnTopByColumn.get(column) ?? START_Y;
    return {
      id: `${event.slug}:${stage}:header:${column}`,
      x: START_X + column * (CARD_WIDTH + COLUMN_GAP),
      y: Math.max(32, columnTop - HEADER_HEIGHT - HEADER_TO_CARD_GAP),
      width: CARD_WIDTH,
      title: label,
      subtitle: stage === "final-four" && column === 1
        ? "第 96 场冠军赛 · 第 95 场季军赛"
        : repechageSwissFlow?.roundSubtitles[column + 1]
          ?? `${matchesByColumn.get(column)?.length ?? 0} 场`,
      tone: column === labels.length - 1 && stage === "final-four" ? "amber" : "cyan",
    };
  });

  if (terminalGroups.size > 0) {
    const outcomeCard = destinationCards.find((card) => card.id.includes(":outcome:"));
    headers.push({
      id: `${event.slug}:${stage}:outcome-header`,
      x: START_X + labels.length * (CARD_WIDTH + COLUMN_GAP),
      y: Math.max(32, (outcomeCard?.y ?? START_Y) - 48 - HEADER_TO_CARD_GAP),
      width: CARD_WIDTH,
      title: stage === "final-four" ? "最终名次 · 1–4" : "最终去向",
      subtitle: stage === "final-four" ? "" : `${terminalGroups.size} 个去向`,
      tone: "amber",
    });
  }

  if (repechageSwissFlow && swissFlowLayout) {
    const flowColumnStart = labels.length + (terminalGroups.size > 0 ? 1 : 0);
    headers.push({
      id: `${event.slug}:${stage}:swiss-flow:before-round3-header`,
      x: START_X + (labels.length - 1) * (CARD_WIDTH + COLUMN_GAP),
      y: swissFlowLayout.preRound3HeaderY,
      width: CARD_WIDTH,
      title: "前两轮后淘汰",
      subtitle: `${repechageSwissFlow.eliminatedBeforeRound3} 队 · 0-2 组`,
      tone: "steel",
    });
    headers.push({
      id: `${event.slug}:${stage}:swiss-flow:qualified-header`,
      x: START_X + flowColumnStart * (CARD_WIDTH + COLUMN_GAP),
      y: swissFlowLayout.qualificationHeaderY,
      width: CARD_WIDTH,
      title: "第三轮后晋级",
      subtitle: `${repechageSwissFlow.qualificationEntryCount} 队 · ${repechageSwissFlow.qualificationSlotRange}`,
      tone: "cyan",
    });
    headers.push({
      id: `${event.slug}:${stage}:swiss-flow:eliminated-header`,
      x: START_X + flowColumnStart * (CARD_WIDTH + COLUMN_GAP),
      y: swissFlowLayout.eliminatedHeaderY,
      width: CARD_WIDTH,
      title: "第三轮后淘汰",
      subtitle: `${repechageSwissFlow.eliminatedAfterRound3} 队 · 累计 2 败`,
      tone: "steel",
    });
  }
  const outcomeBottom = cards.reduce(
    (max, card) => Math.max(
      max,
      card.kind === "team" && destinationCards.some((destination) => destination.id === card.id)
        ? card.y + card.height
        : 0,
    ),
    0,
  );
  const contentBottom = Math.max(START_Y + maxColumnHeight, outcomeBottom);

  return {
    id: stage,
    label: `${event.shortName}赛程`,
    title: isSwissStage
      ? `${event.name} · ${stage === "swiss-a" ? "A" : "B"} 组瑞士轮`
      : `${event.name} · ${labels.join(" / ")}`,
    description: isSwissStage
      ? "先输两场出局，第三轮决出名额战名单。"
      : stage === "final-four"
        ? "半决赛胜者争冠、负者争季，四场定第 1–4 名。"
      : "按官方场序展示，抽签后显示真实队伍。",
    width:
      START_X * 2 +
      totalColumns * CARD_WIDTH +
      Math.max(0, totalColumns - 1) * COLUMN_GAP,
    height: contentBottom + 80,
    viewport: { align: "left", minScale: 0.52, paddingX: 48, paddingY: 36 },
    headers,
    cards,
    connectors,
    showProbability: false,
  };
}

/**
 * 在对阵图基础上叠加种子沙盘模拟结果：赛程卡片在构建时即按区域赛
 * MatchCanvasCard 形式带上模拟对阵双方与比分；此处只需把队伍类卡片
 * （席位 / 战绩桶 / 流向占位）落位为模拟队伍。
 */
export function buildFinalsWorkspaceStage(
  event: FinalEventSchedule,
  stage: FinalEventStageFilter,
  simulation?: FinalsEventSimulation,
): WorkspaceStage {
  const workspaceStage = buildFinalsWorkspaceStageBase(event, stage, simulation);
  if (simulation) {
    const resolveSimulationKey = (key: TeamCardSimulationKey): SimulatedFinalTeam | null => {
      if (key.kind === "slot") return simulation.groupQualifiers[key.slot] ?? null;
      if (key.kind === "destination") {
        const teams = simulation.terminalOutcomes.get(key.destination) ?? [];
        return teams.length === 1 ? teams[0] ?? null : null;
      }
      if (key.kind === "swissFlow") {
        const group = stage === "swiss-b" ? "B" : "A";
        return swissFlowPlaceholderTeams(simulation, group, key.phase)[key.index] ?? null;
      }
      if (key.kind === "recordBucket") {
        const group = stage === "swiss-b" ? "B" : "A";
        return swissRecordBucketTeams(simulation, group, key.bucket)[key.index] ?? null;
      }
      const result = simulation.matchResults.get(key.matchNumber);
      if (!result || !result.winnerSide) return null;
      const side = key.outcome === "winner" ? result.winnerSide : result.winnerSide === "red" ? "blue" : "red";
      return side === "red" ? result.red : result.blue;
    };
    for (const card of workspaceStage.cards) {
      if (card.kind === "team" && card.simulationKey) {
        const team = resolveSimulationKey(card.simulationKey);
        if (team) {
          card.collegeName = team.collegeName;
          card.teamName = team.teamName;
          card.teamKey = team.teamKey;
          card.meta = ["模拟落位"];
        }
      }
    }
    // 战绩桶卡片区已落位真实队伍，区块头不再提示「待确认」
    for (const header of workspaceStage.headers) {
      if (header.id.includes(":swiss-bucket:") && header.subtitle === "真实队伍待确认") {
        header.subtitle = "模拟落位";
      }
    }
  }
  return workspaceStage;
}
