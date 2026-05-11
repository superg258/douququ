import { buildRegionHref, REGION_LABELS } from "@/lib/region-config";
import type {
  PrematchCenterMatch,
  PrematchCenterResponse,
  PrematchDataSource,
  PrematchTimelineState,
} from "@/lib/types";
import { formatBeijingMonthDayTime, formatBeijingTime, getBeijingHour } from "@/lib/time-format";

const DATA_SOURCE_LABELS: Record<PrematchDataSource, string> = {
  official_live: "官方对阵",
  simulation: "模拟预测",
  simulation_proxy: "模拟预测",
};

export function getDataSourceLabel(
  source: PrematchDataSource,
  scheduleState?: PrematchCenterMatch["scheduleState"],
  timelineState?: PrematchTimelineState
) {
  if (source === "official_live") {
    if (timelineState === "review_pending") return "官方赛果";
    if (scheduleState === "official_placeholder") return "官方排期";
    if (scheduleState === "scheduled" || scheduleState === "confirmed_unfinished") return "官方对阵";
  }
  return DATA_SOURCE_LABELS[source] ?? source;
}

const TIMELINE_STATE_LABELS: Record<PrematchTimelineState, string> = {
  live_now: "正在进行",
  up_next: "即将开赛",
  today_pending: "尚未开赛",
  confirmed_upcoming: "已确认未开赛",
  overdue_unresolved: "已过期未同步",
  simulation_unassigned: "待排期",
  review_pending: "已完赛",
};

export function getTimelineStateLabel(state: PrematchTimelineState) {
  return TIMELINE_STATE_LABELS[state] ?? state;
}

export function isVisiblePrematchSchedule(match: PrematchCenterMatch) {
  return (
    match.scheduleState === "scheduled" ||
    match.scheduleState === "confirmed_unfinished" ||
    match.scheduleState === "official_placeholder" ||
    (match.scheduleState === "simulation_proxy" && Boolean(match.plannedStartAt))
  );
}

export function isOfficialPrematchSchedule(match: PrematchCenterMatch) {
  return (
    match.dataSource === "official_live" &&
    (match.scheduleState === "scheduled" || match.scheduleState === "confirmed_unfinished")
  );
}

export function getPrematchTimelineDisplayLabel(match: PrematchCenterMatch) {
  if (match.scheduleState === "official_placeholder") {
    return "官方排期";
  }
  if (match.scheduleState === "simulation_proxy" || match.dataSource === "simulation_proxy") {
    return "模拟预测";
  }
  return match.timelineState ? getTimelineStateLabel(match.timelineState) : "";
}

export function buildPrematchHref(match: PrematchCenterMatch) {
  const targetMode = match.dataSource === "official_live" ? "live" : "sim";
  return buildRegionHref(match.regionSlug, match.workspaceView, {
    seed: match.seed,
    mode: targetMode,
    highlight: match.predictedWinnerTeamKey,
  });
}

export function buildPrematchScheduleHref(match: PrematchCenterMatch) {
  const targetMode = match.dataSource === "official_live" ? "live" : "sim";
  return buildRegionHref(match.regionSlug, match.workspaceView, {
    seed: match.seed,
    mode: targetMode,
  });
}

export function formatPrematchTime(value: string | null) {
  return formatBeijingTime(value);
}

export function formatPrematchMonthDayTime(value: string | null) {
  return formatBeijingMonthDayTime(value);
}

export function formatEmptyStateCount(completedCount: number) {
  return `已完赛 ${completedCount} 场。可以进入赛区沙盘查看实时回放、预测命中情况与最终排名。`;
}

export function isPrematchCompleteState(
  data: Pick<PrematchCenterResponse, "completedMatchCount" | "pendingMatchCount">
) {
  return data.pendingMatchCount === 0 && data.completedMatchCount > 0;
}

