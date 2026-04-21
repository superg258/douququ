from __future__ import annotations

from statistics import NormalDist
from pathlib import Path
from typing import Any

import numpy as np

from .history_sources import RegionalPreModelConfig
from .ingest import ROOT, canonicalize_school, read_dataset, require_dataframe_deps, school_key


CONFLICT_ABS_THRESHOLD = 0.25
REGIONAL_STAGE_IDS = {"rmuc_regional_group", "rmuc_regional_knockout"}
REGIONAL_OUTCOME_RANK_WEIGHT = 0.70
REGIONAL_OUTCOME_STRENGTH_WEIGHT = 0.30
FEATURE_COLUMNS = [
    "shape_prior_signal",
    "rmul_ranking_signal",
    "rmul_station_strength_mean",
    "rmul_station_strength_top4",
    "rmul_relative_finish",
    "shape_pos",
    "shape_neg",
    "rmul_pos",
    "rmul_neg",
    "shape_missing_flag",
    "rmul_missing_flag",
]


def _safe_standardize(series: Any) -> Any:
    valid = series.dropna()
    if valid.empty:
        return series.fillna(0.0).astype(float)
    mean = float(valid.mean())
    std = float(valid.std(ddof=0))
    if std <= 1e-9:
        return (series.fillna(mean) - mean).astype(float)
    return ((series.fillna(mean) - mean) / std).astype(float)


def _load_rank_score_map_for_season(season: int) -> dict[str, float]:
    pd, _ = require_dataframe_deps()
    if int(season) == 2026:
        path = ROOT / "data" / "reference" / "2026_regionals" / "ranking_1884.csv"
        if not path.exists():
            return {}
        frame = pd.read_csv(path)
        return {
            school_key(canonicalize_school(str(row["college_name"]))): float(row["score"])
            for row in frame.to_dict(orient="records")
        }
    path = ROOT / "data" / "extracted" / f"{season}RMUC" / "rank_score.csv"
    if not path.exists():
        return {}
    frame = pd.read_csv(path)
    return {
        school_key(canonicalize_school(str(row["school_chinese"]))): float(row["score"])
        for row in frame.to_dict(orient="records")
    }


def _load_lagged_station_score_map_for_season(
    season: int,
    base_snapshot: Any | None = None,
) -> tuple[dict[str, float], str]:
    pd, _ = require_dataframe_deps()
    if int(season) >= 2026 and base_snapshot is not None:
        frame = pd.DataFrame(base_snapshot).copy()
        if not frame.empty and {"school_key", "rmuc_long_term_base_theta_mean"}.issubset(frame.columns):
            score_map = {
                str(row["school_key"]): float(row["rmuc_long_term_base_theta_mean"])
                for row in frame[["school_key", "rmuc_long_term_base_theta_mean"]].to_dict(orient="records")
            }
            return score_map, "lagged_rmuc_program_base"
    if int(season) == 2025:
        score_map = _load_rank_score_map_for_season(2024)
        if score_map:
            return score_map, "lagged_2024_rank_score"
    return {}, "missing_lagged_prior"


def _build_rmul_station_members_for_season(rmul_history: Any, season: int) -> dict[str, list[str]]:
    pd, _ = require_dataframe_deps()
    if int(season) == 2026:
        teams_path = ROOT / "data" / "cleaned" / "2026RMUL" / "teams.csv"
        if teams_path.exists():
            teams = pd.read_csv(teams_path)
            station_members: dict[str, list[str]] = {}
            for station_name, station_frame in teams.groupby("zone_name", sort=False):
                school_keys = sorted(
                    {
                        school_key(canonicalize_school(str(value)))
                        for value in station_frame["college_name"].dropna().astype(str).tolist()
                    }
                )
                station_members[str(station_name)] = school_keys
            if station_members:
                return station_members
    frame = rmul_history[rmul_history["season"] == season].copy()
    if frame.empty:
        return {}
    members: dict[str, list[str]] = {}
    for station_name, station_frame in frame.groupby("station_name", sort=False):
        school_keys = sorted({str(value) for value in station_frame["school_key"].dropna().astype(str).tolist()})
        members[str(station_name)] = school_keys
    return members


def _build_rmul_station_strength_summary(
    station_members: dict[str, list[str]],
    rank_score_map: dict[str, float],
) -> dict[str, dict[str, float]]:
    summary: dict[str, dict[str, float]] = {}
    for station_name, members in station_members.items():
        scores = [float(rank_score_map.get(str(member), 0.0)) for member in members]
        if scores:
            sorted_scores = sorted(scores, reverse=True)
            mean_score = float(np.mean(scores))
            top4_mean = float(np.mean(sorted_scores[: min(4, len(sorted_scores))]))
            score_std = float(np.std(scores, ddof=0))
            depth = int(len(scores))
        else:
            mean_score = 0.0
            top4_mean = 0.0
            score_std = 0.0
            depth = 0
        summary[str(station_name)] = {
            "rmul_station_score_mean_raw": mean_score,
            "rmul_station_score_top4_mean_raw": top4_mean,
            "rmul_station_score_std_raw": score_std,
            "rmul_station_score_depth": depth,
        }
    return summary


def _rank_to_z(rank: int, total: int) -> float:
    q = 1.0 - ((rank - 0.5) / total)
    q = min(max(q, 1e-4), 1.0 - 1e-4)
    return float(NormalDist().inv_cdf(q))


def _shape_bucket_widths(total: int, bucket_count: int = 8) -> list[int]:
    total = max(int(total), 1)
    bucket_count = max(1, min(int(bucket_count), total))
    weights = np.arange(bucket_count, 0, -1, dtype=float)
    raw_widths = (weights / weights.sum()) * float(total)
    widths = np.floor(raw_widths).astype(int)
    widths = np.maximum(widths, 1)
    overflow = int(widths.sum() - total)
    if overflow > 0:
        for idx in range(bucket_count - 1, -1, -1):
            while overflow > 0 and widths[idx] > 1:
                widths[idx] -= 1
                overflow -= 1
    elif overflow < 0:
        fractional = raw_widths - np.floor(raw_widths)
        order = np.argsort(-fractional, kind="stable")
        deficit = -overflow
        for idx in order:
            if deficit <= 0:
                break
            widths[idx] += 1
            deficit -= 1
    return [int(value) for value in widths.tolist()]


