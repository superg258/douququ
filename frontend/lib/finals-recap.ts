import type { FinalsSimulationResult } from "@/lib/finals-simulation";
import { predictDisplayScoreline } from "@/lib/scoreline";
import type { FinalEventSchedule, FinalEventSlug, SimulatedFinalMatch } from "@/lib/types";

/**
 * 决赛阶段（复活赛 + 全国赛）模型战绩复盘。
 *
 * 只统计真实已完成赛果，且只覆盖决赛阶段 —— 区域赛历史数据不计入，
 * 看板自复活赛起从零开始累计。预测口径与混合推演一致：
 * 按赛前 Elo 计算系列赛胜率，高于 50% 的一方为预测胜者；
 * 预测比分取模型最可能比分（predictDisplayScoreline）。
 */

export interface FinalsRecapGroup {
  completedMatches: number;
  winnerHits: number;
  scorelineHits: number;
  upsetMisses: number;
  winnerHitRate: number | null;
  scorelineHitRate: number | null;
}

export interface FinalsRecapMatch {
  id: string;
  eventSlug: FinalEventSlug;
  matchNumber: number;
  stage: string;
  startsAt: string | null;
  redCollegeName: string;
  blueCollegeName: string;
  predictedWinnerSide: "red" | "blue";
  predictedWinnerName: string;
  actualWinnerName: string;
  predictedScoreline: string;
  actualScoreline: string;
  favoriteRate: number;
  deviationType: "upset_miss" | "scoreline_miss";
}

export interface FinalsPredictionRecap {
  summary: FinalsRecapGroup;
  byEvent: Record<FinalEventSlug, FinalsRecapGroup>;
  notableMatches: FinalsRecapMatch[];
}

const EVENT_ORDER: FinalEventSlug[] = ["repechage", "nationals"];

function emptyGroup(): FinalsRecapGroup {
  return {
    completedMatches: 0,
    winnerHits: 0,
    scorelineHits: 0,
    upsetMisses: 0,
    winnerHitRate: null,
    scorelineHitRate: null,
  };
}

function finalizeGroup(group: FinalsRecapGroup): FinalsRecapGroup {
  return {
    ...group,
    winnerHitRate: group.completedMatches > 0 ? group.winnerHits / group.completedMatches : null,
    scorelineHitRate: group.completedMatches > 0 ? group.scorelineHits / group.completedMatches : null,
  };
}

function recordHit(group: FinalsRecapGroup, winnerHit: boolean, scorelineHit: boolean) {
  group.completedMatches += 1;
  if (winnerHit) group.winnerHits += 1;
  if (scorelineHit) group.scorelineHits += 1;
  if (!winnerHit) group.upsetMisses += 1;
}

function isReviewableMatch(match: SimulatedFinalMatch) {
  return Boolean(
    match.isRealResult
    && match.red
    && match.blue
    && match.winnerSide
    && typeof match.pSeriesRed === "number"
    && typeof match.pGameRed === "number",
  );
}

export function buildFinalsPredictionRecap(
  simulation: FinalsSimulationResult | null,
  events: Record<FinalEventSlug, FinalEventSchedule>,
): FinalsPredictionRecap {
  const summary = emptyGroup();
  const byEvent: Record<FinalEventSlug, FinalsRecapGroup> = {
    repechage: emptyGroup(),
    nationals: emptyGroup(),
  };
  const notableMatches: FinalsRecapMatch[] = [];

  for (const eventSlug of EVENT_ORDER) {
    const matchResults = simulation ? [...simulation[eventSlug].matchResults.values()] : [];
    const bestOfByNumber = new Map(events[eventSlug].matches.map((match) => [match.number, match.bestOf]));
    const metaByNumber = new Map(
      events[eventSlug].matches.map((match) => [match.number, { stage: match.stage, startsAt: match.startsAt }]),
    );
    const rows = matchResults
      .filter(isReviewableMatch)
      .sort((left, right) => left.matchNumber - right.matchNumber);

    for (const match of rows) {
      const red = match.red!;
      const blue = match.blue!;
      const pSeriesRed = match.pSeriesRed!;
      const predictedSide: "red" | "blue" = pSeriesRed >= 0.5 ? "red" : "blue";
      const winnerHit = predictedSide === match.winnerSide;
      const bestOf = bestOfByNumber.get(match.matchNumber) ?? 3;
      const predictedScoreline = predictDisplayScoreline(match.pGameRed!, pSeriesRed, bestOf).scoreline;
      const actualScoreline = `${match.redScore}:${match.blueScore}`;
      const scorelineHit = winnerHit && predictedScoreline === actualScoreline;

      recordHit(summary, winnerHit, scorelineHit);
      recordHit(byEvent[eventSlug], winnerHit, scorelineHit);

      if (!winnerHit || !scorelineHit) {
        const meta = metaByNumber.get(match.matchNumber);
        notableMatches.push({
          id: `${eventSlug}:${match.matchNumber}`,
          eventSlug,
          matchNumber: match.matchNumber,
          stage: meta?.stage ?? "",
          startsAt: meta?.startsAt ?? null,
          redCollegeName: red.collegeName,
          blueCollegeName: blue.collegeName,
          predictedWinnerSide: predictedSide,
          predictedWinnerName: predictedSide === "red" ? red.collegeName : blue.collegeName,
          actualWinnerName: match.winnerSide === "red" ? red.collegeName : blue.collegeName,
          predictedScoreline,
          actualScoreline,
          favoriteRate: Math.max(pSeriesRed, 1 - pSeriesRed),
          deviationType: winnerHit ? "scoreline_miss" : "upset_miss",
        });
      }
    }
  }

  notableMatches.sort((left, right) => {
    if (left.deviationType !== right.deviationType) return left.deviationType === "upset_miss" ? -1 : 1;
    if (left.favoriteRate !== right.favoriteRate) return right.favoriteRate - left.favoriteRate;
    return (left.startsAt ?? "").localeCompare(right.startsAt ?? "");
  });

  return {
    summary: finalizeGroup(summary),
    byEvent: {
      repechage: finalizeGroup(byEvent.repechage),
      nationals: finalizeGroup(byEvent.nationals),
    },
    notableMatches: notableMatches.slice(0, 6),
  };
}
