export type RegionSlug = "east_region" | "south_region" | "north_region";
export type WorkspaceView = "slots" | "swiss-a" | "swiss-b" | "qualification" | "playoff" | "final-rankings";
export type CanvasTone = "cyan" | "amber" | "steel" | "emerald";
export type LiveSourceStatus = "active" | "inactive" | "missing" | "error";

export interface LiveStatusSummary {
  sourceStatus: LiveSourceStatus;
  sourceReason: string | null;
  sourceUpdatedAt: string | null;
  completedOfficialMatches: number;
  confirmedOfficialMatches: number;
  ledgerRows: number;
  recentError?: string | null;
}

export interface LiveStateTeam {
  teamKey: string;
  schoolKey: string;
  collegeName: string;
  teamName: string;
  currentPublishedRating: number;
  preseasonPublishedRating: number;
  publishedDeltaFromPreseason: number;
  liveStateRatingComponent: number;
  confirmedPriorRatingComponent: number;
  residualPriorRatingComponent: number;
  regionalGroupMatchesPlayed: number;
  currentStageFamily: string;
  latestMatchId: string | null;
  latestMatchDate: string | null;
}

export interface LiveStateLedgerRow {
  matchId: string;
  matchDate: string;
  regionSlug: RegionSlug;
  stageFamily: string;
  teamKey: string;
  opponentTeamKey: string;
  teamSide: "red" | "blue";
  scoreline: string;
  matchResult: "win" | "loss" | string;
  publishedRatingBeforeMatch: number;
  publishedRatingAfterMatch: number;
  publishedDeltaRating: number;
  liveUpdateDeltaRating: number;
  priorComponentDeltaRating: number;
  confirmedPriorRatingAfterMatch: number;
  residualPriorRatingAfterMatch: number;
}

export interface LiveStateResponse extends LiveStatusSummary {
  available: boolean;
  reason: string | null;
  regionSlug: RegionSlug;
  regionName: string;
  generatedAt: string | null;
  season: number | null;
  currentSnapshot: LiveStateTeam[];
  matchLedger: LiveStateLedgerRow[];
  teamIndex: Record<
    string,
    {
      teamKey: string;
      schoolKey: string;
      collegeName: string;
      teamName: string;
      regionSlug: RegionSlug;
      regionName: string;
    }
  >;
}

export type MiniProgramPrediction =
  | {
      status: "available";
      matchId: string;
      redCount: number;
      blueCount: number;
      tieCount: number;
      totalCount: number;
      redRate: number;
      blueRate: number;
      tieRate: number;
      fetchedAt: string;
    }
  | {
      status: "unavailable";
      matchId: string;
      reason?: string;
      fetchedAt?: string;
      redCount?: number;
      blueCount?: number;
      tieCount?: number;
      totalCount?: number;
      redRate?: number;
      blueRate?: number;
      tieRate?: number;
    };

export interface OverviewTeam {
  teamKey: string;
  collegeName: string;
  teamName: string;
  mu0: number;
  sigma0: number;
  eloGlobalRank: number;
  eloRegionRank: number;
  seedTier: string;
  seedRankInRegion: number;
  regionSlug: RegionSlug;
  regionName: string;
  probabilities: {
    roundOf16: number;
    repechage: number;
    national: number;
    champion: number;
  };
}

export interface OverviewRegion {
  regionSlug: RegionSlug;
  regionName: string;
  nationalSlots: number;
  repechageSlots: number;
  monteCarlo: {
    aggregationMode: string;
    seedCount: number;
    iterationsPerSeed: number;
    effectiveIterations: number;
    seeds: number[];
    pairProbabilitySamples: number;
  };
  liveStatus?: LiveStatusSummary;
  teams: OverviewTeam[];
}

export interface OverviewResponse {
  generatedAt: string;
  regions: OverviewRegion[];
}

export interface TeamRef {
  teamKey: string;
  collegeName: string;
  teamName: string;
  slot?: string | null;
}

export interface SlotRow extends TeamRef {
  groupName: string;
  drawBox: string;
  seedTier: string;
  seedRankInRegion: number;
  mu0: number;
  sigma0: number;
  eloGlobalRank: number;
}

export interface GroupRankingRow extends TeamRef {
  groupRank: number;
  wins: number;
  losses: number;
  status: string;
  finalRank: number;
}

export interface MatchRow {
  matchLabel: string;
  stage: string;
  stageOrder: number;
  roundNumber: number;
  groupName: string;
  bestOf: number;
  isRealResult?: boolean;
  isConfirmedMatchup?: boolean;
  redTeam: TeamRef;
  blueTeam: TeamRef;
  scoreline: string;
  winnerTeamKey: string;
  loserTeamKey: string;
  pGameRed: number;
  pGameBlue: number;
  pSeriesRed: number;
  pSeriesBlue: number;
  deltaH2H: number;
  redMu0?: number;
  blueMu0?: number;
  redDelta?: number;
  blueDelta?: number;
  confidenceLabel: string;
  winnerNext: string;
  loserNext: string;
  officialMatchId?: string;
  officialStatus?: string;
  plannedStartAt?: string | null;
  miniProgramPrediction?: MiniProgramPrediction;
}

export interface FinalRankingRow extends TeamRef {
  rank: number;
  groupName: string;
  seedTier: string;
  seedRankInRegion: number;
  swissWins: number;
  swissLosses: number;
  swissGroupRank: number | null;
  mu0: number;
  finalBucket: string;
  advancement: string;
}