def _shape_construct_score(rank: int, total: int) -> float:
    total = max(int(total), 1)
    rank = min(max(int(rank), 1), total)
    widths = _shape_bucket_widths(total)
    bucket_drop_steps = np.array([0.18, 0.24, 0.32, 0.44, 0.62, 0.86, 1.18, 1.62], dtype=float)
    if len(widths) != len(bucket_drop_steps):
        x = np.linspace(0.0, 1.0, len(widths))
        bucket_drop_steps = 0.18 + (1.44 * np.square(x))
    bucket_index = 0
    start_rank = 1
    for idx, width in enumerate(widths):
        end_rank = start_rank + width - 1
        if rank <= end_rank:
            bucket_index = idx
            break
        start_rank = end_rank + 1
    local_width = widths[bucket_index]
    local_rank = rank - start_rank
    local_fraction = (local_rank + 0.5) / max(local_width, 1)
    base_score = 3.0 - float(bucket_drop_steps[:bucket_index].sum())
    local_penalty = float(bucket_drop_steps[bucket_index]) * float(local_fraction)
    return float(base_score - local_penalty)


def _logit(value: float) -> float:
    clipped = min(max(float(value), 1e-4), 1.0 - 1e-4)
    return float(np.log(clipped / (1.0 - clipped)))


def _shrunk_residual_delta_theta(
    actual_wins: float,
    expected_wins: float,
    match_count: int,
    beta_perf: float,
    prior_weight: float,
) -> float:
    n = max(int(match_count), 1)
    expected_rate = float(expected_wins) / float(n)
    shrunk_rate = (float(actual_wins) + (float(prior_weight) * expected_rate)) / float(n + float(prior_weight))
    return max(float(beta_perf), 1e-6) * (_logit(shrunk_rate) - _logit(expected_rate))


def _shrunk_strength_theta(
    actual_wins: float,
    match_count: int,
    beta_perf: float,
    prior_weight: float,
    prior_rate: float = 0.5,
) -> float:
    n = max(int(match_count), 1)
    shrunk_rate = (float(actual_wins) + (float(prior_weight) * float(prior_rate))) / float(n + float(prior_weight))
    return max(float(beta_perf), 1e-6) * (_logit(shrunk_rate) - _logit(float(prior_rate)))


def _compute_rank_z(series: Any, ascending: bool = False) -> Any:
    ranks = series.rank(method="average", ascending=ascending)
    total = int(len(series))
    return ranks.map(lambda value: _rank_to_z(int(round(float(value))), total))


def _augment_same_year_rank_targets(
    training_frame: Any,
    rank_shift_scale: float,
    strength_scale: float,
) -> Any:
    frame = training_frame.copy()
    if frame.empty:
        return frame
    frame["base_rank_z"] = _compute_rank_z(frame["base_anchor_theta"], ascending=False)
    frame["regional_observed_rank_z"] = _compute_rank_z(frame["regional_observed_strength_theta"], ascending=False)
    if "regional_outcome_rank_z" in frame.columns:
        target_rank_z = frame["regional_outcome_rank_z"].astype(float)
    else:
        target_rank_z = frame["regional_observed_rank_z"].astype(float)
        frame["regional_outcome_rank_z"] = target_rank_z
    rank_scale = float(frame["regional_observed_strength_theta"].std(ddof=0)) / max(float(target_rank_z.std(ddof=0)), 1e-6)
    rank_scale = max(rank_scale, 1e-6)
    target_center_theta = float(frame["base_anchor_theta"].mean())
    frame["regional_outcome_strength_theta"] = frame.apply(
        lambda row: _compute_regional_outcome_strength_theta(
            regional_outcome_rank_z=float(row["regional_outcome_rank_z"]),
            regional_observed_strength_theta=float(row["regional_observed_strength_theta"]),
            rank_to_theta_scale=rank_scale,
            target_center_theta=target_center_theta,
        ),
        axis=1,
    )
    frame["regional_rank_shift_theta"] = frame["regional_outcome_strength_theta"] - frame["base_anchor_theta"]
    frame["regional_strength_adjust_theta"] = frame["regional_outcome_strength_theta"] - frame["base_anchor_theta"]
    frame["regional_prior_shift_theta"] = frame["regional_outcome_strength_theta"] - frame["base_anchor_theta"]
    frame["regional_prior_target_theta"] = frame["regional_prior_shift_theta"]
    return frame


def _compute_regional_outcome_strength_theta(
    regional_outcome_rank_z: float,
    regional_observed_strength_theta: float,
    rank_to_theta_scale: float,
    target_center_theta: float = 0.0,
) -> float:
    return float(
        float(target_center_theta)
        +
        (REGIONAL_OUTCOME_RANK_WEIGHT * (float(rank_to_theta_scale) * float(regional_outcome_rank_z)))
        + (REGIONAL_OUTCOME_STRENGTH_WEIGHT * float(regional_observed_strength_theta))
    )


def _regional_outcome_score(
    group_wins: float,
    group_matches: int,
    knockout_wins: float,
    knockout_matches: int,
) -> float:
    group_matches = max(int(group_matches), 0)
    knockout_matches = max(int(knockout_matches), 0)
    group_wins = float(group_wins)
    knockout_wins = float(knockout_wins)
    group_rate = group_wins / group_matches if group_matches > 0 else 0.0
    knockout_rate = knockout_wins / knockout_matches if knockout_matches > 0 else 0.0
    knockout_qualified = 1.0 if knockout_matches > 0 else 0.0
    return (
        group_wins
        + (0.35 * group_rate)
        + (1.00 * knockout_qualified)
        + (1.50 * knockout_wins)
        + (0.50 * knockout_rate)
    )


