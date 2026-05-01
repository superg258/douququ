#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_elo"

PARTICIPANTS_FIELDS = [
    "college_name",
    "team_name_2026",
    "preferred_region",
    "admitted_region",
    "seed_rank_in_region",
    "seed_tier",
    "ranking_source",
    "ranking_global_rank",
    "ranking_score",
]

SCHOOL_ALIASES = {
    "北京理工大学（珠海）": "北京理工大学珠海学院",
    "合肥工业大学（宣城校区）": "合肥工业大学(宣城校区)",
    "华北科技学院": "应急管理大学",
    "应急管理学院": "应急管理大学",
}

TEAM_ALIASES = {
    " I Hiter": "I Hiter",
    "TARS_Go": "TARS Go",
}

ROBOT_TYPE_WEIGHTS = {
    "Infantry": 0.30,
    "Hero": 0.20,
    "Airplane": 0.12,
    "Guard": 0.12,
    "Sapper": 0.15,
    "Dart": 0.08,
    "Radar": 0.03,
}

PRIOR_WEIGHTS = {
    "z_25game": 0.65,
    "z_robot25_raw": 0.06,
    "z_26rmul": 0.07,
    "z_form": 0.14,
    "tilde_z_hist": 0.08,
}

RATING_MODEL_VERSION = "dynamic_school_elo_v4_balance_adjusted"
PREVIOUS_DYNAMIC_SCHOOL_VERSION = "dynamic_school_elo_v4_rmul_per_game"
PREVIOUS_EXTRACTED_SCHOOL_VERSION = "extracted_school_history_v1"
EMPIRICAL_BAYES_PRIOR_WEIGHTS = {
    "ranking_score": 0.50,
    "shape_rank": 0.35,
    "robot_raw_score": 0.15,
}
PRIOR_MU_SCALE = 80.0
HISTORY_2024_MATCH_EQUIVALENT = 0.25
HISTORY_2025_MATCH_EQUIVALENT = 1.00
HISTORY_2026_RMUL_MATCH_EQUIVALENT = 0.35
HISTORY_WEIGHT_OFFSET = 3.0
SEASON_2024_TO_2025_RETENTION = 0.60
SEASON_2025_TO_2026_RETENTION = 0.78
SEASON_2024_TO_2025_RETENTION_DAMPING = 0.28
SEASON_2024_PRIOR_SCALE_DAMPING = 0.35
GROUP_SUMMARY_2024_DAMPING = 0.35
RANK_SCORE_2024_DAMPING = 0.35
RANK_SCORE_2025_DAMPING = 0.40
RMUL_HISTORY_K = 14.0
BASELINE_HISTORY_CHAIN_VERSION = "history_chain_v1"
BASELINE_HISTORY_PRIOR_MU_SCALE = 100.0
BASELINE_HISTORY_WEIGHT_OFFSET = 5.0
SIGMA_HISTORY_WEIGHT_MULTIPLIER = 50.0
LEGACY_EMPIRICAL_BAYES_PRIOR_WEIGHTS = {
    "ranking_score": 0.55,
    "shape_rank": 0.30,
    "robot_raw_score": 0.15,
}
LEGACY_PRIOR_MU_SCALE = 135.0
LEGACY_RMUL_EVIDENCE_BLEND = 0.35
LEGACY_RMUL_MATCH_EQUIVALENT = 0.35
LEGACY_EVIDENCE_WEIGHT_OFFSET = 8.0
LEGACY_POSTERIOR_MU_STRETCH = 2.5
LEGACY_PRESEASON_MU_FLOOR = 1225.0
ROBUST_Z_CLIP = 3.0
ROBOT_ROBUST_Z_CLIP = 2.5

ROBOT_STAGE_FAMILY_WEIGHTS = {
    "regional": 0.40,
    "repechage_stage1": 0.20,
    "repechage_stage2": 0.15,
    "national": 0.25,
}

ROBOT_STAGE_RELIABILITY_OFFSET = 1.5

RMUL_PRIOR_K = 18.0
RMUL_3V3_RELIABILITY_CAP = 0.65
RMUL_3V3_RELIABILITY_MATCH_SCALE = 4.0
RMUL_3V3_MATCH_EQUIVALENT = 0.30
RMUL_3V3_SIGMA_BONUS = 8.0
RMUL_ONLY_SIGMA_BONUS = 12.0
NO_RMUL_RECENCY_SIGMA_BONUS = 10.0
PRESEASON_SIGMA_FLOOR = 45.0
PRESEASON_SIGMA_CEILING = 105.0
SIGMA_DISAGREEMENT_DIVISOR = 14.0
SIGMA_DISAGREEMENT_CAP = 10.0
SCHOOL_SHAPE_PRIOR_SCALE = 14.0
SHAPE_RECENT_RELIABILITY_SUPPRESSION = 0.65
SHAPE_ADJUSTMENT_CAP = 10.0
SHAPE_ADJUSTMENT_HIGH_RELIABILITY_CAP = 6.0
SHAPE_HIGH_RELIABILITY_THRESHOLD = 0.75
SHAPE_TAIL_PENALTY_START = 80
SHAPE_TAIL_PENALTY_SCALE = 0.07
SHAPE_TAIL_PENALTY_EXPONENT = 1.25
SHAPE_FAIL_PENALTY_START = 88
SHAPE_FAIL_PENALTY_SCALE = 0.14
SHAPE_FAIL_PENALTY_EXPONENT = 1.30
SHAPE_ADJUSTMENT_TAIL_NEGATIVE_CAP = 12.0
SHAPE_ADJUSTMENT_FAIL_NEGATIVE_CAP = 16.0
SHAPE_ADJUSTMENT_HIGH_RELIABILITY_TAIL_NEGATIVE_CAP = 8.0
SHAPE_ADJUSTMENT_HIGH_RELIABILITY_FAIL_NEGATIVE_CAP = 12.0
SHAPE_SIGMA_DISAGREEMENT_DIVISOR = 6.0
NO_RMUL_MATCH_SIGMA_BONUS = 3.0
NO_RECENT_MATCH_SIGMA_BONUS = 2.0
RECENT_PRIOR_SCALE_2025 = 48.0
RECENT_PRIOR_SCALE_2026 = 42.0
RECENT_RHO_2025_TO_2026 = 0.88
RECENT_MATCH_EQUIVALENT_2026 = 1.00
RECENT_RELIABILITY_OFFSET = 8.0
RECENT_COVERAGE_OFFSET = 4.0
LEVEL_WEIGHT_BASE = 0.14
LEVEL_WEIGHT_RELIABILITY_MULTIPLIER = 0.04
MOMENTUM_WEIGHT_BASE = 0.32
MOMENTUM_WEIGHT_RELIABILITY_MULTIPLIER = 0.08
MOMENTUM_WEIGHT_NEW_SCHOOL_FLOOR = 0.46
RECENT_FORM_STRETCH = 1.10
RECENT_MOMENTUM_MIN = -110.0
RECENT_MOMENTUM_MAX = 150.0
RECENT_LEVEL_GAP_MIN = -55.0
RECENT_LEVEL_GAP_MAX = 95.0
RECENT_MOMENTUM_SIGMA_DIVISOR = 10.0
RECENT_MOMENTUM_SIGMA_CAP = 10.0
RECENT_LEVEL_SIGMA_DIVISOR = 16.0
RECENT_LEVEL_SIGMA_CAP = 5.0
RECENT_CALIBRATION_COVERAGE_THRESHOLD = 0.70
RECENT_CALIBRATION_MATCH_THRESHOLD = 4
RECENT_CALIBRATION_SCALE_MIN = 0.85
RECENT_CALIBRATION_SCALE_MAX = 1.20
NEW_SCHOOL_COMPENSATION_BASE = 2.0
NEW_SCHOOL_COMPENSATION_RECENT_MULTIPLIER = 0.12
NEW_SCHOOL_COMPENSATION_PEER_MULTIPLIER = 0.50
NEW_SCHOOL_COMPENSATION_LEVEL_MULTIPLIER = 0.08
NEW_SCHOOL_COMPENSATION_CAP = 10.0
OLD_HISTORY_DECAY_MULTIPLIER = 0.10
OLD_HISTORY_DECAY_MATCH_OFFSET = 8.0
OLD_HISTORY_DECAY_CAP = 4.0
OLD_HISTORY_DECAY_MIN_CURRENT_MATCHES = 3
PEER_ADJUSTMENT_SCALE = 28.0
PEER_ADJUSTMENT_CAP = 22.0
PEER_RELIABILITY_OFFSET = 2.0

PEER_STAGE_WEIGHTS = {
    "rmuc_national_knockout": 1.00,
    "rmuc_national_group": 0.90,
    "rmuc_repechage_stage2": 0.80,
    "rmul_knockout": 0.80,
    "rmuc_repechage_stage1": 0.72,
    "rmuc_regional_knockout": 0.72,
    "rmul_group": 0.64,
    "rmuc_regional_group": 0.58,
}

RECENT_STAGE_WEIGHTS = {
    "rmuc_regional_group": 18.0,
    "rmuc_regional_knockout": 22.0,
    "rmuc_repechage_stage1": 23.0,
    "rmuc_repechage_stage2": 24.0,
    "rmuc_national_group": 26.0,
    "rmuc_national_knockout": 30.0,
    "rmul_group": 20.0,
    "rmul_knockout": 24.0,
}

DYNAMIC_STAGE_WEIGHT_PRESETS = {
    "conservative": {
        "rmuc_regional_group": 18.0,
        "rmuc_regional_knockout": 20.0,
        "rmuc_repechage_stage1": 16.0,
        "rmuc_repechage_stage2": 17.0,
        "rmuc_national_group": 18.0,
        "rmuc_national_knockout": 22.0,
        "rmul_group": 14.0,
        "rmul_knockout": 16.0,
    },
    "balanced": {
        "rmuc_regional_group": 20.0,
        "rmuc_regional_knockout": 22.0,
        "rmuc_repechage_stage1": 17.0,
        "rmuc_repechage_stage2": 18.0,
        "rmuc_national_group": 20.0,
        "rmuc_national_knockout": 24.0,
        "rmul_group": 15.0,
        "rmul_knockout": 17.0,
    },
    "sharp": {
        "rmuc_regional_group": 22.0,
        "rmuc_regional_knockout": 24.0,
        "rmuc_repechage_stage1": 18.0,
        "rmuc_repechage_stage2": 19.0,
        "rmuc_national_group": 22.0,
        "rmuc_national_knockout": 26.0,
        "rmul_group": 16.0,
        "rmul_knockout": 18.0,
    },
}

DYNAMIC_PRIOR_PROFILES = {
    "low": {"scale_2024": 45.0, "scale_2025": 35.0, "scale_2026": 40.0},
    "mid": {"scale_2024": 55.0, "scale_2025": 45.0, "scale_2026": 50.0},
    "high": {"scale_2024": 65.0, "scale_2025": 55.0, "scale_2026": 60.0},
}

DYNAMIC_RHO_2024_TO_2025_CANDIDATES = [0.72, 0.78, 0.84]
DYNAMIC_RHO_2025_TO_2026_CANDIDATES = [0.82, 0.88, 0.94]

SEASON_START_PRIOR_WEIGHTS = {
    "2024": {"rank_score_2024": 1.0},
    "2025": {"group_summary_2024": 0.12, "rank_score_2025": 0.88},
    "2026RMUL": {
        "ranking_1884": 0.03,
        "group_summary_2025": 0.32,
        "rank_score_2025": 0.10,
        "robot_summary_2025": 0.10,
        "recent_2025_form_prior": 0.45,
    },
}

LEGACY_EXTRACTED_SCHOOL_REFERENCE_METRICS = {
    "matches": 101,
    "log_loss": 0.610027,
    "brier": 0.186838,
    "accuracy": 0.771739,
}

PREVIOUS_DYNAMIC_REFERENCE_METRICS = {
    "rmuc_2025": {
        "matches": 400,
        "log_loss": 0.649002,
        "brier": 0.178815,
        "accuracy": 0.656642,
    },
    "rmul_2026": {
        "matches": 510,
        "log_loss": 0.617238,
        "brier": 0.172893,
        "accuracy": 0.729075,
    },
}

ROBOT_TYPE_METRICS = {
    "Infantry": [
        ("eaSmallHitRate", 1.0),
        ("eagHurt", 1.0),
        ("eagKdaScore", 1.0),
        ("gKillCount", 1.0),
    ],
    "Hero": [
        ("eaBigHitRate", 1.0),
        ("gkDamage", 1.0),
        ("eaSnipeCnt", 1.0),
        ("eagKdaScore", 1.0),
    ],
    "Airplane": [
        ("eagHurt", 1.0),
        ("gKillCount", 1.0),
        ("avgShootNum", 1.0),
        ("eagKdaScore", 1.0),
    ],
    "Guard": [
        ("eagHurt", 1.0),
        ("gKillCount", 1.0),
        ("eagKdaScore", 1.0),
    ],
    "Sapper": [
        ("eaExchangeEcon", 1.0),
        ("avgMineDiff", 1.0),
        ("avgMineTime", -1.0),
    ],
    "Dart": [
        ("etDartOutpostCnt", 1.0),
        ("etDartFixedCnt", 1.0),
        ("etDartRDFixCnt", 1.0),
        ("etDartRDMoveCnt", 1.0),
    ],
    "Radar": [
        ("eaRadarMarkerTime", 1.0),
        ("eaRadarDebuffDmg", 1.0),
    ],
}

RMUC_STAGE_ORDER = [
    "regional_east",
    "regional_central",
    "regional_south",
    "repechage_stage1",
    "repechage_stage2",
    "national_group",
    "national_knockout",
]

RMUC_STAGE_K = {
    "regional_east": 18.0,
    "regional_central": 18.0,
    "regional_south": 18.0,
    "repechage_stage1": 12.0,
    "repechage_stage2": 12.0,
    "national_group": 10.0,
    "national_knockout": 14.0,
}

RMUC_STAGE_N0 = {
    "regional_east": 4.0,
    "regional_central": 4.0,
    "regional_south": 4.0,
    "repechage_stage1": 5.0,
    "repechage_stage2": 5.0,
    "national_group": 6.0,
    "national_knockout": 4.0,
}

RMUC_STAGE_BONUSES = {
    "regional_direct_national": 22.0,
    "regional_repechage": 10.0,
    "repechage_stage1_direct_national": 14.0,
    "repechage_stage1_to_stage2": 10.0,
    "repechage_stage2_direct_national": 14.0,
    "national_group_to_knockout": 12.0,
}

RMUC_STAGE_DEPTH_BONUS = {
    "regional_east": 0.0,
    "regional_central": 0.0,
    "regional_south": 0.0,
    "repechage_stage1": 18.0,
    "repechage_stage2": 32.0,
    "national_group": 58.0,
    "national_knockout": 85.0,
}

RMUC_2025_STAGE_ORDER = RMUC_STAGE_ORDER
RMUC_2025_K = RMUC_STAGE_K
RMUC_2025_N0 = RMUC_STAGE_N0
RMUC_2025_STAGE_BONUSES = RMUC_STAGE_BONUSES
RMUC_2025_DEPTH_BONUS = RMUC_STAGE_DEPTH_BONUS


@dataclass(frozen=True)
class TeamMasterRow:
    team_key: str
    college_name: str
    team_name: str
    shape_rank: int
    preferred_region: str
    admitted_region: str
    seed_rank_in_region: int | None
    seed_tier: str
    ranking_source: str
    ranking_global_rank: int | None
    ranking_score: float | None


@dataclass
class FeatureSeries:
    values: dict[str, float]
    covered: set[str]


@dataclass
class MatchRecord:
    event_code: str
    zone_name: str
    stage_bucket: str
    stage_id: str
    rating_stage_id: str
    match_id: int
    order_number: int
    match_date: str
    best_of: int
    red_key: str
    blue_key: str
    red_school_key: str
    blue_school_key: str
    red_team_name: str
    blue_team_name: str
    red_college_name: str
    blue_college_name: str
    winner_key: str | None
    winner_school_key: str | None
    score: float
    share_score: float
    red_wins: int
    blue_wins: int
    completed_games: int


def normalize_school(name: str) -> str:
    return SCHOOL_ALIASES.get(name.strip(), name.strip())


def normalize_team(name: str) -> str:
    compact = " ".join(name.strip().split())
    return TEAM_ALIASES.get(compact, compact)


def make_team_key(college_name: str, team_name: str) -> str:
    return f"{normalize_school(college_name)}::{normalize_team(team_name)}"


def make_school_key(college_name: str) -> str:
    return normalize_school(college_name)


def match_entity_key(match: MatchRecord, side: str, entity_level: str) -> str:
    if entity_level == "school":
        return match.red_school_key if side == "red" else match.blue_school_key
    if entity_level == "team":
        return match.red_key if side == "red" else match.blue_key
    raise ValueError(f"Unsupported entity_level: {entity_level}")


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value: Any) -> int | None:
    numeric = parse_float(value)
    if numeric is None:
        return None
    return int(numeric)


def clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def logistic_expectation(delta: float) -> float:
    clipped = clip(delta, -300.0, 300.0)
    return 1.0 / (1.0 + 10.0 ** (-clipped / 400.0))


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def prune_legacy_participants_column(path: Path) -> None:
    rows = read_csv(path)
    if not rows:
        return
    if "rating_pre_2026_rmuc" not in rows[0]:
        return
    cleaned = []
    for row in rows:
        cleaned.append({field: row.get(field, "") for field in PARTICIPANTS_FIELDS})
    write_csv(path, cleaned, PARTICIPANTS_FIELDS)


def percentile_z_map(
    score_map: dict[Any, float],
    *,
    higher_is_better: bool = True,
) -> dict[Any, float]:
    if not score_map:
        return {}
    buckets: defaultdict[float, list[Any]] = defaultdict(list)
    for key, score in score_map.items():
        buckets[float(score)].append(key)
    ordered_scores = sorted(buckets.keys(), reverse=higher_is_better)
    total = len(score_map)
    if total == 1:
        only_key = next(iter(score_map))
        return {only_key: 0.0}
    out: dict[Any, float] = {}
    position = 0
    for score in ordered_scores:
        keys = buckets[score]
        start = position
        end = position + len(keys) - 1
        avg_rank = (start + end) / 2.0
        q = 1.0 - (avg_rank / (total - 1))
        z_value = (2.0 * q) - 1.0
        for key in keys:
            out[key] = z_value
        position += len(keys)
    return out


def robust_z_map(
    score_map: dict[Any, float],
    *,
    higher_is_better: bool = True,
    clip_limit: float = ROBUST_Z_CLIP,
) -> dict[Any, float]:
    if not score_map:
        return {}
    values = [float(score) for score in score_map.values()]
    median = statistics.median(values)
    mad = statistics.median(abs(value - median) for value in values)
    scale = mad * 1.4826
    if scale <= 1e-9:
        scale = statistics.pstdev(values)
    if scale <= 1e-9:
        scale = 1.0
    out: dict[Any, float] = {}
    direction = 1.0 if higher_is_better else -1.0
    for key, score in score_map.items():
        z_value = direction * ((float(score) - median) / scale)
        out[key] = clip(z_value, -clip_limit, clip_limit)
    return out


def inverse_normal_rank_map(
    rank_map: dict[Any, int],
    *,
    lower_rank_is_better: bool = True,
) -> dict[Any, float]:
    if not rank_map:
        return {}
    total = len(rank_map)
    normal = statistics.NormalDist()
    out: dict[Any, float] = {}
    for key, rank in rank_map.items():
        quantile = (total - rank + 0.625) / (total + 0.25) if lower_rank_is_better else (rank - 0.375) / (total + 0.25)
        out[key] = normal.inv_cdf(clip(quantile, 1e-6, 1.0 - 1e-6))
    return out


def shape_rank_tail_penalty(rank: int) -> float:
    penalty = 0.0
    if rank > SHAPE_TAIL_PENALTY_START:
        penalty += SHAPE_TAIL_PENALTY_SCALE * ((rank - SHAPE_TAIL_PENALTY_START) ** SHAPE_TAIL_PENALTY_EXPONENT)
    if rank > SHAPE_FAIL_PENALTY_START:
        penalty += SHAPE_FAIL_PENALTY_SCALE * ((rank - SHAPE_FAIL_PENALTY_START) ** SHAPE_FAIL_PENALTY_EXPONENT)
    return penalty


def shape_rank_component_map(rank_map: dict[Any, int]) -> dict[Any, float]:
    base_component = inverse_normal_rank_map(rank_map, lower_rank_is_better=True)
    return {
        key: base_component[key] - shape_rank_tail_penalty(rank)
        for key, rank in rank_map.items()
    }


def shape_adjustment_negative_cap(rank: int, recent_reliability: float) -> float:
    if recent_reliability >= SHAPE_HIGH_RELIABILITY_THRESHOLD:
        if rank > SHAPE_FAIL_PENALTY_START:
            return SHAPE_ADJUSTMENT_HIGH_RELIABILITY_FAIL_NEGATIVE_CAP
        if rank > SHAPE_TAIL_PENALTY_START:
            return SHAPE_ADJUSTMENT_HIGH_RELIABILITY_TAIL_NEGATIVE_CAP
        return SHAPE_ADJUSTMENT_HIGH_RELIABILITY_CAP
    if rank > SHAPE_FAIL_PENALTY_START:
        return SHAPE_ADJUSTMENT_FAIL_NEGATIVE_CAP
    if rank > SHAPE_TAIL_PENALTY_START:
        return SHAPE_ADJUSTMENT_TAIL_NEGATIVE_CAP
    return SHAPE_ADJUSTMENT_CAP


