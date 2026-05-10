export const BEIJING_TIME_ZONE = "Asia/Shanghai";

function parseDateTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function partsByType(parts: Intl.DateTimeFormatPart[]) {
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatBeijingTime(value: string | null | undefined) {
  const parsed = parseDateTime(value);
  if (!parsed) return null;
  const parts = partsByType(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(parsed)
  );
  return `${parts.hour}:${parts.minute}`;
}

export function formatBeijingMonthDayTime(value: string | null | undefined) {
  const parsed = parseDateTime(value);
  if (!parsed) return null;
  const parts = partsByType(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(parsed)
  );
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function getBeijingHour(value: string | null | undefined) {
  const parsed = parseDateTime(value);
  if (!parsed) return null;
  const parts = partsByType(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(parsed)
  );
  const hour = Number(parts.hour);
  return Number.isFinite(hour) ? hour : null;
}