def _regional_group_decay_factor(match_count: int, decay_matches: int) -> float:
    capped = max(0, min(int(match_count), max(decay_matches, 1)))
    if capped >= decay_matches:
        return 0.0
    return float((decay_matches - capped) / decay_matches)


def _clip01(value: Any) -> Any:
    return np.clip(value, 0.0, 1.0)


def _weighted_mean_std(values: np.ndarray, weights: np.ndarray) -> tuple[float, float]:
    weights = np.clip(np.asarray(weights, dtype=float), 1e-6, None)
    values = np.asarray(values, dtype=float)
    mean = float(np.average(values, weights=weights))
    variance = float(np.average(np.square(values - mean), weights=weights))
    return mean, max(float(np.sqrt(max(variance, 0.0))), 1e-6)


def build_shape_evidence(feature_frame: Any, config: RegionalPreModelConfig | None = None) -> Any:
    cfg = config or RegionalPreModelConfig()
    shape_signal = feature_frame["shape_prior_signal"].astype(float).fillna(0.0)
    shape_missing = feature_frame["shape_missing_flag"].astype(float).fillna(0.0)
    shape_pos = shape_signal.clip(lower=0.0)
    shape_neg = shape_signal.clip(upper=0.0)
    return cfg.shape_evidence_scale * ((0.70 * shape_signal) + (0.20 * shape_pos) + (0.10 * shape_neg)) * (
        1.0 - (0.50 * shape_missing)
    )


def build_rmul_finish_evidence(feature_frame: Any, config: RegionalPreModelConfig | None = None) -> Any:
    cfg = config or RegionalPreModelConfig()
    rmul_signal = feature_frame["rmul_ranking_signal"].astype(float).fillna(0.0)
    rmul_missing = feature_frame["rmul_missing_flag"].astype(float).fillna(0.0)
    rmul_pos = rmul_signal.clip(lower=0.0)
    rmul_neg = rmul_signal.clip(upper=0.0)
    return cfg.rmul_finish_scale * ((0.65 * rmul_signal) + (0.25 * rmul_pos) + (0.10 * rmul_neg)) * (
        1.0 - (0.50 * rmul_missing)
    )


def apply_station_calibration(
    feature_frame: Any,
    rmul_finish_evidence: Any,
    config: RegionalPreModelConfig | None = None,
) -> Any:
    cfg = config or RegionalPreModelConfig()
    station_signal = 0.5 * (
        feature_frame["rmul_station_strength_mean"].astype(float).fillna(0.0)
        + feature_frame["rmul_station_strength_top4"].astype(float).fillna(0.0)
    )
    rmul_finish = rmul_finish_evidence.astype(float)
    rmul_missing = feature_frame["rmul_missing_flag"].astype(float).fillna(0.0)
    aligned_strength = np.sign(rmul_finish) * np.tanh(np.abs(rmul_finish))
    calibration = cfg.station_calibration_scale * station_signal * aligned_strength * (1.0 - rmul_missing)
    return calibration.astype(float)


def build_evidence_score(
    feature_frame: Any,
    config: RegionalPreModelConfig | None = None,
    model: dict[str, Any] | None = None,
) -> Any:
    pd, _ = require_dataframe_deps()
    cfg = config or RegionalPreModelConfig()
    frame = pd.DataFrame(feature_frame).copy()
    frame["shape_evidence_theta"] = build_shape_evidence(frame, cfg)
    frame["rmul_finish_evidence_theta"] = build_rmul_finish_evidence(frame, cfg)
    frame["rmul_station_calibration_theta"] = apply_station_calibration(
        frame,
        frame["rmul_finish_evidence_theta"],
        cfg,
    )
    frame["evidence_score_raw"] = (
        frame["shape_evidence_theta"]
        + frame["rmul_finish_evidence_theta"]
        + frame["rmul_station_calibration_theta"]
    )
    evidence_mean = float(model.get("evidence_raw_mean", frame["evidence_score_raw"].mean())) if model else float(
        frame["evidence_score_raw"].mean()
    )
    evidence_std = float(model.get("evidence_raw_std", frame["evidence_score_raw"].std(ddof=0))) if model else float(
        frame["evidence_score_raw"].std(ddof=0)
    )
    evidence_alignment = float(model.get("evidence_alignment", 1.0)) if model else 1.0
    evidence_std = max(evidence_std, 1e-6)
    frame["evidence_score_centered"] = evidence_alignment * (
        (frame["evidence_score_raw"] - evidence_mean) / evidence_std
    )
    return frame[
        [
            "shape_evidence_theta",
            "rmul_finish_evidence_theta",
            "rmul_station_calibration_theta",
            "evidence_score_raw",
            "evidence_score_centered",
        ]
    ]


def compute_prior_delta_cap(
    history_strength: Any,
    recent_evidence_support: Any,
    config: RegionalPreModelConfig | None = None,
) -> Any:
    cfg = config or RegionalPreModelConfig()
    history = _clip01(np.asarray(history_strength, dtype=float))
    support = _clip01(np.asarray(recent_evidence_support, dtype=float))
    novelty = np.power(1.0 - history, max(float(cfg.history_cap_curve), 1e-6))
    cap = cfg.prior_delta_cap_min + ((cfg.prior_delta_cap_max - cfg.prior_delta_cap_min) * novelty)
    cap *= 0.85 + (0.15 * support)
    return np.clip(cap, cfg.prior_delta_cap_min, cfg.prior_delta_cap_max)


def map_evidence_to_prior_delta(
    centered_evidence_score: Any,
    history_strength: Any,
    recent_evidence_support: Any,
    config: RegionalPreModelConfig | None = None,
) -> Any:
    centered = np.asarray(centered_evidence_score, dtype=float)
    caps = compute_prior_delta_cap(history_strength, recent_evidence_support, config)
    delta = caps * np.tanh(centered)
    pd, _ = require_dataframe_deps()
    return pd.Series(delta, index=getattr(centered_evidence_score, "index", None), dtype=float)


