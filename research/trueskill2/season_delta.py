from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SeasonDeltaConfig:
    prior_delta_sigma_weight: float = 0.55
    history_sigma_weight: float = 0.30
    base_event_sigma: float = 0.25
    delta_cap: float = 3.00
    sigma_floor: float = 0.30
    process_sigma: float = 0.08
    result_obs_sigma_base: float = 0.60
    expected_loss_sigma_multiplier: float = 1.00
    expected_loss_probability_threshold: float = 0.35
    team_damage_weight: float = 0.90
    base_hp_weight: float = 0.10
    opponent_points_weight: float = 0.0
    form_scale: float = 1.60
    form_temperature: float = 1.20
    form_obs_sigma_base: float = 0.60
    form_reliability_floor: float = 0.35
    robot_form_blend_weight: float = 0.35
    robot_form_scale: float = 1.25
    robot_form_temperature: float = 1.20
    robot_form_obs_sigma_base: float = 1.15
    robot_form_reliability_floor: float = 0.35
    momentum_update_enabled: bool = False
    result_momentum_scale: float = 0.35
    result_momentum_decay: float = 0.55
    result_momentum_cap: float = 0.50
    surprise_residual_threshold: float = 0.25
    sweep_bonus_2_0: float = 0.10
    max_sigma_inflation: float = 0.18
    form_freshness_decay_minutes: float = 90.0
    form_freshness_floor: float = 0.25
    early_group_sigma_floor: float = 0.30
    early_group_sigma_floor_matches: float = 0.0
    opponent_form_expected_scale: float = 0.50
    opponent_form_adjustment_weight: float = 0.35
    robot_gate_conflict_weight: float = 0.05
    robot_gate_robot_only_weight: float = 0.50
    robot_gate_neutral_weight: float = 0.25


@dataclass(frozen=True)
class MatchResultObservation:
    red_obs_mu: float
    blue_obs_mu: float
    obs_sigma: float
    red_obs_sigma: float
    blue_obs_sigma: float
    probability_red: float
    residual: float


@dataclass(frozen=True)
class FormObservation:
    form_signal: float
    obs_mu: float
    obs_sigma: float
    reliability: float


@dataclass(frozen=True)
class FreshenedFormObservation:
    obs_mu: float
    obs_sigma: float
    freshness_weight: float


@dataclass(frozen=True)
class EventFormFreshness:
    weight: float
    status: str


@dataclass(frozen=True)
class OpponentAdjustedFormObservation:
    adjusted_obs_mu: float
    expected_form_mu: float
    adjustment_mu: float


@dataclass(frozen=True)
class ResultSigmaInflation:
    surprise_residual: float
    sigma_inflation: float


def soft_clip(value: float, cap: float) -> float:
    cap = max(float(cap), 1e-9)
    return float(cap * math.tanh(float(value) / cap))


def fuse_observation(
    mu: float,
    sigma: float,
    obs_mu: float,
    obs_sigma: float,
    *,
    process_sigma: float = 0.08,
    sigma_floor: float = 0.30,
    delta_cap: float = 3.00,
) -> tuple[float, float, float]:
    prior_var = max(float(sigma), float(sigma_floor)) ** 2
    obs_var = max(float(obs_sigma), 1e-6) ** 2
    gain = prior_var / (prior_var + obs_var)
    mu_new = float(mu) + (gain * (float(obs_mu) - float(mu)))
    mu_new = soft_clip(mu_new, delta_cap)
    sigma_new = math.sqrt(max(((1.0 - gain) * prior_var) + (float(process_sigma) ** 2), float(sigma_floor) ** 2))
    return mu_new, sigma_new, float(gain)


