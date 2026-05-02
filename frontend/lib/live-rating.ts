import type { MatchRow } from "@/lib/types";

export type MatchRatingSide = "red" | "blue";

export interface MatchRatingBreakdown {
  teamName: string;
  before: number;
  after: number;
  totalDelta: number;
  liveDelta: number | null;
  priorDelta: number | null;
  priorLabel: string;
  hasSplitAdjustment: boolean;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatSignedRatingDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function ratingDeltaTone(value: number) {
  if (value > 0) {
    return "text-rm-status-safe";
  }
  if (value < 0) {
    return "text-rm-red";
  }
  return "text-rm-metal-text";
}

export function deriveMatchRatingBreakdown(match: MatchRow, side: MatchRatingSide): MatchRatingBreakdown | null {
  const isRed = side === "red";
  const before = isRed ? match.redMu0 : match.blueMu0;
  const totalDelta = isRed ? match.redDelta : match.blueDelta;
  if (!isNumber(before) || !isNumber(totalDelta)) {
    return null;
  }

  const liveDelta = isRed ? match.redLiveDelta : match.blueLiveDelta;
  const priorDelta = isRed ? match.redPriorDelta : match.bluePriorDelta;
  const priorLabel = (isRed ? match.redPriorAdjustmentLabel : match.bluePriorAdjustmentLabel) || "前三轮先验修正";
  const hasSplitAdjustment = isNumber(liveDelta) && isNumber(priorDelta);

  return {
    teamName: isRed ? match.redTeam.collegeName : match.blueTeam.collegeName,
    before,
    after: before + totalDelta,
    totalDelta,
    liveDelta: hasSplitAdjustment ? liveDelta : null,
    priorDelta: hasSplitAdjustment ? priorDelta : null,
    priorLabel,
    hasSplitAdjustment,
  };
}