export interface SimulationResponse {
  meta: {
    regionSlug: RegionSlug;
    regionName: string;
    seed: number;
    generatedAt: string;
    samplesPerMatch: number;
    nationalSlots: number;
    repechageSlots: number;
    monteCarlo?: OverviewRegion["monteCarlo"];
    liveStatus?: LiveStatusSummary;
  };
  slots: SlotRow[];
  groupRankings: Record<string, GroupRankingRow[]>;
  matches: MatchRow[];
  finalRankings: FinalRankingRow[];
  summary: {
    champion: TeamRef;
    runnerUp: TeamRef;
    thirdPlace: TeamRef;
    fourthPlace: TeamRef;
    nationalQualifiers: string[];
    repechageQualifiers: string[];
    matchCountByStage: Record<string, number>;
  };
}

export interface RegionViewConfig {
  id: WorkspaceView;
  label: string;
  description: string;
  kind: "canvas";
  tone: CanvasTone;
}

export interface OverviewMetric {
  label: string;
  value: string;
}

export interface OverviewModule {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  tone?: CanvasTone;
}

export interface RegionDashboardCard {
  regionSlug: RegionSlug;
  regionName: string;
  nationalSlots: number;
  repechageSlots: number;
  teamCount: number;
  avgTop4Elo: number;
  avgTop8Elo: number;
  meanElo: number;
  medianElo: number;
  top3ChampionShare: number;
  top8ChampionShare: number;
  titleGap: number;
  favorite: OverviewTeam;
  teams: OverviewTeam[];
  monteCarlo: OverviewRegion["monteCarlo"];
  liveStatus?: LiveStatusSummary;
  titleShapeTag: string;
  profileTags: string[];
  summarySentence: string;
  nationalLocks: OverviewTeam[];
  repechageLocks: OverviewTeam[];
  nationalRace: {
    locksCount: number;
    cutoffTeam: OverviewTeam | null;
    chasingTeams: OverviewTeam[];
    totalChasingCount: number;
    cutoffProbability: number;
    gap: number;
    bandSize: number;
  };
  repechageRace: {
    locksCount: number;
    cutoffTeam: OverviewTeam | null;
    chasingTeams: OverviewTeam[];
    totalChasingCount: number;
    cutoffProbability: number;
    gap: number;
    bandSize: number;
  };
}

export interface RegionStrengthRow {
  regionSlug: RegionSlug;
  regionName: string;
  powerIndex: number;
  top4AverageElo: number;
  top8AverageElo: number;
  meanElo: number;
  medianElo: number;
  favoriteChampionProbability: number;
  top3ChampionShare: number;
  nationalLockCount: number;
  titleGap: number;
}

export interface EloRankingRow {
  rankInRegion: number;
  teamKey: string;
  collegeName: string;
  teamName: string;
  mu0: number;
  repechageProbability: number;
  nationalProbability: number;
  championProbability: number;
}

export interface EloRankingSection {
  regionSlug: RegionSlug;
  regionName: string;
  teamCount: number;
  topTeam: OverviewTeam | null;
  top8AverageElo: number;
  rows: EloRankingRow[];
}

export interface OverviewDashboard {
  generatedLabel: string;
  heroMetrics: OverviewMetric[];
  regions: RegionDashboardCard[];
  contenders: OverviewTeam[];
  regionStrength: RegionStrengthRow[];
}

export interface EloRankingsDashboard {
  generatedLabel: string;
  sections: EloRankingSection[];
}

export interface WorkspaceStageHeader {
  id: string;
  x: number;
  y: number;
  width: number;
  title: string;
  subtitle?: string;
  tone?: CanvasTone;
}

export interface MatchCardSide {
  teamKey: string;
  collegeName: string;
  teamName: string;
  score: string;
  probability: number;
  side: "red" | "blue";
  isWinner: boolean;
}

interface CanvasCardBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: CanvasTone;
}

export interface MatchCanvasCard extends CanvasCardBase {
  title?: string;
  subtitle?: string;
  kind: "match";
  match: MatchRow;
  orderLabel: string;
  displayLabel: string;
  metaLabel: string;
  variant?: "standard" | "compact" | "playoff";
  showProbability?: boolean;
  redSide: MatchCardSide;
  blueSide: MatchCardSide;
}

export interface TeamCanvasCard extends CanvasCardBase {
  mu0?: number;
  heroSlot?: string;
  kind: "team";
  variant: "team" | "summary" | "ranking";
  teamKey: string;
  collegeName: string;
  teamName: string;
  orderLabel?: string;
  subtitle?: string;
  statLine?: string;
  meta?: string[];
}

export type CanvasCard = MatchCanvasCard | TeamCanvasCard;

export interface CanvasConnector {
  teamKey?: string;
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  kind?: "curve" | "bracket" | "merge";
  viaX?: number;
  branchY?: number[];
  branchLabels?: Array<{ y: number; text: string }>;
  tone?: CanvasTone;
  weight?: "normal" | "strong";
}

export interface WorkspaceStage {
  showProbability?: boolean;
  id: WorkspaceView;
  label: string;
  title: string;
  description: string;
  width: number;
  height: number;
  viewport?: {
    align?: "center" | "left";
    minScale?: number;
    paddingX?: number;
    paddingY?: number;
  };
  headers: WorkspaceStageHeader[];
  cards: CanvasCard[];
  connectors: CanvasConnector[];
}

export type InspectorSelection =
  | { kind: "team"; teamKey: string }
  | { kind: "match"; matchLabel: string };