def compute_regional_pre_blend_lambda(
    history_strength: float,
    recent_evidence_support: float,
    posterior_uncertainty: float,
    prior_gap_theta: float,
    config: RegionalPreModelConfig | None = None,
) -> float:
    cfg = config or RegionalPreModelConfig()
    history_strength = min(max(float(history_strength), 0.0), 1.0)
    evidence_support = min(max(float(recent_evidence_support), 0.0), 1.0)
    uncertainty_strength = max(float(posterior_uncertainty), 0.0) / (
        max(float(posterior_uncertainty), 0.0) + max(cfg.history_uncertainty_scale, 1e-6)
    )
    novelty_strength = 1.0 - history_strength
    signal_strength = abs(float(prior_gap_theta)) / (abs(float(prior_gap_theta)) + max(cfg.blend_signal_scale, 1e-6))
    blend_strength = (
        ((1.0 - cfg.blend_uncertainty_weight) * ((0.65 * novelty_strength) + (0.35 * evidence_support)))
        + (cfg.blend_uncertainty_weight * uncertainty_strength)
    )
    blend_lambda = cfg.blend_lambda_min + ((cfg.blend_lambda_max - cfg.blend_lambda_min) * blend_strength)
    blend_lambda *= 1.0 + (cfg.deviation_lambda_boost * signal_strength)
    return float(min(max(blend_lambda, cfg.blend_lambda_min), cfg.blend_lambda_max))


def compute_regional_same_year_signal(
    shape_prior_signal: float,
    rmul_ranking_signal: float,
    consistency_signal: float,
    config: RegionalPreModelConfig | None = None,
) -> float:
    cfg = config or RegionalPreModelConfig()
    return float(
        (cfg.same_year_shape_weight * float(shape_prior_signal))
        + (cfg.same_year_rmul_weight * float(rmul_ranking_signal))
        + (cfg.same_year_consistency_weight * float(consistency_signal))
    )


def interpolate_regional_pre_theta(base_theta: float, prior_score_theta: float, blend_lambda: float) -> float:
    return float(base_theta + (blend_lambda * (prior_score_theta - base_theta)))


def compute_regional_prior_runtime_components(
    prior_theta: float,
    live_state_theta: float,
    decay_factor: float,
) -> tuple[float, float]:
    prior_theta = float(prior_theta)
    live_state_theta = float(live_state_theta)
    decay_factor = min(max(float(decay_factor), 0.0), 1.0)
    residual = prior_theta * decay_factor
    released = prior_theta - residual
    if abs(prior_theta) <= 1e-9 or abs(live_state_theta) <= 1e-9:
        return 0.0, residual
    if np.sign(prior_theta) != np.sign(live_state_theta):
        return 0.0, residual
    return released, residual


def _build_same_year_shape_signal(shape_history: Any, season: int) -> Any:
    pd, _ = require_dataframe_deps()
    frame = shape_history[shape_history["season"] == season].copy()
    if frame.empty:
        return pd.DataFrame(
            columns=[
                "school_key",
                "school_name",
                "shape_rank",
                "shape_prior_signal",
                "shape_signal_season_count",
                "shape_source_years",
                "is_rmuc_2026_team",
                "shape_missing_flag",
            ]
        )
    total = int(len(frame))
    shape_scores = frame["shape_rank"].map(lambda value: _shape_construct_score(int(value), total))
    frame["shape_prior_signal"] = _safe_standardize(shape_scores)
    frame["shape_signal_season_count"] = 1
    frame["shape_source_years"] = str(season)
    frame["is_rmuc_2026_team"] = season == 2026
    frame["shape_missing_flag"] = 0.0
    return frame[
        [
            "school_key",
            "school_name",
            "shape_rank",
            "shape_prior_signal",
            "shape_signal_season_count",
            "shape_source_years",
            "is_rmuc_2026_team",
            "shape_missing_flag",
        ]
    ].drop_duplicates(["school_key"], keep="first")


def _build_same_year_rmul_signal(
    rmul_history: Any,
    season: int,
    lagged_station_score_map: dict[str, float] | None = None,
    station_source: str | None = None,
) -> Any:
    pd, _ = require_dataframe_deps()
    frame = rmul_history[rmul_history["season"] == season].copy()
    if frame.empty:
        return pd.DataFrame(
            columns=[
                "school_key",
                "school_name",
                "rmul_ranking_signal",
                "rmul_station_strength_mean",
                "rmul_station_strength_top4",
                "rmul_station_strength_std",
                "rmul_station_strength_depth",
                "rmul_relative_finish",
                "rmul_strength_adjusted_signal",
                "rmul_station_source",
                "rmul_ranking_season_count",
                "rmul_ranking_source_years",
                "rmul_missing_flag",
            ]
        )
    rank_score_map = lagged_station_score_map if lagged_station_score_map is not None else {}
    station_members = _build_rmul_station_members_for_season(rmul_history, season)
    station_strength_summary = _build_rmul_station_strength_summary(station_members, rank_score_map)
    station_strength_frame = pd.DataFrame.from_records(
        [
            {
                "station_name": station_name,
                **values,
                "rmul_station_source": station_source or "missing_lagged_prior",
            }
            for station_name, values in station_strength_summary.items()
        ]
    )
    season_best = (
        frame.groupby(["school_key", "school_name"], as_index=False)
        .agg(placement_score=("placement_score", "max"), station_name=("station_name", "first"))
        .sort_values(["placement_score", "school_key"], ascending=[False, True], kind="stable")
        .reset_index(drop=True)
    )
    season_best = season_best.merge(station_strength_frame, on="station_name", how="left")
    season_best["rmul_ranking_signal"] = _safe_standardize(season_best["placement_score"])
    season_best["rmul_station_strength_mean"] = _safe_standardize(season_best["rmul_station_score_mean_raw"].fillna(0.0))
    season_best["rmul_station_strength_top4"] = _safe_standardize(season_best["rmul_station_score_top4_mean_raw"].fillna(0.0))
    season_best["rmul_station_strength_std"] = _safe_standardize(season_best["rmul_station_score_std_raw"].fillna(0.0))
    season_best["rmul_station_strength_depth"] = season_best["rmul_station_score_depth"].fillna(0).astype(float)
    season_best["rmul_relative_finish"] = season_best["rmul_ranking_signal"] + (
        0.5 * (season_best["rmul_station_strength_mean"] + season_best["rmul_station_strength_top4"])
    )
    season_best["rmul_strength_adjusted_signal"] = season_best["rmul_ranking_signal"] * (
        1.0 + np.clip(season_best["rmul_station_strength_top4"], -1.5, 1.5)
    )
    season_best["rmul_ranking_season_count"] = 1
    season_best["rmul_ranking_source_years"] = str(season)
    season_best["rmul_missing_flag"] = 0.0
    return season_best[
        [
            "school_key",
            "school_name",
            "rmul_ranking_signal",
            "rmul_station_strength_mean",
            "rmul_station_strength_top4",
            "rmul_station_strength_std",
            "rmul_station_strength_depth",
            "rmul_relative_finish",
            "rmul_strength_adjusted_signal",
            "rmul_station_source",
            "rmul_ranking_season_count",
            "rmul_ranking_source_years",
            "rmul_missing_flag",
        ]
    ]


