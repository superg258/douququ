import type { LiveStateResponse, LiveStatusSummary, MiniProgramPrediction, RegionSlug } from "@/lib/types";

type RealtimeState = LiveStateResponse | LiveStatusSummary | null | undefined;

export interface RealtimeAvailability {
  enabled: boolean;
  badge: "实时数据" | "暂无实时";
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
    return {
      enabled: true,
      badge: "实时数据",
      hint: "实时数据已连接",
    };
  }

  return {
    enabled: false,
    badge: "暂无实时",
    hint: state.sourceReason || "暂无实时数据",
  };
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
