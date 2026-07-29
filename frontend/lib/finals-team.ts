import { buildFinalsMatchRow } from "@/lib/finals-match-adapter";
import type { FinalsStageProbabilityProjection } from "@/lib/finals-schedule";
import type { FinalsEventSimulation } from "@/lib/finals-simulation";
import type {
  FinalEventParticipant,
  FinalEventResponse,
  FinalEventSchedule,
  FinalEventSlug,
  FinalEventsSnapshotResponse,
  MatchRow,
  OverviewResponse,
} from "@/lib/types";

/** 决赛终端去向 → 展示文案（预测中心情报面板与队伍详情页共用）。 */
export const FINALS_OUTCOME_LABELS: Record<string, string> = {
  全国赛: "晋级全国赛",
  十六强: "晋级十六强",
  淘汰: "淘汰",
};

/**
 * 决赛阶段（复活赛 / 全国赛）「队伍视角」推导逻辑。
 *
 * 从 forecast-center-page 的内联 useMemo 原样抽取，供预测中心情报面板与
 * 队伍详情页共用：参赛名单查询、赛程路径、模拟最终去向、阶段概率映射。
 */

export interface FinalsTeamParticipation {
  repechage: FinalEventParticipant | null;
  nationals: FinalEventParticipant | null;
}

/** 在两项正式赛事的参赛名单中分别按 teamKey 查找队伍。 */
export function findFinalsParticipation(
  events:
    | { repechage?: FinalEventResponse | null; nationals?: FinalEventResponse | null }
    | FinalEventsSnapshotResponse["events"],
  teamKey: string,
): FinalsTeamParticipation {
  return {
    repechage: events.repechage?.event.participants.find((participant) => participant.teamKey === teamKey) ?? null,
    nationals: events.nationals?.event.participants.find((participant) => participant.teamKey === teamKey) ?? null,
  };
}

/**
 * 队伍在该赛事中的赛程路径（按场次号升序）。
 *
 * 默认仅展示官方已确认的赛程：已有真实赛果，或对阵双方已官方落位；
 * 纯沙盘推演、尚未官方确认的对阵会被过滤。
 * 模拟模式可传 `{ includeProjected: true }` 保留纯推演场次，展示完整模拟路径。
 */
export function buildFinalsTeamPath(
  event: FinalEventSchedule,
  simulation: FinalsEventSimulation,
  teamKey: string,
  options?: { includeProjected?: boolean },
): MatchRow[] {
  return event.matches
    .filter((match) => {
      const result = simulation.matchResults.get(match.number);
      if (!result) return false;
      // 仅展示官方已确认的赛程：已有真实赛果，或对阵双方已官方落位
      if (!options?.includeProjected && !result.isRealResult && !result.isConfirmedMatchup) return false;
      return result.red?.teamKey === teamKey || result.blue?.teamKey === teamKey;
    })
    .sort((left, right) => left.number - right.number)
    .map((match) => buildFinalsMatchRow(event, match, simulation.matchResults.get(match.number)));
}

/** 队伍在模拟终端去向（terminalOutcomes）中的 destination；未出现时为 null。 */
export function resolveFinalsTeamOutcome(
  simulation: FinalsEventSimulation,
  teamKey: string,
): string | null {
  for (const [destination, teams] of simulation.terminalOutcomes) {
    if (teams.some((team) => team.teamKey === teamKey)) return destination;
  }
  return null;
}

/** 与 finals-simulation 内部一致：官方流向标签去掉括号后缀再匹配槽位。 */
function normalizeOutcomeFlowLabel(label: string) {
  return label.replace(/（[^）]*）$/u, "");
}

/**
 * 仅由真实赛果支撑的队伍去向（实时模式专用，不写预测去向）。
 * 判定顺序：真实淘汰赛终点（最深场次）→ 瑞士轮真实赛果数学锁定晋级 → 数学锁定淘汰；
 * 无任何真实依据时返回 null（赛事未开打/未锁定时不展示去向）。
 */