def build_regional_prior_feature_matrix(feature_frame: Any) -> Any:
    frame = feature_frame.copy()
    frame["shape_pos"] = frame["shape_prior_signal"].clip(lower=0.0)
    frame["shape_neg"] = frame["shape_prior_signal"].clip(upper=0.0)
    frame["rmul_pos"] = frame["rmul_ranking_signal"].clip(lower=0.0)
    frame["rmul_neg"] = frame["rmul_ranking_signal"].clip(upper=0.0)
    for column in FEATURE_COLUMNS:
        if column not in frame.columns:
            frame[column] = 0.0
    return frame[FEATURE_COLUMNS].astype(float)


def build_same_year_feature_frame(
    dataset_dir: Path,
    season: int,
    lagged_station_score_map: dict[str, float] | None = None,
    station_source: str | None = None,
) -> Any:
    pd, _ = require_dataframe_deps()
    dataset = read_dataset(dataset_dir)
    shape_signal = _build_same_year_shape_signal(dataset["shape_history"], season)
    rmul_signal = _build_same_year_rmul_signal(
        dataset["rmul_3v3_ranking_history"],
        season,
        lagged_station_score_map=lagged_station_score_map,
        station_source=station_source,
    )
    school_frame = pd.DataFrame(
        dataset["school_static_features"][["school_key", "school_name"]]
        .drop_duplicates(["school_key"], keep="first")
    )
    frame = school_frame.merge(shape_signal, on=["school_key", "school_name"], how="left").merge(
        rmul_signal, on=["school_key", "school_name"], how="left"
    )
    frame["shape_missing_flag"] = np.where(frame["shape_prior_signal"].notna(), 0.0, 1.0)
    frame["rmul_missing_flag"] = np.where(frame["rmul_ranking_signal"].notna(), 0.0, 1.0)
    frame["shape_prior_signal"] = frame["shape_prior_signal"].fillna(0.0)
    frame["rmul_ranking_signal"] = frame["rmul_ranking_signal"].fillna(0.0)
    for column in [
        "rmul_station_strength_mean",
        "rmul_station_strength_top4",
        "rmul_station_strength_std",
        "rmul_station_strength_depth",
        "rmul_relative_finish",
        "rmul_strength_adjusted_signal",
    ]:
        frame[column] = frame[column].fillna(0.0) if column in frame.columns else 0.0
    frame["rmul_station_source"] = frame["rmul_station_source"].fillna("") if "rmul_station_source" in frame.columns else ""
    frame["shape_signal_season_count"] = frame["shape_signal_season_count"].fillna(0).astype(int)
    frame["rmul_ranking_season_count"] = frame["rmul_ranking_season_count"].fillna(0).astype(int)
    frame["shape_source_years"] = frame["shape_source_years"].fillna("")
    frame["rmul_ranking_source_years"] = frame["rmul_ranking_source_years"].fillna("")
    frame["shape_rank"] = frame["shape_rank"].astype("Int64")
    frame["is_rmuc_2026_team"] = np.where(frame["is_rmuc_2026_team"].notna(), frame["is_rmuc_2026_team"], False).astype(bool)

    agreement = np.sign(frame["shape_prior_signal"] * frame["rmul_ranking_signal"])
    overlap = np.minimum(frame["shape_prior_signal"].abs(), frame["rmul_ranking_signal"].abs())
    frame["regional_prior_consistency_feature"] = agreement * overlap
    frame["pre_signal_conflict_flag"] = (
        (frame["shape_prior_signal"] * frame["rmul_ranking_signal"] < 0.0)
        & (frame["shape_prior_signal"].abs() >= CONFLICT_ABS_THRESHOLD)
        & (frame["rmul_ranking_signal"].abs() >= CONFLICT_ABS_THRESHOLD)
    )
    return frame


def compute_history_context(
    effective_recent_match_count: float,
    latest_season_match_share: float,
    posterior_uncertainty: float,
    terminal_only_support: bool,
    shape_signal_available: bool,
    rmul_signal_available: bool,
    config: RegionalPreModelConfig | None = None,
) -> dict[str, float]:
    cfg = config or RegionalPreModelConfig()
    coverage_strength = min(max(float(effective_recent_match_count), 0.0) / max(cfg.recent_match_cap, 1e-6), 1.0)
    recent_share = min(max(float(latest_season_match_share), 0.0), 1.0)
    certainty = 1.0 / (1.0 + (max(float(posterior_uncertainty), 0.0) / max(cfg.history_uncertainty_scale, 1e-6)))
    history_strength = (0.45 * coverage_strength) + (0.35 * recent_share) + (0.20 * certainty)
    if terminal_only_support:
        history_strength *= 0.60
    recent_evidence_support = (0.5 if shape_signal_available else 0.0) + (0.5 if rmul_signal_available else 0.0)
    return {
        "rmuc_history_strength": float(history_strength),
        "recent_evidence_support": float(recent_evidence_support),
    }


