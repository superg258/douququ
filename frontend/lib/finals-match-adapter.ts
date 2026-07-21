import { gameWinProbability, seriesWinProbability } from "@/lib/finals-simulation";
import type {
  FinalEventMatch,
  FinalEventSchedule,
  MatchCanvasCard,
  MatchRow,
  SimulatedFinalMatch,
  TeamRef,
} from "@/lib/types";

/**
 * 全国赛 / 复活赛赛程 → 区域赛 MatchRow 适配层。
 *
 * 让 forecast-center 的画布与情报面板原样复用区域赛组件：
 * - 实时模式（抽签未定、只有官方槽位）映射为区域赛的「官方排期占位」对阵：
 *   空 teamKey + collegeName=槽位名 + isConfirmedMatchup=false + officialMatchId，
 *   与 backend service.py 的占位 TeamRef 写法一致；
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
  if (!red || !blue) {
    // 实时模式 / 沙盘未落位：官方排期占位（同区域赛官方占位对阵）
    return {
      ...base,
      isRealResult: false,
      isConfirmedMatchup: false,
      redTeam: placeholderTeamRef(match.redSlot),
      blueTeam: placeholderTeamRef(match.blueSlot),
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
    };
  }

  const redElo = typeof simulation?.redElo === "number" ? simulation.redElo : null;
  const blueElo = typeof simulation?.blueElo === "number" ? simulation.blueElo : null;
  const pGameRed = gameWinProbability(redElo, blueElo);
  const pSeriesRed = seriesWinProbability(pGameRed, match.bestOf);
  const winnerSide = simulation?.winnerSide ?? null;
  const redScore = simulation?.redScore ?? 0;
  const blueScore = simulation?.blueScore ?? 0;

  return {
    ...base,
    isRealResult: false,
    isConfirmedMatchup: true,
    redTeam: simulatedTeamRef(red, match.redSlot),
    blueTeam: simulatedTeamRef(blue, match.blueSlot),
    scoreline: winnerSide ? `${redScore}:${blueScore}` : "-:-",
    winnerTeamKey: winnerSide ? (winnerSide === "red" ? red.teamKey : blue.teamKey) : "",
    loserTeamKey: winnerSide ? (winnerSide === "red" ? blue.teamKey : red.teamKey) : "",
    pGameRed,
    pGameBlue: 1 - pGameRed,
    pSeriesRed,
    pSeriesBlue: 1 - pSeriesRed,
    deltaH2H: 0,
    confidenceLabel: confidenceLabelForSeries(pSeriesRed),
    redMu0: redElo ?? undefined,
    blueMu0: blueElo ?? undefined,
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
