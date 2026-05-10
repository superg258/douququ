export function clampProbability(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function formatProbability(value: number | null | undefined, precision = 0) {
  return `${(clampProbability(value) * 100).toFixed(precision)}%`;
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
