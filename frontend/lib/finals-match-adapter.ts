import { gameWinProbability, seriesWinProbability } from "@/lib/finals-simulation";
import type {
  FinalEventMatch,
  FinalEventSchedule,
  MatchCanvasCard,
  MatchRow,
  OverviewTeam,
  SimulatedFinalMatch,
  TeamRef,
} from "@/lib/types";

export interface FinalsTeamRatingSnapshot {
  currentElo: number | null;
  seasonDelta: number | null;
  globalRank: number | null;
}

function finiteElo(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 与区域赛学校卡的 currentElo 语义对齐：优先展示赛事回放吸收完所有真实赛果后的
 * 最新 Elo；总览 Elo 只作为尚无赛事状态时的回退值。
 */
export function resolveFinalsTeamRating(
  teamKey: string,
  allTeams: OverviewTeam[],
  finalEloByTeamKey?: Readonly<Record<string, number>> | null,
): FinalsTeamRatingSnapshot {
  const overviewTeam = allTeams.find((team) => team.teamKey === teamKey) ?? null;
  const replayElo = finalEloByTeamKey?.[teamKey];
  const currentElo = finiteElo(replayElo)
    ? replayElo
    : overviewTeam
      ? (overviewTeam.currentElo ?? overviewTeam.mu0)
      : null;
  const preseasonElo = overviewTeam
    ? (overviewTeam.preseasonElo ?? overviewTeam.mu0)
    : null;
  const seasonDelta = currentElo !== null && preseasonElo !== null
    ? currentElo - preseasonElo
    : overviewTeam?.eloDeltaFromPreseason ?? null;

  if (currentElo === null) {
    return { currentElo, seasonDelta, globalRank: overviewTeam?.eloGlobalRank ?? null };
  }

  const ratingByTeamKey = new Map<string, { elo: number; baselineRank: number }>();
  for (const team of allTeams) {
    const dynamicElo = finalEloByTeamKey?.[team.teamKey];
    const elo = finiteElo(dynamicElo) ? dynamicElo : (team.currentElo ?? team.mu0);
    ratingByTeamKey.set(team.teamKey, { elo, baselineRank: team.eloGlobalRank });
  }
  for (const [dynamicTeamKey, dynamicElo] of Object.entries(finalEloByTeamKey ?? {})) {
    if (finiteElo(dynamicElo) && !ratingByTeamKey.has(dynamicTeamKey)) {
      ratingByTeamKey.set(dynamicTeamKey, { elo: dynamicElo, baselineRank: Number.MAX_SAFE_INTEGER });
    }
  }

  const rankedTeamKeys = [...ratingByTeamKey]
    .sort(([leftKey, left], [rightKey, right]) => (
      right.elo - left.elo
      || left.baselineRank - right.baselineRank
      || leftKey.localeCompare(rightKey, "zh-CN")
    ))
    .map(([rankedTeamKey]) => rankedTeamKey);
  const rankIndex = rankedTeamKeys.indexOf(teamKey);
  return {
    currentElo,
    seasonDelta,
    globalRank: rankIndex >= 0 ? rankIndex + 1 : overviewTeam?.eloGlobalRank ?? null,
  };
}

/**
 * 全国赛 / 复活赛赛程 → 区域赛 MatchRow 适配层。
 *
 * 让 forecast-center 的画布与情报面板原样复用区域赛组件：
 * - 实时模式优先映射官方队伍、比分与赛果；尚未落位时映射为区域赛的
 *   「官方排期占位」对阵（空 teamKey + collegeName=槽位名）；
 * - 模拟模式（沙盘已落位）用与模拟器相同的 Elo 胜率公式合成
 *   pGameRed / pSeriesRed / mu0，数据与沙盘自洽。
 */

function placeholderTeamRef(slot: string): TeamRef {
  return {
    teamKey: "",
    collegeName: slot,
    teamName: "槽位待确认",
    slot: slot || null,
  };
}

function simulatedTeamRef(team: NonNullable<SimulatedFinalMatch["red"]>, slot: string): TeamRef {
  return {
    teamKey: team.teamKey,
    collegeName: team.collegeName,
    teamName: team.teamName,
    slot: slot || null,
  };
}

const COMPLETED_STATUSES = new Set(["DONE", "FINISHED", "ENDED", "COMPLETE", "COMPLETED"]);

function normalizedStatus(match: FinalEventMatch) {
  return String(match.officialStatus ?? "").trim().toUpperCase();
}

function officialTeamRef(
  event: FinalEventSchedule,
  match: FinalEventMatch,
  side: "red" | "blue",
): TeamRef | null {
  const teamKey = match[`${side}TeamKey`]?.trim() ?? "";
  const collegeName = match[`${side}CollegeName`]?.trim() ?? "";
  const teamName = match[`${side}TeamName`]?.trim() ?? "";
  const participant = event.participants.find((candidate) => (
    (teamKey && candidate.teamKey === teamKey)
    || (collegeName && candidate.collegeName === collegeName && (!teamName || candidate.teamName === teamName))
  ));
  const resolvedTeamKey = teamKey || participant?.teamKey || "";
  const resolvedCollegeName = collegeName || participant?.collegeName || "";
  const resolvedTeamName = teamName || participant?.teamName || "";
  if (!resolvedTeamKey && !resolvedCollegeName && !resolvedTeamName) return null;
  return {
    teamKey: resolvedTeamKey,
    collegeName: resolvedCollegeName,
    teamName: resolvedTeamName,
    slot: (side === "red" ? match.redSlot : match.blueSlot) || null,
  };
}

function officialScoreline(match: FinalEventMatch) {
  const scoreline = match.scoreline?.trim();
  if (scoreline) return scoreline;
  if (typeof match.redWins === "number" && typeof match.blueWins === "number") {
    return `${match.redWins}:${match.blueWins}`;
  }
  return "0:0";
}

function confidenceLabelForSeries(pSeriesRed: number) {
  const margin = Math.abs(pSeriesRed - 0.5);
  if (margin >= 0.35) return "high";
  if (margin >= 0.15) return "medium";
  return "low";
}

export function buildFinalsMatchRow(
  event: FinalEventSchedule,
  match: FinalEventMatch,
  simulation?: SimulatedFinalMatch | null,
): MatchRow {
  const base = {
    matchLabel: `${event.slug}:${match.number}`,
    // 与区域赛一致：阶段标签不带 BO 后缀（BO 单独展示）
    stage: match.stage.replace(/（BO\d）/g, "").trim(),
    stageOrder: match.number,
    roundNumber: 0,
    regionalMatchNumber: match.number,
    groupName: "",
    bestOf: match.bestOf,
    winnerNext: match.winnerTo ?? "",
    loserNext: match.loserTo ?? "",
    plannedStartAt: match.startsAt,
  };

  const red = simulation?.red ?? null;
  const blue = simulation?.blue ?? null;
  const officialRed = officialTeamRef(event, match, "red");
  const officialBlue = officialTeamRef(event, match, "blue");
  const officialCompleted = match.isCompleted === true || COMPLETED_STATUSES.has(normalizedStatus(match));
  if (!red || !blue || (officialCompleted && officialRed && officialBlue)) {
    if (officialRed && officialBlue) {
      const scoreline = officialScoreline(match);
      const [redScoreText, blueScoreText] = scoreline.split(":");
      const redScore = Number(redScoreText);
      const blueScore = Number(blueScoreText);
      const isCompleted = officialCompleted;
      const result = String(match.result ?? "").trim().toLowerCase();
      const winnerSide = result === "red" || result === officialRed.teamKey.toLowerCase()
        ? "red"
        : result === "blue" || result === officialBlue.teamKey.toLowerCase()
          ? "blue"
          : isCompleted && Number.isFinite(redScore) && Number.isFinite(blueScore) && redScore !== blueScore
            ? (redScore > blueScore ? "red" : "blue")
            : null;
      const pGameRed = simulation?.pGameRed ?? gameWinProbability(simulation?.redElo ?? null, simulation?.blueElo ?? null);
      const pSeriesRed = simulation?.pSeriesRed ?? seriesWinProbability(pGameRed, match.bestOf);
      return {
        ...base,
        isRealResult: isCompleted,
        isConfirmedMatchup: match.isConfirmedMatchup !== false,
        hasLiveScoreline: Boolean(match.hasLiveScoreline || isCompleted || match.scoreline),
        officialStatus: match.officialStatus ?? undefined,
        redTeam: officialRed,
        blueTeam: officialBlue,
        scoreline,
        winnerTeamKey: winnerSide ? (winnerSide === "red" ? officialRed.teamKey : officialBlue.teamKey) : "",
        loserTeamKey: winnerSide ? (winnerSide === "red" ? officialBlue.teamKey : officialRed.teamKey) : "",
        pGameRed,
        pGameBlue: 1 - pGameRed,
        pSeriesRed,
        pSeriesBlue: 1 - pSeriesRed,
        deltaH2H: simulation?.deltaH2H ?? 0,
        redMu0: simulation?.redElo ?? undefined,
        blueMu0: simulation?.blueElo ?? undefined,
        redDelta: simulation?.redEloDelta,
        blueDelta: simulation?.blueEloDelta,
        redCurrentElo: simulation?.redEloAfter ?? simulation?.redElo ?? undefined,
        blueCurrentElo: simulation?.blueEloAfter ?? simulation?.blueElo ?? undefined,
        confidenceLabel: "low",
        officialMatchId: `${event.slug}-${match.number}`,
      };
    }
    // 实时模式 / 沙盘未落位：官方排期占位（同区域赛官方占位对阵）
    return {
      ...base,
      isRealResult: false,
      // 抽签已经落位但一侧仍是复活赛待确认席位时，保留另一侧的真实队伍；
      // 不能因为整场尚未确认而把已知队伍也抹成槽位占位。
      isConfirmedMatchup: Boolean(officialRed && officialBlue) && match.isConfirmedMatchup !== false,
      redTeam: officialRed ?? placeholderTeamRef(match.redSlot),
      blueTeam: officialBlue ?? placeholderTeamRef(match.blueSlot),
      scoreline: "0:0",
      winnerTeamKey: "",
      loserTeamKey: "",
      pGameRed: 0.5,
      pGameBlue: 0.5,
      pSeriesRed: 0.5,
      pSeriesBlue: 0.5,
      deltaH2H: 0,
      confidenceLabel: "low",
      officialMatchId: `${event.slug}-${match.number}`,
      officialStatus: match.officialStatus ?? undefined,
    };
  }

  const redElo = typeof simulation?.redElo === "number" ? simulation.redElo : null;
  const blueElo = typeof simulation?.blueElo === "number" ? simulation.blueElo : null;
  const pGameRed = simulation?.pGameRed ?? gameWinProbability(redElo, blueElo);
  const pSeriesRed = simulation?.pSeriesRed ?? seriesWinProbability(pGameRed, match.bestOf);
  const winnerSide = simulation?.winnerSide ?? null;
  const redScore = simulation?.redScore ?? 0;
  const blueScore = simulation?.blueScore ?? 0;
  const hasOfficialLiveScoreline = !simulation?.isRealResult
    && match.hasLiveScoreline === true
    && Boolean(officialRed && officialBlue);
  const displayedScoreline = hasOfficialLiveScoreline
    ? officialScoreline(match)
    : winnerSide ? `${redScore}:${blueScore}` : "-:-";

  return {
    ...base,
    isRealResult: Boolean(simulation?.isRealResult),
    isConfirmedMatchup: simulation?.isConfirmedMatchup ?? true,
    isScenarioProjection: !simulation?.isRealResult && !hasOfficialLiveScoreline && Boolean(winnerSide),
    hasLiveScoreline: hasOfficialLiveScoreline,
    redTeam: simulatedTeamRef(red, match.redSlot),
    blueTeam: simulatedTeamRef(blue, match.blueSlot),
    scoreline: displayedScoreline,
    winnerTeamKey: !hasOfficialLiveScoreline && winnerSide ? (winnerSide === "red" ? red.teamKey : blue.teamKey) : "",
    loserTeamKey: !hasOfficialLiveScoreline && winnerSide ? (winnerSide === "red" ? blue.teamKey : red.teamKey) : "",
    pGameRed,
    pGameBlue: 1 - pGameRed,
    pSeriesRed,
    pSeriesBlue: 1 - pSeriesRed,
    deltaH2H: simulation?.deltaH2H ?? 0,
    confidenceLabel: confidenceLabelForSeries(pSeriesRed),
    redMu0: redElo ?? undefined,
    blueMu0: blueElo ?? undefined,
    redDelta: simulation?.redEloDelta,
    blueDelta: simulation?.blueEloDelta,
    redCurrentElo: simulation?.redEloAfter ?? redElo ?? undefined,
    blueCurrentElo: simulation?.blueEloAfter ?? blueElo ?? undefined,
    officialMatchId: `${event.slug}-${match.number}`,
    officialStatus: match.officialStatus ?? undefined,
  };
}

const FINALS_MATCH_CARD_WIDTH = 400;
const FINALS_MATCH_CARD_HEIGHT = 188;

/** 与 canvas-builders.buildMatchCard 同形构造 MatchCanvasCard（区域赛赛程卡片）。 */
export function buildFinalsMatchCard(
  event: FinalEventSchedule,
  match: FinalEventMatch,
  x: number,
  y: number,
  simulation?: SimulatedFinalMatch | null,
): MatchCanvasCard {
  const row = buildFinalsMatchRow(event, match, simulation);
  const [redScore, blueScore] = row.scoreline.split(":");
  return {
    id: row.matchLabel,
    kind: "match",
    x,
    y,
    width: FINALS_MATCH_CARD_WIDTH,
    height: FINALS_MATCH_CARD_HEIGHT,
    tone: match.stageKey === "final" || match.stageKey === "third_place"
      ? "amber"
      : match.stageKey === "swiss"
        ? "cyan"
        : "emerald",
    orderLabel: `${match.number}`,
    displayLabel: `第 ${match.number} 场`,
    metaLabel: `${match.stage} / BO${match.bestOf}`,
    variant: "standard",
    showProbability: false,
    match: row,
    redSide: {
      teamKey: row.redTeam.teamKey,
      collegeName: row.redTeam.collegeName,
      teamName: row.redTeam.teamName,
      score: redScore ?? "-",
      probability: row.pSeriesRed,
      side: "red",
      isWinner: row.winnerTeamKey !== "" && row.winnerTeamKey === row.redTeam.teamKey,
    },
    blueSide: {
      teamKey: row.blueTeam.teamKey,
      collegeName: row.blueTeam.collegeName,
      teamName: row.blueTeam.teamName,
      score: blueScore ?? "-",
      probability: row.pSeriesBlue,
      side: "blue",
      isWinner: row.winnerTeamKey !== "" && row.winnerTeamKey === row.blueTeam.teamKey,
    },
  };
}
