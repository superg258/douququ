import type {
  EloRankingRow,
  EloRankingsDashboard,
  EloRankingSection,
  OverviewDashboard,
  OverviewMetric,
  OverviewRegion,
  OverviewResponse,
  OverviewTeam,
  RegionDashboardCard,
  RegionStrengthRow,
} from "@/lib/types";
import { compareRegionOrder } from "@/lib/region-config";

const NATIONAL_LOCK_THRESHOLD = 0.7;
const REGION_STRENGTH_WEIGHTS = {
  avgTop4Elo: 0.25,
  favoriteChampionProbability: 0.1,
  top3ChampionShare: 0.15,
  avgTop8Elo: 0.2,
  meanElo: 0.1,
  medianElo: 0.05,
  nationalLockCount: 0.15,
} as const;

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function favoriteOf(region: OverviewRegion) {
  return [...region.teams].sort((left, right) => {
    if (right.probabilities.champion !== left.probabilities.champion) {
      return right.probabilities.champion - left.probabilities.champion;
    }
    return right.mu0 - left.mu0;
  })[0];
}

function rankTeamsByProbability(
  region: OverviewRegion,
  selector: (team: OverviewTeam) => number,
) {
  return [...region.teams].sort((left, right) => {
    const leftValue = selector(left);
    const rightValue = selector(right);

    if (rightValue !== leftValue) {
      return rightValue - leftValue;
    }
    return right.mu0 - left.mu0;
  });
}

function rankTeamsByElo(region: OverviewRegion) {
  return [...region.teams].sort((left, right) => {
    if (right.mu0 !== left.mu0) {
      return right.mu0 - left.mu0;
    }
    if (left.eloRegionRank !== right.eloRegionRank) {
      return left.eloRegionRank - right.eloRegionRank;
    }
    return left.teamKey.localeCompare(right.teamKey);
  });
}

function buildRaceBucket(
  region: OverviewRegion,
  selector: (team: OverviewTeam) => number,
  cutoffRank: number,
  lockThreshold = 0.8,
) {
  const ranked = rankTeamsByProbability(region, selector);
  const cutoffIndex = Math.max(Math.min(cutoffRank - 1, ranked.length - 1), 0);
  const cutoffTeam = ranked[cutoffIndex] ?? null;
  const nextTeam = ranked[cutoffIndex + 1] ?? null;
  const cutoffProb = cutoffTeam ? selector(cutoffTeam) : 0;
  
  const allChasing = ranked.slice(cutoffIndex + 1);
  const validChasing = allChasing.filter(team => cutoffProb - selector(team) <= 0.20 && selector(team) > 0);
  
  const chasingTeams = validChasing.slice(0, 3);
  const totalChasingCount = validChasing.length;

  return {
    locksCount: ranked.filter((team) => selector(team) >= lockThreshold).length,
    cutoffTeam,
    chasingTeams,
    totalChasingCount,
    cutoffProbability: cutoffTeam ? selector(cutoffTeam) : 0,
    gap: Math.max((cutoffTeam ? selector(cutoffTeam) : 0) - (nextTeam ? selector(nextTeam) : 0), 0),
    bandSize: Math.min(1 + chasingTeams.length, 4),
  };
}

function buildLockTeams(
  region: OverviewRegion,
  selector: (team: OverviewTeam) => number,
  lockThreshold = 0.8,
) {
  return rankTeamsByProbability(region, selector).filter((team) => selector(team) >= lockThreshold);
}

function normalize(value: number, min: number, max: number) {
  if (max === min) {
    return 0.5;
  }
  return (value - min) / (max - min);
}

function determineTitleShape(titleGap: number, top2ChampionShare: number) {
  if (titleGap >= 0.12) {
    return "一超多强";
  }
  if (titleGap < 0.06 && top2ChampionShare >= 0.65) {
    return "双强并跑";
  }
  return "群雄混战";
}

function pickMaxCard(cards: RegionDashboardCard[], selector: (card: RegionDashboardCard) => number) {
  return [...cards].sort((left, right) => {
    const delta = selector(right) - selector(left);
    if (delta !== 0) {
      return delta;
    }
    return compareRegionOrder(left.regionSlug, right.regionSlug);
  })[0];
}

