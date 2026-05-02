import { describe, expect, it } from "vitest";

import {
  deriveRealtimeAvailability,
  formatMiniProgramPrediction,
} from "@/lib/realtime";
import type { LiveStateResponse, MiniProgramPrediction } from "@/lib/types";

describe("realtime helpers", () => {
  it("enables live mode only when the live source is active for the current region", () => {
    const liveState: LiveStateResponse = {
      available: true,
      sourceStatus: "active",
      sourceReason: null,
      regionSlug: "south_region",
      regionName: "南部赛区",
      generatedAt: "2026-04-27T00:00:00+00:00",
      season: 2026,
      sourceUpdatedAt: "2026-04-27T00:00:00+00:00",
      completedOfficialMatches: 1,
      confirmedOfficialMatches: 2,
      ledgerRows: 2,
      currentSnapshot: [],
      matchLedger: [],
      teamIndex: {},
    };

    expect(deriveRealtimeAvailability("south_region", liveState)).toEqual({
      enabled: true,
      badge: "实时数据",
      hint: "实时数据已连接",
    });
    expect(deriveRealtimeAvailability("east_region", liveState).enabled).toBe(false);
  });

  it("reports a Chinese inactive reason when the official source is not RMUC", () => {
    const liveState: LiveStateResponse = {
      available: false,
      sourceStatus: "inactive",
      sourceReason: "当前官方 live_json 不是 RMUC 超级对抗赛",
      regionSlug: "south_region",
      regionName: "南部赛区",
      generatedAt: null,
      season: null,
      sourceUpdatedAt: null,
      completedOfficialMatches: 0,
      confirmedOfficialMatches: 0,
      ledgerRows: 0,
      currentSnapshot: [],
      matchLedger: [],
      teamIndex: {},
    };

    expect(deriveRealtimeAvailability("south_region", liveState)).toEqual({
      enabled: false,
      badge: "暂无实时",
      hint: "当前官方 live_json 不是 RMUC 超级对抗赛",
    });
  });

  it("formats mini-program predictions and unavailable states separately from model probability", () => {
    const prediction: MiniProgramPrediction = {
      status: "available",
      matchId: "296001",
      redCount: 7,
      blueCount: 3,
      tieCount: 0,
      totalCount: 10,
      redRate: 0.7,
      blueRate: 0.3,
      tieRate: 0,
      fetchedAt: "2026-04-27T00:00:00+00:00",
    };

    expect(formatMiniProgramPrediction(prediction)).toBe("王牌预言家 红 70.0% / 蓝 30.0%");
    expect(formatMiniProgramPrediction({ status: "unavailable", matchId: "296001", reason: "network" })).toBe("王牌预言家 暂未开放");
    expect(formatMiniProgramPrediction(undefined)).toBeNull();
  });
});