export function resolveLockedTeamOutcome(
  event: FinalEventSchedule,
  simulation: FinalsEventSimulation,
  teamKey: string,
): string | null {
  // 终点 = 不是任何比赛槽位的流向目的地（如 "全国赛"/"冠军"/"淘汰"）
  const slotLabels = new Set<string>();
  for (const match of event.matches) {
    slotLabels.add(normalizeOutcomeFlowLabel(match.redSlot));
    slotLabels.add(normalizeOutcomeFlowLabel(match.blueSlot));
  }
  const isTerminalDestination = (destination: string | null): destination is string =>
    destination !== null && !slotLabels.has(normalizeOutcomeFlowLabel(destination));

  let terminalOutcome: string | null = null;
  let deepestMatchNumber = -1;
  for (const match of event.matches) {
    if (match.stageKey === "swiss") continue;
    const result = simulation.matchResults.get(match.number);
    if (!result?.isRealResult || !result.winnerSide) continue;
    const winnerKey = result.winnerSide === "red" ? result.red?.teamKey : result.blue?.teamKey;
    const loserKey = result.winnerSide === "red" ? result.blue?.teamKey : result.red?.teamKey;
    let destination: string | null = null;
    if (winnerKey === teamKey && isTerminalDestination(match.winnerTo)) destination = match.winnerTo;
    if (loserKey === teamKey && isTerminalDestination(match.loserTo)) destination = match.loserTo;
    if (destination && match.number > deepestMatchNumber) {
      terminalOutcome = destination;
      deepestMatchNumber = match.number;
    }
  }
  if (terminalOutcome) return terminalOutcome;
  if (simulation.lockedQualifierTeamKeys.includes(teamKey)) {
    return event.slug === "repechage" ? "全国赛" : "十六强";
  }
  if (simulation.lockedEliminatedTeamKeys.includes(teamKey)) return "淘汰";
  return null;
}

export interface FinalsTeamStageRates {
  advancementRate?: number;
  groupAdvancementRate?: number;
  topEightRate?: number;
  topFourRate?: number;
  championRate?: number;
}

/**
 * 从阶段概率投影中取队伍在指定赛事下的各阶段概率。
 * 无投影或队伍不在对应名单时返回空对象。
 */
export function resolveFinalsStageRates(
  projection: FinalsStageProbabilityProjection | null,
  eventSlug: FinalEventSlug,
  teamKey: string,
): FinalsTeamStageRates {
  if (!projection) return {};
  if (eventSlug === "repechage") {
    return { ...projection.repechage.get(teamKey) };
  }
  return { ...projection.nationals.get(teamKey) };
}

/**
 * 决赛区块的数据可用性门槛：两项正式赛事快照与总览齐全时，
 * 模拟与概率推导才有输入；任一缺失时决赛区块整体降级隐藏（队伍页）。
 */
export function hasFinalsStageData(
  events:
    | { repechage?: FinalEventResponse | null; nationals?: FinalEventResponse | null }
    | Partial<Record<FinalEventSlug, FinalEventResponse>>,
  overview: OverviewResponse | null | undefined,
): boolean {
  return Boolean(events.repechage && events.nationals && overview);
}

/** 从模拟抽签结果（槽位 → teamKey）反查队伍的落位槽位（如 "A1"）。 */
export function resolveFinalsDrawSlot(
  simulation: FinalsEventSimulation | null | undefined,
  teamKey: string,
): string | null {
  if (!simulation) return null;
  for (const [slot, assignedTeamKey] of Object.entries(simulation.drawAssignments)) {
    if (assignedTeamKey === teamKey) return slot;
  }
  return null;
}

/** 在官方赛程对阵中查找队伍已落位的抽签槽位；尚未官方落位时返回 null。 */
export function findFinalsOfficialSlot(
  event: FinalEventSchedule,
  teamKey: string,
): string | null {
  for (const match of event.matches) {
    if (match.redTeamKey === teamKey && match.redSlot) return match.redSlot;
    if (match.blueTeamKey === teamKey && match.blueSlot) return match.blueSlot;
  }
  return null;
}

export interface TeamFinalsMetricCard {
  key: "advancement" | "groupAdvancement" | "topFour" | "champion";
  label: string;
  tone: "blue" | "gold";
  value: number | undefined;
}

/**
 * 队伍页指标卡的决赛自适应模型（Elo 卡之外的 3 张概率卡）：
 * - 复活赛队伍：复活赛晋级率（蓝）＋国赛四强率／冠军率（金，来自开放名额推算池）；
 * - 全国赛队伍：十六强率（蓝）＋四强率／冠军率（金）；
 * - 未晋级决赛阶段：返回 null，页面保持区域赛四卡。
 */
export function resolveTeamFinalsCardModel(
  participation: FinalsTeamParticipation,
  rates: { repechage: FinalsTeamStageRates; nationals: FinalsTeamStageRates },
): TeamFinalsMetricCard[] | null {
  if (participation.repechage) {
    return [
      { key: "advancement", label: "复活赛晋级率", tone: "blue", value: rates.repechage.advancementRate },
      { key: "topFour", label: "国赛四强率", tone: "gold", value: rates.nationals.topFourRate },
      { key: "champion", label: "国赛冠军率", tone: "gold", value: rates.nationals.championRate },
    ];
  }
  if (participation.nationals) {
    return [
      { key: "groupAdvancement", label: "十六强率", tone: "blue", value: rates.nationals.groupAdvancementRate },
      { key: "topFour", label: "四强率", tone: "gold", value: rates.nationals.topFourRate },
      { key: "champion", label: "冠军率", tone: "gold", value: rates.nationals.championRate },
    ];
  }
  return null;
}
