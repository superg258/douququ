import type {
  CanvasCard,
  CanvasConnector,
  CanvasTone,
  MatchCanvasCard,
  MatchRow,
  TeamCanvasCard,
  WorkspaceStageHeader,
} from "@/lib/types";

/**
 * 区域赛、复活赛和全国赛共用的画布几何契约。
 *
 * 赛事各自只决定赛制关系、文案和数据适配；卡片尺寸与连线路由在此处统一，
 * 防止同一张 WorkspaceStage 在不同赛事中出现点击命中区或连接器偏移差异。
 */
export const CANVAS_LAYOUT = {
  match: { width: 400, height: 188 },
  team: { width: 400, height: 108 },
  detailTeam: { width: 400, height: 128 },
  header: { height: 48, toCardGap: 20, connectorAnchorY: 24 },
  flow: { teamStep: 148, headerToCardOffset: 52, sectionGap: 88 },
} as const;

export type CreateMatchCanvasCardOptions = {
  x: number;
  y: number;
  tone: CanvasTone;
  orderLabel: string;
  displayLabel: string;
  metaLabel: string;
  id?: string;
  width?: number;
  height?: number;
  variant?: MatchCanvasCard["variant"];
  showProbability?: boolean;
};

/**
 * 把统一的 MatchRow 投影为可点击的画布卡片。
 *
 * 两类赛事的数据源不同，但都会先适配为 MatchRow；因此点击选择、比分、
 * 实际/预测状态都必须由这一处生成相同的卡片字段。
 */
export function createMatchCanvasCard(
  match: MatchRow,
  options: CreateMatchCanvasCardOptions,
): MatchCanvasCard {
  const [redScore = "0", blueScore = "0"] = match.scoreline.split(":");
  const hasWinner = Boolean(match.winnerTeamKey);

  return {
    id: options.id ?? match.matchLabel,
    kind: "match",
    x: options.x,
    y: options.y,
    width: options.width ?? CANVAS_LAYOUT.match.width,
    height: options.height ?? CANVAS_LAYOUT.match.height,
    tone: options.tone,
    orderLabel: options.orderLabel,
    displayLabel: options.displayLabel,
    metaLabel: options.metaLabel,
    variant: options.variant ?? "standard",
    showProbability: options.showProbability ?? false,
    match,
    redSide: {
      teamKey: match.redTeam.teamKey,
      collegeName: match.redTeam.collegeName,
      teamName: match.redTeam.teamName,
      score: redScore,
      probability: match.pSeriesRed,
      side: "red",
      // 官方占位的双方 teamKey 都为空时，不能把两边同时标成胜者。
      isWinner: hasWinner && match.winnerTeamKey === match.redTeam.teamKey,
    },
    blueSide: {
      teamKey: match.blueTeam.teamKey,
      collegeName: match.blueTeam.collegeName,
      teamName: match.blueTeam.teamName,
      score: blueScore,
      probability: match.pSeriesBlue,
      side: "blue",
      isWinner: hasWinner && match.winnerTeamKey === match.blueTeam.teamKey,
    },
  };
}

export type CreateTeamCanvasCardOptions = Omit<
  TeamCanvasCard,
  "kind" | "variant" | "tone" | "width" | "height"
> & {
  variant?: TeamCanvasCard["variant"];
  tone?: CanvasTone;
  width?: number;
  height?: number;
};

/** 区域赛与 finals 共用的队伍/去向/占位卡片构造器。 */
export function createTeamCanvasCard({
  variant = "team",
  tone = "steel",
  width = CANVAS_LAYOUT.team.width,
  height = CANVAS_LAYOUT.team.height,
  ...card
}: CreateTeamCanvasCardOptions): TeamCanvasCard {
  return {
    ...card,
    kind: "team",
    variant,
    tone,
    width,
    height,
  };
}

function cardLeftMid(card: CanvasCard) {
  return { x: card.x - 6, y: card.y + card.height / 2 };
}

/** 在阶段表头之间创建一条可带分支文案的正交流程线。 */
export function connectHeaderBands(
  sourceHeaders: WorkspaceStageHeader[],
  targetHeaders: WorkspaceStageHeader[],
  id: string,
  tone: CanvasTone = "steel",
  branchLabelTexts?: string[],
): CanvasConnector | null {
  if (!sourceHeaders.length || !targetHeaders.length) {
    return null;
  }

  const sourceRight = Math.max(...sourceHeaders.map((header) => header.x + header.width));
  const sourceY =
    sourceHeaders.reduce((sum, header) => sum + header.y + CANVAS_LAYOUT.header.connectorAnchorY, 0) /
    sourceHeaders.length;
  const targetLeft = Math.min(...targetHeaders.map((header) => header.x));
  const targetY =
    targetHeaders.reduce((sum, header) => sum + header.y + CANVAS_LAYOUT.header.connectorAnchorY, 0) /
    targetHeaders.length;
  const branchY = targetHeaders.map((header) => header.y + CANVAS_LAYOUT.header.connectorAnchorY);
  const gap = Math.max(18, targetLeft - sourceRight);

  return {
    id,
    kind: "bracket",
    fromX: sourceRight + 6,
    fromY: sourceY,
    toX: targetLeft - 12,
    toY: targetY,
    viaX: sourceRight + Math.max(18, Math.min(36, gap * 0.5)),
    branchY,
    branchLabels: branchLabelTexts?.map((text, index) => {
      const targetHeader = targetHeaders[index];
      return { text, y: targetHeader ? targetHeader.y - 12 : targetY - 30 };
    }),
    tone,
    weight: tone === "amber" ? "strong" : "normal",
  };
}

/** 多张来源卡片汇入一张目标卡片。 */
export function connectCardGroupToCard(
  sourceCards: Array<CanvasCard | undefined>,
  targetCard: CanvasCard | undefined,
  id: string,
  tone: CanvasTone = "steel",
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

/** 多张来源卡片汇入后，再按战绩池/去向分叉至多张目标卡片。 */
export function connectCardGroupToCards(
  sourceCards: Array<CanvasCard | undefined>,
  targetCards: Array<CanvasCard | undefined>,
  id: string,
  tone: CanvasTone = "steel",
): CanvasConnector | null {
  const resolvedSources = sourceCards.filter((card): card is CanvasCard => Boolean(card));
  const resolvedTargets = targetCards.filter((card): card is CanvasCard => Boolean(card));
  if (!resolvedSources.length || !resolvedTargets.length) {
    return null;
  }

  const fromX = Math.max(...resolvedSources.map((card) => card.x + card.width)) + 6;
  const branchY = resolvedSources.map((card) => card.y + card.height / 2);
  const targetBranchY = resolvedTargets.map((card) => card.y + card.height / 2);
  const toX = Math.min(...resolvedTargets.map((card) => card.x)) - 6;
  const gap = Math.max(24, toX - fromX);

  return {
    id,
    kind: "merge-split",
    fromX,
    fromY: branchY.reduce((sum, y) => sum + y, 0) / branchY.length,
    toX,
    toY: targetBranchY.reduce((sum, y) => sum + y, 0) / targetBranchY.length,
    viaX: fromX + Math.max(24, Math.min(88, gap * 0.42)),
    branchY,
    targetBranchY,
    tone,
    weight: tone === "amber" ? "strong" : "normal",
  };
}
