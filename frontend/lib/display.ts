const STAGE_LABELS: Record<string, string> = {
  swiss: "瑞士轮",
  round_of_16: "16 进 8",
  quarterfinal: "8 进 4",
  qualification_round1: "资格赛第一轮",
  qualification_round2: "资格赛第二轮",
  semifinal: "半决赛",
  final: "冠军战",
  third_place: "季军战",
};

const FINAL_BUCKET_LABELS: Record<string, string> = {
  champion: "冠军",
  runner_up: "亚军",
  "runner-up": "亚军",
  third_place: "季军",
  "third-place": "季军",
  fourth_place: "第四名",
  "fourth-place": "第四名",
  top8: "八强",
  quarterfinalist: "八强",
  national_via_qualifier: "资格赛晋级国赛",
  repechage_from_national_playoff_loss: "国赛资格战负者转入复活赛",
  repechage_direct: "直通复活赛",
  swiss_out: "瑞士轮淘汰",
  swiss_eliminated: "瑞士轮淘汰",
  group_eliminated: "小组赛淘汰",
};

const ADVANCEMENT_LABELS: Record<string, string> = {
  national_qualified: "晋级国赛",
  repechage_qualified: "晋级复活赛",
  eliminated: "淘汰",
  group_eliminated: "止步小组赛",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  very_high: "极高",
  high: "高",
  medium: "中",
  low: "低",
  very_low: "较低",
};

const SEED_TIER_LABELS: Record<string, string> = {
  tier1: "第一梯队",
  tier2: "第二梯队",
  unseeded: "非种子",
  S1: "第一梯队",
  S2: "第二梯队",
  U: "非种子",
};

function fallbackLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\bSwiss\b/gi, "瑞士轮")
    .replace(/\bchampion\b/gi, "冠军")
    .replace(/\brepechage\b/gi, "复活赛")
    .replace(/\bnational\b/gi, "国赛")
    .replace(/\bgroup\b/gi, "小组赛")
    .replace(/\beliminated\b/gi, "淘汰")
    .trim();
}

export function translateStageLabel(stage: string) {
  return STAGE_LABELS[stage] ?? fallbackLabel(stage);
}

export function translateFinalBucket(bucket: string) {
  return FINAL_BUCKET_LABELS[bucket] ?? fallbackLabel(bucket);
}

export function translateAdvancementLabel(advancement: string) {
  return ADVANCEMENT_LABELS[advancement] ?? fallbackLabel(advancement);
}

export function translateDestinationLabel(destination: string) {
  if (ADVANCEMENT_LABELS[destination]) {
    return translateAdvancementLabel(destination);
  }
  if (FINAL_BUCKET_LABELS[destination]) {
    return translateFinalBucket(destination);
  }
  if (STAGE_LABELS[destination]) {
    return `进入${translateStageLabel(destination)}`;
  }
  if (destination === "next") {
    return "进入下一阶段";
  }
  return fallbackLabel(destination);
}

export function translateConfidenceLabel(confidence: string) {
  return CONFIDENCE_LABELS[confidence] ?? fallbackLabel(confidence);
}

export function formatSeedTierLabel(seedTier: string) {
  return SEED_TIER_LABELS[seedTier] ?? fallbackLabel(seedTier);
}

export function formatMatchLabel(matchLabel: string) {
  let match = /^([AB])-SWISS-(\d+)-(\d+)$/.exec(matchLabel);
  if (match) {
    return `${match[1]} 组瑞士轮第 ${Number(match[2])} 轮第 ${Number(match[3])} 场`;
  }

  match = /^QUAL-1-(\d+)$/.exec(matchLabel);
  if (match) {
    return `资格赛第一轮第 ${Number(match[1])} 场`;
  }

  match = /^QUAL-2-(\d+)$/.exec(matchLabel);
  if (match) {
    return `国赛席位战第 ${Number(match[1])} 场`;
  }

  match = /^QUAL-R-(\d+)$/.exec(matchLabel);
  if (match) {
    return `复活赛席位战第 ${Number(match[1])} 场`;
  }

  match = /^R16-(\d+)$/.exec(matchLabel);
  if (match) {
    return `16 进 8 第 ${Number(match[1])} 场`;
  }

  match = /^QF-(\d+)$/.exec(matchLabel);
  if (match) {
    return `8 进 4 第 ${Number(match[1])} 场`;
  }

  match = /^SF-(\d+)$/.exec(matchLabel);
  if (match) {
    return `半决赛第 ${Number(match[1])} 场`;
  }

  if (/^FINAL(?:-\d+)?$/.test(matchLabel)) {
    return "冠军战";
  }

  if (/^THIRD(?:-\d+)?$/.test(matchLabel)) {
    return "季军战";
  }

  return fallbackLabel(matchLabel);
}

export function formatSwissRecordLabel(wins: number, losses: number) {
  return `瑞士轮 ${wins}-${losses}`;
}

export function formatRankingResultLabel(rank: number, finalBucket: string, advancement: string) {
  return `最终排名 #${rank} · ${translateFinalBucket(finalBucket)} · ${translateAdvancementLabel(advancement)}`;
}
