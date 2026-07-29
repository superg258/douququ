import { describe, expect, it } from "vitest";

import {
  deriveRealtimeAvailability,
  liveStateRefreshKey,
} from "@/lib/realtime";
import type { LiveStateResponse } from "@/lib/types";

const activeSourceStatus = {
  sourceKind: "official" as const,
  isSynthetic: false,
  sourceAgeSeconds: 0,
  freshnessLabel: "fresh" as const,
  validationState: "validated" as const,
  scenarioId: null,
  runtimeArtifactVersion: "runtime:test",
  completedMatches: 0,
  confirmedMatches: 0,
};

describe("realtime helpers", () => {
  it("describes active schedule shells separately from completed live results", () => {
    const liveState: LiveStateResponse = {
      ...activeSourceStatus,
      available: true,
      reason: null,
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
      officialScheduleMatches: 8,
      officialPlaceholderMatches: 0,
      liveDataLevel: "official_results",
      liveDataLabel: "官方赛果已接入",
      currentSnapshot: [],
      matchLedger: [],
      teamIndex: {},
    } as LiveStateResponse;

    const scheduleShell = {
      ...liveState,
      available: false,
      completedOfficialMatches: 0,
      confirmedOfficialMatches: 0,
      officialScheduleMatches: 88,
      officialPlaceholderMatches: 88,
      liveDataLevel: "schedule_shell",
      liveDataLabel: "官方排期已接入，对阵待确认",
    } as LiveStateResponse;

    expect(deriveRealtimeAvailability("south_region", liveState)).toEqual({
      enabled: true,
      badge: "官方赛果",
      hint: "官方赛果已接入",
    });
    expect(deriveRealtimeAvailability("south_region", scheduleShell)).toEqual({
      enabled: true,
      badge: "官方排期",
      hint: "官方排期已接入，对阵待确认",
    });
    expect(deriveRealtimeAvailability("east_region", liveState).enabled).toBe(false);
  });

  it("reports a Chinese inactive reason when the official source is not RMUC", () => {
    const liveState: LiveStateResponse = {
      ...activeSourceStatus,
      available: false,
      reason: "当前官方 live_json 不是 RMUC 超级对抗赛",
      sourceStatus: "inactive",
      sourceAgeSeconds: null,
      freshnessLabel: "unknown",
      validationState: "inactive",
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

  it("changes the live simulation refresh key when runtime artifacts change without count changes", () => {
    const liveState: LiveStateResponse = {
      ...activeSourceStatus,
      available: true,
      reason: null,
      sourceStatus: "active",
      sourceReason: null,
      regionSlug: "south_region",
      regionName: "南部赛区",
      generatedAt: "2026-05-11T07:03:03+00:00",
      runtimeArtifactVersion: "ledger:old",
      season: 2026,
      sourceUpdatedAt: "2026-05-10T12:00:00+08:00",
      completedOfficialMatches: 1,
      confirmedOfficialMatches: 16,
      ledgerRows: 2,
      officialScheduleMatches: 88,
      officialPlaceholderMatches: 72,
      liveDataLevel: "official_results",
      liveDataLabel: "官方赛果已接入",
      currentSnapshot: [],
      matchLedger: [],
      teamIndex: {},
    };

    expect(
      liveStateRefreshKey({
        ...liveState,
        runtimeArtifactVersion: "ledger:new",
      })
    ).not.toBe(liveStateRefreshKey(liveState));
  });
});