def build_regional_prior_training_samples(
    dataset_dir: Path,
    season: int,
    base_snapshot: Any,
    beta_perf: float,
    config: RegionalPreModelConfig | None = None,
) -> Any:
    pd, _ = require_dataframe_deps()
    cfg = config or RegionalPreModelConfig()
    dataset = read_dataset(dataset_dir)
    canonical = dataset["canonical_matches"]
    regional_matches = canonical[
        (canonical["ruleset_id"] == "RMUC")
        & (canonical["season"] == season)
        & (canonical["stage_id"].isin(REGIONAL_STAGE_IDS))
    ].copy()
    lagged_station_score_map, station_source = _load_lagged_station_score_map_for_season(season)
    feature_frame = build_same_year_feature_frame(
        dataset_dir,
        season,
        lagged_station_score_map=lagged_station_score_map,
        station_source=station_source,
    )
    if regional_matches.empty:
        return pd.DataFrame(
            columns=[
                "season",
                "school_key",
                "school_name",
                *FEATURE_COLUMNS,
                "rmul_station_strength_std",
                "rmul_station_strength_depth",
                "regional_group_match_count",
                "regional_group_wins",
                "regional_knockout_match_count",
                "regional_knockout_wins",
                "regional_knockout_qualified",
                "regional_match_count",
                "regional_series_wins",
                "expected_series_wins",
                "regional_observed_strength_theta",
                "regional_outcome_score",
                "regional_outcome_rank_z",
                "base_rank_z",
                "regional_prior_target_rank_shift",
                "regional_outcome_strength_theta",
                "regional_prior_shift_theta",
                "regional_prior_target_theta",
                "training_weight",
            ]
        )

    base_map = base_snapshot.set_index("school_key")["rmuc_long_term_base_theta_mean"].to_dict()
    school_name_map = feature_frame.set_index("school_key")["school_name"].to_dict()
    stats: dict[str, dict[str, Any]] = {}
    for row in regional_matches.to_dict(orient="records"):
        red_key = str(row["red_school_key"])
        blue_key = str(row["blue_school_key"])
        stage_id = str(row["stage_id"])
        is_group_match = stage_id == "rmuc_regional_group"
        is_knockout_match = stage_id == "rmuc_regional_knockout"
        theta_red = float(base_map.get(red_key, 0.0))
        theta_blue = float(base_map.get(blue_key, 0.0))
        p_red = 1.0 / (1.0 + np.exp(-((theta_red - theta_blue) / max(beta_perf, 1e-6))))
        for school_key, school_name, win_value, expected_value in [
            (red_key, school_name_map.get(red_key, red_key), 1.0 if row["winner_side"] == "red" else 0.0, p_red),
            (blue_key, school_name_map.get(blue_key, blue_key), 1.0 if row["winner_side"] == "blue" else 0.0, 1.0 - p_red),
        ]:
            bucket = stats.setdefault(
                school_key,
                {
                    "school_name": school_name,
                    "regional_match_count": 0,
                    "regional_series_wins": 0.0,
                    "expected_series_wins": 0.0,
                    "regional_group_match_count": 0,
                    "regional_group_wins": 0.0,
                    "regional_knockout_match_count": 0,
                    "regional_knockout_wins": 0.0,
                },
            )
            bucket["regional_match_count"] += 1
            bucket["regional_series_wins"] += float(win_value)
            bucket["expected_series_wins"] += float(expected_value)
            if is_group_match:
                bucket["regional_group_match_count"] += 1
                bucket["regional_group_wins"] += float(win_value)
            elif is_knockout_match:
                bucket["regional_knockout_match_count"] += 1
                bucket["regional_knockout_wins"] += float(win_value)

    stat_rows = []
    for school_key, values in stats.items():
        match_count = int(values["regional_match_count"])
        if match_count <= 0:
            continue
        actual_wins = float(values["regional_series_wins"])
        expected_wins = float(values["expected_series_wins"])
        observed_strength = _shrunk_strength_theta(
            actual_wins=actual_wins,
            match_count=match_count,
            beta_perf=beta_perf,
            prior_weight=cfg.regional_prior_target_pseudocount,
            prior_rate=0.5,
        )
        regional_group_match_count = int(values["regional_group_match_count"])
        regional_group_wins = float(values["regional_group_wins"])
        regional_knockout_match_count = int(values["regional_knockout_match_count"])
        regional_knockout_wins = float(values["regional_knockout_wins"])
        regional_knockout_qualified = 1 if regional_knockout_match_count > 0 else 0
        regional_outcome_score = _regional_outcome_score(
            group_wins=regional_group_wins,
            group_matches=regional_group_match_count,
            knockout_wins=regional_knockout_wins,
            knockout_matches=regional_knockout_match_count,
        )
        stat_rows.append(
            {
                "season": season,
                "school_key": school_key,
                "school_name": values["school_name"],
                "regional_group_match_count": regional_group_match_count,
                "regional_group_wins": regional_group_wins,
                "regional_knockout_match_count": regional_knockout_match_count,
                "regional_knockout_wins": regional_knockout_wins,
                "regional_knockout_qualified": regional_knockout_qualified,
                "regional_match_count": match_count,
                "regional_series_wins": actual_wins,
                "expected_series_wins": expected_wins,
                "regional_observed_strength_theta": float(observed_strength),
                "regional_outcome_score": float(regional_outcome_score),
                "training_weight": float(cfg.regional_prior_train_terminal_weight if season == 2024 else 1.0),
            }
        )
    training = pd.DataFrame.from_records(stat_rows)
    feature_merge_columns = [
        "school_key",
        "school_name",
        "shape_prior_signal",
        "rmul_ranking_signal",
        "regional_prior_consistency_feature",
        "rmul_station_strength_mean",
        "rmul_station_strength_top4",
        "rmul_station_strength_std",
        "rmul_station_strength_depth",
        "rmul_relative_finish",
        "rmul_strength_adjusted_signal",
        "shape_missing_flag",
        "rmul_missing_flag",
    ]
    training = training.merge(
        feature_frame.reindex(columns=feature_merge_columns, fill_value=0.0),
        on=["school_key", "school_name"],
        how="left",
    )
    for column in [
        "rmul_station_strength_mean",
        "rmul_station_strength_top4",
        "rmul_station_strength_std",
        "rmul_station_strength_depth",
        "rmul_relative_finish",
        "rmul_strength_adjusted_signal",
    ]:
        if column not in training.columns:
            training[column] = 0.0
    training["base_anchor_theta"] = training["school_key"].map(lambda key: float(base_map.get(str(key), 0.0)))
    training["regional_outcome_rank_z"] = _compute_rank_z(training["regional_outcome_score"], ascending=False)
    training = _augment_same_year_rank_targets(
        training,
        rank_shift_scale=1.0,
        strength_scale=0.15,
    )
    training["regional_prior_target_rank_shift"] = (
        training["regional_outcome_rank_z"].astype(float) - training["base_rank_z"].astype(float)
    )
    raw_feature_columns = [
        "shape_prior_signal",
        "rmul_ranking_signal",
        "regional_prior_consistency_feature",
        "rmul_station_strength_mean",
        "rmul_station_strength_top4",
        "rmul_station_strength_std",
        "rmul_station_strength_depth",
        "rmul_relative_finish",
        "rmul_strength_adjusted_signal",
        "shape_missing_flag",
        "rmul_missing_flag",
    ]
    for column in raw_feature_columns:
        training[column] = training[column].fillna(0.0)
    engineered = build_regional_prior_feature_matrix(training)
    for column in FEATURE_COLUMNS:
        training[column] = engineered[column]
    diagnostic_feature_columns = [column for column in raw_feature_columns if column not in FEATURE_COLUMNS]
    return training[
        [
            "season",
            "school_key",
            "school_name",
            *diagnostic_feature_columns,
            *FEATURE_COLUMNS,
            "regional_group_match_count",
            "regional_group_wins",
            "regional_knockout_match_count",
            "regional_knockout_wins",
            "regional_knockout_qualified",
            "regional_match_count",
            "regional_series_wins",
            "expected_series_wins",
            "regional_observed_strength_theta",
            "regional_outcome_score",
            "regional_outcome_rank_z",
            "base_rank_z",
            "regional_prior_target_rank_shift",
            "regional_outcome_strength_theta",
            "regional_observed_rank_z",
            "regional_rank_shift_theta",
            "regional_strength_adjust_theta",
            "regional_prior_shift_theta",
            "regional_prior_target_theta",
            "training_weight",
        ]
    ].sort_values(["season", "school_key"], kind="stable").reset_index(drop=True)


