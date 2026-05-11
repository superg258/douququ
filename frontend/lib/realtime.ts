import type { LiveStateResponse, LiveStatusSummary, MiniProgramPrediction, RegionSlug } from "@/lib/types";

type RealtimeState = LiveStateResponse | LiveStatusSummary | null | undefined;

export interface RealtimeAvailability {
  enabled: boolean;
  badge: "官方赛果" | "官方对阵" | "官方排期" | "实时数据" | "暂无实时";
  hint: string;
}

function stateRegionSlug(state: RealtimeState) {
  return state && "regionSlug" in state ? state.regionSlug : null;
}

export function deriveRealtimeAvailability(regionSlug: RegionSlug, state: RealtimeState): RealtimeAvailability {
  if (!state) {
    return {
      enabled: false,
      badge: "暂无实时",
      hint: "加载中",
    };
  }

  const statusRegionSlug = stateRegionSlug(state);
  if (statusRegionSlug && statusRegionSlug !== regionSlug) {
    return {
      enabled: false,
      badge: "暂无实时",
      hint: "未包含当前赛区",
    };
  }

  if (state.sourceStatus === "active") {
    const completed = Number(state.completedOfficialMatches ?? 0);
    const confirmed = Number(state.confirmedOfficialMatches ?? 0);
    const officialSchedule = Number(state.officialScheduleMatches ?? 0);
    const officialPlaceholders = Number(state.officialPlaceholderMatches ?? 0);
    const level =
      state.liveDataLevel ||
      (completed > 0
        ? "official_results"
        : confirmed > 0
          ? "confirmed_matchups"
          : officialSchedule > 0 || officialPlaceholders > 0
            ? "schedule_shell"
            : "source_connected");

    if (level === "official_results" || completed > 0) {
      return {
        enabled: true,
        badge: "官方赛果",
        hint: state.liveDataLabel || "官方赛果已接入",
      };
    }
    if (level === "confirmed_matchups" || confirmed > 0) {
      return {
        enabled: true,
        badge: "官方对阵",
        hint: state.liveDataLabel || "官方对阵已确认，赛果待同步",
      };
    }
    if (level === "schedule_shell" || officialSchedule > 0 || officialPlaceholders > 0) {
      return {
        enabled: true,
        badge: "官方排期",
        hint: state.liveDataLabel || "官方排期已接入，对阵待确认",
      };
    }
    return {
      enabled: false,
      badge: "暂无实时",
      hint: state.liveDataLabel || "官方实时源已连接，赛程待同步",
    };
  }

  return {
    enabled: false,
    badge: "暂无实时",
    hint: state.sourceReason || "暂无实时数据",
  };
}

export function liveStateRefreshKey(state: LiveStateResponse | null | undefined) {
  if (!state) {
    return "";
  }
  return [
    state.runtimeArtifactVersion ?? "",
    state.generatedAt ?? "",
    state.sourceUpdatedAt ?? "",
    state.completedOfficialMatches,
    state.confirmedOfficialMatches,
    state.officialScheduleMatches ?? 0,
    state.officialPlaceholderMatches ?? 0,
    state.ledgerRows,
  ].join(":");
}

export function formatMiniProgramPrediction(prediction: MiniProgramPrediction | null | undefined) {
  if (!prediction) {
    return null;
  }
  if (prediction.status !== "available") {
    return "王牌预言家 暂未开放";
  }

  const red = (prediction.redRate * 100).toFixed(1);
  const blue = (prediction.blueRate * 100).toFixed(1);
  if (prediction.tieRate > 0) {
    return `王牌预言家 红 ${red}% / 蓝 ${blue}% / 平 ${(prediction.tieRate * 100).toFixed(1)}%`;
  }
  return `王牌预言家 红 ${red}% / 蓝 ${blue}%`;
}