function pickMinCard(cards: RegionDashboardCard[], selector: (card: RegionDashboardCard) => number) {
  return [...cards].sort((left, right) => {
    const delta = selector(left) - selector(right);
    if (delta !== 0) {
      return delta;
    }
    return compareRegionOrder(left.regionSlug, right.regionSlug);
  })[0];
}

function pushProfileTag(tagMap: Map<string, string[]>, regionSlug: RegionDashboardCard["regionSlug"], tag: string) {
  const tags = tagMap.get(regionSlug) ?? [];
  if (!tags.includes(tag) && tags.length < 2) {
    tags.push(tag);
    tagMap.set(regionSlug, tags);
  }
}

function buildProfileTags(cards: RegionDashboardCard[]) {
  const tagMap = new Map<string, string[]>();
  const headWinner = pickMaxCard(cards, (card) => card.avgTop4Elo);
  const depthWinner = pickMaxCard(cards, (card) => card.avgTop8Elo * 0.6 + card.medianElo * 0.4);
  const openWinner = pickMinCard(cards, (card) => card.titleGap);
  const crowdWinner = pickMinCard(cards, (card) => card.nationalRace.gap);

  pushProfileTag(tagMap, headWinner.regionSlug, "头部火力最强");
  pushProfileTag(tagMap, depthWinner.regionSlug, "整体深度最佳");
  pushProfileTag(tagMap, openWinner.regionSlug, "争冠悬念最大");
  pushProfileTag(tagMap, crowdWinner.regionSlug, "国赛门槛最紧");

  return tagMap;
}

function buildSummarySentence(card: RegionDashboardCard) {
  const intro = card.profileTags[0] ?? card.titleShapeTag;
  const cutoffCollege = card.nationalRace.cutoffTeam?.collegeName;
  const chasingCount = card.nationalRace.chasingTeams.length;

  if (cutoffCollege && chasingCount > 0) {
    return `${card.regionName}${intro}，已有${card.nationalRace.locksCount}队稳进国赛，${cutoffCollege}正守在最后一张国赛席位上，身后还有${chasingCount}队继续追赶。`;
  }

  if (cutoffCollege) {
    return `${card.regionName}${intro}，已有${card.nationalRace.locksCount}队稳进国赛，${cutoffCollege}仍在守住最后一张国赛席位。`;
  }

  return `${card.regionName}${intro}，国赛门槛仍在变化，先重点看争冠热度与整体深度。`;
}

