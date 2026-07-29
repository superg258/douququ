import { describe, expect, it } from "vitest";

import { buildScheduleStrip } from "@/lib/schedule-strip";
import type { FinalEventMatch, FinalEventSchedule, FinalEventSlug } from "@/lib/types";

function match(partial: Partial<FinalEventMatch> & { number: number; startsAt: string }): FinalEventMatch {
  return {
    stageKey: "swiss",
    stage: "瑞士轮",
    bestOf: 3,
    redSlot: "A1",
    blueSlot: "A2",
    winnerTo: null,
    loserTo: null,
    startTime: "",
    endTime: "",
    endsAt: partial.startsAt,
    ...partial,
  };
}

function event(slug: FinalEventSlug, matches: FinalEventMatch[]): Pick<FinalEventSchedule, "shortName" | "matches"> {
  return { shortName: slug === "repechage" ? "复活赛" : "全国赛", matches };
}

describe("buildScheduleStrip", () => {
  const completedToday = match({
    number: 1,
    startsAt: "2026-07-30T10:00:00+08:00",
    endsAt: "2026-07-30T10:40:00+08:00",
    isCompleted: true,
    redWins: 2,
    blueWins: 1,
    redCollegeName: "红方大学",
    blueCollegeName: "蓝方大学",
  });
  const upcomingToday = match({
    number: 2,
    startsAt: "2026-07-30T19:00:00+08:00",
    endsAt: "2026-07-30T19:40:00+08:00",
    redCollegeName: "丙大学",
    blueCollegeName: "丁大学",
  });
  const futureMatch = match({
    number: 3,
    startsAt: "2026-08-02T10:00:00+08:00",
    endsAt: "2026-08-02T10:40:00+08:00",
  });

  it("今天有比赛时返回 today 模式并按时间排序", () => {
    const model = buildScheduleStrip(
      { repechage: event("repechage", [upcomingToday, completedToday]), nationals: event("nationals", [futureMatch]) },
      new Date("2026-07-30T12:00:00+08:00"),
    );
    expect(model?.kind).toBe("today");
    expect(model?.items.map((item) => item.matchNumber)).toEqual([1, 2]);
    expect(model?.dateLabel).toBe("7月30日");
  });

  it("已结束场次带比分与胜者", () => {
    const model = buildScheduleStrip(
      { repechage: event("repechage", [completedToday, upcomingToday]), nationals: event("nationals", []) },
      new Date("2026-07-30T12:00:00+08:00"),
    );
    const done = model?.items.find((item) => item.matchNumber === 1);
    expect(done?.status).toBe("completed");
    expect(done?.scoreline).toBe("2:1");
    expect(done?.winnerSide).toBe("red");
    const pending = model?.items.find((item) => item.matchNumber === 2);
    expect(pending?.status).toBe("upcoming");
    expect(pending?.timeLabel).toBe("19:00");
  });

  it("比赛时间窗口内标记为进行中", () => {
    const model = buildScheduleStrip(
      { repechage: event("repechage", [completedToday, upcomingToday]), nationals: event("nationals", []) },
      new Date("2026-07-30T19:20:00+08:00"),
    );
    const live = model?.items.find((item) => item.matchNumber === 2);
    expect(live?.status).toBe("live");
  });

  it("今天没有比赛时退化为接下来最近开赛场次", () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      match({
        number: index + 10,
        startsAt: `2026-08-0${Math.floor(index / 9) + 2}T1${index}:00:00+08:00`,
        endsAt: `2026-08-0${Math.floor(index / 9) + 2}T1${index}:40:00+08:00`,
      }));
    const model = buildScheduleStrip(
      { repechage: event("repechage", rows), nationals: event("nationals", []) },
      new Date("2026-07-30T12:00:00+08:00"),
    );
    expect(model?.kind).toBe("upcoming");
    expect(model?.items).toHaveLength(5);
    expect(model?.items[0]?.matchNumber).toBe(10);
  });

  it("没有赛程数据时返回 null", () => {
    const model = buildScheduleStrip(
      { repechage: event("repechage", []), nationals: event("nationals", []) },
      new Date("2026-07-30T12:00:00+08:00"),
    );
    expect(model).toBeNull();
  });

  it("缺少真实对阵时展示槽位名", () => {
    const model = buildScheduleStrip(
      { repechage: event("repechage", [futureMatch]), nationals: event("nationals", []) },
      new Date("2026-08-02T09:00:00+08:00"),
    );
    const item = model?.items[0];
    expect(item?.redName).toBe("A1");
    expect(item?.hasActualTeams).toBe(false);
  });
});