export function shouldUseAnimatedPrematchEmptyShell({
  completedMatchCount,
  pendingMatchCount,
  officialPlaceholderMatchCount = 0,
  scheduledMatchCount,
}: {
  completedMatchCount: number;
  pendingMatchCount: number;
  officialPlaceholderMatchCount?: number;
  scheduledMatchCount: number;
}) {
  const isAllDone = pendingMatchCount === 0 && completedMatchCount > 0;
  const isPrestartEmpty = pendingMatchCount === 0 && completedMatchCount === 0;
  const isOfficialPlaceholderOnly = scheduledMatchCount === 0 && officialPlaceholderMatchCount > 0;
  return isAllDone || isPrestartEmpty || isOfficialPlaceholderOnly;
}

export function getNoScheduledStateCopy(pendingMatchCount: number, officialPlaceholderCount = 0) {
  if (pendingMatchCount === 0) {
    return {
      title: "官方赛程尚未开始同步",
      description:
        "当前还没有接入已排期或已开赛的官方赛程。待官方同步排期后，这里会展示下一场、焦点战和实时预测入口。",
    };
  }

  if (officialPlaceholderCount > 0) {
    return {
      title: "官方排期已同步，对阵待确认",
      description: `当前 ${officialPlaceholderCount} 场官方排期仍为占位状态，真实对阵确认后会进入实时预测列表。`,
    };
  }

  return {
    title: "暂无可行动官方对阵",
    description: `当前 ${pendingMatchCount} 场未赛均为模拟推演。待官方确认对阵后，已排期场次将在此展示。`,
  };
}

export function buildRegionRankingHref(regionSlug: string) {
  return buildRegionHref(regionSlug as PrematchCenterMatch["regionSlug"], "final-rankings");
}

export const EMPTY_STATE_REGION_LINKS = (
  ["south_region", "east_region", "north_region"] as const
).map((slug) => ({
  regionSlug: slug,
  label: `${REGION_LABELS[slug]}最终排名`,
  href: buildRegionRankingHref(slug),
}));

export type TimeBlock = "上午" | "下午" | "晚间";

const SPOTLIGHT_LIMIT = 3;
const STRONG_TEAM_RANK_CUTOFF = 32;
const CLOSE_MATCH_BONUS_MARGIN = 0.3;
const CLOSE_MATCH_MAX_BONUS = 15;
const MODERATE_BLOWOUT_MARGIN = 0.6;
const HEAVY_BLOWOUT_MARGIN = 0.75;
const MODERATE_BLOWOUT_PENALTY = 15;
const HEAVY_BLOWOUT_PENALTY = 35;
const COMBINED_SIGNAL_SECONDARY_FACTOR = 0.35;

export function getTimeBlockLabel(isoString: string | null): TimeBlock | null {
  const hour = getBeijingHour(isoString);
  if (hour === null) return null;
  if (hour < 12) return "上午";
  if (hour < 18) return "下午";
  return "晚间";
}

const TIME_BLOCK_ORDER: Record<TimeBlock, number> = { 上午: 0, 下午: 1, 晚间: 2 };

export function groupByTimeBlock<T extends { plannedStartAt: string | null }>(
  items: T[]
): { block: TimeBlock; items: T[] }[] {
  const groups = new Map<TimeBlock, T[]>();
  for (const item of items) {
    const block = getTimeBlockLabel(item.plannedStartAt) ?? "上午";
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block)!.push(item);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => TIME_BLOCK_ORDER[a] - TIME_BLOCK_ORDER[b])
    .map(([block, items]) => ({ block, items }));
}

export function formatPrematchDate(
  dateStr: string | null
): { dateLabel: string; weekday: string } | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return {
      dateLabel: `${d.getMonth() + 1}月${d.getDate()}日`,
      weekday: weekdays[d.getDay()],
    };
  } catch {
    return null;
  }
}

export function groupByDate<T extends { plannedLocalDate: string | null }>(
  items: T[]
): { dateLabel: string; weekday: string; items: T[] }[] {
  const groups = new Map<string, { dateLabel: string; weekday: string; items: T[] }>();
  for (const item of items) {
    const key = item.plannedLocalDate ?? "__none__";
    if (!groups.has(key)) {
      const fmt = formatPrematchDate(item.plannedLocalDate);
      groups.set(key, {
        dateLabel: fmt?.dateLabel ?? "待定",
        weekday: fmt?.weekday ?? "",
        items: [],
      });
    }
    groups.get(key)!.items.push(item);
  }
  return Array.from(groups.values());
}