def fit_regional_prior_model(training_frame: Any, config: RegionalPreModelConfig | None = None) -> dict[str, Any]:
    cfg = config or RegionalPreModelConfig()
    if training_frame.empty:
        return {
            "feature_columns": FEATURE_COLUMNS,
            "evidence_raw_mean": 0.0,
            "evidence_raw_std": 1.0,
            "evidence_alignment": 1.0,
            "residual_sd": 0.25,
            "training_row_count": 0,
            "season_weights": {},
            "target_rank_shift_mean": 0.0,
            "target_rank_shift_std": 1.0,
            "evidence_target_corr": 0.0,
        }
    weights = training_frame["training_weight"].astype(float).to_numpy()
    evidence = build_evidence_score(training_frame, cfg)
    raw = evidence["evidence_score_raw"].astype(float).to_numpy()
    target = training_frame["regional_prior_target_rank_shift"].astype(float).to_numpy()
    evidence_mean, evidence_std = _weighted_mean_std(raw, weights)
    target_mean, target_std = _weighted_mean_std(target, weights)
    centered_raw = (raw - evidence_mean) / evidence_std
    centered_target = (target - target_mean) / target_std
    covariance = float(np.average(centered_raw * centered_target, weights=np.clip(weights, 1e-6, None)))
    alignment = 1.0 if covariance >= 0.0 else -1.0
    centered_evidence = alignment * centered_raw
    corr_denom = max(
        float(np.sqrt(np.average(np.square(centered_evidence), weights=np.clip(weights, 1e-6, None)))),
        1e-6,
    )
    target_denom = max(
        float(np.sqrt(np.average(np.square(centered_target), weights=np.clip(weights, 1e-6, None)))),
        1e-6,
    )
    evidence_target_corr = float(
        np.average(centered_evidence * centered_target, weights=np.clip(weights, 1e-6, None)) / (corr_denom * target_denom)
    )
    residual = centered_target - centered_evidence
    residual_sd = float(np.sqrt(np.average(np.square(residual), weights=np.clip(weights, 1e-6, None))))
    return {
        "feature_columns": FEATURE_COLUMNS,
        "evidence_raw_mean": float(evidence_mean),
        "evidence_raw_std": float(evidence_std),
        "evidence_alignment": float(alignment),
        "residual_sd": max(residual_sd * 0.25, 0.10),
        "training_row_count": int(len(training_frame)),
        "season_weights": {
            str(int(season)): float(training_frame.loc[training_frame["season"] == season, "training_weight"].mean())
            for season in sorted(training_frame["season"].unique().tolist())
        },
        "target_rank_shift_mean": float(target_mean),
        "target_rank_shift_std": float(target_std),
        "evidence_target_corr": evidence_target_corr,
    }


