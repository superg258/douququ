import { describe, expect, it } from "vitest";

import { buildLiveCommandCenter } from "@/lib/live-command-center";
import type { OverviewResponse } from "@/lib/types";

function makeOverview(): OverviewResponse {
  return {
    generatedAt: "2026-04-18T10:00:00.000Z",
    regions: [
      {
        regionSlug: "north_region",
        regionName: "北部赛区",
        nationalSlots: 10,
        repechageSlots: 4,
        monteCarlo: {
          aggregationMode: "seed_average",
          seedCount: 1,
          iterationsPerSeed: 100000,
          effectiveIterations: 100000,
          seeds: [20260414],
          pairProbabilitySamples: 1000,
        },
        liveStatus: {
          sourceStatus: "missing",
          sourceReason: "official schedule pending",
          sourceUpdatedAt: null,
          completedOfficialMatches: 0,
          confirmedOfficialMatches: 0,
          ledgerRows: 0,
        },
        teams: [],
      },
    ],
  };
}

describe("live command center", () => {
  it("keeps homepage prediction entry live-only when realtime schedule is unavailable", () => {
    const commandCenter = buildLiveCommandCenter(makeOverview());

    expect(commandCenter.source).toBe("live");
    expect(commandCenter.sections.map(({ id, title, tone, emptyLabel }) => ({ id, title, tone, emptyLabel }))).toEqual([
      { id: "live-now", title: "正在进行", tone: "green", emptyLabel: "等待官方源" },
      { id: "up-next", title: "即将开赛", tone: "amber", emptyLabel: "等待官方源" },
      { id: "confirmed-upcoming", title: "已确认未开赛", tone: "blue", emptyLabel: "等待官方源" },
      { id: "upset-results", title: "赛后爆冷", tone: "red", emptyLabel: "等待官方源" },
      { id: "vote-split", title: "投票分歧", tone: "steel", emptyLabel: "等待官方源" },
      { id: "review-pending", title: "赛果待复盘", tone: "steel", emptyLabel: "等待官方源" },
    ]);
    expect(commandCenter.sections.every((section) => section.items.length === 0)).toBe(true);
    expect(commandCenter.unavailableReason).toContain("实时赛程");
    expect(commandCenter.unavailableReason).not.toContain("模拟");
  });
});
