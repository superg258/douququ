export type RegionSlug = "east_region" | "south_region" | "north_region";
export type WorkspaceView = "slots" | "swiss-a" | "swiss-b" | "qualification" | "playoff" | "final-rankings";
export type CanvasTone = "cyan" | "amber" | "steel" | "emerald";
export type LiveSourceStatus = "active" | "inactive" | "missing" | "error";
export type EloRankSource = "live" | "preseason";

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
  priorRetentionFraction: number;
  priorAbsorptionFraction: number;
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
  priorRetentionFractionBeforeMatch: number;
  priorRetentionFractionAfterMatch: number;
  priorAbsorptionFractionBeforeMatch: number;
  priorAbsorptionFractionAfterMatch: number;
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
  currentElo?: number;
  preseasonElo?: number;
  eloDeltaFromPreseason?: number;
  eloRankSource?: EloRankSource;
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
  currentElo?: number;
  preseasonElo?: number;
  eloDeltaFromPreseason?: number;
  eloRankSource?: EloRankSource;
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
  redCurrentElo?: number;
  blueCurrentElo?: number;
  redDelta?: number;
  blueDelta?: number;
  redLiveDelta?: number;
  blueLiveDelta?: number;
  redPriorDelta?: number;
  bluePriorDelta?: number;
  redPriorAdjustmentLabel?: string;
  bluePriorAdjustmentLabel?: string;
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
  currentElo?: number;
  preseasonElo?: number;
  eloDeltaFromPreseason?: number;
  eloRankSource?: EloRankSource;
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
  currentElo?: number;
  preseasonElo?: number;
  eloDeltaFromPreseason?: number;
  eloRankSource?: EloRankSource;
  repechageProbability: number;
  nationalProbability: number;
  championProbability: number;
}