def effective_history_rho_2024_to_2025(base_rho: float) -> float:
    return base_rho * SEASON_2024_TO_2025_RETENTION_DAMPING


def effective_scale_2024(base_scale: float) -> float:
    return base_scale * SEASON_2024_PRIOR_SCALE_DAMPING


def recenter_rating_map(score_map: dict[str, float], *, target_mean: float = 1500.0) -> dict[str, float]:
    if not score_map:
        return {}
    shift = target_mean - statistics.fmean(float(score) for score in score_map.values())
    return {key: float(score) + shift for key, score in score_map.items()}


def pearson_corr(keys: Iterable[str], left: dict[str, float], right: dict[str, float]) -> float:
    xs: list[float] = []
    ys: list[float] = []
    for key in keys:
        xs.append(left[key])
        ys.append(right[key])
    if len(xs) < 2:
        return 0.0
    mean_x = statistics.fmean(xs)
    mean_y = statistics.fmean(ys)
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if var_x <= 0 or var_y <= 0:
        return 0.0
    return cov / math.sqrt(var_x * var_y)


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float]:
    n = len(vector)
    augmented = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(augmented[r][col]))
        if abs(augmented[pivot_row][col]) < 1e-12:
            continue
        if pivot_row != col:
            augmented[col], augmented[pivot_row] = augmented[pivot_row], augmented[col]
        pivot = augmented[col][col]
        for idx in range(col, n + 1):
            augmented[col][idx] /= pivot
        for row in range(n):
            if row == col:
                continue
            factor = augmented[row][col]
            if abs(factor) < 1e-12:
                continue
            for idx in range(col, n + 1):
                augmented[row][idx] -= factor * augmented[col][idx]
    return [augmented[i][n] for i in range(n)]


def residualize_feature(
    universe: list[str],
    target: FeatureSeries,
    predictors: list[FeatureSeries],
) -> FeatureSeries:
    predictor_values = [predictor.values for predictor in predictors]
    covered_keys = [key for key in universe if key in target.covered]
    if not covered_keys:
        return FeatureSeries(values={key: 0.0 for key in universe}, covered=set())
    design: list[list[float]] = []
    y_values: list[float] = []
    for key in covered_keys:
        design.append([1.0] + [values.get(key, 0.0) for values in predictor_values])
        y_values.append(target.values[key])
    cols = len(design[0])
    xtx = [[0.0 for _ in range(cols)] for _ in range(cols)]
    xty = [0.0 for _ in range(cols)]
    for row, y in zip(design, y_values):
        for i in range(cols):
            xty[i] += row[i] * y
            for j in range(cols):
                xtx[i][j] += row[i] * row[j]
    for idx in range(1, cols):
        xtx[idx][idx] += 1e-6
    beta = solve_linear_system(xtx, xty)
    residual_raw: dict[str, float] = {}
    for key in covered_keys:
        prediction = beta[0]
        for offset, values in enumerate(predictor_values, start=1):
            prediction += beta[offset] * values.get(key, 0.0)
        residual_raw[key] = target.values[key] - prediction
    residual_z = percentile_z_map(residual_raw, higher_is_better=True)
    values = {key: residual_z.get(key, 0.0) for key in universe}
    return FeatureSeries(values=values, covered=set(covered_keys))


def make_feature_from_raw(
    universe: list[str],
    raw_scores: dict[str, float],
    *,
    higher_is_better: bool = True,
) -> FeatureSeries:
    z_map = percentile_z_map(raw_scores, higher_is_better=higher_is_better)
    return FeatureSeries(
        values={key: z_map.get(key, 0.0) for key in universe},
        covered=set(raw_scores.keys()),
    )


def combine_component_maps(
    component_maps: dict[str, dict[str, float]],
    component_weights: dict[str, float],
    *,
    universe: Iterable[str] | None = None,
) -> dict[str, float]:
    if universe is None:
        keys = sorted({key for mapping in component_maps.values() for key in mapping})
    else:
        keys = list(universe)
    combined: dict[str, float] = {}
    for key in keys:
        weighted_sum = 0.0
        total_weight = 0.0
        for name, weight in component_weights.items():
            mapping = component_maps.get(name, {})
            if key not in mapping:
                continue
            weighted_sum += weight * mapping[key]
            total_weight += weight
        combined[key] = (weighted_sum / total_weight) if total_weight else 0.0
    return combined


def team_keys_from_rows(
    rows: Iterable[dict[str, str]],
    college_field: str,
    team_field: str,
) -> set[str]:
    return {make_team_key(row[college_field], row[team_field]) for row in rows}


def build_team_master() -> list[TeamMasterRow]:
    shape_rows = read_csv(ROOT / "data" / "cleaned" / "reference" / "2026RMUC_96_teams.csv")
    participants_rows = read_csv(ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv")
    participants_by_key: dict[str, dict[str, str]] = {
        make_team_key(row["college_name"], row["team_name_2026"]): row for row in participants_rows
    }
    team_master: list[TeamMasterRow] = []
    for row in shape_rows:
        team_key = make_team_key(row["school_name"], row["team_name"])
        participant = participants_by_key.get(team_key)
        if participant is None:
            raise ValueError(f"Missing participants_1912 row for {team_key}")
        team_master.append(
            TeamMasterRow(
                team_key=team_key,
                college_name=normalize_school(row["school_name"]),
                team_name=normalize_team(row["team_name"]),
                shape_rank=int(row["rank"]),
                preferred_region=participant["preferred_region"],
                admitted_region=participant["admitted_region"],
                seed_rank_in_region=parse_int(participant["seed_rank_in_region"]),
                seed_tier=participant["seed_tier"],
                ranking_source=participant["ranking_source"],
                ranking_global_rank=parse_int(participant["ranking_global_rank"]),
                ranking_score=parse_float(participant["ranking_score"]),
            )
        )
    if len(team_master) != 96:
        raise ValueError(f"Expected 96 team_master rows, found {len(team_master)}")
    return team_master


def build_match_records(path: Path, event_code: str) -> list[MatchRecord]:
    rows = read_csv(path)
    records: list[MatchRecord] = []
    for row in rows:
        if event_code in {"2024RMUC", "2025RMUC"}:
            stage_id = classify_rmuc_stage(event_code, row["zone_name"], row["stage_bucket"])
        else:
            stage_id = f"{row['zone_name']}:{row['stage_bucket']}"
        rating_stage_id = classify_dynamic_stage(event_code, row["zone_name"], row["stage_bucket"])
        red_key = make_team_key(row["red_college_name"], row["red_team_name"])
        blue_key = make_team_key(row["blue_college_name"], row["blue_team_name"])
        red_school_key = make_school_key(row["red_college_name"])
        blue_school_key = make_school_key(row["blue_college_name"])
        red_wins = parse_int(row["red_side_win_game_count"]) or 0
        blue_wins = parse_int(row["blue_side_win_game_count"]) or 0
        total_games = red_wins + blue_wins
        share_score = (red_wins / total_games) if total_games > 0 else 0.5
        winner_key: str | None
        winner_school_key: str | None
        if row["result"] == "TIE":
            winner_key = None
            winner_school_key = None
            score = 0.5
        elif row["winner_side"] == "red":
            winner_key = red_key
            winner_school_key = red_school_key
            score = 1.0
        else:
            winner_key = blue_key
            winner_school_key = blue_school_key
            score = 0.0
        records.append(
            MatchRecord(
                event_code=event_code,
                zone_name=row["zone_name"],
                stage_bucket=row["stage_bucket"],
                stage_id=stage_id,
                rating_stage_id=rating_stage_id,
                match_id=int(row["match_id"]),
                order_number=int(row["order_number"]),
                match_date=row["match_date"],
                best_of=int(row["plan_game_count"]),
                red_key=red_key,
                blue_key=blue_key,
                red_school_key=red_school_key,
                blue_school_key=blue_school_key,
                red_team_name=normalize_team(row["red_team_name"]),
                blue_team_name=normalize_team(row["blue_team_name"]),
                red_college_name=normalize_school(row["red_college_name"]),
                blue_college_name=normalize_school(row["blue_college_name"]),
                winner_key=winner_key,
                winner_school_key=winner_school_key,
                score=score,
                share_score=share_score,
                red_wins=red_wins,
                blue_wins=blue_wins,
                completed_games=total_games,
            )
        )
    records.sort(key=lambda item: (item.match_date, item.order_number, item.match_id))
    return records


def classify_rmuc_stage(event_code: str, zone_name: str, stage_bucket: str) -> str:
    if zone_name == "东部赛区":
        return "regional_east"
    if zone_name == "中部赛区":
        return "regional_central"
    if zone_name == "南部赛区":
        return "regional_south"
    if zone_name in {"港澳台及海外赛区&复活赛第一赛段", "复活赛第一赛段"}:
        return "repechage_stage1"
    if zone_name == "复活赛第二赛段":
        return "repechage_stage2"
    if zone_name in {"全国赛", "2025赛季全国赛"} and stage_bucket == "group":
        return "national_group"
    if zone_name in {"全国赛", "2025赛季全国赛"} and stage_bucket == "knockout":
        return "national_knockout"
    raise ValueError(f"Unexpected {event_code} stage {zone_name} / {stage_bucket}")


def classify_rmuc_2025_stage(zone_name: str, stage_bucket: str) -> str:
    return classify_rmuc_stage("2025RMUC", zone_name, stage_bucket)


def classify_dynamic_stage(event_code: str, zone_name: str, stage_bucket: str) -> str:
    if event_code == "2026RMUL":
        return f"rmul_{stage_bucket}"
    if zone_name in {"东部赛区", "中部赛区", "南部赛区"}:
        return f"rmuc_regional_{stage_bucket}"
    if zone_name in {"港澳台及海外赛区&复活赛第一赛段", "复活赛第一赛段"}:
        return "rmuc_repechage_stage1"
    if zone_name == "复活赛第二赛段":
        return "rmuc_repechage_stage2"
    if zone_name in {"全国赛", "2025赛季全国赛"} and stage_bucket == "group":
        return "rmuc_national_group"
    if zone_name in {"全国赛", "2025赛季全国赛"} and stage_bucket == "knockout":
        return "rmuc_national_knockout"
    raise ValueError(f"Unexpected dynamic stage {event_code} / {zone_name} / {stage_bucket}")


def simple_source_elo(
    records: list[MatchRecord],
    k_factor: float,
    *,
    entity_level: str = "team",
    rmul_per_game: bool = False,
) -> dict[str, float]:
    ratings: defaultdict[str, float] = defaultdict(lambda: 1500.0)
    for match in records:
        red_key = match_entity_key(match, "red", entity_level)
        blue_key = match_entity_key(match, "blue", entity_level)
        red_mu = ratings[red_key]
        blue_mu = ratings[blue_key]
        if rmul_per_game and match.event_code == "2026RMUL":
            update = average_ordered_series_update(
                red_mu,
                blue_mu,
                match.red_wins,
                match.blue_wins,
                k_factor,
            )
            ratings[red_key] = red_mu + update["red_delta"]
            ratings[blue_key] = blue_mu + update["blue_delta"]
            continue
        expected_red = logistic_expectation(red_mu - blue_mu)
        expected_blue = 1.0 - expected_red
        actual_red = match.score
        actual_blue = 1.0 - actual_red
        ratings[red_key] = red_mu + k_factor * (actual_red - expected_red)
        ratings[blue_key] = blue_mu + k_factor * (actual_blue - expected_blue)
    return dict(ratings)


@lru_cache(maxsize=None)
def legal_series_sequences(red_wins: int, blue_wins: int) -> tuple[tuple[float, ...], ...]:
    total_games = max(0, red_wins) + max(0, blue_wins)
    if total_games <= 0:
        return (tuple(),)
    sequences: list[tuple[float, ...]] = []
    for red_positions in combinations(range(total_games), max(0, red_wins)):
        red_position_set = set(red_positions)
        sequences.append(tuple(1.0 if idx in red_position_set else 0.0 for idx in range(total_games)))
    return tuple(sequences)


def average_ordered_series_update(
    red_mu: float,
    blue_mu: float,
    red_wins: int,
    blue_wins: int,
    k_match: float,
) -> dict[str, float]:
    completed_games = red_wins + blue_wins
    if completed_games <= 0:
        expected_red = logistic_expectation(red_mu - blue_mu)
        return {
            "expected_share": expected_red,
            "actual_share": 0.5,
            "red_delta": 0.0,
            "blue_delta": 0.0,
            "microgame_count": 0.0,
            "sequence_count": 1.0,
            "k_per_game": 0.0,
        }

    sequences = legal_series_sequences(red_wins, blue_wins)
    k_per_game = k_match / completed_games
    expected_share_total = 0.0
    red_delta_total = 0.0
    blue_delta_total = 0.0
    for sequence in sequences:
        current_red = red_mu
        current_blue = blue_mu
        expected_sum = 0.0
        for actual_red in sequence:
            expected_red = logistic_expectation(current_red - current_blue)
            expected_sum += expected_red
            current_red = current_red + (k_per_game * (actual_red - expected_red))
            current_blue = current_blue + (k_per_game * ((1.0 - actual_red) - (1.0 - expected_red)))
        expected_share_total += expected_sum / completed_games
        red_delta_total += current_red - red_mu
        blue_delta_total += current_blue - blue_mu

    sequence_count = float(len(sequences))
    return {
        "expected_share": expected_share_total / sequence_count,
        "actual_share": red_wins / completed_games,
        "red_delta": red_delta_total / sequence_count,
        "blue_delta": blue_delta_total / sequence_count,
        "microgame_count": float(completed_games),
        "sequence_count": sequence_count,
        "k_per_game": k_per_game,
    }


def build_2025_group_fallback(universe: list[str]) -> FeatureSeries:
    rows = read_csv(ROOT / "data" / "cleaned" / "2025RMUC" / "group_rank.csv")
    grouped: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row["zone_name"]].append(row)
    team_scores: defaultdict[str, list[float]] = defaultdict(list)
    for zone_name, zone_rows in grouped.items():
        group_order = {
            idx: float(zone_rows[idx]["group_order"])
            for idx in range(len(zone_rows))
            if parse_float(zone_rows[idx]["group_order"]) is not None
        }
        opponent_points = {
            idx: parse_float(zone_rows[idx]["opponent_points"]) or 0.0 for idx in range(len(zone_rows))
        }
        base_hp = {
            idx: parse_float(zone_rows[idx]["avg_base_hp_diff"]) or 0.0 for idx in range(len(zone_rows))
        }
        outpost_hp = {
            idx: parse_float(zone_rows[idx]["avg_outpost_hp_diff"]) or 0.0 for idx in range(len(zone_rows))
        }
        team_damage = {
            idx: parse_float(zone_rows[idx]["avg_team_damage"]) or 0.0 for idx in range(len(zone_rows))
        }
        z_group = percentile_z_map(group_order, higher_is_better=False)
        z_opp = percentile_z_map(opponent_points, higher_is_better=True)
        z_base = percentile_z_map(base_hp, higher_is_better=True)
        z_outpost = percentile_z_map(outpost_hp, higher_is_better=True)
        z_damage = percentile_z_map(team_damage, higher_is_better=True)
        for idx, zone_row in enumerate(zone_rows):
            team_key = make_team_key(zone_row["college_name"], zone_row["team_name"])
            score = (
                0.4 * z_group.get(idx, 0.0)
                + 0.2 * z_opp.get(idx, 0.0)
                + 0.2 * z_base.get(idx, 0.0)
                + 0.1 * z_outpost.get(idx, 0.0)
                + 0.1 * z_damage.get(idx, 0.0)
            )
            team_scores[team_key].append(score)
    averaged = {key: statistics.fmean(scores) for key, scores in team_scores.items()}
    return make_feature_from_raw(universe, averaged, higher_is_better=True)


def build_school_rank_feature(
    universe: list[str],
    team_master: list[TeamMasterRow],
    path: Path,
    *,
    school_field: str,
    score_field: str,
) -> FeatureSeries:
    rows = read_csv(path)
    school_scores = {
        normalize_school(row[school_field]): parse_float(row[score_field]) or 0.0 for row in rows
    }
    raw = {
        team.team_key: school_scores[team.college_name]
        for team in team_master
        if team.college_name in school_scores
    }
    return make_feature_from_raw(universe, raw, higher_is_better=True)


def build_form_feature(universe: list[str], team_master: list[TeamMasterRow]) -> FeatureSeries:
    raw = {team.team_key: float(team.shape_rank) for team in team_master}
    return make_feature_from_raw(universe, raw, higher_is_better=False)


def classify_robot_stage_family(zone_name: str) -> str:
    if zone_name in {"东部赛区", "中部赛区", "南部赛区"}:
        return "regional"
    if zone_name == "复活赛第一赛段":
        return "repechage_stage1"
    if zone_name == "复活赛第二赛段":
        return "repechage_stage2"
    if zone_name == "2025赛季全国赛":
        return "national"
    raise ValueError(f"Unexpected robot_data zone_name: {zone_name}")


def compute_robot_stage_reliability(stage_count: int) -> float:
    if stage_count <= 0:
        return 0.0
    return math.sqrt(stage_count / (stage_count + ROBOT_STAGE_RELIABILITY_OFFSET))


def build_robot_feature(
    universe: list[str],
) -> tuple[FeatureSeries, dict[str, Any], dict[str, dict[str, Any]]]:
    rows = read_csv(ROOT / "data" / "cleaned" / "2025RMUC" / "robot_data.csv")
    grouped: defaultdict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, row in enumerate(rows):
        grouped[(row["zone_name"], row["robot_type"])].append(idx)
    row_scores: dict[int, float] = {}
    metric_presence: dict[str, int] = {}
    for (zone_name, robot_type), indexes in grouped.items():
        metrics = ROBOT_TYPE_METRICS[robot_type]
        metric_z_maps: list[dict[int, float]] = []
        for metric_name, direction in metrics:
            raw_values: dict[int, float] = {}
            for idx in indexes:
                value = parse_float(rows[idx][metric_name])
                if value is None:
                    continue
                raw_values[idx] = value * direction
            metric_presence[f"{zone_name}:{robot_type}:{metric_name}"] = len(raw_values)
            metric_z_maps.append(percentile_z_map(raw_values, higher_is_better=True))
        for idx in indexes:
            available = [metric_map.get(idx, 0.0) for metric_map in metric_z_maps]
            row_scores[idx] = statistics.fmean(available) if available else 0.0
    team_stage_families: defaultdict[str, set[str]] = defaultdict(set)
    team_robot_stage_scores: defaultdict[tuple[str, str, str], list[float]] = defaultdict(list)
    for idx, row in enumerate(rows):
        team_key = make_team_key(row["college_name"], row["team_name"])
        stage_family = classify_robot_stage_family(row["zone_name"])
        team_stage_families[team_key].add(stage_family)
        team_robot_stage_scores[(team_key, row["robot_type"], stage_family)].append(row_scores[idx])
    team_robot_stage_averages: dict[tuple[str, str, str], float] = {
        key: statistics.fmean(values) for key, values in team_robot_stage_scores.items()
    }
    raw_team_scores: dict[str, float] = {}
    robot_team_details: dict[str, dict[str, Any]] = {}
    stage_count_distribution: Counter[int] = Counter()
    for team_key in team_stage_families:
        stage_families = team_stage_families[team_key]
        stage_count = len(stage_families)
        stage_reliability = compute_robot_stage_reliability(stage_count)
        stage_count_distribution[stage_count] += 1
        team_robot_type_scores: dict[str, float] = {}
        for robot_type, weight in ROBOT_TYPE_WEIGHTS.items():
            family_scores = {
                family: team_robot_stage_averages[(team_key, robot_type, family)]
                for family in stage_families
                if (team_key, robot_type, family) in team_robot_stage_averages
            }
            observed_weight = sum(ROBOT_STAGE_FAMILY_WEIGHTS[family] for family in family_scores)
            if observed_weight > 0:
                team_robot_type_scores[robot_type] = sum(
                    ROBOT_STAGE_FAMILY_WEIGHTS[family] * score for family, score in family_scores.items()
                ) / observed_weight
            else:
                team_robot_type_scores[robot_type] = 0.0
        raw_unshrunk = sum(
            ROBOT_TYPE_WEIGHTS[robot_type] * team_robot_type_scores[robot_type]
            for robot_type in ROBOT_TYPE_WEIGHTS
        )
        raw_score = raw_unshrunk * stage_reliability
        raw_team_scores[team_key] = raw_score
        robot_team_details[team_key] = {
            "robot_stage_count": stage_count,
            "robot_stage_reliability": stage_reliability,
            "z_robot25_raw_unshrunk": raw_unshrunk,
            "robot_raw_score": raw_score,
            "robot_stage_families": ",".join(sorted(stage_families)),
            **{f"robot_{robot_type.lower()}_score": team_robot_type_scores[robot_type] for robot_type in ROBOT_TYPE_WEIGHTS},
        }
    feature = make_feature_from_raw(universe, raw_team_scores, higher_is_better=True)
    for team_key, details in robot_team_details.items():
        details["z_robot25_raw"] = feature.values[team_key]
    diagnostics = {
        "covered_teams": len(feature.covered),
        "rows": len(rows),
        "robot_type_weights": ROBOT_TYPE_WEIGHTS,
        "robot_stage_family_weights": ROBOT_STAGE_FAMILY_WEIGHTS,
        "stage_count_distribution": dict(sorted(stage_count_distribution.items())),
        "metric_presence_min": min(metric_presence.values()) if metric_presence else 0,
        "metric_presence_max": max(metric_presence.values()) if metric_presence else 0,
    }
    return feature, diagnostics, robot_team_details