def apply_regional_prior_model(feature_frame: Any, model: dict[str, Any], config: RegionalPreModelConfig | None = None) -> Any:
    cfg = config or RegionalPreModelConfig()
    frame = feature_frame.copy()
    evidence_frame = build_evidence_score(frame, cfg, model)
    for column in evidence_frame.columns:
        frame[column] = evidence_frame[column]
    frame["prior_delta_cap_theta"] = compute_prior_delta_cap(
        frame["rmuc_history_strength"],
        frame["recent_evidence_support"],
        cfg,
    )
    frame["regional_prior_delta_theta"] = map_evidence_to_prior_delta(
        frame["evidence_score_centered"],
        frame["rmuc_history_strength"],
        frame["recent_evidence_support"],
        cfg,
    )
    frame["regional_prior_shift_theta"] = frame["regional_prior_delta_theta"]
    frame["regional_prior_score_theta"] = frame["base_anchor_theta"] + frame["regional_prior_delta_theta"]
    missing_count = frame["shape_missing_flag"] + frame["rmul_missing_flag"]
    base_sd = float(model.get("residual_sd", 0.5)) * (1.0 + (0.25 * missing_count))
    frame["pre_signal_sd"] = base_sd * cfg.aligned_sd_scale
    frame["pre_signal_conflict_flag"] = False
    return frame


def build_regional_pre_frame(
    dataset_dir: Path,
    snapshot_date: str,
    prior_model: dict[str, Any],
    base_snapshot: Any,
    config: RegionalPreModelConfig | None = None,
) -> Any:
    cfg = config or RegionalPreModelConfig()
    dataset = read_dataset(dataset_dir)
    snapshot_year = int(snapshot_date[:4])

    lagged_station_score_map, station_source = _load_lagged_station_score_map_for_season(snapshot_year, base_snapshot)
    frame = build_same_year_feature_frame(
        dataset_dir,
        snapshot_year,
        lagged_station_score_map=lagged_station_score_map,
        station_source=station_source,
    )
    frame = frame.merge(
        base_snapshot[
            [
                "school_key",
                "rmuc_long_term_base_theta_mean",
                "rmuc_long_term_base_theta_sd",
                "rmuc_recent_match_effective_count",
                "rmuc_latest_season_match_share",
                "rmuc_terminal_only_support",
            ]
        ].rename(columns={"rmuc_long_term_base_theta_mean": "base_anchor_theta"}),
        on="school_key",
        how="left",
    )
    frame["base_anchor_theta"] = frame["base_anchor_theta"].fillna(0.0)
    history_rows = frame.apply(
        lambda row: compute_history_context(
            effective_recent_match_count=float(row.get("rmuc_recent_match_effective_count", 0.0)),
            latest_season_match_share=float(row.get("rmuc_latest_season_match_share", 0.0)),
            posterior_uncertainty=float(row.get("rmuc_long_term_base_theta_sd", 1.0)),
            terminal_only_support=bool(row.get("rmuc_terminal_only_support", False)),
            shape_signal_available=bool(row["shape_signal_season_count"]),
            rmul_signal_available=bool(row["rmul_ranking_season_count"]),
            config=cfg,
        ),
        axis=1,
        result_type="expand",
    )
    frame["rmuc_history_strength"] = history_rows["rmuc_history_strength"]
    frame["recent_evidence_support"] = history_rows["recent_evidence_support"]
    frame = apply_regional_prior_model(frame, prior_model, cfg)

    canonical = dataset["canonical_matches"]
    current_year_rmuc = canonical[
        (canonical["ruleset_id"] == "RMUC")
        & (canonical["season"] == snapshot_year)
        & (canonical["match_date"] <= snapshot_date)
    ].copy()
    regional_group = current_year_rmuc[current_year_rmuc["stage_id"] == "rmuc_regional_group"].copy()
    post_group = current_year_rmuc[current_year_rmuc["stage_id"] != "rmuc_regional_group"].copy()
    group_counts: dict[str, int] = {}
    post_group_keys = set(post_group["red_school_key"].tolist()) | set(post_group["blue_school_key"].tolist())
    for row in regional_group[["red_school_key", "blue_school_key"]].to_dict(orient="records"):
        for key in (row["red_school_key"], row["blue_school_key"]):
            group_counts[str(key)] = group_counts.get(str(key), 0) + 1
    frame["regional_group_matches_played"] = frame["school_key"].map(group_counts).fillna(0).astype(int)
    frame["regional_post_group_started"] = frame["school_key"].isin(post_group_keys)
    frame["regional_pre_decay_factor"] = frame["regional_group_matches_played"].map(
        lambda value: _regional_group_decay_factor(int(value), cfg.pre_decay_matches)
    )
    frame.loc[frame["regional_post_group_started"], "regional_pre_decay_factor"] = 0.0
    frame["regional_pre_active"] = frame["regional_pre_decay_factor"] > 0.0
    frame["regional_prior_effective_theta"] = frame["regional_prior_delta_theta"] * frame["regional_pre_decay_factor"]

    return frame[
        [
            "school_key",
            "school_name",
            "shape_rank",
            "is_rmuc_2026_team",
            "shape_prior_signal",
            "rmul_ranking_signal",
            "regional_prior_consistency_feature",
            "rmul_station_strength_mean",
            "rmul_station_strength_top4",
            "rmul_station_strength_std",
            "rmul_station_strength_depth",
            "rmul_relative_finish",
            "rmul_strength_adjusted_signal",
            "rmul_station_source",
            "base_anchor_theta",
            "shape_missing_flag",
            "rmul_missing_flag",
            "pre_signal_sd",
            "pre_signal_conflict_flag",
            "shape_evidence_theta",
            "rmul_finish_evidence_theta",
            "rmul_station_calibration_theta",
            "evidence_score_raw",
            "evidence_score_centered",
            "prior_delta_cap_theta",
            "rmuc_history_strength",
            "recent_evidence_support",
            "regional_prior_delta_theta",
            "regional_prior_score_theta",
            "regional_prior_effective_theta",
            "regional_pre_active",
            "regional_group_matches_played",
            "regional_post_group_started",
            "regional_pre_decay_factor",
            "shape_signal_season_count",
            "shape_source_years",
            "rmul_ranking_season_count",
            "rmul_ranking_source_years",
        ]
    ]