function buildRegionCards(regions: OverviewRegion[]): RegionDashboardCard[] {
  const cards = [...regions]
    .sort((left, right) => compareRegionOrder(left.regionSlug, right.regionSlug))
    .map((region) => {
      const nationalSelector = (team: OverviewTeam) => team.probabilities.national;
      const repechageOrBetterSelector = (team: OverviewTeam) => team.probabilities.national + team.probabilities.repechage;
      const eloValues = region.teams.map((team) => team.mu0).sort((left, right) => right - left);
      const championTeams = [...region.teams].sort((left, right) => {
        if (right.probabilities.champion !== left.probabilities.champion) {
          return right.probabilities.champion - left.probabilities.champion;
        }
        return right.mu0 - left.mu0;
      });
      const avgTop4Elo = average(eloValues.slice(0, 4));
      const avgTop8Elo = average(eloValues.slice(0, 8));
      const meanElo = average(eloValues);
      const medianElo = median(eloValues);
      const top2ChampionShare = sum(championTeams.slice(0, 2).map((team) => team.probabilities.champion));
      const top3ChampionShare = sum(championTeams.slice(0, 3).map((team) => team.probabilities.champion));
      const top8ChampionShare = sum(championTeams.slice(0, 8).map((team) => team.probabilities.champion));
      const titleGap =
        (championTeams[0]?.probabilities.champion ?? 0) - (championTeams[1]?.probabilities.champion ?? 0);
      const nationalLocks = buildLockTeams(region, nationalSelector, NATIONAL_LOCK_THRESHOLD);
      const nationalRace = buildRaceBucket(region, nationalSelector, region.nationalSlots, NATIONAL_LOCK_THRESHOLD);
      const repechageLocks = buildLockTeams(region, repechageOrBetterSelector, NATIONAL_LOCK_THRESHOLD);
      // `repechage` on the API means "exactly enters repechage". The homepage race band needs
      // the total seat line, so it uses "national or repechage" as the ordering metric.
      const repechageRace = buildRaceBucket(
        region,
        repechageOrBetterSelector,
        region.nationalSlots + region.repechageSlots,
      );

      return {
        regionSlug: region.regionSlug,
        regionName: region.regionName,
        nationalSlots: region.nationalSlots,
        repechageSlots: region.repechageSlots,
        teamCount: region.teams.length,
        avgTop4Elo,
        avgTop8Elo,
        meanElo,
        medianElo,
        top3ChampionShare,
        top8ChampionShare,
        titleGap,
        favorite: favoriteOf(region),
        teams: region.teams,
        monteCarlo: region.monteCarlo,
        titleShapeTag: determineTitleShape(titleGap, top2ChampionShare),
        profileTags: [],
        summarySentence: "",
        nationalLocks,
        repechageLocks,
        nationalRace,
        repechageRace,
      };
    });

  const profileTags = buildProfileTags(cards);

  return cards.map((card) => {
    const nextCard = {
      ...card,
      profileTags: profileTags.get(card.regionSlug) ?? [],
    };

    return {
      ...nextCard,
      summarySentence: buildSummarySentence(nextCard),
    };
  });
}

function buildContenders(regions: OverviewRegion[]) {
  return regions
    .flatMap((region) => region.teams)
    .sort((left, right) => {
      if (right.probabilities.champion !== left.probabilities.champion) {
        return right.probabilities.champion - left.probabilities.champion;
      }
      return right.mu0 - left.mu0;
    })
    .slice(0, 8);
}

function buildRegionStrength(cards: RegionDashboardCard[]): RegionStrengthRow[] {
  const baseRows = cards.map((card) => ({
    regionSlug: card.regionSlug,
    regionName: card.regionName,
    top4AverageElo: card.avgTop4Elo,
    top8AverageElo: card.avgTop8Elo,
    meanElo: card.meanElo,
    medianElo: card.medianElo,
    favoriteChampionProbability: card.favorite.probabilities.champion,
    top3ChampionShare: card.top3ChampionShare,
    nationalLockCount: card.nationalLocks.length,
    titleGap: card.titleGap,
  }));

  const mins = {
    top4AverageElo: Math.min(...baseRows.map((row) => row.top4AverageElo)),
    top8AverageElo: Math.min(...baseRows.map((row) => row.top8AverageElo)),
    meanElo: Math.min(...baseRows.map((row) => row.meanElo)),
    medianElo: Math.min(...baseRows.map((row) => row.medianElo)),
    favoriteChampionProbability: Math.min(...baseRows.map((row) => row.favoriteChampionProbability)),
    top3ChampionShare: Math.min(...baseRows.map((row) => row.top3ChampionShare)),
    nationalLockCount: Math.min(...baseRows.map((row) => row.nationalLockCount)),
  };
  const maxs = {
    top4AverageElo: Math.max(...baseRows.map((row) => row.top4AverageElo)),
    top8AverageElo: Math.max(...baseRows.map((row) => row.top8AverageElo)),
    meanElo: Math.max(...baseRows.map((row) => row.meanElo)),
    medianElo: Math.max(...baseRows.map((row) => row.medianElo)),
    favoriteChampionProbability: Math.max(...baseRows.map((row) => row.favoriteChampionProbability)),
    top3ChampionShare: Math.max(...baseRows.map((row) => row.top3ChampionShare)),
    nationalLockCount: Math.max(...baseRows.map((row) => row.nationalLockCount)),
  };

  return baseRows
    .map((row) => {
      // Composite score blends head firepower, depth, title heat, and stable national-level thickness.
      const composite =
        normalize(row.top4AverageElo, mins.top4AverageElo, maxs.top4AverageElo) * REGION_STRENGTH_WEIGHTS.avgTop4Elo +
        normalize(
          row.favoriteChampionProbability,
          mins.favoriteChampionProbability,
          maxs.favoriteChampionProbability,
        ) * REGION_STRENGTH_WEIGHTS.favoriteChampionProbability +
        normalize(row.top3ChampionShare, mins.top3ChampionShare, maxs.top3ChampionShare) *
          REGION_STRENGTH_WEIGHTS.top3ChampionShare +
        normalize(row.top8AverageElo, mins.top8AverageElo, maxs.top8AverageElo) * REGION_STRENGTH_WEIGHTS.avgTop8Elo +
        normalize(row.meanElo, mins.meanElo, maxs.meanElo) * REGION_STRENGTH_WEIGHTS.meanElo +
        normalize(row.medianElo, mins.medianElo, maxs.medianElo) * REGION_STRENGTH_WEIGHTS.medianElo +
        normalize(row.nationalLockCount, mins.nationalLockCount, maxs.nationalLockCount) *
          REGION_STRENGTH_WEIGHTS.nationalLockCount;

      return {
        ...row,
        powerIndex: Math.round(60 + composite * 40),
      };
    })
    .sort((left, right) => compareRegionOrder(left.regionSlug, right.regionSlug));
}