def compute_group_stage_sigma_floor(
    *,
    stage_family: str,
    group_matches_played_before: int | float,
    config: SeasonDeltaConfig | None = None,
) -> float:
    cfg = config or SeasonDeltaConfig()
    base_floor = float(cfg.sigma_floor)
    if str(stage_family) != "regional_group":
        return base_floor
    early_floor = max(float(cfg.early_group_sigma_floor), base_floor)
    window = max(float(cfg.early_group_sigma_floor_matches), 0.0)
    if early_floor <= base_floor or window <= 0.0:
        return base_floor
    played = min(max(float(group_matches_played_before), 0.0), window)
    if played >= window:
        return base_floor
    progress = played / window
    return round(base_floor + ((early_floor - base_floor) * (1.0 - progress)), 12)


def compute_effective_sigma_theta(
    *,
    pre_signal_sd: float,
    regional_prior_delta_theta: float,
    rmuc_history_strength: float,
    config: SeasonDeltaConfig | None = None,
) -> float:
    cfg = config or SeasonDeltaConfig()
    history_strength = min(max(float(rmuc_history_strength), 0.0), 1.0)
    value = math.sqrt(
        (float(pre_signal_sd) ** 2)
        + ((float(cfg.prior_delta_sigma_weight) * abs(float(regional_prior_delta_theta))) ** 2)
        + ((float(cfg.history_sigma_weight) * (1.0 - history_strength)) ** 2)
        + (float(cfg.base_event_sigma) ** 2)
    )
    return max(float(value), float(cfg.sigma_floor))


def compute_match_result_observations(
    *,
    theta_red: float,
    theta_blue: float,
    season_delta_mu_red: float,
    season_delta_mu_blue: float,
    actual_red_score: float,
    total_games: int | float,
    beta_perf: float,
    config: SeasonDeltaConfig | None = None,
) -> MatchResultObservation:
    cfg = config or SeasonDeltaConfig()
    beta = max(float(beta_perf), 1e-6)
    probability_red = 1.0 / (1.0 + math.exp(-((float(theta_red) - float(theta_blue)) / beta)))
    residual = beta * (float(actual_red_score) - probability_red)
    games = max(float(total_games), 1.0)
    obs_sigma = float(cfg.result_obs_sigma_base) / math.sqrt(games / 2.0)
    max_multiplier = max(float(cfg.expected_loss_sigma_multiplier), 1.0)
    threshold = min(max(float(cfg.expected_loss_probability_threshold), 0.0), 0.50)
    red_obs_sigma = float(obs_sigma)
    blue_obs_sigma = float(obs_sigma)
    if threshold > 0.0 and max_multiplier > 1.0:
        if residual < 0.0 and probability_red < threshold:
            underdog_depth = (threshold - probability_red) / threshold
            red_obs_sigma *= 1.0 + ((max_multiplier - 1.0) * underdog_depth)
        probability_blue = 1.0 - probability_red
        if residual > 0.0 and probability_blue < threshold:
            underdog_depth = (threshold - probability_blue) / threshold
            blue_obs_sigma *= 1.0 + ((max_multiplier - 1.0) * underdog_depth)
    return MatchResultObservation(
        red_obs_mu=float(season_delta_mu_red) + residual,
        blue_obs_mu=float(season_delta_mu_blue) - residual,
        obs_sigma=float(obs_sigma),
        red_obs_sigma=float(red_obs_sigma),
        blue_obs_sigma=float(blue_obs_sigma),
        probability_red=float(probability_red),
        residual=float(residual),
    )


def compute_form_observation(
    *,
    z_team_damage: float,
    z_base_hp_diff: float,
    z_opponent_points: float = 0.0,
    group_matches_played: int | float,
    config: SeasonDeltaConfig | None = None,
) -> FormObservation:
    cfg = config or SeasonDeltaConfig()
    form_signal = (float(cfg.team_damage_weight) * float(z_team_damage)) + (
        float(cfg.base_hp_weight) * float(z_base_hp_diff)
    ) + (
        float(cfg.opponent_points_weight) * float(z_opponent_points)
    )
    temperature = max(float(cfg.form_temperature), 1e-6)
    obs_mu = float(cfg.form_scale) * math.tanh(float(form_signal) / temperature)
    reliability = min(math.sqrt(max(float(group_matches_played), 0.0) / 2.0), 1.0)
    obs_sigma = float(cfg.form_obs_sigma_base) / max(reliability, float(cfg.form_reliability_floor))
    return FormObservation(
        form_signal=float(form_signal),
        obs_mu=float(obs_mu),
        obs_sigma=float(obs_sigma),
        reliability=float(reliability),
    )


