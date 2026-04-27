import type { LiveStateResponse, LiveStatusSummary, MiniProgramPrediction, RegionSlug } from "@/lib/types";

type RealtimeState = LiveStateResponse | LiveStatusSummary | null | undefined;

export interface RealtimeAvailability {
  enabled: boolean;
  badge: "已接入" | "待接入";
  hint: string;
}

function stateRegionSlug(state: RealtimeState) {
  return state && "regionSlug" in state ? state.regionSlug : null;
}

export function deriveRealtimeAvailability(regionSlug: RegionSlug, state: RealtimeState): RealtimeAvailability {
  if (!state) {
    return {
      enabled: false,
      badge: "待接入",
      hint: "读取中",
    };
  }

  const statusRegionSlug = stateRegionSlug(state);
  if (statusRegionSlug && statusRegionSlug !== regionSlug) {
    return {
      enabled: false,
      badge: "待接入",
      hint: "未包含当前赛区",
    };
  }

  if (state.sourceStatus === "active") {
    return {
      enabled: true,
      badge: "已接入",
      hint: "已接入",
    };
  }

  return {
    enabled: false,
    badge: "待接入",
    hint: state.sourceReason || "待接入",
  };
}

export function formatMiniProgramPrediction(prediction: MiniProgramPrediction | null | undefined) {
  if (!prediction) {
    return null;
  }
  if (prediction.status !== "available") {
    return "王牌预言家 暂不可用";
  }

  const red = (prediction.redRate * 100).toFixed(1);
  const blue = (prediction.blueRate * 100).toFixed(1);
  if (prediction.tieRate > 0) {
    return `王牌预言家 红 ${red}% / 蓝 ${blue}% / 平 ${(prediction.tieRate * 100).toFixed(1)}%`;
  }
  return `王牌预言家 红 ${red}% / 蓝 ${blue}%`;
}
