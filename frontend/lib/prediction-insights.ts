import { buildRegionHref } from "@/lib/region-config";
import { translateConfidenceLabel, translateStageLabel } from "@/lib/display";
import { predictDisplayScoreline } from "@/lib/scoreline";
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

export function predictMatchScoreline(pGameRed: number, pSeriesRed: number, bestOf: number = 3) {
  return predictDisplayScoreline(pGameRed, pSeriesRed, bestOf);
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
  const reasons = [`模型预测 ${favoriteName} 系列赛胜率 ${pct(favoriteRate)}，领先 ${underdogName} ${pct(margin)}。`];

  if (typeof match.redMu0 === "number" && typeof match.blueMu0 === "number") {
    const eloGap = Math.abs(match.redMu0 - match.blueMu0);
    const eloLeader = match.redMu0 >= match.blueMu0 ? match.redTeam.collegeName : match.blueTeam.collegeName;
    reasons.push(`赛前战力差距约 ${eloGap.toFixed(1)}，更看好 ${eloLeader}。`);
  }

  if (Math.abs(match.deltaH2H) >= 0.1) {
    reasons.push(`历史对战修正 ${match.deltaH2H > 0 ? "+" : ""}${match.deltaH2H.toFixed(2)}，反映两队过往交锋记录的影响。`);
  }

  if (match.miniProgramPrediction?.status === "available") {
    const audienceRed = match.miniProgramPrediction.redRate;
    const modelRed = match.pSeriesRed;
    const delta = Math.abs(audienceRed - modelRed);
    reasons.push(delta >= 0.15 ? `观众投票与模型预测红方概率相差 ${pct(delta)}，本场值得关注。` : "观众投票与模型判断接近，意见较为一致。");
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