def compute_robot_form_observation(
    *,
    robot_family_signal: float,
    group_matches_played: int | float,
    config: SeasonDeltaConfig | None = None,
) -> FormObservation:
    cfg = config or SeasonDeltaConfig()
    temperature = max(float(cfg.robot_form_temperature), 1e-6)
    obs_mu = float(cfg.robot_form_scale) * math.tanh(float(robot_family_signal) / temperature)
    reliability = min(math.sqrt(max(float(group_matches_played), 0.0) / 2.0), 1.0)
    obs_sigma = float(cfg.robot_form_obs_sigma_base) / max(reliability, float(cfg.robot_form_reliability_floor))
    return FormObservation(
        form_signal=float(robot_family_signal),
        obs_mu=float(obs_mu),
        obs_sigma=float(obs_sigma),
        reliability=float(reliability),
    )


def compute_result_momentum_update(
    *,
    previous_momentum: float,
    side: str,
    actual_red_score: float,
    probability_red: float,
    total_games: int | float,
    config: SeasonDeltaConfig | None = None,
) -> float:
    cfg = config or SeasonDeltaConfig()
    red_residual = float(actual_red_score) - float(probability_red)
    side_residual = red_residual if str(side) == "red" else -red_residual
    game_weight = math.sqrt(max(float(total_games), 1.0) / 2.0)
    new_signal = float(cfg.result_momentum_scale) * side_residual * game_weight
    updated = (float(cfg.result_momentum_decay) * float(previous_momentum)) + new_signal
    return soft_clip(updated, float(cfg.result_momentum_cap))


def compute_result_sigma_inflation(
    *,
    actual_red_score: float,
    probability_red: float,
    total_games: int | float,
    config: SeasonDeltaConfig | None = None,
) -> ResultSigmaInflation:
    cfg = config or SeasonDeltaConfig()
    residual = abs(float(actual_red_score) - float(probability_red))
    excess = max(residual - float(cfg.surprise_residual_threshold), 0.0)
    games = max(float(total_games), 1.0)
    decisive_bonus = float(cfg.sweep_bonus_2_0) if games <= 2.0 and float(actual_red_score) in (0.0, 1.0) else 0.0
    surprise = excess + decisive_bonus
    denominator = max((1.0 - float(cfg.surprise_residual_threshold)) + float(cfg.sweep_bonus_2_0), 1e-6)
    normalized = min(max(surprise / denominator, 0.0), 1.0)
    return ResultSigmaInflation(
        surprise_residual=float(residual),
        sigma_inflation=float(cfg.max_sigma_inflation) * normalized,
    )


def apply_result_sigma_inflation(
    sigma: float,
    sigma_inflation: float,
    *,
    config: SeasonDeltaConfig | None = None,
) -> float:
    cfg = config or SeasonDeltaConfig()
    inflation = min(max(float(sigma_inflation), 0.0), float(cfg.max_sigma_inflation))
    inflated = math.sqrt((max(float(sigma), float(cfg.sigma_floor)) ** 2) + (inflation ** 2))
    return max(float(inflated), float(cfg.sigma_floor))


def compute_form_freshness_weight(
    *,
    snapshot_age_minutes: float | None,
    config: SeasonDeltaConfig | None = None,
) -> float:
    if snapshot_age_minutes is None:
        return 1.0
    cfg = config or SeasonDeltaConfig()
    age = max(float(snapshot_age_minutes), 0.0)
    decay = max(float(cfg.form_freshness_decay_minutes), 1e-6)
    return float(max(math.exp(-(age / decay)), 0.0))