export interface EloRankingSection {
  regionSlug: RegionSlug;
  regionName: string;
  teamCount: number;
  medianElo: number;
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
  isSimulated?: boolean;
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

/* ═══════════════════════════════════════════════════════════
   Prematch Center
   ═══════════════════════════════════════════════════════════ */

export type PrematchDataSource = "official_live" | "simulation" | "simulation_proxy";
export type PrematchScheduleState = "simulation" | "simulation_proxy" | "scheduled" | "confirmed_unfinished";
export type PrematchRequestedMode = "live" | "sim";
export type PrematchEffectiveMode = "live" | "sim" | "simulation_proxy";
export type PrematchTimelineState =
  | "live_now"
  | "up_next"
  | "today_pending"
  | "confirmed_upcoming"
  | "overdue_unresolved"
  | "simulation_unassigned"
  | "review_pending";

export interface PrematchRegionStatus {
  regionSlug: RegionSlug;
  regionName: string;
  sourceStatus: LiveSourceStatus | null;
  sourceReason: string | null;
  sourceUpdatedAt: string | null;
  completedOfficialMatches: number;
  confirmedOfficialMatches: number;
  slotAssignmentSource?: string | null;
  slotAssignmentReason?: string | null;
}

export interface SourceFreshness {
  serviceGeneratedAt: string;
  modelGeneratedAt: string;
  officialScheduleUpdatedAt: string | null;
  liveEloUpdatedAt: string | null;
  officialScheduleAgeMinutes: number | null;
  liveEloStatus: "active" | "missing" | string;
  activeRegionCount: number;
  totalRegionCount: number;
  coverageLabel: string;
  regionStatuses: PrematchRegionStatus[];
}

export interface PrematchAudience {
  status: "available" | "stale" | "unavailable";
  available: boolean;
  redRate: number | null;
  blueRate: number | null;
  tieRate: number | null;
  totalCount: number | null;
  favoriteSide: "red" | "blue" | "tie" | null;
  label: string;
  fetchedAt: string | null;
}

export interface PrematchDivergence {
  available: boolean;
  redDelta: number | null;
  absoluteDelta: number | null;
  label: string;
  audienceFavoriteSide: "red" | "blue" | "tie" | null;
}

export interface PrematchUpsetRisk {
  score: number;
  label: string;
  reason: string;
}

export interface PrematchCenterMatch {
  id: string;
  regionSlug: RegionSlug;
  regionName: string;
  seed: number;
  mode: string;
  dataSource: PrematchDataSource;
  scheduleState: PrematchScheduleState;
  timelineState?: PrematchTimelineState;
  workspaceView: WorkspaceView;
  matchLabel: string;
  stage: string;
  stageLabel: string;
  stageOrder: number;
  roundNumber: number;
  groupName: string;
  bestOf: number;
  plannedStartAt: string | null;
  plannedLocalDate: string | null;
  officialMatchId: string | null;
  officialStatus: string | null;
  redTeam: TeamRef;
  blueTeam: TeamRef;
  pGameRed: number;
  pGameBlue: number;
  pSeriesRed: number;
  pSeriesBlue: number;
  favoriteRate: number;
  margin: number;
  predictedWinnerSide: "red" | "blue";
  predictedWinnerTeamKey: string;
  predictedWinnerName: string;
  predictedScoreline: string;
  confidenceLabel: string;
  confidenceText: string;
  audience: PrematchAudience;
  modelAudienceDivergence: PrematchDivergence;
  upsetRisk: PrematchUpsetRisk;
  redTeamGlobalRank?: number | null;
  blueTeamGlobalRank?: number | null;
  redCurrentElo?: number | null;
  blueCurrentElo?: number | null;
  redPreseasonElo?: number | null;
  bluePreseasonElo?: number | null;
  redEloDeltaFromPreseason?: number | null;
  blueEloDeltaFromPreseason?: number | null;
  redSeasonOverperformer?: boolean;
  blueSeasonOverperformer?: boolean;
  strongTeamInvolved?: boolean;
  priorUpsetTeamKeys?: string[];
  hasPriorUpsetTeam?: boolean;
  seasonOverperformerTeamKeys?: string[];
  hasSeasonOverperformerTeam?: boolean;
}

export interface PrematchCenterResponse {
  generatedAt: string;
  seed: number;
  targetDate: string;
  timezone: string;
  source: {
    requestedMode: PrematchRequestedMode;
    effectiveMode: PrematchEffectiveMode;
    regionStatuses: PrematchRegionStatus[];
  };
  sourceFreshness?: SourceFreshness;
  completedMatchCount: number;
  pendingMatchCount: number;
  confirmedPendingMatchCount: number;
  scheduledPendingMatchCount: number;
  nextMatch: PrematchCenterMatch | null;
  nextActionMatch?: PrematchCenterMatch | null;
  timelineBuckets?: {
    liveNow: PrematchCenterMatch[];
    upNext: PrematchCenterMatch[];
    todayPending: PrematchCenterMatch[];
    confirmedUpcoming: PrematchCenterMatch[];
    overdueUnresolved: PrematchCenterMatch[];
    simulationUnassigned: PrematchCenterMatch[];
    reviewPending: PrematchCenterMatch[];
  };
  todayMatches: PrematchCenterMatch[];
  allUpcomingMatches: PrematchCenterMatch[];
}

export interface CommandCenterResponse {
  generatedAt: string;
  seed: number;
  targetDate: string;
  timezone: string;
  source: PrematchCenterResponse["source"];
  sourceFreshness: SourceFreshness;
  completedMatchCount: number;
  pendingMatchCount: number;
  confirmedPendingMatchCount: number;
  scheduledPendingMatchCount: number;
  nextActionMatch: PrematchCenterMatch | null;
  timelineBuckets: NonNullable<PrematchCenterResponse["timelineBuckets"]>;
}

export interface PredictionRecapGroup {
  completedMatches: number;
  pendingMatches: number;
  winnerHits: number;
  scorelineHits: number;
  upsetMisses: number;
  winnerHitRate: number | null;
  scorelineHitRate: number | null;
  regionName?: string;
  confidenceText?: string;
  stageLabel?: string;
}

export interface PredictionRecapMatch {
  id: string;
  regionSlug: RegionSlug;
  regionName: string;
  seed: number;
  workspaceView: WorkspaceView;
  matchLabel: string;
  stage: string;
  stageLabel: string;
  plannedStartAt?: string | null;
  predictedWinnerTeamKey: string;
  predictedWinnerName: string;
  actualWinnerTeamKey: string | null;
  actualWinnerName: string | null;
  predictedScoreline: string;
  actualScoreline: string | null;
  favoriteRate: number;
  confidenceLabel: string;
  confidenceText: string;
  deviationType: "upset_miss" | "scoreline_miss" | string;
  redTeam: TeamRef;
  blueTeam: TeamRef;
  predictedWinnerSide: "red" | "blue";
}

export interface PredictionRecapResponse {
  generatedAt: string;
  seed: number;
  mode: "live" | "sim";
  summary: PredictionRecapGroup;
  byRegion: Record<RegionSlug, PredictionRecapGroup>;
  byConfidence: Record<string, PredictionRecapGroup>;
  byStage: Record<string, PredictionRecapGroup>;
  notableMatches: PredictionRecapMatch[];
}

export type TeamProfileMatch = MatchRow & {
  side: "red" | "blue";
  opponent: TeamRef;
  resultForTeam: "win" | "loss" | "pending" | string;
  winProbability: number;
  stageLabel: string;
  workspaceView: WorkspaceView;
};

export interface TeamProfileResponse {
  generatedAt: string;
  seed: number;
  mode: "live" | "sim";
  team: OverviewTeam;
  region: {
    regionSlug: RegionSlug;
    regionName: string;
    nationalSlots: number;
    repechageSlots: number;
  };
  slot: SlotRow | null;
  finalRanking: FinalRankingRow | null;
  matchPath: TeamProfileMatch[];
  completedMatches: TeamProfileMatch[];
  upcomingMatches: TeamProfileMatch[];
  liveState: {
    snapshot: LiveStateTeam | null;
    ledger: LiveStateLedgerRow[];
  } | null;
  regionEntry: {
    regionSlug: RegionSlug;
    view: WorkspaceView;
    seed: number;
    mode: "live" | "sim";
    highlightTeamKey: string;
  };
  sourceFreshness: SourceFreshness;
}