def build_match_count_map(records: list[MatchRecord], *, entity_level: str = "team") -> dict[str, int]:
    counts: Counter[str] = Counter()
    for match in records:
        counts[match_entity_key(match, "red", entity_level)] += 1
        counts[match_entity_key(match, "blue", entity_level)] += 1
    return dict(counts)


def compute_rmuc_2025_anchor_strength(
    records: list[MatchRecord],
) -> tuple[dict[str, float], dict[str, Any]]:
    _, stage_diagnostics, final_ratings = run_rmuc_2025_stage_aware_backtest(records)
    participants = stage_participants(records)
    deepest_stage_by_team: dict[str, str] = {}
    deepest_stage_counts: Counter[str] = Counter()
    for stage_id in RMUC_STAGE_ORDER:
        for team_key in participants.get(stage_id, set()):
            deepest_stage_by_team[team_key] = stage_id
    raw_strength: dict[str, float] = {}
    for team_key, final_rating in final_ratings.items():
        deepest_stage = deepest_stage_by_team.get(team_key)
        if deepest_stage is None:
            continue
        deepest_stage_counts[deepest_stage] += 1
        raw_strength[team_key] = final_rating + RMUC_STAGE_DEPTH_BONUS[deepest_stage]
    diagnostics = {
        "depth_bonus": RMUC_STAGE_DEPTH_BONUS,
        "deepest_stage_counts": dict(deepest_stage_counts),
        "stage_aware": stage_diagnostics,
    }
    return raw_strength, diagnostics


def build_rmul_recent_reference_feature(
    universe: list[str],
    records: list[MatchRecord],
) -> tuple[FeatureSeries, FeatureSeries, dict[str, float], dict[str, int], dict[str, Any]]:
    match_counts = build_match_count_map(records)
    rmul_microgame_count = sum(match.completed_games for match in records)
    raw_feature = make_feature_from_raw(
        universe,
        simple_source_elo(records, RMUL_PRIOR_K, rmul_per_game=True),
        higher_is_better=True,
    )
    values: dict[str, float] = {}
    reliability: dict[str, float] = {}
    for key in universe:
        n26 = match_counts.get(key, 0)
        if n26 <= 0 or key not in raw_feature.covered:
            reliability[key] = 0.0
            values[key] = 0.0
            continue
        rel = RMUL_3V3_RELIABILITY_CAP * math.sqrt(n26 / (n26 + RMUL_3V3_RELIABILITY_MATCH_SCALE))
        reliability[key] = rel
        values[key] = raw_feature.values[key] * rel
    adjusted_feature = FeatureSeries(
        values=values,
        covered=set(raw_feature.covered),
    )
    covered_reliability = [reliability[key] for key in raw_feature.covered]
    diagnostics = {
        "prior_k": RMUL_PRIOR_K,
        "weight": PRIOR_WEIGHTS["z_26rmul"],
        "reliability_cap": RMUL_3V3_RELIABILITY_CAP,
        "reliability_match_scale": RMUL_3V3_RELIABILITY_MATCH_SCALE,
        "match_equivalent": RMUL_3V3_MATCH_EQUIVALENT,
        "covered_teams": len(raw_feature.covered),
        "median_reliability": round(statistics.median(covered_reliability), 6) if covered_reliability else 0.0,
        "max_reliability": round(max(covered_reliability), 6) if covered_reliability else 0.0,
        "rmul_update_granularity": "per_game",
        "rmul_k_budget_policy": "match_budget_preserved",
        "rmul_order_policy": "average_all_legal_sequences",
        "rmul_microgame_count": rmul_microgame_count,
        "rmul_series_count": len(records),
        "rmul_avg_games_per_match": round((rmul_microgame_count / len(records)), 6) if records else 0.0,
    }
    return adjusted_feature, raw_feature, reliability, match_counts, diagnostics


def build_empirical_bayes_prior(
    team_master: list[TeamMasterRow],
    robot_team_details: dict[str, dict[str, Any]],
    *,
    prior_weights: dict[str, float] = EMPIRICAL_BAYES_PRIOR_WEIGHTS,
    prior_mu_scale: float = PRIOR_MU_SCALE,
) -> tuple[dict[str, float], dict[str, float], dict[str, dict[str, float]]]:
    ranking_scores = {
        team.team_key: float(team.ranking_score)
        for team in team_master
        if team.ranking_score is not None
    }
    shape_ranks = {team.team_key: int(team.shape_rank) for team in team_master}
    robot_raw_scores = {
        team_key: float(details["robot_raw_score"])
        for team_key, details in robot_team_details.items()
    }

    ranking_component = robust_z_map(ranking_scores, higher_is_better=True, clip_limit=ROBUST_Z_CLIP)
    shape_component = shape_rank_component_map(shape_ranks)
    robot_component = robust_z_map(robot_raw_scores, higher_is_better=True, clip_limit=ROBOT_ROBUST_Z_CLIP)

    prior_mu: dict[str, float] = {}
    prior_score_map: dict[str, float] = {}
    prior_component_rows: dict[str, dict[str, float]] = {}
    for team in team_master:
        key = team.team_key
        weighted_sum = 0.0
        total_weight = 0.0
        component_row = {
            "ranking_score_component": 0.0,
            "shape_rank_component": float(shape_component[key]),
            "robot_raw_component": 0.0,
        }
        if key in ranking_component:
            component_row["ranking_score_component"] = float(ranking_component[key])
            weighted_sum += prior_weights["ranking_score"] * component_row["ranking_score_component"]
            total_weight += prior_weights["ranking_score"]
        weighted_sum += prior_weights["shape_rank"] * component_row["shape_rank_component"]
        total_weight += prior_weights["shape_rank"]
        if key in robot_component:
            component_row["robot_raw_component"] = float(robot_component[key])
            weighted_sum += prior_weights["robot_raw_score"] * component_row["robot_raw_component"]
            total_weight += prior_weights["robot_raw_score"]
        prior_score = (weighted_sum / total_weight) if total_weight else 0.0
        prior_score_map[key] = prior_score
        prior_mu[key] = 1500.0 + (prior_mu_scale * prior_score)
        prior_component_rows[key] = component_row
    return prior_mu, prior_score_map, prior_component_rows


def compute_sigma0(
    universe: list[str],
    evidence_weight: dict[str, float],
    prior_mu: dict[str, float],
    evidence_mu: dict[str, float],
) -> dict[str, float]:
    sigma: dict[str, float] = {}
    for key in universe:
        disagreement = abs(prior_mu[key] - evidence_mu[key])
        base = 95.0 - (SIGMA_HISTORY_WEIGHT_MULTIPLIER * evidence_weight[key]) + min(
            disagreement / SIGMA_DISAGREEMENT_DIVISOR,
            SIGMA_DISAGREEMENT_CAP,
        )
        sigma[key] = clip(base, PRESEASON_SIGMA_FLOOR, PRESEASON_SIGMA_CEILING)
    return sigma