def adjust_form_observation_for_freshness(
    *,
    obs_mu: float,
    obs_sigma: float,
    freshness_weight: float,
    config: SeasonDeltaConfig | None = None,
) -> FreshenedFormObservation:
    cfg = config or SeasonDeltaConfig()
    weight = min(max(float(freshness_weight), 0.0), 1.0)
    effective_weight = max(weight, float(cfg.form_freshness_floor))
    return FreshenedFormObservation(
        obs_mu=float(obs_mu),
        obs_sigma=float(obs_sigma) / effective_weight,
        freshness_weight=float(weight),
    )


def compute_event_form_freshness(
    *,
    snapshot_matches_played: int | float | None,
    expected_matches_played_before: int | float | None,
    time_freshness_weight: float = 1.0,
) -> EventFormFreshness:
    if expected_matches_played_before is None:
        weight = min(max(float(time_freshness_weight), 0.0), 1.0)
        return EventFormFreshness(weight=weight, status="time_decay")
    expected = float(expected_matches_played_before)
    if expected <= 0.0:
        return EventFormFreshness(weight=0.0, status="no_prior_matches")
    if snapshot_matches_played is None:
        return EventFormFreshness(weight=0.0, status="missing_played_count")
    snapshot = float(snapshot_matches_played)
    tolerance = 1e-6
    if snapshot + tolerance < expected:
        return EventFormFreshness(weight=0.0, status="stale")
    if snapshot > expected + tolerance:
        return EventFormFreshness(weight=0.0, status="future_leak")
    return EventFormFreshness(weight=1.0, status="current")


def compute_opponent_adjusted_form_observation(
    *,
    obs_mu: float,
    team_theta: float,
    opponent_theta: float,
    beta_perf: float,
    config: SeasonDeltaConfig | None = None,
) -> OpponentAdjustedFormObservation:
    cfg = config or SeasonDeltaConfig()
    beta = max(float(beta_perf), 1e-6)
    expected = float(cfg.opponent_form_expected_scale) * math.tanh((float(team_theta) - float(opponent_theta)) / beta)
    adjustment = float(cfg.opponent_form_adjustment_weight) * expected
    return OpponentAdjustedFormObservation(
        adjusted_obs_mu=float(obs_mu) - adjustment,
        expected_form_mu=float(expected),
        adjustment_mu=float(adjustment),
    )


def compute_robot_gate_weight(
    *,
    robot_reliability: float,
    alignment: str | None,
    conflict: bool,
    robot_snapshot_age_minutes: float | None = None,
    config: SeasonDeltaConfig | None = None,
) -> float:
    cfg = config or SeasonDeltaConfig()
    reliability = min(max(float(robot_reliability), 0.0), 1.0)
    freshness = compute_form_freshness_weight(snapshot_age_minutes=robot_snapshot_age_minutes, config=cfg)
    label = str(alignment or "").strip()
    if bool(conflict) or label == "conflict":
        base = float(cfg.robot_gate_conflict_weight)
    elif label.startswith("aligned_"):
        base = 1.0
    elif label.startswith("robot_only_"):
        base = float(cfg.robot_gate_robot_only_weight)
    elif label == "neutral":
        base = float(cfg.robot_gate_neutral_weight)
    else:
        base = 0.0
    return float(min(max(base * reliability * freshness, 0.0), 1.0))


def robust_z(values: object, *, clip: float = 2.5) -> object:
    array = np.asarray(values, dtype=float)
    median = float(np.nanmedian(array)) if array.size else 0.0
    mad = float(np.nanmedian(np.abs(array - median))) if array.size else 0.0
    scale = max(1.4826 * mad, 1e-9)
    return np.clip((array - median) / scale, -float(clip), float(clip))
