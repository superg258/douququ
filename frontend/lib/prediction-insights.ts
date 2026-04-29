import { buildRegionHref } from "@/lib/region-config";
import { translateConfidenceLabel, translateStageLabel } from "@/lib/display";
import type { MatchRow, RegionSlug, SimulationResponse, WorkspaceView } from "@/lib/types";

export interface MatchPredictionExplanation {
  matchLabel: string;
  regionSlug?: RegionSlug;
  regionName?: string;
  stageLabel: string;
  favoriteTeamKey: string;
  favoriteName: string;
  underdogName: string;
  favoriteSide: "red" | "blue";
  favoriteRate: number;
  underdogRate: number;
  margin: number;
  predictedScoreline: string;
  confidenceText: string;
  verdict: "pending" | "hit" | "score-hit" | "miss" | "upset";
  verdictLabel: string;
  reasonBullets: string[];
  href?: string;
}

export interface PredictionRecapBucket {
  completedMatches: number;
  winnerHits: number;
  scoreHits: number;
  upsetMatches: number;
  winnerHitRate: number;
}

export interface PredictionRecap extends PredictionRecapBucket {
  pendingMatches: number;
  byConfidence: Record<string, PredictionRecapBucket>;
  byStage: Record<string, PredictionRecapBucket>;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function clampRate(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function predictMatchScoreline(pGameRed: number, pSeriesRed: number, bestOf: number = 3) {
  const p = clampRate(pGameRed);
  const q = 1 - p;

  if (bestOf === 3) {
    const probs = {
      "2:0": p * p,
      "2:1": 2 * p * p * q,
      "1:2": 2 * p * q * q,
      "0:2": q * q,
    };
    if (pSeriesRed >= 0.5) {
      return pSeriesRed < 0.72 ? { scoreline: "2:1", probability: probs["2:1"] } : { scoreline: "2:0", probability: probs["2:0"] };
    }
    return pSeriesRed > 0.28 ? { scoreline: "1:2", probability: probs["1:2"] } : { scoreline: "0:2", probability: probs["0:2"] };
  }

  const probs = {
    "3:0": p * p * p,
    "3:1": 3 * p * p * p * q,
    "3:2": 6 * p * p * p * q * q,
    "2:3": 6 * p * p * q * q * q,
    "1:3": 3 * p * q * q * q,
    "0:3": q * q * q,
  };

  if (pSeriesRed >= 0.5) {
    if (pSeriesRed < 0.65) return { scoreline: "3:2", probability: probs["3:2"] };
    if (pSeriesRed < 0.85) return { scoreline: "3:1", probability: probs["3:1"] };
    return { scoreline: "3:0", probability: probs["3:0"] };
  }

  if (pSeriesRed > 0.35) return { scoreline: "2:3", probability: probs["2:3"] };
  if (pSeriesRed > 0.15) return { scoreline: "1:3", probability: probs["1:3"] };
  return { scoreline: "0:3", probability: probs["0:3"] };
}

function predictedWinnerSide(match: MatchRow) {
  return match.pSeriesRed >= match.pSeriesBlue ? "red" : "blue";
}

function actualWinnerSide(match: MatchRow) {
  if (match.winnerTeamKey === match.redTeam.teamKey) return "red";
  if (match.winnerTeamKey === match.blueTeam.teamKey) return "blue";

  const [redScore = "0", blueScore = "0"] = match.scoreline.split(":");
  return Number(redScore) >= Number(blueScore) ? "red" : "blue";
}

function isPredictedScoreWinnerRed(scoreline: string) {
  const [redScore = "0", blueScore = "0"] = scoreline.split(":");
  return Number(redScore) >= Number(blueScore);
}

function determineVerdict(match: MatchRow, predictedScoreline: string): MatchPredictionExplanation["verdict"] {
  if (!match.isRealResult) return "pending";

  const winnerHit = predictedWinnerSide(match) === actualWinnerSide(match);
  if (!winnerHit) return "upset";
  if (predictedScoreline === match.scoreline) return "score-hit";
  return "hit";
}

function verdictLabel(verdict: MatchPredictionExplanation["verdict"]) {
  switch (verdict) {
    case "score-hit":
      return "比分命中";
    case "hit":
      return "胜负命中";
    case "upset":
      return "爆冷偏离";
    case "miss":
      return "判断偏离";
    default:
      return "待赛验证";
  }
}

function buildReasons(match: MatchRow, favoriteName: string, favoriteRate: number, underdogName: string, margin: number) {
  const reasons = [`TS2 给出 ${favoriteName} ${pct(favoriteRate)} 的系列赛胜率，领先 ${underdogName} ${pct(margin)}。`];

  if (typeof match.redMu0 === "number" && typeof match.blueMu0 === "number") {
    const eloGap = Math.abs(match.redMu0 - match.blueMu0);
    const eloLeader = match.redMu0 >= match.blueMu0 ? match.redTeam.collegeName : match.blueTeam.collegeName;
    reasons.push(`Elo 赛前差约 ${eloGap.toFixed(1)}，战力侧更偏向 ${eloLeader}。`);
  }

  if (Math.abs(match.deltaH2H) >= 0.1) {
    reasons.push(`对位修正幅度 ${match.deltaH2H > 0 ? "+" : ""}${match.deltaH2H.toFixed(2)}，说明双方历史/结构差异会影响判断。`);
  }

  if (match.miniProgramPrediction?.status === "available") {
    const audienceRed = match.miniProgramPrediction.redRate;
    const modelRed = match.pSeriesRed;
    const delta = Math.abs(audienceRed - modelRed);
    reasons.push(delta >= 0.15 ? `观众投票与模型红方概率相差 ${pct(delta)}，本场适合重点观察分歧。` : "观众投票与模型判断接近，分歧风险较低。");
  }

  return reasons.slice(0, 3);
}

function viewForMatch(match: MatchRow): WorkspaceView {
  if (match.stage === "swiss") return match.groupName === "B" ? "swiss-b" : "swiss-a";
  if (match.stage.startsWith("qualification")) return "qualification";
  return "playoff";
}

export function explainMatchPrediction(match: MatchRow, context?: { regionSlug?: RegionSlug; regionName?: string }): MatchPredictionExplanation {
  const favoriteSide = predictedWinnerSide(match);
  const favorite = favoriteSide === "red" ? match.redTeam : match.blueTeam;
  const underdog = favoriteSide === "red" ? match.blueTeam : match.redTeam;
  const favoriteRate = favoriteSide === "red" ? match.pSeriesRed : match.pSeriesBlue;
  const underdogRate = favoriteSide === "red" ? match.pSeriesBlue : match.pSeriesRed;
  const predictedScoreline = predictMatchScoreline(match.pGameRed, match.pSeriesRed, match.bestOf).scoreline;
  const verdict = determineVerdict(match, predictedScoreline);
  const href = context?.regionSlug ? buildRegionHref(context.regionSlug, viewForMatch(match), { seed: null, highlight: favorite.teamKey }) : undefined;

  return {
    matchLabel: match.matchLabel,
    regionSlug: context?.regionSlug,
    regionName: context?.regionName,
    stageLabel: translateStageLabel(match.stage),
    favoriteTeamKey: favorite.teamKey,
    favoriteName: favorite.collegeName,
    underdogName: underdog.collegeName,
    favoriteSide,
    favoriteRate,
    underdogRate,
    margin: Math.abs(favoriteRate - underdogRate),
    predictedScoreline,
    confidenceText: translateConfidenceLabel(match.confidenceLabel),
    verdict,
    verdictLabel: verdictLabel(verdict),
    reasonBullets: buildReasons(match, favorite.collegeName, favoriteRate, underdog.collegeName, Math.abs(favoriteRate - underdogRate)),
    href,
  };
}

function emptyBucket(): PredictionRecapBucket {
  return {
    completedMatches: 0,
    winnerHits: 0,
    scoreHits: 0,
    upsetMatches: 0,
    winnerHitRate: 0,
  };
}

function addToBucket(bucket: PredictionRecapBucket, match: MatchRow) {
  const predictedScoreline = predictMatchScoreline(match.pGameRed, match.pSeriesRed, match.bestOf).scoreline;
  const winnerHit = predictedWinnerSide(match) === actualWinnerSide(match);
  bucket.completedMatches += 1;
  if (winnerHit) bucket.winnerHits += 1;
  if (winnerHit && predictedScoreline === match.scoreline) bucket.scoreHits += 1;
  if (!winnerHit) bucket.upsetMatches += 1;
  bucket.winnerHitRate = bucket.completedMatches ? bucket.winnerHits / bucket.completedMatches : 0;
}

export function buildPredictionRecap(simulation: SimulationResponse): PredictionRecap {
  const recap: PredictionRecap = {
    ...emptyBucket(),
    pendingMatches: 0,
    byConfidence: {},
    byStage: {},
  };

  simulation.matches.forEach((match) => {
    if (!match.isRealResult) {
      recap.pendingMatches += 1;
      return;
    }

    addToBucket(recap, match);

    const confidenceBucket = recap.byConfidence[match.confidenceLabel] ?? emptyBucket();
    addToBucket(confidenceBucket, match);
    recap.byConfidence[match.confidenceLabel] = confidenceBucket;

    const stageLabel = translateStageLabel(match.stage);
    const stageBucket = recap.byStage[stageLabel] ?? emptyBucket();
    addToBucket(stageBucket, match);
    recap.byStage[stageLabel] = stageBucket;
  });

  return recap;
}
