function clampRate(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function predictDisplayScoreline(pGameRed: number, pSeriesRed: number, bestOf: number = 3) {
  const p = clampRate(pGameRed);
  const q = 1 - p;

  if (bestOf === 5) {
    const probabilities: Record<string, number> = {
      "3:0": p * p * p,
      "3:1": 3 * p * p * p * q,
      "3:2": 6 * p * p * p * q * q,
      "2:3": 6 * p * p * q * q * q,
      "1:3": 3 * p * q * q * q,
      "0:3": q * q * q,
    };
    const seriesRed = clampRate(pSeriesRed);
    if (seriesRed >= 0.5) {
      if (seriesRed < 0.65) return { scoreline: "3:2", probability: probabilities["3:2"] };
      if (seriesRed < 0.85) return { scoreline: "3:1", probability: probabilities["3:1"] };
      return { scoreline: "3:0", probability: probabilities["3:0"] };
    }
    if (seriesRed > 0.35) return { scoreline: "2:3", probability: probabilities["2:3"] };
    if (seriesRed > 0.15) return { scoreline: "1:3", probability: probabilities["1:3"] };
    return { scoreline: "0:3", probability: probabilities["0:3"] };
  }

  const probabilities = {
    "2:0": p * p,
    "2:1": 2 * p * p * q,
    "1:2": 2 * p * q * q,
    "0:2": q * q,
  };
  if (p >= 0.5) {
    return p >= 0.6
      ? { scoreline: "2:0", probability: probabilities["2:0"] }
      : { scoreline: "2:1", probability: probabilities["2:1"] };
  }
  return p <= 0.4
    ? { scoreline: "0:2", probability: probabilities["0:2"] }
    : { scoreline: "1:2", probability: probabilities["1:2"] };
}