function formatGeneratedLabel(generatedAt: string) {
  return new Date(generatedAt).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildHeroMetrics(overview: OverviewResponse): OverviewMetric[] {
  const totalTeams = overview.regions.reduce((sum, region) => sum + region.teams.length, 0);
  const totalNationalSlots = overview.regions.reduce((sum, region) => sum + region.nationalSlots, 0);
  const totalRepechageSlots = overview.regions.reduce((sum, region) => sum + region.repechageSlots, 0);
  const monteCarlo = overview.regions[0]?.monteCarlo;
  return [
    { label: "参赛队伍", value: `${totalTeams} 支` },
    { label: "国赛席位", value: `${totalNationalSlots} 个` },
    { label: "复活赛席位", value: `${totalRepechageSlots} 个` },
    {
      label: "模拟规模",
      value: monteCarlo ? `${monteCarlo.seedCount} 组种子 / ${monteCarlo.effectiveIterations.toLocaleString("zh-CN")} 次` : "待生成",
    },
    { label: "最近更新", value: formatGeneratedLabel(overview.generatedAt) },
  ];
}

export function buildOverviewDashboard(overview: OverviewResponse): OverviewDashboard {
  const regions = buildRegionCards(overview.regions);
  const contenders = buildContenders(overview.regions);
  const regionStrength = buildRegionStrength(regions);

  return {
    generatedLabel: formatGeneratedLabel(overview.generatedAt),
    heroMetrics: buildHeroMetrics(overview),
    regions,
    contenders,
    regionStrength,
  };
}

function buildEloRankingSections(regions: OverviewRegion[]): EloRankingSection[] {
  return [...regions]
    .sort((left, right) => compareRegionOrder(left.regionSlug, right.regionSlug))
    .map((region) => {
      const rankedTeams = rankTeamsByElo(region);
      const rows: EloRankingRow[] = rankedTeams.map((team, index) => ({
        rankInRegion: index + 1,
        teamKey: team.teamKey,
        collegeName: team.collegeName,
        teamName: team.teamName,
        mu0: team.mu0,
        repechageProbability: team.probabilities.repechage,
        nationalProbability: team.probabilities.national,
        championProbability: team.probabilities.champion,
      }));

      return {
        regionSlug: region.regionSlug,
        regionName: region.regionName,
        teamCount: region.teams.length,
        topTeam: rankedTeams[0] ?? null,
        top8AverageElo: average(rankedTeams.slice(0, 8).map((team) => team.mu0)),
        rows,
      };
    });
}

export function buildEloRankingsDashboard(overview: OverviewResponse): EloRankingsDashboard {
  return {
    generatedLabel: formatGeneratedLabel(overview.generatedAt),
    sections: buildEloRankingSections(overview.regions),
  };
}
