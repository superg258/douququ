import { hasActualFinalMatchup } from "@/lib/finals-schedule";
import { BEIJING_TIME_ZONE } from "@/lib/time-format";
import type { FinalEventMatch, FinalEventSchedule, FinalEventSlug } from "@/lib/types";

/**
 * 主页「今日赛程带」的数据构建。
 *
 * 优先展示今天（北京时间）有对阵信息的比赛；今天没有比赛时，
 * 退化为接下来最近开赛的若干场。已结束的场次带比分与胜者高亮。
 */

export type ScheduleStripStatus = "completed" | "live" | "upcoming";

export interface ScheduleStripItem {
  id: string;
  eventSlug: FinalEventSlug;
  eventShortName: string;
  matchNumber: number;
  stage: string;
  startsAt: string;
  timeLabel: string;
  redName: string;
  blueName: string;
  hasActualTeams: boolean;
  status: ScheduleStripStatus;
  scoreline: string | null;
  winnerSide: "red" | "blue" | null;
}

export interface ScheduleStripModel {
  kind: "today" | "upcoming";
  dateLabel: string;
  items: ScheduleStripItem[];
}

const UPCOMING_FALLBACK_COUNT = 5;

function beijingDateKey(value: string | Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(typeof value === "string" ? new Date(value) : value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function beijingTimeLabel(value: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.hour}:${parts.minute}`;
}

function beijingDateLabel(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    month: "long",
    day: "numeric",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function matchScoreline(match: FinalEventMatch) {
  if (typeof match.redWins === "number" && typeof match.blueWins === "number") {
    return `${match.redWins}:${match.blueWins}`;
  }
  const scoreline = String(match.scoreline ?? "").trim();
  return /^\d+:\d+$/.test(scoreline) ? scoreline : null;
}

function matchWinnerSide(match: FinalEventMatch, scoreline: string | null) {
  const result = String(match.result ?? "").trim().toLowerCase();
  if (result === "red" || result === "blue") return result;
  if (!scoreline) return null;
  const [red, blue] = scoreline.split(":").map(Number);
  if (red === blue) return null;
  return red > blue ? "red" as const : "blue" as const;
}

function toStripItem(
  eventSlug: FinalEventSlug,
  eventShortName: string,
  match: FinalEventMatch,
  nowMs: number,
): ScheduleStripItem {
  const completed = match.isCompleted === true;
  const startMs = Date.parse(match.startsAt);
  const endMs = Date.parse(match.endsAt);
  const live = !completed && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && nowMs <= endMs;
  const scoreline = completed ? matchScoreline(match) : null;
  const hasActualTeams = hasActualFinalMatchup(match);
  return {
    id: `${eventSlug}:${match.number}`,
    eventSlug,
    eventShortName,
    matchNumber: match.number,
    stage: match.stage,
    startsAt: match.startsAt,
    timeLabel: beijingTimeLabel(match.startsAt),
    redName: match.redCollegeName ?? match.redSlot,
    blueName: match.blueCollegeName ?? match.blueSlot,
    hasActualTeams,
    status: completed ? "completed" : live ? "live" : "upcoming",
    scoreline,
    winnerSide: completed ? matchWinnerSide(match, scoreline) : null,
  };
}

export function buildScheduleStrip(
  events: Record<FinalEventSlug, Pick<FinalEventSchedule, "shortName" | "matches">>,
  now: Date,
): ScheduleStripModel | null {
  const nowMs = now.getTime();
  const all = (Object.entries(events) as Array<[FinalEventSlug, Pick<FinalEventSchedule, "shortName" | "matches">]>)
    .flatMap(([eventSlug, event]) => event.matches.map((match) => ({ eventSlug, eventShortName: event.shortName, match })))
    .filter(({ match }) => Boolean(match.startsAt))
    .sort((left, right) => left.match.startsAt.localeCompare(right.match.startsAt));

  if (all.length === 0) return null;

  const todayKey = beijingDateKey(now);
  const todayRows = all.filter(({ match }) => beijingDateKey(match.startsAt) === todayKey);

  if (todayRows.length > 0) {
    return {
      kind: "today",
      dateLabel: beijingDateLabel(now),
      items: todayRows.map(({ eventSlug, eventShortName, match }) => toStripItem(eventSlug, eventShortName, match, nowMs)),
    };
  }

  const upcomingRows = all
    .filter(({ match }) => match.isCompleted !== true && Date.parse(match.startsAt) >= nowMs)
    .slice(0, UPCOMING_FALLBACK_COUNT);
  if (upcomingRows.length === 0) return null;
  return {
    kind: "upcoming",
    dateLabel: beijingDateLabel(upcomingRows[0].match.startsAt),
    items: upcomingRows.map(({ eventSlug, eventShortName, match }) => toStripItem(eventSlug, eventShortName, match, nowMs)),
  };
}