function plannedStartTimestamp(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function comparePrematchTime(a: PrematchCenterMatch, b: PrematchCenterMatch) {
  const timeDelta = plannedStartTimestamp(a.plannedStartAt) - plannedStartTimestamp(b.plannedStartAt);
  if (timeDelta !== 0) return timeDelta;
  const stageDelta = a.stageOrder - b.stageOrder;
  if (stageDelta !== 0) return stageDelta;
  const roundDelta = a.roundNumber - b.roundNumber;
  if (roundDelta !== 0) return roundDelta;
  return a.matchLabel.localeCompare(b.matchLabel, "zh-CN");
}

export function sortPrematchMatchesByTime<T extends PrematchCenterMatch>(matches: T[]): T[] {
  return [...matches].sort(comparePrematchTime);
}

function strongTeamSignalScore(rank: number | null | undefined) {
  if (typeof rank !== "number" || rank > STRONG_TEAM_RANK_CUTOFF) return 0;
  if (rank <= 4) return 70;
  if (rank <= 8) return 60;
  return 50;
}

function overperformerSignalScore(
  isSeasonOverperformer: boolean | undefined,
  delta: number | null | undefined
) {
  if (!isSeasonOverperformer) return 0;
  if (typeof delta !== "number") return 60;
  if (delta >= 60) return 80;
  if (delta >= 40) return 70;
  return 60;
}

function combineTeamSignal(primary: number, secondary: number) {
  if (primary <= 0 && secondary <= 0) return 0;
  const high = Math.max(primary, secondary);
  const low = Math.min(primary, secondary);
  return high + low * COMBINED_SIGNAL_SECONDARY_FACTOR;
}

function teamSpotlightSignal(match: PrematchCenterMatch, side: "red" | "blue") {
  const strongScore = strongTeamSignalScore(
    side === "red" ? match.redTeamGlobalRank : match.blueTeamGlobalRank
  );
  const overperformerScore = overperformerSignalScore(
    side === "red" ? match.redSeasonOverperformer : match.blueSeasonOverperformer,
    side === "red" ? match.redEloDeltaFromPreseason : match.blueEloDeltaFromPreseason
  );
  return combineTeamSignal(strongScore, overperformerScore);
}

function competitiveBonus(match: PrematchCenterMatch) {
  if (match.margin >= CLOSE_MATCH_BONUS_MARGIN) return 0;
  return ((CLOSE_MATCH_BONUS_MARGIN - match.margin) / CLOSE_MATCH_BONUS_MARGIN) * CLOSE_MATCH_MAX_BONUS;
}

function blowoutPenalty(match: PrematchCenterMatch) {
  if (match.margin >= HEAVY_BLOWOUT_MARGIN) return HEAVY_BLOWOUT_PENALTY;
  if (match.margin >= MODERATE_BLOWOUT_MARGIN) return MODERATE_BLOWOUT_PENALTY;
  return 0;
}

function isSpotlightCandidate(match: PrematchCenterMatch) {
  return teamSpotlightSignal(match, "red") > 0 && teamSpotlightSignal(match, "blue") > 0;
}

function spotlightPriority(match: PrematchCenterMatch) {
  if (!isSpotlightCandidate(match)) return 0;
  return (
    teamSpotlightSignal(match, "red") +
    teamSpotlightSignal(match, "blue") +
    competitiveBonus(match) -
    blowoutPenalty(match)
  );
}

export function selectSpotlightMatches<T extends PrematchCenterMatch>(
  matches: T[],
  limit = SPOTLIGHT_LIMIT
): T[] {
  return [...matches]
    .filter((match) => isOfficialPrematchSchedule(match) && isSpotlightCandidate(match))
    .sort((a, b) => {
      const priorityDelta = spotlightPriority(b) - spotlightPriority(a);
      if (priorityDelta !== 0) return priorityDelta;
      return comparePrematchTime(a, b);
    })
    .slice(0, limit)
    .sort(comparePrematchTime);
}
