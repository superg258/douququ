import type { MiniProgramPrediction } from "@/lib/types";

export function clampProbability(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function formatProbability(value: number | null | undefined, precision = 0) {
  return `${(clampProbability(value) * 100).toFixed(precision)}%`;
}

export function formatRate(value: number | null | undefined, precision = 1) {
  return formatProbability(clampProbability(value), precision);
}

export type AudienceSignalStatus = "available" | "stale" | "unavailable";

export interface AudienceSignal {
  status: AudienceSignalStatus;
  redRate: number;
  blueRate: number;
  centerLabel: string;
  title: string;
}

function hasRate(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function audienceSignal(prediction: MiniProgramPrediction | undefined): AudienceSignal {
  if (!prediction) {
    return {
      status: "unavailable",
      redRate: 0,
      blueRate: 0,
      centerLabel: "暂未开放",
      title: "王牌预言家投票通道暂未开放",
    };
  }

  if (prediction.status === "available") {
    const tieText = prediction.tieRate > 0 ? ` / 平 ${formatRate(prediction.tieRate)}` : "";
    return {
      status: "available",
      redRate: prediction.redRate,
      blueRate: prediction.blueRate,
      centerLabel: `${prediction.totalCount}票${tieText}`,
      title: `王牌预言家观众投票：红 ${formatRate(prediction.redRate)}，蓝 ${formatRate(prediction.blueRate)}${tieText}`,
    };
  }

  if (hasRate(prediction.redRate) && hasRate(prediction.blueRate)) {
    return {
      status: "stale",
      redRate: prediction.redRate,
      blueRate: prediction.blueRate,
      centerLabel: "历史记录 / 暂未更新",
      title: prediction.reason ?? "王牌预言家暂未更新，显示最近一次记录",
    };
  }

  return {
    status: "unavailable",
    redRate: 0,
    blueRate: 0,
    centerLabel: "暂未开放",
    title: prediction.reason ?? "王牌预言家暂未开放",
  };
}

function predictedScorelineWinner(scoreline?: string | null): "red" | "blue" | null {
  if (!scoreline) {
    return null;
  }
  const [redText, blueText] = scoreline.split(":");
  const red = Number(redText);
  const blue = Number(blueText);
  if (!Number.isFinite(red) || !Number.isFinite(blue) || red === blue) {
    return null;
  }
  return red > blue ? "red" : "blue";
}

export function getPredictedAdvantageSide({
  pSeriesRed,
  pSeriesBlue,
  predictedScoreline,
}: {
  pSeriesRed: number;
  pSeriesBlue: number;
  predictedScoreline?: string | null;
}): "red" | "blue" {
  if (pSeriesRed > pSeriesBlue) {
    return "red";
  }
  if (pSeriesBlue > pSeriesRed) {
    return "blue";
  }
  return predictedScorelineWinner(predictedScoreline) ?? "red";
}

export function getPredictedAdvantageLabel(input: {
  pSeriesRed: number;
  pSeriesBlue: number;
  predictedScoreline?: string | null;
}) {
  return getPredictedAdvantageSide(input) === "red" ? "红方占优" : "蓝方占优";
}