def compute_preseason_extracted_school_history_v1(
    team_master: list[TeamMasterRow],
) -> tuple[list[dict[str, Any]], dict[str, FeatureSeries], dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    model_version = PREVIOUS_EXTRACTED_SCHOOL_VERSION
    universe = [team.team_key for team in team_master]
    cleaned_matches_2024 = build_match_records(ROOT / "data" / "cleaned" / "2024RMUC" / "matches.csv", "2024RMUC")
    cleaned_matches_2025 = build_match_records(ROOT / "data" / "cleaned" / "2025RMUC" / "matches.csv", "2025RMUC")
    cleaned_matches_2026_rmul = build_match_records(ROOT / "data" / "cleaned" / "2026RMUL" / "matches.csv", "2026RMUL")
    extracted_paths = {
        "2024RMUC": ROOT / "data" / "extracted" / "2024RMUC" / "matches.csv",
        "2025RMUC": ROOT / "data" / "extracted" / "2025RMUC" / "matches.csv",
        "2026RMUL": ROOT / "data" / "extracted" / "2026RMUL" / "matches.csv",
    }
    extracted_matches_2024 = build_match_records(extracted_paths["2024RMUC"], "2024RMUC")
    extracted_matches_2025 = build_match_records(extracted_paths["2025RMUC"], "2025RMUC")
    extracted_matches_2026_rmul = build_match_records(extracted_paths["2026RMUL"], "2026RMUL")
    rmuc_2025_anchor_strength, rmuc_2025_anchor_diagnostics = compute_rmuc_2025_anchor_strength(cleaned_matches_2025)
    z_25game = make_feature_from_raw(universe, rmuc_2025_anchor_strength, higher_is_better=True)
    z_26rmul, z_26rmul_raw, rmul_reliability, match_counts_2026_rmul, rmul_diagnostics = build_rmul_recent_reference_feature(
        universe,
        cleaned_matches_2026_rmul,
    )
    z_hist = build_school_rank_feature(
        universe,
        team_master,
        ROOT / "data" / "reference" / "2026_regionals" / "ranking_1884.csv",
        school_field="college_name",
        score_field="score",
    )
    z_form = build_form_feature(universe, team_master)
    z_robot25_raw, robot_diagnostics, robot_team_details = build_robot_feature(universe)
    tilde_z_hist = residualize_feature(universe, z_hist, [z_25game, z_26rmul])
    prior_mu, prior_score_map, prior_component_rows = build_empirical_bayes_prior(team_master, robot_team_details)
    school_history_bundle = build_school_history_bundle(
        extracted_matches_2024,
        extracted_matches_2025,
        extracted_matches_2026_rmul,
    )
    school_history_audit = collect_school_history_audit(extracted_paths)
    global_school_rows = build_global_school_rows(school_history_bundle)
    evidence_mu: dict[str, float] = {}
    history_weight: dict[str, float] = {}
    disagreement_mu: dict[str, float] = {}
    sigma0: dict[str, float]
    features = {
        "z_25game": z_25game,
        "z_robot25_raw": z_robot25_raw,
        "z_26rmul_raw": z_26rmul_raw,
        "z_26rmul": z_26rmul,
        "z_form": z_form,
        "z_hist": z_hist,
        "tilde_z_hist": tilde_z_hist,
    }
    legacy_h_values: dict[str, float] = {}
    n_eff_history: dict[str, float] = {}
    for team in team_master:
        key = team.team_key
        school_key = make_school_key(team.college_name)
        legacy_h_values[key] = sum(PRIOR_WEIGHTS[name] * features[name].values[key] for name in PRIOR_WEIGHTS)
        evidence_mu[key] = school_history_bundle["history_mu"].get(school_key, 1500.0)
        n_eff = school_history_bundle["n_eff_history"].get(school_key, 0.0)
        n_eff_history[key] = n_eff
        history_weight[key] = school_history_bundle["history_weight"].get(school_key, 0.0)
        disagreement_mu[key] = abs(prior_mu[key] - evidence_mu[key])
    sigma0 = compute_sigma0(universe, history_weight, prior_mu, evidence_mu)

    preseason_rows: list[dict[str, Any]] = []
    for team in team_master:
        key = team.team_key
        school_key = make_school_key(team.college_name)
        history_mu = school_history_bundle["history_mu"].get(school_key, 1500.0)
        history_mu_end_2024 = school_history_bundle["history_mu_end_2024"].get(school_key, 1500.0)
        history_mu_end_2025 = school_history_bundle["history_mu_end_2025"].get(school_key, 1500.0)
        history_mu_end_2026_rmul = school_history_bundle["history_mu_end_2026_rmul"].get(school_key, history_mu)
        match_count_2024 = school_history_bundle["n_matches_2024_rmuc"].get(school_key, 0)
        match_count_2025 = school_history_bundle["n_matches_2025_rmuc"].get(school_key, 0)
        match_count_2026 = school_history_bundle["n_matches_2026_rmul"].get(school_key, 0)
        mu0 = (prior_mu[key] * (1.0 - history_weight[key])) + (history_mu * history_weight[key])
        robot_detail = robot_team_details.get(key, {})
        preseason_rows.append(
            {
                "team_key": key,
                "school_key": school_key,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "shape_rank": team.shape_rank,
                "preferred_region": team.preferred_region,
                "admitted_region": team.admitted_region,
                "seed_rank_in_region": team.seed_rank_in_region or "",
                "seed_tier": team.seed_tier,
                "ranking_source": team.ranking_source,
                "ranking_global_rank": team.ranking_global_rank or "",
                "ranking_score": team.ranking_score or "",
                "z_25game": round(features["z_25game"].values[key], 6),
                "robot_stage_count": robot_detail.get("robot_stage_count", 0),
                "robot_stage_reliability": round(robot_detail.get("robot_stage_reliability", 0.0), 6),
                "z_robot25_raw_unshrunk": round(robot_detail.get("z_robot25_raw_unshrunk", 0.0), 6),
                "robot_raw_score": round(robot_detail.get("robot_raw_score", 0.0), 6),
                "z_robot25_raw": round(features["z_robot25_raw"].values[key], 6),
                "z_26rmul_raw": round(features["z_26rmul_raw"].values[key], 6),
                "z_26rmul": round(features["z_26rmul"].values[key], 6),
                "rmul_reliability": round(rmul_reliability.get(key, 0.0), 6),
                "z_form": round(features["z_form"].values[key], 6),
                "z_hist": round(features["z_hist"].values[key], 6),
                "tilde_z_hist": round(features["tilde_z_hist"].values[key], 6),
                "n_matches_2024_rmuc": match_count_2024,
                "n_matches_2025_rmuc": match_count_2025,
                "n_matches_2026_rmul": match_count_2026,
                "n_eff": round(n_eff_history[key], 4),
                "n_eff_history": round(n_eff_history[key], 4),
                "H": round(legacy_h_values[key], 6),
                "prior_score": round(prior_score_map[key], 6),
                "prior_mu": round(prior_mu[key], 6),
                "history_mu": round(history_mu, 6),
                "history_weight": round(history_weight[key], 6),
                "history_mu_end_2024": round(history_mu_end_2024, 6),
                "history_mu_end_2025": round(history_mu_end_2025, 6),
                "history_mu_end_2026_rmul": round(history_mu_end_2026_rmul, 6),
                "evidence_mu": round(evidence_mu[key], 6),
                "evidence_weight": round(history_weight[key], 6),
                "disagreement_mu": round(disagreement_mu[key], 6),
                "rating_model_version": RATING_MODEL_VERSION,
                "mu0": round(mu0, 6),
                "sigma0": round(sigma0[key], 6),
            }
        )
    robot_feature_rows: list[dict[str, Any]] = []
    for team in team_master:
        key = team.team_key
        detail = robot_team_details.get(key)
        if not detail:
            continue
        robot_feature_rows.append(
            {
                "team_key": key,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "robot_stage_count": detail["robot_stage_count"],
                "robot_stage_reliability": round(detail["robot_stage_reliability"], 6),
                "robot_stage_families": detail["robot_stage_families"],
                "z_robot25_raw_unshrunk": round(detail["z_robot25_raw_unshrunk"], 6),
                "robot_raw_score": round(detail["robot_raw_score"], 6),
                "z_robot25_raw": round(detail["z_robot25_raw"], 6),
                "robot_infantry_score": round(detail["robot_infantry_score"], 6),
                "robot_hero_score": round(detail["robot_hero_score"], 6),
                "robot_guard_score": round(detail["robot_guard_score"], 6),
                "robot_airplane_score": round(detail["robot_airplane_score"], 6),
                "robot_sapper_score": round(detail["robot_sapper_score"], 6),
                "robot_dart_score": round(detail["robot_dart_score"], 6),
                "robot_radar_score": round(detail["robot_radar_score"], 6),
            }
        )
    diagnostics = {
        "robot": robot_diagnostics,
        "rmul_recent_reference": rmul_diagnostics,
        "rmuc_2025_anchor": rmuc_2025_anchor_diagnostics,
        model_version: {
            "rating_model_version": model_version,
            "history_source": "data/extracted",
            "prior_component_weights": EMPIRICAL_BAYES_PRIOR_WEIGHTS,
            "prior_mu_scale": PRIOR_MU_SCALE,
            "history_match_equivalents": {
                "2024RMUC": HISTORY_2024_MATCH_EQUIVALENT,
                "2025RMUC": HISTORY_2025_MATCH_EQUIVALENT,
                "2026RMUL": HISTORY_2026_RMUL_MATCH_EQUIVALENT,
            },
            "history_weight_offset": HISTORY_WEIGHT_OFFSET,
            "season_retention": {
                "2024_to_2025": SEASON_2024_TO_2025_RETENTION,
                "2025_to_2026": SEASON_2025_TO_2026_RETENTION,
            },
            "mu_bounds": {"floor": None, "ceiling": None},
            "sigma_bounds": [PRESEASON_SIGMA_FLOOR, PRESEASON_SIGMA_CEILING],
            "global_school_pool_size": school_history_audit["global_school_pool_size"],
            "history_match_total": school_history_audit["history_match_total"],
            "history_match_totals_by_event": school_history_audit["history_match_totals_by_event"],
            "history_school_counts_by_event": school_history_audit["history_school_counts_by_event"],
            "covered_history_2024": len({key for key, count in school_history_bundle["n_matches_2024_rmuc"].items() if count > 0}),
            "covered_history_2025": len({key for key, count in school_history_bundle["n_matches_2025_rmuc"].items() if count > 0}),
            "covered_history_2026_rmul": len({key for key, count in school_history_bundle["n_matches_2026_rmul"].items() if count > 0}),
            "median_history_weight": round(statistics.median(history_weight.values()), 6),
            "median_disagreement_mu": round(statistics.median(disagreement_mu.values()), 6),
            "alias_merge_count": school_history_audit["alias_merge_count"],
            "alias_merged_schools": school_history_audit["alias_merged_schools"],
            "multi_team_name_schools": school_history_audit["multi_team_name_schools"],
            "missing_school_joins": sum(
                1
                for team in team_master
                if make_school_key(team.college_name) not in school_history_bundle["history_mu"]
            ),
            "history_builder": school_history_bundle["diagnostics"],
        },
        "feature_coverage": {
            name: len(series.covered) for name, series in features.items()
        },
        "correlations": {
            "corr_z25game_vs_zrobot25_raw": round(
                pearson_corr(z_25game.covered & z_robot25_raw.covered, z_25game.values, z_robot25_raw.values), 6
            ),
            "corr_z25game_vs_zhist": round(
                pearson_corr(z_25game.covered & z_hist.covered, z_25game.values, z_hist.values), 6
            ),
            "corr_z25game_vs_tilde_zhist": round(
                pearson_corr(tilde_z_hist.covered & z_25game.covered, tilde_z_hist.values, z_25game.values), 6
            ),
            "corr_z26rmul_raw_vs_z26rmul": round(
                pearson_corr(z_26rmul.covered & z_26rmul_raw.covered, z_26rmul.values, z_26rmul_raw.values), 6
            ),
            "corr_zform_vs_z26rmul": round(
                pearson_corr(z_form.covered & z_26rmul.covered, z_form.values, z_26rmul.values), 6
            ),
        },
        "prior_weights": PRIOR_WEIGHTS,
        "robot_stage_family_weights": ROBOT_STAGE_FAMILY_WEIGHTS,
        "robot_stage_count_distribution": robot_diagnostics["stage_count_distribution"],
        "robot_global_weight": PRIOR_WEIGHTS["z_robot25_raw"],
        "removed_features": ["tilde_z_robot25"],
        "excluded_sources": ["2024RMUC rank_score.csv", "2025RMUC rank_score.csv"],
        "decoupled_sources": ["z_form independent from z_26rmul"],
    }
    return preseason_rows, features, diagnostics, robot_feature_rows, global_school_rows


def build_ranking_current_rows(preseason_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered_rows = sorted(
        preseason_rows,
        key=lambda row: (-float(row["mu0"]), row["college_name"], row["team_name"]),
    )
    ranking_rows: list[dict[str, Any]] = []
    for rank, row in enumerate(ordered_rows, start=1):
        ranking_rows.append(
            {
                "rank": rank,
                "school_key": row["school_key"],
                "college_name": row["college_name"],
                "team_name": row["team_name"],
                "mu0": row["mu0"],
                "z_25game": row["z_25game"],
                "z_robot25_raw": row["z_robot25_raw"],
                "z_26rmul": row["z_26rmul"],
                "z_form": row["z_form"],
                "tilde_z_hist": row["tilde_z_hist"],
                "sigma0": row["sigma0"],
                "prior_mu": row["prior_mu"],
                "long_term_mu": row["long_term_mu"],
                "history_mu": row["history_mu"],
                "history_weight": row["history_weight"],
                "recent_form_mu": row["recent_form_mu"],
                "recent_form_mu_calibrated": row["recent_form_mu_calibrated"],
                "recent_anchor_mu": row["recent_anchor_mu"],
                "recent_momentum": row["recent_momentum"],
                "recent_level_gap": row["recent_level_gap"],
                "level_adjustment": row["level_adjustment"],
                "momentum_adjustment": row["momentum_adjustment"],
                "shape_adjustment": row["shape_adjustment"],
                "level_weight": row["level_weight"],
                "momentum_weight": row["momentum_weight"],
                "recent_weight": row["recent_weight"],
                "recent_reliability": row["recent_reliability"],
                "recent_adjustment": row["recent_adjustment"],
                "peer_match_count": row["peer_match_count"],
                "peer_consistency_adjustment": row["peer_consistency_adjustment"],
                "new_school_compensation": row["new_school_compensation"],
                "old_history_decay": row["old_history_decay"],
                "recent_gap": row["recent_gap"],
                "level_gap": row["level_gap"],
                "history_mu_end_2024": row["history_mu_end_2024"],
                "history_mu_end_2025": row["history_mu_end_2025"],
                "history_mu_end_2026_rmul": row["history_mu_end_2026_rmul"],
                "coverage_2025": row["coverage_2025"],
                "effective_scale_2024": row["effective_scale_2024"],
                "effective_rho_2024_to_2025": row["effective_rho_2024_to_2025"],
                "effective_rho_2025_to_2026": row["effective_rho_2025_to_2026"],
                "group_summary_2024_damped_component": row["group_summary_2024_damped_component"],
                "evidence_mu": row["evidence_mu"],
                "evidence_weight": row["evidence_weight"],
                "disagreement_mu": row["disagreement_mu"],
                "shape_rank": row["shape_rank"],
                "preferred_region": row["preferred_region"],
                "admitted_region": row["admitted_region"],
                "seed_rank_in_region": row["seed_rank_in_region"],
                "seed_tier": row["seed_tier"],
                "n_matches_2024_rmuc": row["n_matches_2024_rmuc"],
                "n_matches_2025_rmuc": row["n_matches_2025_rmuc"],
                "n_matches_2026_rmul": row["n_matches_2026_rmul"],
                "n_eff_history": row["n_eff_history"],
                "rating_model_version": row["rating_model_version"],
            }
        )
    return ranking_rows


def build_initial_ratings(
    preseason_rows: list[dict[str, Any]],
    *,
    use_full_priors: bool,
    include_robot: bool,
) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in preseason_rows:
        key = row["team_key"]
        if not use_full_priors:
            out[key] = 1500.0
            continue
        h_value = (
            PRIOR_WEIGHTS["z_25game"] * float(row["z_25game"])
            + ((PRIOR_WEIGHTS["z_robot25_raw"] * float(row["z_robot25_raw"])) if include_robot else 0.0)
            + PRIOR_WEIGHTS["z_26rmul"] * float(row["z_26rmul"])
            + PRIOR_WEIGHTS["z_form"] * float(row["z_form"])
            + PRIOR_WEIGHTS["tilde_z_hist"] * float(row["tilde_z_hist"])
        )
        out[key] = 1500.0 + (240.0 * h_value)
    return out


def evaluate_predictions(predictions: list[dict[str, Any]]) -> dict[str, float]:
    if not predictions:
        return {"matches": 0, "log_loss": 0.0, "brier": 0.0, "accuracy": 0.0}
    log_losses = []
    briers = []
    accuracy_hits = 0
    for row in predictions:
        p = clip(float(row["p_red_win"]), 1e-9, 1.0 - 1e-9)
        actual = float(row["actual_red"])
        log_losses.append(-(actual * math.log(p) + (1.0 - actual) * math.log(1.0 - p)))
        briers.append((p - actual) ** 2)
        if actual == 0.5:
            continue
        predicted = 1.0 if p >= 0.5 else 0.0
        actual_label = 1.0 if actual > 0.5 else 0.0
        if predicted == actual_label:
            accuracy_hits += 1
    non_ties = sum(1 for row in predictions if float(row["actual_red"]) != 0.5)
    accuracy = (accuracy_hits / non_ties) if non_ties else 0.0
    return {
        "matches": len(predictions),
        "log_loss": round(statistics.fmean(log_losses), 6),
        "brier": round(statistics.fmean(briers), 6),
        "accuracy": round(accuracy, 6),
    }


def run_plain_elo_history(
    records: list[MatchRecord],
    initial_ratings: dict[str, float],
    k_group: float,
    k_knockout: float,
    model_name: str,
    *,
    entity_level: str = "team",
    rmul_per_game: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    ratings = defaultdict(lambda: 1500.0, initial_ratings)
    predictions: list[dict[str, Any]] = []
    for match in records:
        red_key = match_entity_key(match, "red", entity_level)
        blue_key = match_entity_key(match, "blue", entity_level)
        red_mu = ratings[red_key]
        blue_mu = ratings[blue_key]
        k_factor = k_group if match.stage_bucket == "group" else k_knockout
        if rmul_per_game and match.event_code == "2026RMUL":
            update = average_ordered_series_update(
                red_mu,
                blue_mu,
                match.red_wins,
                match.blue_wins,
                k_factor,
            )
            p_red = update["expected_share"]
            actual_red = update["actual_share"]
        else:
            p_red = logistic_expectation(red_mu - blue_mu)
            actual_red = match.score
        predictions.append(
            {
                "model": model_name,
                "event_code": match.event_code,
                "stage_id": match.stage_id,
                "match_id": match.match_id,
                "match_date": match.match_date,
                "red_college_name": match.red_college_name,
                "red_team_name": match.red_team_name,
                "blue_college_name": match.blue_college_name,
                "blue_team_name": match.blue_team_name,
                "p_red_win": round(p_red, 6),
                "actual_red": actual_red,
            }
        )
        if rmul_per_game and match.event_code == "2026RMUL":
            ratings[red_key] = red_mu + update["red_delta"]
            ratings[blue_key] = blue_mu + update["blue_delta"]
            continue
        ratings[red_key] = red_mu + k_factor * (match.score - p_red)
        ratings[blue_key] = blue_mu + k_factor * ((1.0 - match.score) - (1.0 - p_red))
    return predictions, dict(ratings)


def run_simple_walk_forward(
    records: list[MatchRecord],
    initial_ratings: dict[str, float],
    k_group: float,
    k_knockout: float,
    model_name: str,
) -> list[dict[str, Any]]:
    predictions, _ = run_plain_elo_history(records, initial_ratings, k_group, k_knockout, model_name)
    return predictions


def stage_participants(records: list[MatchRecord], *, entity_level: str = "team") -> dict[str, set[str]]:
    participants: defaultdict[str, set[str]] = defaultdict(set)
    for match in records:
        participants[match.stage_id].add(match_entity_key(match, "red", entity_level))
        participants[match.stage_id].add(match_entity_key(match, "blue", entity_level))
    return dict(participants)


def earliest_later_stage_map(records: list[MatchRecord], *, entity_level: str = "team") -> dict[str, dict[str, str]]:
    participants = stage_participants(records, entity_level=entity_level)
    team_stage_positions: defaultdict[str, list[int]] = defaultdict(list)
    for position, stage_id in enumerate(RMUC_STAGE_ORDER):
        for team_key in participants.get(stage_id, set()):
            team_stage_positions[team_key].append(position)
    out: dict[str, dict[str, str]] = {}
    for stage_id in RMUC_STAGE_ORDER:
        stage_idx = RMUC_STAGE_ORDER.index(stage_id)
        out[stage_id] = {}
        for team_key in participants.get(stage_id, set()):
            later_positions = [pos for pos in team_stage_positions[team_key] if pos > stage_idx]
            if later_positions:
                out[stage_id][team_key] = RMUC_STAGE_ORDER[min(later_positions)]
    return out


def stage_floor_assignments(
    stage_id: str,
    participants: set[str],
    next_stage_by_team: dict[str, str],
    entry_ratings: dict[str, float],
) -> tuple[dict[str, float], dict[str, float]]:
    floors: dict[str, float] = {}
    cutlines: dict[str, float] = {}

    def compute_cut(qualified: set[str], eligible: set[str], bonus: float, cut_name: str) -> None:
        nonlocal floors, cutlines
        nonqualified = eligible - qualified
        if not qualified or not nonqualified:
            return
        qualified_min = min(entry_ratings[key] for key in qualified)
        nonqualified_max = max(entry_ratings[key] for key in nonqualified)
        cut_value = (qualified_min + nonqualified_max) / 2.0
        cutlines[cut_name] = round(cut_value, 6)
        for key in qualified:
            floors[key] = max(floors.get(key, -10**9), cut_value + bonus)

    if stage_id.startswith("regional_"):
        direct = {key for key, nxt in next_stage_by_team.items() if nxt == "national_group"}
        repechage = {
            key
            for key, nxt in next_stage_by_team.items()
            if nxt in {"repechage_stage1", "repechage_stage2"}
        }
        compute_cut(direct, participants, RMUC_STAGE_BONUSES["regional_direct_national"], "direct_national_cut")
        compute_cut(repechage, participants - direct, RMUC_STAGE_BONUSES["regional_repechage"], "repechage_cut")
    elif stage_id == "repechage_stage1":
        direct = {key for key, nxt in next_stage_by_team.items() if nxt == "national_group"}
        stage2 = {key for key, nxt in next_stage_by_team.items() if nxt == "repechage_stage2"}
        compute_cut(direct, participants, RMUC_STAGE_BONUSES["repechage_stage1_direct_national"], "direct_national_cut")
        compute_cut(stage2, participants - direct, RMUC_STAGE_BONUSES["repechage_stage1_to_stage2"], "stage2_cut")
    elif stage_id == "repechage_stage2":
        direct = {key for key, nxt in next_stage_by_team.items() if nxt == "national_group"}
        compute_cut(direct, participants, RMUC_STAGE_BONUSES["repechage_stage2_direct_national"], "direct_national_cut")
    elif stage_id == "national_group":
        knockout = {key for key, nxt in next_stage_by_team.items() if nxt == "national_knockout"}
        compute_cut(knockout, participants, RMUC_STAGE_BONUSES["national_group_to_knockout"], "knockout_cut")
    return floors, cutlines


def run_rmuc_stage_aware_history(
    records: list[MatchRecord],
    initial_ratings: dict[str, float],
    model_name: str,
    *,
    entity_level: str = "team",
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, float]]:
    ratings: defaultdict[str, float] = defaultdict(lambda: 1500.0, initial_ratings)
    predictions: list[dict[str, Any]] = []
    stage_records: defaultdict[str, list[MatchRecord]] = defaultdict(list)
    for match in records:
        stage_records[match.stage_id].append(match)
    participants_by_stage = stage_participants(records, entity_level=entity_level)
    next_stage_map = earliest_later_stage_map(records, entity_level=entity_level)
    stage_entry_ratings: dict[str, dict[str, float]] = {}
    progression_audits: list[dict[str, Any]] = []
    stage_zero_win_drops: list[float] = []

    current_stage = None
    stage_match_counts: Counter[str] = Counter()
    stage_win_counts: Counter[str] = Counter()

    def finalize_stage(stage_id: str) -> None:
        if stage_id is None:
            return
        participants = participants_by_stage.get(stage_id, set())
        entry = stage_entry_ratings.get(stage_id, {})
        floors, cutlines = stage_floor_assignments(stage_id, participants, next_stage_map.get(stage_id, {}), entry)
        n0 = RMUC_STAGE_N0[stage_id]
        for team_key in participants:
            mu_in = entry[team_key]
            mu_match = ratings[team_key]
            stage_matches = stage_match_counts[team_key]
            lam = stage_matches / (stage_matches + n0) if stage_matches else 0.0
            base_floor = max(mu_in, floors.get(team_key, -10**9))
            ratings[team_key] = (lam * mu_match) + ((1.0 - lam) * base_floor)
            if team_key in next_stage_map.get(stage_id, {}):
                if cutlines:
                    reference_cut = max(cutlines.values())
                    progression_audits.append(
                        {
                            "stage_id": stage_id,
                            "team_key": team_key,
                            "post_stage_mu": round(ratings[team_key], 6),
                            "reference_cut": round(reference_cut, 6),
                            "penalized": ratings[team_key] < (reference_cut - 10.0),
                        }
                    )
            if stage_win_counts[team_key] == 0 and stage_matches >= 2:
                stage_zero_win_drops.append(mu_in - ratings[team_key])

    for match in records:
        if match.stage_id != current_stage:
            finalize_stage(current_stage) if current_stage is not None else None
            current_stage = match.stage_id
            stage_match_counts = Counter()
            stage_win_counts = Counter()
            stage_entry_ratings[current_stage] = {
                key: ratings[key] for key in participants_by_stage.get(current_stage, set())
            }
        red_key = match_entity_key(match, "red", entity_level)
        blue_key = match_entity_key(match, "blue", entity_level)
        red_mu = ratings[red_key]
        blue_mu = ratings[blue_key]
        p_red = logistic_expectation(red_mu - blue_mu)
        predictions.append(
            {
                "model": model_name,
                "event_code": match.event_code,
                "stage_id": match.stage_id,
                "match_id": match.match_id,
                "match_date": match.match_date,
                "red_college_name": match.red_college_name,
                "red_team_name": match.red_team_name,
                "blue_college_name": match.blue_college_name,
                "blue_team_name": match.blue_team_name,
                "p_red_win": round(p_red, 6),
                "actual_red": match.score,
            }
        )
        k_factor = RMUC_STAGE_K[match.stage_id]
        ratings[red_key] = red_mu + k_factor * (match.score - p_red)
        ratings[blue_key] = blue_mu + k_factor * ((1.0 - match.score) - (1.0 - p_red))
        stage_match_counts[red_key] += 1
        stage_match_counts[blue_key] += 1
        if match.score == 1.0:
            stage_win_counts[red_key] += 1
        elif match.score == 0.0:
            stage_win_counts[blue_key] += 1

    finalize_stage(current_stage) if current_stage is not None else None
    progression_penalty_rate = (
        sum(1 for row in progression_audits if row["penalized"]) / len(progression_audits)
        if progression_audits
        else 0.0
    )
    diagnostics = {
        "progression_penalty_rate": round(progression_penalty_rate, 6),
        "progression_audits": progression_audits,
        "zero_win_stage_drop_median": round(statistics.median(stage_zero_win_drops), 6)
        if stage_zero_win_drops
        else 0.0,
    }
    return predictions, diagnostics, dict(ratings)


def run_rmuc_2025_stage_aware_backtest(
    records: list[MatchRecord],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, float]]:
    return run_rmuc_stage_aware_history(records, {}, "stage_aware_rmuc_2025")


def regress_ratings_to_mean(
    ratings: dict[str, float],
    *,
    retention: float,
    target_mean: float = 1500.0,
) -> dict[str, float]:
    return {
        key: target_mean + (retention * (value - target_mean))
        for key, value in ratings.items()
    }


def build_history_mu(
    universe: list[str],
    matches_2024_rmuc: list[MatchRecord],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
    *,
    entity_level: str = "team",
    model_prefix: str = "history",
    rmul_per_game: bool = False,
) -> dict[str, Any]:
    _, diagnostics_2024, end_2024_raw = run_rmuc_stage_aware_history(
        matches_2024_rmuc,
        {},
        f"{model_prefix}_rmuc_2024",
        entity_level=entity_level,
    )
    start_2025 = regress_ratings_to_mean(
        end_2024_raw,
        retention=SEASON_2024_TO_2025_RETENTION,
    )
    _, diagnostics_2025, end_2025_raw = run_rmuc_stage_aware_history(
        matches_2025_rmuc,
        start_2025,
        f"{model_prefix}_rmuc_2025",
        entity_level=entity_level,
    )
    start_2026 = regress_ratings_to_mean(
        end_2025_raw,
        retention=SEASON_2025_TO_2026_RETENTION,
    )
    _, end_2026_rmul_raw = run_plain_elo_history(
        matches_2026_rmul,
        start_2026,
        RMUL_HISTORY_K,
        RMUL_HISTORY_K,
        f"{model_prefix}_rmul_2026",
        entity_level=entity_level,
        rmul_per_game=rmul_per_game,
    )

    counts_2024 = build_match_count_map(matches_2024_rmuc, entity_level=entity_level)
    counts_2025 = build_match_count_map(matches_2025_rmuc, entity_level=entity_level)
    counts_2026 = build_match_count_map(matches_2026_rmul, entity_level=entity_level)
    history_mu = {key: end_2026_rmul_raw.get(key, start_2026.get(key, 1500.0)) for key in universe}
    history_mu_end_2024 = {key: end_2024_raw.get(key, 1500.0) for key in universe}
    history_mu_end_2025 = {key: end_2025_raw.get(key, start_2025.get(key, 1500.0)) for key in universe}
    history_mu_end_2026_rmul = {key: end_2026_rmul_raw.get(key, history_mu[key]) for key in universe}
    return {
        "history_mu": history_mu,
        "history_mu_end_2024": history_mu_end_2024,
        "history_mu_end_2025": history_mu_end_2025,
        "history_mu_end_2026_rmul": history_mu_end_2026_rmul,
        "n_matches_2024_rmuc": counts_2024,
        "n_matches_2025_rmuc": counts_2025,
        "n_matches_2026_rmul": counts_2026,
        "diagnostics": {
            "retention_2024_to_2025": SEASON_2024_TO_2025_RETENTION,
            "retention_2025_to_2026": SEASON_2025_TO_2026_RETENTION,
            "rmul_history_k": RMUL_HISTORY_K,
            "rmul_update_granularity": "per_game" if rmul_per_game else "match_share",
            "entity_level": entity_level,
            "covered_2024": len(end_2024_raw),
            "covered_2025": len(end_2025_raw),
            "covered_2026_rmul": len(end_2026_rmul_raw),
            "rmuc_2024_stage_aware": diagnostics_2024,
            "rmuc_2025_stage_aware": diagnostics_2025,
        },
    }


def build_school_history_bundle(
    matches_2024_rmuc: list[MatchRecord],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
) -> dict[str, Any]:
    universe = sorted(
        {
            match.red_school_key
            for match in matches_2024_rmuc + matches_2025_rmuc + matches_2026_rmul
        }
        | {
            match.blue_school_key
            for match in matches_2024_rmuc + matches_2025_rmuc + matches_2026_rmul
        }
    )
    history_bundle = build_history_mu(
        universe,
        matches_2024_rmuc,
        matches_2025_rmuc,
        matches_2026_rmul,
        entity_level="school",
        model_prefix="extracted_school_history",
        rmul_per_game=False,
    )
    n_eff_history: dict[str, float] = {}
    history_weight: dict[str, float] = {}
    for key in universe:
        n_eff = (
            HISTORY_2024_MATCH_EQUIVALENT * history_bundle["n_matches_2024_rmuc"].get(key, 0)
            + HISTORY_2025_MATCH_EQUIVALENT * history_bundle["n_matches_2025_rmuc"].get(key, 0)
            + HISTORY_2026_RMUL_MATCH_EQUIVALENT * history_bundle["n_matches_2026_rmul"].get(key, 0)
        )
        n_eff_history[key] = n_eff
        history_weight[key] = n_eff / (n_eff + HISTORY_WEIGHT_OFFSET) if n_eff > 0.0 else 0.0
    history_bundle["n_eff_history"] = n_eff_history
    history_bundle["history_weight"] = history_weight
    return history_bundle


def collect_school_history_audit(paths: dict[str, Path]) -> dict[str, Any]:
    alias_variants: defaultdict[str, set[str]] = defaultdict(set)
    team_names_by_school: defaultdict[str, set[str]] = defaultdict(set)
    school_counts_by_event: dict[str, int] = {}
    match_counts_by_event: dict[str, int] = {}
    for event_code, path in paths.items():
        rows = read_csv(path)
        match_counts_by_event[event_code] = len(rows)
        event_schools: set[str] = set()
        for row in rows:
            for school_field, team_field in [
                ("red_college_name", "red_team_name"),
                ("blue_college_name", "blue_team_name"),
            ]:
                raw_school = row[school_field].strip()
                school_key = normalize_school(raw_school)
                alias_variants[school_key].add(raw_school)
                team_names_by_school[school_key].add(normalize_team(row[team_field]))
                event_schools.add(school_key)
        school_counts_by_event[event_code] = len(event_schools)
    alias_merged_schools = {
        school_key: sorted(raw_names)
        for school_key, raw_names in alias_variants.items()
        if len(raw_names) > 1
    }
    multi_team_name_schools = {
        school_key: sorted(team_names)
        for school_key, team_names in team_names_by_school.items()
        if len(team_names) > 1
    }
    return {
        "alias_merged_schools": alias_merged_schools,
        "alias_merge_count": sum(len(raw_names) - 1 for raw_names in alias_merged_schools.values()),
        "multi_team_name_schools": multi_team_name_schools,
        "global_school_pool_size": len(alias_variants),
        "history_match_total": sum(match_counts_by_event.values()),
        "history_match_totals_by_event": match_counts_by_event,
        "history_school_counts_by_event": school_counts_by_event,
    }


def build_global_school_rows(
    history_bundle: dict[str, Any],
    recent_form_bundle: dict[str, Any],
    peer_bundle: dict[str, dict[str, float]] | None = None,
) -> list[dict[str, Any]]:
    peer_adjustment = peer_bundle["peer_consistency_adjustment"] if peer_bundle is not None else {}
    peer_match_count = peer_bundle["peer_match_count"] if peer_bundle is not None else {}

    def school_total_mu(school_key: str) -> float:
        long_term_mu = history_bundle["history_mu"][school_key]
        recent_components = compute_recent_adjustment_components(
            long_term_mu=long_term_mu,
            calibrated_recent_form_mu_end_2025=recent_form_bundle["recent_form_mu_end_2025_calibrated"].get(school_key, 1500.0),
            calibrated_recent_form_mu_end_2026_rmul=recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0),
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
        )
        school_peer_adjustment = peer_adjustment.get(school_key, 0.0)
        new_school_compensation = compute_new_school_compensation(
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
            recent_adjustment=recent_components["recent_adjustment"],
            peer_consistency_adjustment=school_peer_adjustment,
            recent_level_gap=recent_components["recent_level_gap"],
            recent_reliability=recent_components["recent_reliability"],
        )
        old_history_decay = compute_old_history_decay(
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
            long_term_mu=long_term_mu,
            recent_form_mu_end_2026_rmul=recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0),
            history_weight=history_bundle["history_weight"].get(school_key, 0.0),
            recent_reliability=recent_components["recent_reliability"],
        )
        return (
            long_term_mu
            + recent_components["recent_adjustment"]
            + school_peer_adjustment
            + new_school_compensation
            - old_history_decay
        )

    ordered_keys = sorted(
        history_bundle["history_mu"],
        key=lambda school_key: (
            -school_total_mu(school_key),
            school_key,
        ),
    )
    rows: list[dict[str, Any]] = []
    for rank, school_key in enumerate(ordered_keys, start=1):
        long_term_mu = history_bundle["history_mu"][school_key]
        recent_components = compute_recent_adjustment_components(
            long_term_mu=long_term_mu,
            calibrated_recent_form_mu_end_2025=recent_form_bundle["recent_form_mu_end_2025_calibrated"].get(school_key, 1500.0),
            calibrated_recent_form_mu_end_2026_rmul=recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0),
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
        )
        recent_form_mu = recent_form_bundle["recent_form_mu_calibrated"].get(school_key, 1500.0)
        school_peer_adjustment = peer_adjustment.get(school_key, 0.0)
        new_school_compensation = compute_new_school_compensation(
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
            recent_adjustment=recent_components["recent_adjustment"],
            peer_consistency_adjustment=school_peer_adjustment,
            recent_level_gap=recent_components["recent_level_gap"],
            recent_reliability=recent_components["recent_reliability"],
        )
        old_history_decay = compute_old_history_decay(
            n_matches_2024=history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
            n_matches_2025=history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
            n_matches_2026=history_bundle["n_matches_2026_rmul"].get(school_key, 0),
            long_term_mu=long_term_mu,
            recent_form_mu_end_2026_rmul=recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0),
            history_weight=history_bundle["history_weight"].get(school_key, 0.0),
            recent_reliability=recent_components["recent_reliability"],
        )
        rows.append(
            {
                "rank": rank,
                "school_key": school_key,
                "college_name": school_key,
                "mu0": round(
                    long_term_mu
                    + recent_components["recent_adjustment"]
                    + school_peer_adjustment
                    + new_school_compensation
                    - old_history_decay,
                    6,
                ),
                "long_term_mu": round(long_term_mu, 6),
                "history_mu": round(long_term_mu, 6),
                "recent_form_mu": round(recent_form_mu, 6),
                "recent_form_mu_calibrated": round(recent_form_mu, 6),
                "recent_anchor_mu": round(recent_components["recent_anchor_mu"], 6),
                "recent_momentum": round(recent_components["recent_momentum"], 6),
                "recent_level_gap": round(recent_components["recent_level_gap"], 6),
                "level_adjustment": round(recent_components["level_adjustment"], 6),
                "momentum_adjustment": round(recent_components["momentum_adjustment"], 6),
                "level_weight": round(recent_components["level_weight"], 6),
                "recent_adjustment": round(recent_components["recent_adjustment"], 6),
                "momentum_weight": round(recent_components["momentum_weight"], 6),
                "recent_weight": round(recent_components["momentum_weight"], 6),
                "recent_reliability": round(recent_components["recent_reliability"], 6),
                "peer_match_count": peer_match_count.get(school_key, 0),
                "peer_consistency_adjustment": round(school_peer_adjustment, 6),
                "new_school_compensation": round(new_school_compensation, 6),
                "old_history_decay": round(old_history_decay, 6),
                "recent_gap": round(recent_components["recent_gap"], 6),
                "level_gap": round(recent_components["level_gap"], 6),
                "history_mu_end_2024": round(history_bundle["history_mu_end_2024"][school_key], 6),
                "history_mu_end_2025": round(history_bundle["history_mu_end_2025"][school_key], 6),
                "history_mu_end_2026_rmul": round(history_bundle["history_mu_end_2026_rmul"][school_key], 6),
                "recent_form_mu_end_2025": round(recent_form_bundle["recent_form_mu_end_2025_calibrated"].get(school_key, 1500.0), 6),
                "recent_form_mu_end_2026_rmul": round(recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0), 6),
                "coverage_2025": round(history_bundle["coverage_2025"].get(school_key, 0.0), 6),
                "effective_scale_2024": round(history_bundle["effective_scale_2024"].get(school_key, 0.0), 6),
                "effective_rho_2024_to_2025": round(history_bundle["effective_rho_2024_to_2025"].get(school_key, 0.0), 6),
                "effective_rho_2025_to_2026": round(history_bundle["effective_rho_2025_to_2026"].get(school_key, 0.0), 6),
                "group_summary_2024_damped_component": round(
                    history_bundle["group_summary_2024_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "n_matches_2024_rmuc": history_bundle["n_matches_2024_rmuc"].get(school_key, 0),
                "n_matches_2025_rmuc": history_bundle["n_matches_2025_rmuc"].get(school_key, 0),
                "n_matches_2026_rmul": history_bundle["n_matches_2026_rmul"].get(school_key, 0),
                "n_eff_history": round(history_bundle["n_eff_history"][school_key], 4),
                "history_weight": round(history_bundle["history_weight"][school_key], 6),
                "rating_model_version": RATING_MODEL_VERSION,
            }
        )
    return rows


def build_school_rank_score_component(
    path: Path,
    *,
    school_field: str = "school_chinese",
) -> tuple[dict[str, float], dict[str, Any]]:
    rows = read_csv(path)
    raw_scores = {
        normalize_school(row[school_field]): parse_float(row["score"]) or 0.0
        for row in rows
        if row.get(school_field)
    }
    return robust_z_map(raw_scores, higher_is_better=True), {"rows": len(rows), "covered_schools": len(raw_scores)}


def build_school_group_summary_component(path: Path) -> tuple[dict[str, float], dict[str, Any]]:
    rows = read_csv(path)
    rows_by_zone: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        rows_by_zone[row["zone_name"]].append(row)
    school_scores: defaultdict[str, list[float]] = defaultdict(list)
    component_coverage: Counter[str] = Counter()
    for zone_name, zone_rows in rows_by_zone.items():
        rank_map: dict[int, int] = {}
        wins_map: dict[int, float] = {}
        points_map: dict[int, float] = {}
        opponent_points_map: dict[int, float] = {}
        base_hp_map: dict[int, float] = {}
        outpost_hp_map: dict[int, float] = {}
        damage_map: dict[int, float] = {}
        victory_map: dict[int, float] = {}
        robot_hp_map: dict[int, float] = {}
        for idx, row in enumerate(zone_rows):
            rank_value = parse_int(row.get("rank")) or parse_int(row.get("group_order"))
            if rank_value is not None:
                rank_map[idx] = rank_value
            wins_value = parse_float(row.get("wins"))
            if wins_value is not None:
                wins_map[idx] = wins_value
            points_value = parse_float(row.get("points"))
            if points_value is not None:
                points_map[idx] = points_value
            opponent_points = parse_float(row.get("opponent_points"))
            if opponent_points is not None:
                opponent_points_map[idx] = opponent_points
            base_hp = parse_float(row.get("avg_base_hp_diff"))
            if base_hp is not None:
                base_hp_map[idx] = base_hp
            outpost_hp = parse_float(row.get("avg_outpost_hp_diff"))
            if outpost_hp is not None:
                outpost_hp_map[idx] = outpost_hp
            damage = parse_float(row.get("avg_team_damage")) or parse_float(row.get("total_team_damage"))
            if damage is not None:
                damage_map[idx] = damage
            victory = parse_float(row.get("total_victory_point_diff"))
            if victory is not None:
                victory_map[idx] = victory
            robot_hp = parse_float(row.get("total_robot_hp_remaining"))
            if robot_hp is not None:
                robot_hp_map[idx] = robot_hp
        component_maps = {
            "rank": inverse_normal_rank_map(rank_map, lower_rank_is_better=True),
            "wins": robust_z_map(wins_map, higher_is_better=True),
            "points": robust_z_map(points_map, higher_is_better=True),
            "opponent_points": robust_z_map(opponent_points_map, higher_is_better=True),
            "base_hp": robust_z_map(base_hp_map, higher_is_better=True),
            "outpost_hp": robust_z_map(outpost_hp_map, higher_is_better=True),
            "damage": robust_z_map(damage_map, higher_is_better=True),
            "victory": robust_z_map(victory_map, higher_is_better=True),
            "robot_hp": robust_z_map(robot_hp_map, higher_is_better=True),
        }
        component_weights = {
            "rank": 0.35,
            "wins": 0.18,
            "points": 0.12,
            "opponent_points": 0.10,
            "base_hp": 0.12,
            "outpost_hp": 0.08,
            "damage": 0.10,
            "victory": 0.10,
            "robot_hp": 0.06,
        }
        for name, mapping in component_maps.items():
            component_coverage[name] += len(mapping)
        for idx, row in enumerate(zone_rows):
            school_key = make_school_key(row["college_name"])
            weighted_sum = 0.0
            total_weight = 0.0
            for name, weight in component_weights.items():
                if idx not in component_maps[name]:
                    continue
                weighted_sum += weight * component_maps[name][idx]
                total_weight += weight
            if total_weight <= 0.0:
                continue
            school_scores[school_key].append(weighted_sum / total_weight)
    raw_scores = {
        school_key: statistics.fmean(values)
        for school_key, values in school_scores.items()
        if values
    }
    return robust_z_map(raw_scores, higher_is_better=True), {
        "rows": len(rows),
        "covered_schools": len(raw_scores),
        "zones": len(rows_by_zone),
        "component_coverage": dict(sorted(component_coverage.items())),
    }


def build_school_robot_summary_component(path: Path) -> tuple[dict[str, float], dict[str, Any], dict[str, dict[str, Any]]]:
    rows = read_csv(path)
    grouped: defaultdict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, row in enumerate(rows):
        grouped[(row["zone_name"], row["robot_type"])].append(idx)
    row_scores: dict[int, float] = {}
    for (_, robot_type), indexes in grouped.items():
        metrics = ROBOT_TYPE_METRICS[robot_type]
        metric_z_maps: list[dict[int, float]] = []
        for metric_name, direction in metrics:
            raw_values: dict[int, float] = {}
            for idx in indexes:
                value = parse_float(rows[idx].get(metric_name))
                if value is None:
                    continue
                raw_values[idx] = value * direction
            metric_z_maps.append(robust_z_map(raw_values, higher_is_better=True, clip_limit=ROBOT_ROBUST_Z_CLIP))
        for idx in indexes:
            metric_values = [metric_map.get(idx, 0.0) for metric_map in metric_z_maps]
            row_scores[idx] = statistics.fmean(metric_values) if metric_values else 0.0
    school_stage_families: defaultdict[str, set[str]] = defaultdict(set)
    school_robot_stage_scores: defaultdict[tuple[str, str, str], list[float]] = defaultdict(list)
    for idx, row in enumerate(rows):
        school_key = make_school_key(row["college_name"])
        stage_family = classify_robot_stage_family(row["zone_name"])
        school_stage_families[school_key].add(stage_family)
        school_robot_stage_scores[(school_key, row["robot_type"], stage_family)].append(row_scores[idx])
    raw_school_scores: dict[str, float] = {}
    school_details: dict[str, dict[str, Any]] = {}
    for school_key, stage_families in school_stage_families.items():
        stage_count = len(stage_families)
        stage_reliability = compute_robot_stage_reliability(stage_count)
        type_scores: dict[str, float] = {}
        for robot_type in ROBOT_TYPE_WEIGHTS:
            family_scores = {
                family: statistics.fmean(school_robot_stage_scores[(school_key, robot_type, family)])
                for family in stage_families
                if (school_key, robot_type, family) in school_robot_stage_scores
            }
            observed_weight = sum(ROBOT_STAGE_FAMILY_WEIGHTS[family] for family in family_scores)
            if observed_weight > 0:
                type_scores[robot_type] = sum(
                    ROBOT_STAGE_FAMILY_WEIGHTS[family] * score for family, score in family_scores.items()
                ) / observed_weight
            else:
                type_scores[robot_type] = 0.0
        raw_unshrunk = sum(
            ROBOT_TYPE_WEIGHTS[robot_type] * type_scores[robot_type]
            for robot_type in ROBOT_TYPE_WEIGHTS
        )
        raw_school_scores[school_key] = raw_unshrunk * stage_reliability
        school_details[school_key] = {
            "robot_stage_count": stage_count,
            "robot_stage_reliability": stage_reliability,
            "robot_stage_families": ",".join(sorted(stage_families)),
            "robot_raw_score": raw_unshrunk * stage_reliability,
            "robot_raw_score_unshrunk": raw_unshrunk,
            **{f"robot_{robot_type.lower()}_score": type_scores[robot_type] for robot_type in ROBOT_TYPE_WEIGHTS},
        }
    feature = robust_z_map(raw_school_scores, higher_is_better=True, clip_limit=ROBOT_ROBUST_Z_CLIP)
    for school_key, details in school_details.items():
        details["z_robot25_raw"] = feature.get(school_key, 0.0)
    diagnostics = {
        "rows": len(rows),
        "covered_schools": len(feature),
        "robot_type_weights": ROBOT_TYPE_WEIGHTS,
        "robot_stage_family_weights": ROBOT_STAGE_FAMILY_WEIGHTS,
    }
    return feature, diagnostics, school_details


def build_shape_rank_component(team_master: list[TeamMasterRow]) -> dict[str, float]:
    return shape_rank_component_map({team.team_key: team.shape_rank for team in team_master})


def build_school_history_universe(*record_groups: list[MatchRecord]) -> list[str]:
    universe = {
        match.red_school_key
        for records in record_groups
        for match in records
    } | {
        match.blue_school_key
        for records in record_groups
        for match in records
    }
    return sorted(universe)


def apply_season_start_prior(
    universe: Iterable[str],
    prior_component: dict[str, float],
    *,
    prior_scale: float,
    previous_ratings: dict[str, float] | None = None,
    retention: float = 0.0,
    retention_by_key: dict[str, float] | None = None,
    target_mean: float = 1500.0,
) -> dict[str, float]:
    start_ratings: dict[str, float] = {}
    for school_key in universe:
        previous_rating = previous_ratings.get(school_key, target_mean) if previous_ratings is not None else target_mean
        effective_retention = retention_by_key.get(school_key, retention) if retention_by_key is not None else retention
        base = target_mean + (effective_retention * (previous_rating - target_mean))
        start_ratings[school_key] = base + (prior_scale * prior_component.get(school_key, 0.0))
    return start_ratings


def build_recent_coverage_map(
    history_universe: Iterable[str],
    match_count_map: dict[str, int],
) -> dict[str, float]:
    coverage_map: dict[str, float] = {}
    for school_key in history_universe:
        count = match_count_map.get(school_key, 0)
        if count <= 0:
            coverage_map[school_key] = 0.0
            continue
        coverage_map[school_key] = math.sqrt(count / (count + RECENT_COVERAGE_OFFSET))
    return coverage_map


def compute_iqr(values: Iterable[float]) -> float:
    ordered = sorted(values)
    if len(ordered) < 2:
        return 0.0
    quartiles = statistics.quantiles(ordered, n=4, method="inclusive")
    return quartiles[2] - quartiles[0]


def build_recent_affine_calibration(
    history_mu: dict[str, float],
    recent_form_mu_end_2026_raw: dict[str, float],
    coverage_2025: dict[str, float],
    n_matches_2026: dict[str, int],
) -> dict[str, Any]:
    anchor_keys = [
        school_key
        for school_key in history_mu
        if (
            coverage_2025.get(school_key, 0.0) >= RECENT_CALIBRATION_COVERAGE_THRESHOLD
            or n_matches_2026.get(school_key, 0) >= RECENT_CALIBRATION_MATCH_THRESHOLD
        )
        and school_key in recent_form_mu_end_2026_raw
    ]
    if not anchor_keys:
        return {"scale": 1.0, "offset": 0.0, "anchor_count": 0}

    long_term_anchor = [history_mu[school_key] for school_key in anchor_keys]
    recent_anchor = [recent_form_mu_end_2026_raw[school_key] for school_key in anchor_keys]
    recent_iqr = compute_iqr(recent_anchor)
    long_term_iqr = compute_iqr(long_term_anchor)
    if recent_iqr <= 1e-9:
        scale = 1.0
    else:
        scale = clip(long_term_iqr / recent_iqr, RECENT_CALIBRATION_SCALE_MIN, RECENT_CALIBRATION_SCALE_MAX)
    offset = statistics.median(long_term_anchor) - (scale * statistics.median(recent_anchor))
    return {
        "scale": scale,
        "offset": offset,
        "anchor_count": len(anchor_keys),
    }


def apply_recent_affine_calibration(ratings: dict[str, float], scale: float, offset: float) -> dict[str, float]:
    return {school_key: offset + (scale * value) for school_key, value in ratings.items()}


def build_recent_2025_form_prior(
    history_universe: list[str],
    matches_2025_rmuc: list[MatchRecord],
    prior_component_2025: dict[str, float],
) -> tuple[dict[str, float], dict[str, Any]]:
    start_2025 = apply_season_start_prior(
        history_universe,
        prior_component_2025,
        prior_scale=RECENT_PRIOR_SCALE_2025,
    )
    _, end_2025 = run_school_stage_weighted_elo(
        matches_2025_rmuc,
        start_2025,
        RECENT_STAGE_WEIGHTS,
        f"{RATING_MODEL_VERSION}_recent_prior_2025",
    )
    count_2025 = build_match_count_map(matches_2025_rmuc, entity_level="school")
    coverage_2025 = build_recent_coverage_map(history_universe, count_2025)
    recent_prior_raw = robust_z_map(end_2025, higher_is_better=True)
    recent_prior = {
        school_key: recent_prior_raw.get(school_key, 0.0) * coverage_2025.get(school_key, 0.0)
        for school_key in history_universe
    }
    return recent_prior, {
        "prior_scale_2025": RECENT_PRIOR_SCALE_2025,
        "stage_weights": RECENT_STAGE_WEIGHTS,
        "covered_schools": len(end_2025),
        "schools_with_2025_matches": sum(1 for count in count_2025.values() if count > 0),
        "coverage_offset": RECENT_COVERAGE_OFFSET,
    }


def compute_recent_reliability(n_matches_2025: int, n_matches_2026: int) -> float:
    n_eff_recent = n_matches_2025 + (RECENT_MATCH_EQUIVALENT_2026 * n_matches_2026)
    if n_eff_recent <= 0.0:
        return 0.0
    return math.sqrt(n_eff_recent / (n_eff_recent + RECENT_RELIABILITY_OFFSET))


def compute_recent_weights(
    n_matches_2024: int,
    n_matches_2025: int,
    n_matches_2026: int,
) -> tuple[float, float, float]:
    if (n_matches_2025 + n_matches_2026) <= 0:
        return 0.0, 0.0, 0.0
    reliability = compute_recent_reliability(n_matches_2025, n_matches_2026)
    level_weight = LEVEL_WEIGHT_BASE + (LEVEL_WEIGHT_RELIABILITY_MULTIPLIER * reliability)
    momentum_weight = MOMENTUM_WEIGHT_BASE + (MOMENTUM_WEIGHT_RELIABILITY_MULTIPLIER * reliability)
    if n_matches_2024 == 0 and n_matches_2025 <= 2:
        momentum_weight = max(momentum_weight, MOMENTUM_WEIGHT_NEW_SCHOOL_FLOOR)
    return level_weight, momentum_weight, reliability


def stretch_recent_rating(value: float) -> float:
    return 1500.0 + (RECENT_FORM_STRETCH * (value - 1500.0))


def stretch_recent_rating_map(ratings: dict[str, float]) -> dict[str, float]:
    return {school_key: stretch_recent_rating(value) for school_key, value in ratings.items()}


def compute_recent_adjustment_components(
    *,
    long_term_mu: float,
    calibrated_recent_form_mu_end_2025: float,
    calibrated_recent_form_mu_end_2026_rmul: float,
    n_matches_2024: int,
    n_matches_2025: int,
    n_matches_2026: int,
) -> dict[str, float]:
    level_weight, momentum_weight, recent_reliability = compute_recent_weights(
        n_matches_2024,
        n_matches_2025,
        n_matches_2026,
    )
    recent_anchor_mu = calibrated_recent_form_mu_end_2025
    recent_momentum_raw = calibrated_recent_form_mu_end_2026_rmul - recent_anchor_mu
    recent_momentum = clip(
        recent_momentum_raw,
        RECENT_MOMENTUM_MIN,
        RECENT_MOMENTUM_MAX,
    )
    recent_level_gap = clip(
        calibrated_recent_form_mu_end_2026_rmul - long_term_mu,
        RECENT_LEVEL_GAP_MIN,
        RECENT_LEVEL_GAP_MAX,
    )
    level_adjustment = level_weight * recent_level_gap
    momentum_adjustment = momentum_weight * recent_momentum
    recent_adjustment = level_adjustment + momentum_adjustment
    recent_gap = abs(calibrated_recent_form_mu_end_2026_rmul - recent_anchor_mu)
    level_gap = abs(calibrated_recent_form_mu_end_2026_rmul - long_term_mu)
    return {
        "recent_anchor_mu": recent_anchor_mu,
        "recent_momentum_raw": recent_momentum_raw,
        "recent_momentum": recent_momentum,
        "recent_level_gap": recent_level_gap,
        "level_adjustment": level_adjustment,
        "momentum_adjustment": momentum_adjustment,
        "recent_adjustment": recent_adjustment,
        "level_weight": level_weight,
        "momentum_weight": momentum_weight,
        "recent_reliability": recent_reliability,
        "recent_gap": recent_gap,
        "level_gap": level_gap,
        "long_term_gap": level_gap,
    }


def is_new_school_breakout(
    n_matches_2024: int,
    n_matches_2025: int,
    n_matches_2026: int,
) -> bool:
    return n_matches_2024 == 0 and n_matches_2025 == 0 and n_matches_2026 > 0


def compute_new_school_compensation(
    *,
    n_matches_2024: int,
    n_matches_2025: int,
    n_matches_2026: int,
    recent_adjustment: float,
    peer_consistency_adjustment: float,
    recent_level_gap: float,
    recent_reliability: float,
) -> float:
    if not is_new_school_breakout(n_matches_2024, n_matches_2025, n_matches_2026):
        return 0.0
    recent_factor = 0.55 + (0.45 * recent_reliability)
    raw_compensation = (
        NEW_SCHOOL_COMPENSATION_BASE
        + (NEW_SCHOOL_COMPENSATION_RECENT_MULTIPLIER * max(0.0, recent_adjustment))
        + (NEW_SCHOOL_COMPENSATION_PEER_MULTIPLIER * max(0.0, peer_consistency_adjustment))
        + (NEW_SCHOOL_COMPENSATION_LEVEL_MULTIPLIER * max(0.0, recent_level_gap))
    )
    return clip(
        recent_factor * raw_compensation,
        0.0,
        NEW_SCHOOL_COMPENSATION_CAP,
    )


def compute_old_history_decay(
    *,
    n_matches_2024: int,
    n_matches_2025: int,
    n_matches_2026: int,
    long_term_mu: float,
    recent_form_mu_end_2026_rmul: float,
    history_weight: float,
    recent_reliability: float,
) -> float:
    if n_matches_2026 < OLD_HISTORY_DECAY_MIN_CURRENT_MATCHES:
        return 0.0
    legacy_matches = n_matches_2024 + n_matches_2025
    if legacy_matches <= 0:
        return 0.0
    stale_gap = max(0.0, long_term_mu - recent_form_mu_end_2026_rmul)
    if stale_gap <= 0.0:
        return 0.0
    legacy_coverage = math.sqrt(legacy_matches / (legacy_matches + OLD_HISTORY_DECAY_MATCH_OFFSET))
    recent_factor = 0.55 + (0.45 * recent_reliability)
    raw_decay = (
        OLD_HISTORY_DECAY_MULTIPLIER
        * stale_gap
        * history_weight
        * legacy_coverage
        * recent_factor
    )
    return clip(raw_decay, 0.0, OLD_HISTORY_DECAY_CAP)


def build_peer_consistency_adjustments(
    team_master: list[TeamMasterRow],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
    recent_form_bundle: dict[str, Any],
) -> dict[str, dict[str, float]]:
    current_school_keys = {make_school_key(team.college_name) for team in team_master}
    residuals_by_school: defaultdict[str, list[float]] = defaultdict(list)
    for match in [*matches_2025_rmuc, *matches_2026_rmul]:
        if match.red_school_key not in current_school_keys or match.blue_school_key not in current_school_keys:
            continue
        stage_weight = PEER_STAGE_WEIGHTS.get(match.rating_stage_id)
        if stage_weight is None:
            continue
        red_mu = recent_form_bundle["recent_form_mu_calibrated"].get(match.red_school_key, 1500.0)
        blue_mu = recent_form_bundle["recent_form_mu_calibrated"].get(match.blue_school_key, 1500.0)
        if match.event_code == "2026RMUL":
            expected_red = average_ordered_series_update(
                red_mu,
                blue_mu,
                match.red_wins,
                match.blue_wins,
                RECENT_STAGE_WEIGHTS[match.rating_stage_id],
            )["expected_share"]
        else:
            expected_red = logistic_expectation(red_mu - blue_mu)
        red_residual = match.share_score - expected_red
        residuals_by_school[match.red_school_key].append(stage_weight * red_residual)
        residuals_by_school[match.blue_school_key].append(stage_weight * (-red_residual))

    peer_match_count = {school_key: len(residuals) for school_key, residuals in residuals_by_school.items()}
    peer_adjustment: dict[str, float] = {}
    peer_reliability: dict[str, float] = {}
    for school_key in current_school_keys:
        match_count = peer_match_count.get(school_key, 0)
        if match_count <= 0:
            peer_reliability[school_key] = 0.0
            peer_adjustment[school_key] = 0.0
            continue
        reliability = math.sqrt(match_count / (match_count + PEER_RELIABILITY_OFFSET))
        peer_reliability[school_key] = reliability
        average_residual = statistics.fmean(residuals_by_school[school_key])
        peer_adjustment[school_key] = clip(
            PEER_ADJUSTMENT_SCALE * reliability * average_residual,
            -PEER_ADJUSTMENT_CAP,
            PEER_ADJUSTMENT_CAP,
        )
    return {
        "peer_match_count": peer_match_count,
        "peer_reliability": peer_reliability,
        "peer_consistency_adjustment": peer_adjustment,
    }


def run_school_stage_weighted_elo(
    records: list[MatchRecord],
    initial_ratings: dict[str, float],
    stage_weights: dict[str, float],
    model_name: str,
    *,
    rmul_per_game: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    ratings: defaultdict[str, float] = defaultdict(lambda: 1500.0, initial_ratings)
    predictions: list[dict[str, Any]] = []
    for match in records:
        red_key = match.red_school_key
        blue_key = match.blue_school_key
        red_mu = ratings[red_key]
        blue_mu = ratings[blue_key]
        k_factor = stage_weights[match.rating_stage_id]
        if rmul_per_game and match.event_code == "2026RMUL":
            update = average_ordered_series_update(
                red_mu,
                blue_mu,
                match.red_wins,
                match.blue_wins,
                k_factor,
            )
            p_red = update["expected_share"]
            actual_red = update["actual_share"]
        else:
            p_red = logistic_expectation(red_mu - blue_mu)
            actual_red = match.share_score
        predictions.append(
            {
                "model": model_name,
                "event_code": match.event_code,
                "stage_id": match.rating_stage_id,
                "match_id": match.match_id,
                "match_date": match.match_date,
                "red_college_name": match.red_college_name,
                "red_team_name": match.red_team_name,
                "blue_college_name": match.blue_college_name,
                "blue_team_name": match.blue_team_name,
                "p_red_win": round(p_red, 6),
                "actual_red": actual_red,
            }
        )
        if rmul_per_game and match.event_code == "2026RMUL":
            ratings[red_key] = red_mu + update["red_delta"]
            ratings[blue_key] = blue_mu + update["blue_delta"]
            continue
        ratings[red_key] = red_mu + k_factor * (match.share_score - p_red)
        ratings[blue_key] = blue_mu + k_factor * ((1.0 - match.share_score) - (1.0 - p_red))
    return predictions, dict(ratings)


def dynamic_objective(eval_2025: dict[str, float], eval_2026: dict[str, float]) -> float:
    return (
        (0.62 * eval_2026["log_loss"])
        + (0.38 * eval_2025["log_loss"])
        + (0.12 * eval_2026["brier"])
        + (0.08 * eval_2025["brier"])
    )


def build_recent_form_bundle(
    history_universe: list[str],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
    prior_components: dict[str, dict[str, float]],
) -> dict[str, Any]:
    count_2025 = build_match_count_map(matches_2025_rmuc, entity_level="school")
    count_2026 = build_match_count_map(matches_2026_rmul, entity_level="school")
    coverage_2025 = build_recent_coverage_map(history_universe, count_2025)
    effective_rho_2025_to_2026 = {
        school_key: RECENT_RHO_2025_TO_2026 * coverage_2025.get(school_key, 0.0)
        for school_key in history_universe
    }
    start_2025 = apply_season_start_prior(
        history_universe,
        prior_components["2025"],
        prior_scale=RECENT_PRIOR_SCALE_2025,
    )
    predictions_2025, end_2025 = run_school_stage_weighted_elo(
        matches_2025_rmuc,
        start_2025,
        RECENT_STAGE_WEIGHTS,
        f"{RATING_MODEL_VERSION}_recent_history_2025",
    )
    start_2026 = apply_season_start_prior(
        history_universe,
        prior_components["2026RMUL"],
        prior_scale=RECENT_PRIOR_SCALE_2026,
        previous_ratings=end_2025,
        retention=RECENT_RHO_2025_TO_2026,
        retention_by_key=effective_rho_2025_to_2026,
    )
    predictions_2026, end_2026 = run_school_stage_weighted_elo(
        matches_2026_rmul,
        start_2026,
        RECENT_STAGE_WEIGHTS,
        f"{RATING_MODEL_VERSION}_recent_history_2026",
        rmul_per_game=True,
    )
    recent_delta_z = robust_z_map(
        {
            school_key: end_2026.get(school_key, 1500.0) - start_2026.get(school_key, 1500.0)
            for school_key in history_universe
            if count_2026.get(school_key, 0) > 0
        },
        higher_is_better=True,
    )
    recent_end_2025_z = robust_z_map(end_2025, higher_is_better=True)
    stretched_start_2025 = stretch_recent_rating_map({school_key: start_2025.get(school_key, 1500.0) for school_key in history_universe})
    stretched_end_2025 = stretch_recent_rating_map({school_key: end_2025.get(school_key, 1500.0) for school_key in history_universe})
    stretched_start_2026 = stretch_recent_rating_map({school_key: start_2026.get(school_key, 1500.0) for school_key in history_universe})
    stretched_end_2026 = stretch_recent_rating_map({school_key: end_2026.get(school_key, 1500.0) for school_key in history_universe})
    return {
        "recent_form_mu": stretched_end_2026,
        "recent_form_mu_start_2025": stretched_start_2025,
        "recent_form_mu_end_2025": stretched_end_2025,
        "recent_form_mu_start_2026_rmul": stretched_start_2026,
        "recent_form_mu_end_2026_rmul": stretched_end_2026,
        "recent_end_2025_z": {school_key: recent_end_2025_z.get(school_key, 0.0) for school_key in history_universe},
        "recent_delta_z": {school_key: recent_delta_z.get(school_key, 0.0) for school_key in history_universe},
        "coverage_2025": coverage_2025,
        "effective_rho_2025_to_2026": effective_rho_2025_to_2026,
        "n_matches_2025_rmuc": count_2025,
        "n_matches_2026_rmul": count_2026,
        "predictions_2025": predictions_2025,
        "predictions_2026": predictions_2026,
        "evaluation_2025": evaluate_predictions(predictions_2025),
        "evaluation_2026": evaluate_predictions(predictions_2026),
        "config": {
            "prior_scale_2025": RECENT_PRIOR_SCALE_2025,
            "prior_scale_2026": RECENT_PRIOR_SCALE_2026,
            "rho_2025_to_2026": RECENT_RHO_2025_TO_2026,
            "coverage_offset_2025": RECENT_COVERAGE_OFFSET,
            "recent_form_stretch": RECENT_FORM_STRETCH,
            "stage_weights": RECENT_STAGE_WEIGHTS,
        },
    }


def calibrate_recent_form_bundle(
    history_bundle: dict[str, Any],
    recent_form_bundle: dict[str, Any],
) -> dict[str, Any]:
    calibration = build_recent_affine_calibration(
        history_bundle["history_mu"],
        recent_form_bundle["recent_form_mu_end_2026_rmul"],
        history_bundle["coverage_2025"],
        history_bundle["n_matches_2026_rmul"],
    )
    scale = calibration["scale"]
    offset = calibration["offset"]
    calibrated_start_2025 = apply_recent_affine_calibration(recent_form_bundle["recent_form_mu_start_2025"], scale, offset)
    calibrated_end_2025 = apply_recent_affine_calibration(recent_form_bundle["recent_form_mu_end_2025"], scale, offset)
    calibrated_start_2026 = apply_recent_affine_calibration(recent_form_bundle["recent_form_mu_start_2026_rmul"], scale, offset)
    calibrated_end_2026 = apply_recent_affine_calibration(recent_form_bundle["recent_form_mu_end_2026_rmul"], scale, offset)
    return {
        **recent_form_bundle,
        "recent_form_mu_raw": recent_form_bundle["recent_form_mu"],
        "recent_form_mu_start_2025_raw": recent_form_bundle["recent_form_mu_start_2025"],
        "recent_form_mu_end_2025_raw": recent_form_bundle["recent_form_mu_end_2025"],
        "recent_form_mu_start_2026_rmul_raw": recent_form_bundle["recent_form_mu_start_2026_rmul"],
        "recent_form_mu_end_2026_rmul_raw": recent_form_bundle["recent_form_mu_end_2026_rmul"],
        "recent_form_mu": calibrated_end_2026,
        "recent_form_mu_calibrated": calibrated_end_2026,
        "recent_form_mu_start_2025_calibrated": calibrated_start_2025,
        "recent_form_mu_end_2025_calibrated": calibrated_end_2025,
        "recent_form_mu_start_2026_rmul_calibrated": calibrated_start_2026,
        "recent_form_mu_end_2026_rmul_calibrated": calibrated_end_2026,
        "calibration": calibration,
    }


def tune_dynamic_school_model(
    history_universe: list[str],
    matches_2024_rmuc: list[MatchRecord],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
    prior_components: dict[str, dict[str, float]],
) -> dict[str, Any]:
    count_2025 = build_match_count_map(matches_2025_rmuc, entity_level="school")
    coverage_2025 = build_recent_coverage_map(history_universe, count_2025)
    candidates: list[dict[str, Any]] = []
    for stage_profile_name, stage_weights in DYNAMIC_STAGE_WEIGHT_PRESETS.items():
        for prior_profile_name, prior_profile in DYNAMIC_PRIOR_PROFILES.items():
            for rho_2024_to_2025 in DYNAMIC_RHO_2024_TO_2025_CANDIDATES:
                for rho_2025_to_2026 in DYNAMIC_RHO_2025_TO_2026_CANDIDATES:
                    effective_rho_2024_to_2025 = effective_history_rho_2024_to_2025(rho_2024_to_2025)
                    scaled_2024 = effective_scale_2024(prior_profile["scale_2024"])
                    start_2024 = apply_season_start_prior(
                        history_universe,
                        prior_components["2024"],
                        prior_scale=scaled_2024,
                    )
                    _, end_2024 = run_school_stage_weighted_elo(
                        matches_2024_rmuc,
                        start_2024,
                        stage_weights,
                        f"{RATING_MODEL_VERSION}_fit_2024",
                    )
                    start_2025 = apply_season_start_prior(
                        history_universe,
                        prior_components["2025"],
                        prior_scale=prior_profile["scale_2025"],
                        previous_ratings=end_2024,
                        retention=effective_rho_2024_to_2025,
                    )
                    predictions_2025, end_2025 = run_school_stage_weighted_elo(
                        matches_2025_rmuc,
                        start_2025,
                        stage_weights,
                        f"{RATING_MODEL_VERSION}_fit_2025",
                    )
                    start_2026 = apply_season_start_prior(
                        history_universe,
                        prior_components["2026RMUL"],
                        prior_scale=prior_profile["scale_2026"],
                        previous_ratings=end_2025,
                        retention=rho_2025_to_2026,
                        retention_by_key={
                            school_key: rho_2025_to_2026 * coverage_2025.get(school_key, 0.0)
                            for school_key in history_universe
                        },
                    )
                    predictions_2026, _ = run_school_stage_weighted_elo(
                        matches_2026_rmul,
                        start_2026,
                        stage_weights,
                        f"{RATING_MODEL_VERSION}_fit_2026",
                        rmul_per_game=True,
                    )
                    evaluation_2025 = evaluate_predictions(predictions_2025)
                    evaluation_2026 = evaluate_predictions(predictions_2026)
                    candidates.append(
                        {
                            "objective": round(dynamic_objective(evaluation_2025, evaluation_2026), 6),
                            "stage_profile": stage_profile_name,
                            "prior_profile": prior_profile_name,
                            "rho_2024_to_2025": rho_2024_to_2025,
                            "effective_rho_2024_to_2025": round(effective_rho_2024_to_2025, 6),
                            "effective_scale_2024": round(scaled_2024, 6),
                            "rho_2025_to_2026": rho_2025_to_2026,
                            "evaluation_2025": evaluation_2025,
                            "evaluation_2026": evaluation_2026,
                        }
                    )
    candidates.sort(
        key=lambda row: (
            row["objective"],
            row["evaluation_2026"]["log_loss"],
            row["evaluation_2025"]["log_loss"],
            row["evaluation_2026"]["brier"],
            row["evaluation_2025"]["brier"],
            -row["evaluation_2026"]["accuracy"],
        )
    )
    best = candidates[0]
    stage_weights = DYNAMIC_STAGE_WEIGHT_PRESETS[best["stage_profile"]]
    prior_profile = DYNAMIC_PRIOR_PROFILES[best["prior_profile"]]
    effective_rho_2024_to_2025 = effective_history_rho_2024_to_2025(best["rho_2024_to_2025"])
    scaled_2024 = effective_scale_2024(prior_profile["scale_2024"])
    start_2024 = apply_season_start_prior(
        history_universe,
        prior_components["2024"],
        prior_scale=scaled_2024,
    )
    _, end_2024 = run_school_stage_weighted_elo(
        matches_2024_rmuc,
        start_2024,
        stage_weights,
        f"{RATING_MODEL_VERSION}_history_2024",
    )
    start_2025 = apply_season_start_prior(
        history_universe,
        prior_components["2025"],
        prior_scale=prior_profile["scale_2025"],
        previous_ratings=end_2024,
        retention=effective_rho_2024_to_2025,
    )
    predictions_2025, end_2025 = run_school_stage_weighted_elo(
        matches_2025_rmuc,
        start_2025,
        stage_weights,
        f"{RATING_MODEL_VERSION}_history_2025",
    )
    start_2026 = apply_season_start_prior(
        history_universe,
        prior_components["2026RMUL"],
        prior_scale=prior_profile["scale_2026"],
        previous_ratings=end_2025,
        retention=best["rho_2025_to_2026"],
        retention_by_key={
            school_key: best["rho_2025_to_2026"] * coverage_2025.get(school_key, 0.0)
            for school_key in history_universe
        },
    )
    predictions_2026, end_2026 = run_school_stage_weighted_elo(
        matches_2026_rmul,
        start_2026,
        stage_weights,
        f"{RATING_MODEL_VERSION}_history_2026",
        rmul_per_game=True,
    )
    return {
        "selected_config": {
            "stage_profile": best["stage_profile"],
            "stage_weights": stage_weights,
            "prior_profile": best["prior_profile"],
            "prior_scales": prior_profile,
            "rho_2024_to_2025": best["rho_2024_to_2025"],
            "effective_rho_2024_to_2025": round(effective_rho_2024_to_2025, 6),
            "effective_scale_2024": round(scaled_2024, 6),
            "rho_2025_to_2026": best["rho_2025_to_2026"],
            "coverage_offset_2025": RECENT_COVERAGE_OFFSET,
        },
        "top_candidates": candidates[:8],
        "start_2024": start_2024,
        "end_2024": end_2024,
        "start_2025": start_2025,
        "end_2025": end_2025,
        "start_2026": start_2026,
        "end_2026": end_2026,
        "predictions_2025": predictions_2025,
        "predictions_2026": predictions_2026,
        "evaluation_2025": evaluate_predictions(predictions_2025),
        "evaluation_2026": evaluate_predictions(predictions_2026),
        "coverage_2025": coverage_2025,
        "effective_rho_2024_to_2025": {
            school_key: effective_rho_2024_to_2025 for school_key in history_universe
        },
        "effective_rho_2025_to_2026": {
            school_key: best["rho_2025_to_2026"] * coverage_2025.get(school_key, 0.0)
            for school_key in history_universe
        },
    }


def build_dynamic_school_history_bundle(
    matches_2024_rmuc: list[MatchRecord],
    matches_2025_rmuc: list[MatchRecord],
    matches_2026_rmul: list[MatchRecord],
    prior_components: dict[str, dict[str, float]],
) -> dict[str, Any]:
    history_universe = build_school_history_universe(matches_2024_rmuc, matches_2025_rmuc, matches_2026_rmul)
    tuning = tune_dynamic_school_model(
        history_universe,
        matches_2024_rmuc,
        matches_2025_rmuc,
        matches_2026_rmul,
        prior_components,
    )
    count_2024 = build_match_count_map(matches_2024_rmuc, entity_level="school")
    count_2025 = build_match_count_map(matches_2025_rmuc, entity_level="school")
    count_2026 = build_match_count_map(matches_2026_rmul, entity_level="school")
    n_eff_history: dict[str, float] = {}
    history_weight: dict[str, float] = {}
    rmul_delta_raw = {
        school_key: tuning["end_2026"].get(school_key, 1500.0) - tuning["start_2026"].get(school_key, 1500.0)
        for school_key in history_universe
    }
    rmul_delta_z = robust_z_map(
        {
            school_key: delta
            for school_key, delta in rmul_delta_raw.items()
            if count_2026.get(school_key, 0) > 0
        },
        higher_is_better=True,
    )
    for school_key in history_universe:
        n_eff = (
            HISTORY_2024_MATCH_EQUIVALENT * count_2024.get(school_key, 0)
            + HISTORY_2025_MATCH_EQUIVALENT * count_2025.get(school_key, 0)
            + HISTORY_2026_RMUL_MATCH_EQUIVALENT * count_2026.get(school_key, 0)
        )
        n_eff_history[school_key] = n_eff
        history_weight[school_key] = n_eff / (n_eff + HISTORY_WEIGHT_OFFSET) if n_eff > 0.0 else 0.0
    return {
        "history_universe": history_universe,
        "history_mu": {school_key: tuning["end_2026"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_start_2024": {school_key: tuning["start_2024"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_end_2024": {school_key: tuning["end_2024"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_start_2025": {school_key: tuning["start_2025"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_end_2025": {school_key: tuning["end_2025"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_start_2026_rmul": {school_key: tuning["start_2026"].get(school_key, 1500.0) for school_key in history_universe},
        "history_mu_end_2026_rmul": {school_key: tuning["end_2026"].get(school_key, 1500.0) for school_key in history_universe},
        "rmul_delta_z": {school_key: rmul_delta_z.get(school_key, 0.0) for school_key in history_universe},
        "coverage_2025": {school_key: tuning["coverage_2025"].get(school_key, 0.0) for school_key in history_universe},
        "effective_rho_2024_to_2025": {
            school_key: tuning["effective_rho_2024_to_2025"].get(school_key, 0.0) for school_key in history_universe
        },
        "effective_rho_2025_to_2026": {
            school_key: tuning["effective_rho_2025_to_2026"].get(school_key, 0.0) for school_key in history_universe
        },
        "n_matches_2024_rmuc": count_2024,
        "n_matches_2025_rmuc": count_2025,
        "n_matches_2026_rmul": count_2026,
        "n_eff_history": n_eff_history,
        "history_weight": history_weight,
        "tuning": tuning,
    }


def compute_preseason_vnext(
    team_master: list[TeamMasterRow],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
    dict[str, Any],
]:
    extracted_paths = {
        "2024RMUC": ROOT / "data" / "extracted" / "2024RMUC" / "matches.csv",
        "2025RMUC": ROOT / "data" / "extracted" / "2025RMUC" / "matches.csv",
        "2026RMUL": ROOT / "data" / "extracted" / "2026RMUL" / "matches.csv",
    }
    matches_2024 = build_match_records(extracted_paths["2024RMUC"], "2024RMUC")
    matches_2025 = build_match_records(extracted_paths["2025RMUC"], "2025RMUC")
    matches_2026_rmul = build_match_records(extracted_paths["2026RMUL"], "2026RMUL")
    history_universe = build_school_history_universe(matches_2024, matches_2025, matches_2026_rmul)

    rank_score_2024, rank_score_2024_diagnostics = build_school_rank_score_component(
        ROOT / "data" / "extracted" / "2024RMUC" / "rank_score.csv"
    )
    rank_score_2025, rank_score_2025_diagnostics = build_school_rank_score_component(
        ROOT / "data" / "extracted" / "2025RMUC" / "rank_score.csv"
    )
    rank_score_2024_damped = {
        school_key: value * RANK_SCORE_2024_DAMPING for school_key, value in rank_score_2024.items()
    }
    rank_score_2025_damped = {
        school_key: value * RANK_SCORE_2025_DAMPING for school_key, value in rank_score_2025.items()
    }
    group_summary_2024, group_summary_2024_diagnostics = build_school_group_summary_component(
        ROOT / "data" / "extracted" / "2024RMUC" / "group_rank.csv"
    )
    group_summary_2024_damped = {
        school_key: value * GROUP_SUMMARY_2024_DAMPING for school_key, value in group_summary_2024.items()
    }
    group_summary_2025, group_summary_2025_diagnostics = build_school_group_summary_component(
        ROOT / "data" / "extracted" / "2025RMUC" / "group_rank.csv"
    )
    robot_summary_2025, robot_2025_diagnostics, robot_school_details = build_school_robot_summary_component(
        ROOT / "data" / "extracted" / "2025RMUC" / "robot_data.csv"
    )
    ranking_1884, ranking_1884_diagnostics = build_school_rank_score_component(
        ROOT / "data" / "reference" / "2026_regionals" / "ranking_1884.csv",
        school_field="college_name",
    )
    shape_feature = build_shape_rank_component(team_master)

    prior_components_2024 = combine_component_maps(
        {"rank_score_2024": rank_score_2024_damped},
        SEASON_START_PRIOR_WEIGHTS["2024"],
        universe=history_universe,
    )
    prior_components_2025 = combine_component_maps(
        {
            "group_summary_2024": group_summary_2024_damped,
            "rank_score_2025": rank_score_2025_damped,
        },
        SEASON_START_PRIOR_WEIGHTS["2025"],
        universe=history_universe,
    )
    recent_2025_form_prior, recent_2025_form_diagnostics = build_recent_2025_form_prior(
        history_universe,
        matches_2025,
        prior_components_2025,
    )
    prior_components = {
        "2024": prior_components_2024,
        "2025": prior_components_2025,
        "2026RMUL": combine_component_maps(
            {
                "ranking_1884": ranking_1884,
                "group_summary_2025": group_summary_2025,
                "rank_score_2025": rank_score_2025_damped,
                "robot_summary_2025": robot_summary_2025,
                "recent_2025_form_prior": recent_2025_form_prior,
            },
            SEASON_START_PRIOR_WEIGHTS["2026RMUL"],
            universe=history_universe,
        ),
    }

    history_bundle = build_dynamic_school_history_bundle(
        matches_2024,
        matches_2025,
        matches_2026_rmul,
        prior_components,
    )
    selected_scale_2024 = history_bundle["tuning"]["selected_config"]["effective_scale_2024"]
    history_bundle["effective_scale_2024"] = {
        school_key: selected_scale_2024 for school_key in history_universe
    }
    history_bundle["rank_score_2024_damped_component"] = {
        school_key: rank_score_2024_damped.get(school_key, 0.0) for school_key in history_universe
    }
    history_bundle["rank_score_2025_damped_component"] = {
        school_key: rank_score_2025_damped.get(school_key, 0.0) for school_key in history_universe
    }
    history_bundle["group_summary_2024_damped_component"] = {
        school_key: group_summary_2024_damped.get(school_key, 0.0) for school_key in history_universe
    }
    recent_form_bundle_raw = build_recent_form_bundle(
        history_universe,
        matches_2025,
        matches_2026_rmul,
        prior_components,
    )
    recent_form_bundle = calibrate_recent_form_bundle(history_bundle, recent_form_bundle_raw)
    peer_bundle = build_peer_consistency_adjustments(
        team_master,
        matches_2025,
        matches_2026_rmul,
        recent_form_bundle,
    )
    school_history_audit = collect_school_history_audit(extracted_paths)
    global_school_rows = build_global_school_rows(
        history_bundle,
        recent_form_bundle,
        peer_bundle,
    )
    z_25game_school = recent_form_bundle["recent_end_2025_z"]
    z_26rmul_raw_school = recent_form_bundle["recent_delta_z"]
    rmul_reliability_school: dict[str, float] = {}
    z_26rmul_school: dict[str, float] = {}
    for school_key in history_universe:
        n_2026 = history_bundle["n_matches_2026_rmul"].get(school_key, 0)
        reliability = RMUL_3V3_RELIABILITY_CAP * math.sqrt(n_2026 / (n_2026 + RMUL_3V3_RELIABILITY_MATCH_SCALE)) if n_2026 > 0 else 0.0
        rmul_reliability_school[school_key] = reliability
        z_26rmul_school[school_key] = z_26rmul_raw_school.get(school_key, 0.0) * reliability
    tilde_z_hist_school = robust_z_map(history_bundle["history_mu"], higher_is_better=True)

    preseason_rows: list[dict[str, Any]] = []
    source_feature_rows: list[dict[str, Any]] = []
    robot_feature_rows: list[dict[str, Any]] = []
    for team in team_master:
        school_key = make_school_key(team.college_name)
        long_term_mu = history_bundle["history_mu"].get(school_key, 1500.0)
        history_weight = history_bundle["history_weight"].get(school_key, 0.0)
        n_matches_2024 = history_bundle["n_matches_2024_rmuc"].get(school_key, 0)
        n_matches_2025 = history_bundle["n_matches_2025_rmuc"].get(school_key, 0)
        n_matches_2026 = history_bundle["n_matches_2026_rmul"].get(school_key, 0)
        recent_form_mu = recent_form_bundle["recent_form_mu_calibrated"].get(school_key, 1500.0)
        recent_form_mu_end_2025 = recent_form_bundle["recent_form_mu_end_2025_calibrated"].get(school_key, 1500.0)
        recent_form_mu_end_2026 = recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0)
        recent_components = compute_recent_adjustment_components(
            long_term_mu=long_term_mu,
            calibrated_recent_form_mu_end_2025=recent_form_mu_end_2025,
            calibrated_recent_form_mu_end_2026_rmul=recent_form_mu_end_2026,
            n_matches_2024=n_matches_2024,
            n_matches_2025=n_matches_2025,
            n_matches_2026=n_matches_2026,
        )
        recent_adjustment = recent_components["recent_adjustment"]
        recent_gap = recent_components["recent_gap"]
        level_gap = recent_components["level_gap"]
        shape_prior_mu = 1500.0 + (PRIOR_MU_SCALE * shape_feature[team.team_key])
        shape_adjustment = SCHOOL_SHAPE_PRIOR_SCALE * shape_feature[team.team_key] * (
            1.0 - (SHAPE_RECENT_RELIABILITY_SUPPRESSION * recent_components["recent_reliability"])
        )
        shape_positive_cap = (
            SHAPE_ADJUSTMENT_HIGH_RELIABILITY_CAP
            if recent_components["recent_reliability"] >= SHAPE_HIGH_RELIABILITY_THRESHOLD
            else SHAPE_ADJUSTMENT_CAP
        )
        shape_negative_cap = shape_adjustment_negative_cap(
            team.shape_rank,
            recent_components["recent_reliability"],
        )
        shape_adjustment = clip(shape_adjustment, -shape_negative_cap, shape_positive_cap)
        peer_match_count = peer_bundle["peer_match_count"].get(school_key, 0)
        peer_consistency_adjustment = peer_bundle["peer_consistency_adjustment"].get(school_key, 0.0)
        new_school_compensation = compute_new_school_compensation(
            n_matches_2024=n_matches_2024,
            n_matches_2025=n_matches_2025,
            n_matches_2026=n_matches_2026,
            recent_adjustment=recent_adjustment,
            peer_consistency_adjustment=peer_consistency_adjustment,
            recent_level_gap=recent_components["recent_level_gap"],
            recent_reliability=recent_components["recent_reliability"],
        )
        old_history_decay = compute_old_history_decay(
            n_matches_2024=n_matches_2024,
            n_matches_2025=n_matches_2025,
            n_matches_2026=n_matches_2026,
            long_term_mu=long_term_mu,
            recent_form_mu_end_2026_rmul=recent_form_mu_end_2026,
            history_weight=history_weight,
            recent_reliability=recent_components["recent_reliability"],
        )
        mu0 = (
            long_term_mu
            + recent_components["level_adjustment"]
            + recent_components["momentum_adjustment"]
            + peer_consistency_adjustment
            + shape_adjustment
            + new_school_compensation
            - old_history_decay
        )
        disagreement_mu = (
            abs(shape_prior_mu - long_term_mu)
            + recent_gap
            + level_gap
            + abs(peer_consistency_adjustment)
            + abs(new_school_compensation)
            + abs(old_history_decay)
        )
        sigma_base = 90.0 - (SIGMA_HISTORY_WEIGHT_MULTIPLIER * history_weight) + min(
            abs(shape_adjustment) / SHAPE_SIGMA_DISAGREEMENT_DIVISOR,
            SIGMA_DISAGREEMENT_CAP,
        )
        sigma_base += min(recent_gap / RECENT_MOMENTUM_SIGMA_DIVISOR, RECENT_MOMENTUM_SIGMA_CAP)
        sigma_base += min(level_gap / RECENT_LEVEL_SIGMA_DIVISOR, RECENT_LEVEL_SIGMA_CAP)
        if n_matches_2026 <= 0:
            sigma_base += NO_RMUL_MATCH_SIGMA_BONUS
        if (n_matches_2025 + n_matches_2026) <= 0:
            sigma_base += NO_RECENT_MATCH_SIGMA_BONUS
        sigma0 = clip(sigma_base, PRESEASON_SIGMA_FLOOR, PRESEASON_SIGMA_CEILING)
        robot_detail = robot_school_details.get(school_key, {})
        preseason_rows.append(
            {
                "team_key": team.team_key,
                "school_key": school_key,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "shape_rank": team.shape_rank,
                "preferred_region": team.preferred_region,
                "admitted_region": team.admitted_region,
                "seed_rank_in_region": team.seed_rank_in_region or "",
                "seed_tier": team.seed_tier,
                "ranking_source": team.ranking_source,
                "ranking_global_rank": team.ranking_global_rank or "",
                "ranking_score": team.ranking_score or "",
                "rank_score_2024_damped_component": round(
                    history_bundle["rank_score_2024_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "rank_score_2025_damped_component": round(
                    history_bundle["rank_score_2025_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "z_25game": round(z_25game_school.get(school_key, 0.0), 6),
                "robot_stage_count": robot_detail.get("robot_stage_count", 0),
                "robot_stage_reliability": round(robot_detail.get("robot_stage_reliability", 0.0), 6),
                "z_robot25_raw_unshrunk": round(robot_detail.get("robot_raw_score_unshrunk", 0.0), 6),
                "robot_raw_score": round(robot_detail.get("robot_raw_score", 0.0), 6),
                "z_robot25_raw": round(robot_summary_2025.get(school_key, 0.0), 6),
                "z_26rmul_raw": round(z_26rmul_raw_school.get(school_key, 0.0), 6),
                "z_26rmul": round(z_26rmul_school.get(school_key, 0.0), 6),
                "rmul_reliability": round(rmul_reliability_school.get(school_key, 0.0), 6),
                "z_form": round(shape_feature[team.team_key], 6),
                "z_hist": round(prior_components["2026RMUL"].get(school_key, 0.0), 6),
                "tilde_z_hist": round(tilde_z_hist_school.get(school_key, 0.0), 6),
                "n_matches_2024_rmuc": n_matches_2024,
                "n_matches_2025_rmuc": n_matches_2025,
                "n_matches_2026_rmul": n_matches_2026,
                "n_eff": round(history_bundle["n_eff_history"].get(school_key, 0.0), 4),
                "n_eff_history": round(history_bundle["n_eff_history"].get(school_key, 0.0), 4),
                "H": round(prior_components["2026RMUL"].get(school_key, 0.0), 6),
                "prior_score": round(shape_feature[team.team_key], 6),
                "prior_mu": round(shape_prior_mu, 6),
                "long_term_mu": round(long_term_mu, 6),
                "history_mu": round(long_term_mu, 6),
                "history_weight": round(history_weight, 6),
                "recent_form_mu": round(recent_form_mu, 6),
                "recent_form_mu_calibrated": round(recent_form_mu, 6),
                "recent_anchor_mu": round(recent_components["recent_anchor_mu"], 6),
                "recent_momentum": round(recent_components["recent_momentum"], 6),
                "recent_level_gap": round(recent_components["recent_level_gap"], 6),
                "level_adjustment": round(recent_components["level_adjustment"], 6),
                "momentum_adjustment": round(recent_components["momentum_adjustment"], 6),
                "shape_adjustment": round(shape_adjustment, 6),
                "level_weight": round(recent_components["level_weight"], 6),
                "momentum_weight": round(recent_components["momentum_weight"], 6),
                "recent_weight": round(recent_components["momentum_weight"], 6),
                "recent_reliability": round(recent_components["recent_reliability"], 6),
                "recent_adjustment": round(recent_adjustment, 6),
                "peer_match_count": peer_match_count,
                "peer_consistency_adjustment": round(peer_consistency_adjustment, 6),
                "new_school_compensation": round(new_school_compensation, 6),
                "old_history_decay": round(old_history_decay, 6),
                "recent_gap": round(recent_gap, 6),
                "level_gap": round(level_gap, 6),
                "history_mu_start_2024": round(history_bundle["history_mu_start_2024"].get(school_key, 1500.0), 6),
                "history_mu_end_2024": round(history_bundle["history_mu_end_2024"].get(school_key, 1500.0), 6),
                "history_mu_start_2025": round(history_bundle["history_mu_start_2025"].get(school_key, 1500.0), 6),
                "history_mu_end_2025": round(history_bundle["history_mu_end_2025"].get(school_key, 1500.0), 6),
                "history_mu_start_2026_rmul": round(history_bundle["history_mu_start_2026_rmul"].get(school_key, 1500.0), 6),
                "history_mu_end_2026_rmul": round(history_bundle["history_mu_end_2026_rmul"].get(school_key, 1500.0), 6),
                "recent_form_mu_start_2025": round(recent_form_bundle["recent_form_mu_start_2025_calibrated"].get(school_key, 1500.0), 6),
                "recent_form_mu_end_2025": round(recent_form_bundle["recent_form_mu_end_2025_calibrated"].get(school_key, 1500.0), 6),
                "recent_form_mu_start_2026_rmul": round(
                    recent_form_bundle["recent_form_mu_start_2026_rmul_calibrated"].get(school_key, 1500.0),
                    6,
                ),
                "recent_form_mu_end_2026_rmul": round(
                    recent_form_bundle["recent_form_mu_end_2026_rmul_calibrated"].get(school_key, 1500.0),
                    6,
                ),
                "coverage_2025": round(history_bundle["coverage_2025"].get(school_key, 0.0), 6),
                "effective_scale_2024": round(history_bundle["effective_scale_2024"].get(school_key, 0.0), 6),
                "effective_rho_2024_to_2025": round(history_bundle["effective_rho_2024_to_2025"].get(school_key, 0.0), 6),
                "effective_rho_2025_to_2026": round(history_bundle["effective_rho_2025_to_2026"].get(school_key, 0.0), 6),
                "group_summary_2024_damped_component": round(
                    history_bundle["group_summary_2024_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "evidence_mu": round(long_term_mu, 6),
                "evidence_weight": round(history_weight, 6),
                "disagreement_mu": round(disagreement_mu, 6),
                "rating_model_version": RATING_MODEL_VERSION,
                "mu0": round(mu0, 6),
                "sigma0": round(sigma0, 6),
            }
        )
        source_feature_rows.append(
            {
                "team_key": team.team_key,
                "school_key": school_key,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "shape_rank": team.shape_rank,
                "shape_prior_component": round(shape_feature[team.team_key], 6),
                "rank_score_2024_component": round(rank_score_2024.get(school_key, 0.0), 6),
                "rank_score_2024_damped_component": round(
                    history_bundle["rank_score_2024_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "rank_score_2025_component": round(rank_score_2025.get(school_key, 0.0), 6),
                "rank_score_2025_damped_component": round(
                    history_bundle["rank_score_2025_damped_component"].get(school_key, 0.0),
                    6,
                ),
                "group_summary_2024_component": round(group_summary_2024.get(school_key, 0.0), 6),
                "group_summary_2024_damped_component": round(group_summary_2024_damped.get(school_key, 0.0), 6),
                "group_summary_2025_component": round(group_summary_2025.get(school_key, 0.0), 6),
                "robot_summary_2025_component": round(robot_summary_2025.get(school_key, 0.0), 6),
                "ranking_1884_component": round(ranking_1884.get(school_key, 0.0), 6),
                "recent_2025_form_prior_component": round(recent_2025_form_prior.get(school_key, 0.0), 6),
                "season_prior_2024": round(prior_components["2024"].get(school_key, 0.0), 6),
                "season_prior_2025": round(prior_components["2025"].get(school_key, 0.0), 6),
                "season_prior_2026_rmul": round(prior_components["2026RMUL"].get(school_key, 0.0), 6),
                "long_term_mu": round(long_term_mu, 6),
                "history_mu": round(long_term_mu, 6),
                "history_weight": round(history_weight, 6),
                "recent_form_mu": round(recent_form_mu, 6),
                "recent_form_mu_calibrated": round(recent_form_mu, 6),
                "recent_anchor_mu": round(recent_components["recent_anchor_mu"], 6),
                "recent_momentum": round(recent_components["recent_momentum"], 6),
                "recent_level_gap": round(recent_components["recent_level_gap"], 6),
                "level_adjustment": round(recent_components["level_adjustment"], 6),
                "momentum_adjustment": round(recent_components["momentum_adjustment"], 6),
                "shape_adjustment": round(shape_adjustment, 6),
                "level_weight": round(recent_components["level_weight"], 6),
                "momentum_weight": round(recent_components["momentum_weight"], 6),
                "recent_weight": round(recent_components["momentum_weight"], 6),
                "recent_reliability": round(recent_components["recent_reliability"], 6),
                "recent_adjustment": round(recent_adjustment, 6),
                "peer_match_count": peer_match_count,
                "peer_consistency_adjustment": round(peer_consistency_adjustment, 6),
                "new_school_compensation": round(new_school_compensation, 6),
                "old_history_decay": round(old_history_decay, 6),
                "recent_gap": round(recent_gap, 6),
                "level_gap": round(level_gap, 6),
                "coverage_2025": round(history_bundle["coverage_2025"].get(school_key, 0.0), 6),
                "effective_scale_2024": round(history_bundle["effective_scale_2024"].get(school_key, 0.0), 6),
                "effective_rho_2024_to_2025": round(history_bundle["effective_rho_2024_to_2025"].get(school_key, 0.0), 6),
                "effective_rho_2025_to_2026": round(history_bundle["effective_rho_2025_to_2026"].get(school_key, 0.0), 6),
                "mu0": round(mu0, 6),
            }
        )
        if robot_detail:
            robot_feature_rows.append(
                {
                    "school_key": school_key,
                    "college_name": team.college_name,
                    "team_name": team.team_name,
                    "robot_stage_count": robot_detail["robot_stage_count"],
                    "robot_stage_reliability": round(robot_detail["robot_stage_reliability"], 6),
                    "robot_stage_families": robot_detail["robot_stage_families"],
                    "z_robot25_raw_unshrunk": round(robot_detail["robot_raw_score_unshrunk"], 6),
                    "robot_raw_score": round(robot_detail["robot_raw_score"], 6),
                    "z_robot25_raw": round(robot_detail["z_robot25_raw"], 6),
                    "robot_infantry_score": round(robot_detail["robot_infantry_score"], 6),
                    "robot_hero_score": round(robot_detail["robot_hero_score"], 6),
                    "robot_guard_score": round(robot_detail["robot_guard_score"], 6),
                    "robot_airplane_score": round(robot_detail["robot_airplane_score"], 6),
                    "robot_sapper_score": round(robot_detail["robot_sapper_score"], 6),
                    "robot_dart_score": round(robot_detail["robot_dart_score"], 6),
                    "robot_radar_score": round(robot_detail["robot_radar_score"], 6),
                }
            )
    rmul_series_count = len(matches_2026_rmul)
    rmul_microgame_count = sum(match.completed_games for match in matches_2026_rmul)
    diagnostics = {
        RATING_MODEL_VERSION: {
            "rating_model_version": RATING_MODEL_VERSION,
            "history_source": "data/extracted",
            "entity_level": "school",
            "score_model": "rmuc_match_share_rmul_per_game",
            "shape_rank_policy": "final_96_output_only",
            "ranking_1884_policy": "2026_rmul_start_prior_weak_only",
            "recent_form_policy": "calibrated_recent_level_plus_momentum_with_peer_consistency",
            "excluded_current_2026_priors": ["seed_rank_in_region", "seed_tier"],
            "head_to_head_policy": "disabled_by_default",
            "prior_component_weights": SEASON_START_PRIOR_WEIGHTS,
        "shape_prior_scale": SCHOOL_SHAPE_PRIOR_SCALE,
        "shape_recent_reliability_suppression": SHAPE_RECENT_RELIABILITY_SUPPRESSION,
        "shape_tail_penalty": {
            "tail_start_rank": SHAPE_TAIL_PENALTY_START,
            "tail_scale": SHAPE_TAIL_PENALTY_SCALE,
            "tail_exponent": SHAPE_TAIL_PENALTY_EXPONENT,
            "failed_start_rank": SHAPE_FAIL_PENALTY_START,
            "failed_scale": SHAPE_FAIL_PENALTY_SCALE,
            "failed_exponent": SHAPE_FAIL_PENALTY_EXPONENT,
            "negative_caps": {
                "default": SHAPE_ADJUSTMENT_CAP,
                "tail": SHAPE_ADJUSTMENT_TAIL_NEGATIVE_CAP,
                "failed": SHAPE_ADJUSTMENT_FAIL_NEGATIVE_CAP,
                "high_reliability_default": SHAPE_ADJUSTMENT_HIGH_RELIABILITY_CAP,
                "high_reliability_tail": SHAPE_ADJUSTMENT_HIGH_RELIABILITY_TAIL_NEGATIVE_CAP,
                "high_reliability_failed": SHAPE_ADJUSTMENT_HIGH_RELIABILITY_FAIL_NEGATIVE_CAP,
            },
        },
        "recent_form_config": {
                "prior_scale_2025": RECENT_PRIOR_SCALE_2025,
                "prior_scale_2026": RECENT_PRIOR_SCALE_2026,
                "rho_2025_to_2026": RECENT_RHO_2025_TO_2026,
                "coverage_offset_2025": RECENT_COVERAGE_OFFSET,
                "stage_weights": RECENT_STAGE_WEIGHTS,
                "recent_form_stretch": RECENT_FORM_STRETCH,
                "calibration": recent_form_bundle["calibration"],
                "level_weight_base": LEVEL_WEIGHT_BASE,
                "level_weight_reliability_multiplier": LEVEL_WEIGHT_RELIABILITY_MULTIPLIER,
                "momentum_weight_base": MOMENTUM_WEIGHT_BASE,
                "momentum_weight_reliability_multiplier": MOMENTUM_WEIGHT_RELIABILITY_MULTIPLIER,
                "momentum_weight_new_school_floor": MOMENTUM_WEIGHT_NEW_SCHOOL_FLOOR,
                "recent_match_equivalent_2026": RECENT_MATCH_EQUIVALENT_2026,
                "recent_reliability_offset": RECENT_RELIABILITY_OFFSET,
                "recent_momentum_min": RECENT_MOMENTUM_MIN,
                "recent_momentum_max": RECENT_MOMENTUM_MAX,
                "recent_level_gap_min": RECENT_LEVEL_GAP_MIN,
                "recent_level_gap_max": RECENT_LEVEL_GAP_MAX,
                "recent_momentum_sigma_divisor": RECENT_MOMENTUM_SIGMA_DIVISOR,
                "recent_momentum_sigma_cap": RECENT_MOMENTUM_SIGMA_CAP,
                "recent_level_sigma_divisor": RECENT_LEVEL_SIGMA_DIVISOR,
                "recent_level_sigma_cap": RECENT_LEVEL_SIGMA_CAP,
                "peer_stage_weights": PEER_STAGE_WEIGHTS,
                "peer_adjustment_scale": PEER_ADJUSTMENT_SCALE,
                "peer_adjustment_cap": PEER_ADJUSTMENT_CAP,
                "peer_reliability_offset": PEER_RELIABILITY_OFFSET,
                "rmul_update_granularity": "per_game",
                "rmul_k_budget_policy": "match_budget_preserved",
                "rmul_order_policy": "average_all_legal_sequences",
                "rmul_per_game_update_mode": "order_averaged_sequential",
                "rmul_microgame_count": rmul_microgame_count,
                "rmul_series_count": rmul_series_count,
                "rmul_avg_games_per_match": round((rmul_microgame_count / rmul_series_count), 6) if rmul_series_count else 0.0,
            },
            "balance_adjustments": {
                "new_school_compensation_base": NEW_SCHOOL_COMPENSATION_BASE,
                "new_school_compensation_recent_multiplier": NEW_SCHOOL_COMPENSATION_RECENT_MULTIPLIER,
                "new_school_compensation_peer_multiplier": NEW_SCHOOL_COMPENSATION_PEER_MULTIPLIER,
                "new_school_compensation_level_multiplier": NEW_SCHOOL_COMPENSATION_LEVEL_MULTIPLIER,
                "new_school_compensation_cap": NEW_SCHOOL_COMPENSATION_CAP,
                "old_history_decay_multiplier": OLD_HISTORY_DECAY_MULTIPLIER,
                "old_history_decay_match_offset": OLD_HISTORY_DECAY_MATCH_OFFSET,
                "old_history_decay_cap": OLD_HISTORY_DECAY_CAP,
                "old_history_decay_min_current_matches": OLD_HISTORY_DECAY_MIN_CURRENT_MATCHES,
            },
            "history_match_equivalents": {
                "2024RMUC": HISTORY_2024_MATCH_EQUIVALENT,
                "2025RMUC": HISTORY_2025_MATCH_EQUIVALENT,
                "2026RMUL": HISTORY_2026_RMUL_MATCH_EQUIVALENT,
            },
            "history_retention_damping": {
                "rho_2024_to_2025_damping": SEASON_2024_TO_2025_RETENTION_DAMPING,
            },
            "season_2024_prior_scale_damping": SEASON_2024_PRIOR_SCALE_DAMPING,
            "group_summary_2024_damping": GROUP_SUMMARY_2024_DAMPING,
            "rank_score_damping": {
                "2024": RANK_SCORE_2024_DAMPING,
                "2025": RANK_SCORE_2025_DAMPING,
            },
            "history_weight_offset": HISTORY_WEIGHT_OFFSET,
            "sigma_bounds": [PRESEASON_SIGMA_FLOOR, PRESEASON_SIGMA_CEILING],
            "global_school_pool_size": school_history_audit["global_school_pool_size"],
            "history_match_total": school_history_audit["history_match_total"],
            "history_match_totals_by_event": school_history_audit["history_match_totals_by_event"],
            "history_school_counts_by_event": school_history_audit["history_school_counts_by_event"],
            "alias_merge_count": school_history_audit["alias_merge_count"],
            "alias_merged_schools": school_history_audit["alias_merged_schools"],
            "multi_team_name_schools": school_history_audit["multi_team_name_schools"],
            "feature_coverage": {
                "rank_score_2024": rank_score_2024_diagnostics["covered_schools"],
                "rank_score_2025": rank_score_2025_diagnostics["covered_schools"],
                "group_summary_2024": group_summary_2024_diagnostics["covered_schools"],
                "group_summary_2025": group_summary_2025_diagnostics["covered_schools"],
                "robot_summary_2025": robot_2025_diagnostics["covered_schools"],
                "ranking_1884": ranking_1884_diagnostics["covered_schools"],
                "recent_2025_form_prior": recent_2025_form_diagnostics["covered_schools"],
                "shape_rank_current_96": len(shape_feature),
            },
            "ignored_sources": ["data/extracted/2026RMUL/robot_data.csv"],
            "ignored_current_features": ["seed_rank_in_region", "seed_tier"],
            "selected_config": history_bundle["tuning"]["selected_config"],
            "top_tuning_candidates": history_bundle["tuning"]["top_candidates"],
        },
        "leakage_checks": {
            "ranking_1884_only_in_2026_rmul_start_prior": True,
            "shape_rank_only_in_final_output_prior": True,
            "seed_rank_in_region_used_in_model": False,
            "seed_tier_used_in_model": False,
            "group_rank_used_as_same_season_posterior": False,
            "rank_score_used_as_same_season_posterior": False,
        },
        "feature_diagnostics": {
            "rank_score_2024": rank_score_2024_diagnostics,
            "rank_score_2025": rank_score_2025_diagnostics,
            "group_summary_2024": group_summary_2024_diagnostics,
            "group_summary_2025": group_summary_2025_diagnostics,
            "robot_summary_2025": robot_2025_diagnostics,
            "ranking_1884": ranking_1884_diagnostics,
            "recent_2025_form_prior": recent_2025_form_diagnostics,
            "excluded_sources": ["2026RMUL robot_data.csv"],
            "removed_features": ["seed_rank_in_region", "seed_tier"],
        },
    }
    return (
        preseason_rows,
        source_feature_rows,
        robot_feature_rows,
        global_school_rows,
        diagnostics,
        history_bundle["tuning"],
    )


def build_legacy_empirical_bayes_initial_ratings(team_master: list[TeamMasterRow]) -> dict[str, float]:
    universe = [team.team_key for team in team_master]
    matches_2025 = build_match_records(ROOT / "data" / "cleaned" / "2025RMUC" / "matches.csv", "2025RMUC")
    matches_2026_rmul = build_match_records(ROOT / "data" / "cleaned" / "2026RMUL" / "matches.csv", "2026RMUL")
    rmuc_2025_anchor_strength, _ = compute_rmuc_2025_anchor_strength(matches_2025)
    rmuc_2025_anchor_mu = recenter_rating_map(rmuc_2025_anchor_strength, target_mean=1500.0)
    rmul_2026_raw_ratings = simple_source_elo(matches_2026_rmul, RMUL_PRIOR_K)
    _, _, robot_team_details = build_robot_feature(universe)
    prior_mu, _, _ = build_empirical_bayes_prior(
        team_master,
        robot_team_details,
        prior_weights=LEGACY_EMPIRICAL_BAYES_PRIOR_WEIGHTS,
        prior_mu_scale=LEGACY_PRIOR_MU_SCALE,
    )
    _, _, rmul_reliability, match_counts_2026_rmul, _ = build_rmul_recent_reference_feature(universe, matches_2026_rmul)
    match_counts_2025 = build_match_count_map(matches_2025)
    legacy_mu: dict[str, float] = {}
    for key in universe:
        evidence_mu = rmuc_2025_anchor_mu.get(key, 1500.0) + (
            LEGACY_RMUL_EVIDENCE_BLEND * rmul_reliability.get(key, 0.0) * (rmul_2026_raw_ratings.get(key, 1500.0) - 1500.0)
        )
        n_eff = match_counts_2025.get(key, 0) + (LEGACY_RMUL_MATCH_EQUIVALENT * match_counts_2026_rmul.get(key, 0))
        evidence_weight = n_eff / (n_eff + LEGACY_EVIDENCE_WEIGHT_OFFSET) if n_eff > 0.0 else 0.0
        posterior_mu = (prior_mu[key] * (1.0 - evidence_weight)) + (evidence_mu * evidence_weight)
        legacy_mu[key] = max(
            1500.0 + (LEGACY_POSTERIOR_MU_STRETCH * (posterior_mu - 1500.0)),
            LEGACY_PRESEASON_MU_FLOOR,
        )
    return legacy_mu


def build_baseline_history_chain_initial_ratings(team_master: list[TeamMasterRow]) -> dict[str, float]:
    universe = [team.team_key for team in team_master]
    matches_2024 = build_match_records(ROOT / "data" / "cleaned" / "2024RMUC" / "matches.csv", "2024RMUC")
    matches_2025 = build_match_records(ROOT / "data" / "cleaned" / "2025RMUC" / "matches.csv", "2025RMUC")
    matches_2026_rmul = build_match_records(ROOT / "data" / "cleaned" / "2026RMUL" / "matches.csv", "2026RMUL")
    _, _, robot_team_details = build_robot_feature(universe)
    prior_mu, _, _ = build_empirical_bayes_prior(
        team_master,
        robot_team_details,
        prior_weights=EMPIRICAL_BAYES_PRIOR_WEIGHTS,
        prior_mu_scale=BASELINE_HISTORY_PRIOR_MU_SCALE,
    )
    history_bundle = build_history_mu(
        universe,
        matches_2024,
        matches_2025,
        matches_2026_rmul,
        entity_level="team",
        model_prefix="baseline_history_chain",
    )
    baseline_mu: dict[str, float] = {}
    for key in universe:
        n_eff = (
            HISTORY_2024_MATCH_EQUIVALENT * history_bundle["n_matches_2024_rmuc"].get(key, 0)
            + HISTORY_2025_MATCH_EQUIVALENT * history_bundle["n_matches_2025_rmuc"].get(key, 0)
            + HISTORY_2026_RMUL_MATCH_EQUIVALENT * history_bundle["n_matches_2026_rmul"].get(key, 0)
        )
        history_weight = n_eff / (n_eff + BASELINE_HISTORY_WEIGHT_OFFSET) if n_eff > 0.0 else 0.0
        baseline_mu[key] = (prior_mu[key] * (1.0 - history_weight)) + (history_bundle["history_mu"][key] * history_weight)
    return baseline_mu


def build_outputs() -> dict[str, Any]:
    prune_legacy_participants_column(ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv")
    team_master = build_team_master()
    (
        preseason_rows,
        source_feature_rows,
        robot_feature_rows,
        global_school_rows,
        diagnostics,
        tuning_bundle,
    ) = compute_preseason_vnext(team_master)
    ranking_current_rows = build_ranking_current_rows(preseason_rows)

    team_master_rows = [
        {
            "team_key": team.team_key,
            "school_key": make_school_key(team.college_name),
            "college_name": team.college_name,
            "team_name": team.team_name,
            "shape_rank": team.shape_rank,
            "preferred_region": team.preferred_region,
            "admitted_region": team.admitted_region,
            "seed_rank_in_region": team.seed_rank_in_region or "",
            "seed_tier": team.seed_tier,
            "ranking_source": team.ranking_source,
            "ranking_global_rank": team.ranking_global_rank or "",
            "ranking_score": team.ranking_score or "",
        }
        for team in team_master
    ]
    predictions = tuning_bundle["predictions_2025"] + tuning_bundle["predictions_2026"]
    eval_rmuc_2025 = tuning_bundle["evaluation_2025"]
    eval_rmul_2026 = tuning_bundle["evaluation_2026"]

    evaluation_summary = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "data_coverage": {
            "team_master_rows": len(team_master_rows),
            "global_school_rows": len(global_school_rows),
            "source_features_rows": len(source_feature_rows),
            "preseason_rows": len(preseason_rows),
            "extracted_rmuc_2024_matches": diagnostics[RATING_MODEL_VERSION]["history_match_totals_by_event"]["2024RMUC"],
            "extracted_rmuc_2025_matches": diagnostics[RATING_MODEL_VERSION]["history_match_totals_by_event"]["2025RMUC"],
            "extracted_rmul_2026_matches": diagnostics[RATING_MODEL_VERSION]["history_match_totals_by_event"]["2026RMUL"],
            "extracted_history_matches_total": diagnostics[RATING_MODEL_VERSION]["history_match_total"],
        },
        "feature_diagnostics": diagnostics["feature_diagnostics"],
        "leakage_checks": diagnostics["leakage_checks"],
        RATING_MODEL_VERSION: diagnostics[RATING_MODEL_VERSION],
        "evaluations": {
            f"rmuc_2025_{RATING_MODEL_VERSION}": eval_rmuc_2025,
            f"rmul_2026_{RATING_MODEL_VERSION}": eval_rmul_2026,
            f"rmuc_2025_{PREVIOUS_DYNAMIC_SCHOOL_VERSION}_reference": PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmuc_2025"],
            f"rmul_2026_{PREVIOUS_DYNAMIC_SCHOOL_VERSION}_reference": PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmul_2026"],
            f"rmul_2026_{PREVIOUS_EXTRACTED_SCHOOL_VERSION}_reference": LEGACY_EXTRACTED_SCHOOL_REFERENCE_METRICS,
        },
        "tuning": tuning_bundle["selected_config"],
        "tuning_candidates": diagnostics[RATING_MODEL_VERSION]["top_tuning_candidates"],
        "ablation": {
            "rmuc_2025_delta_log_loss_vs_previous_dynamic": round(
                PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmuc_2025"]["log_loss"] - eval_rmuc_2025["log_loss"],
                6,
            ),
            "rmuc_2025_delta_brier_vs_previous_dynamic": round(
                PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmuc_2025"]["brier"] - eval_rmuc_2025["brier"],
                6,
            ),
            "rmuc_2025_delta_accuracy_vs_previous_dynamic": round(
                eval_rmuc_2025["accuracy"] - PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmuc_2025"]["accuracy"],
                6,
            ),
            "rmul_2026_delta_log_loss_vs_previous_dynamic": round(
                PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmul_2026"]["log_loss"] - eval_rmul_2026["log_loss"],
                6,
            ),
            "rmul_2026_delta_brier_vs_previous_dynamic": round(
                PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmul_2026"]["brier"] - eval_rmul_2026["brier"],
                6,
            ),
            "rmul_2026_delta_accuracy_vs_previous_dynamic": round(
                eval_rmul_2026["accuracy"] - PREVIOUS_DYNAMIC_REFERENCE_METRICS["rmul_2026"]["accuracy"],
                6,
            ),
            "rmul_2026_delta_log_loss_vs_previous_reference": round(
                LEGACY_EXTRACTED_SCHOOL_REFERENCE_METRICS["log_loss"] - eval_rmul_2026["log_loss"],
                6,
            ),
            "rmul_2026_delta_brier_vs_previous_reference": round(
                LEGACY_EXTRACTED_SCHOOL_REFERENCE_METRICS["brier"] - eval_rmul_2026["brier"],
                6,
            ),
            "rmul_2026_delta_accuracy_vs_previous_reference": round(
                eval_rmul_2026["accuracy"] - LEGACY_EXTRACTED_SCHOOL_REFERENCE_METRICS["accuracy"],
                6,
            ),
        },
    }

    return {
        "team_master_rows": team_master_rows,
        "global_school_rows": global_school_rows,
        "source_feature_rows": source_feature_rows,
        "robot_feature_rows": robot_feature_rows,
        "preseason_rows": preseason_rows,
        "ranking_current_rows": ranking_current_rows,
        "predictions": predictions,
        "evaluation_summary": evaluation_summary,
    }


def write_outputs(outputs: dict[str, Any]) -> None:
    write_csv(
        DERIVED_DIR / "team_master.csv",
        outputs["team_master_rows"],
        list(outputs["team_master_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "source_features.csv",
        outputs["source_feature_rows"],
        list(outputs["source_feature_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "robot_feature_diagnostics.csv",
        outputs["robot_feature_rows"],
        list(outputs["robot_feature_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "preseason_ratings.csv",
        outputs["preseason_rows"],
        list(outputs["preseason_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "global_school_elo.csv",
        outputs["global_school_rows"],
        list(outputs["global_school_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "ranking_current_96.csv",
        outputs["ranking_current_rows"],
        list(outputs["ranking_current_rows"][0].keys()),
    )
    write_csv(
        DERIVED_DIR / "walk_forward_predictions.csv",
        outputs["predictions"],
        list(outputs["predictions"][0].keys()),
    )
    write_json(DERIVED_DIR / "evaluation_summary.json", outputs["evaluation_summary"])
    for obsolete_name in ["robot_raw_ranking.csv", "robot_tilde_ranking.csv", "robot_bias_analysis.csv"]:
        obsolete_path = DERIVED_DIR / obsolete_name
        if obsolete_path.exists():
            obsolete_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 2026 RMUC stage-aware Elo priors and diagnostics.")
    parser.add_argument("--no-write", action="store_true", help="Compute outputs without writing derived files.")
    args = parser.parse_args()

    outputs = build_outputs()
    if not args.no_write:
        write_outputs(outputs)
    print(
        json.dumps(
            {
                "team_master_rows": len(outputs["team_master_rows"]),
                "global_school_rows": len(outputs["global_school_rows"]),
                "preseason_rows": len(outputs["preseason_rows"]),
                "prediction_rows": len(outputs["predictions"]),
                "derived_dir": str(DERIVED_DIR),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
