from __future__ import annotations

import math
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .ingest import require_dataframe_deps
from .season_delta import (
    SeasonDeltaConfig,
    compute_match_result_observations,
    compute_opponent_adjusted_form_observation,
    compute_result_momentum_update,
    fuse_observation,
)


STRATEGIES = [
    "A_current_ts2",
    "B_new_sigma0",
    "C_result_fusion",
    "D_result_fusion_form",
    "E_general_flow_momentum",
    "F_transient_process_residual",
]

RESIDUAL_HEAD_RESULT_WEIGHT = 0.00
RESIDUAL_HEAD_PROCESS_WEIGHT = 0.50
RESIDUAL_HEAD_CONFLICT_SHRINK_WEIGHT = 0.00


def _probability_red(theta_red: float, theta_blue: float, beta_eff: float) -> float:
    beta = max(float(beta_eff), 1e-6)
    return float(1.0 / (1.0 + math.exp(-((float(theta_red) - float(theta_blue)) / beta))))


def _sigmoid(logit: float) -> float:
    if logit >= 0.0:
        z = math.exp(-logit)
        return float(1.0 / (1.0 + z))
    z = math.exp(logit)
    return float(z / (1.0 + z))


def _logit(probability: float) -> float:
    p = min(max(float(probability), 1e-9), 1.0 - 1e-9)
    return float(math.log(p / (1.0 - p)))


def _ece(probabilities: list[float], outcomes: list[int], bins: int = 10) -> float:
    if not probabilities:
        return 0.0
    total = len(probabilities)
    ece = 0.0
    for idx in range(bins):
        low = idx / bins
        high = (idx + 1) / bins
        items = [
            (prob, outcome)
            for prob, outcome in zip(probabilities, outcomes, strict=True)
            if (low <= prob < high) or (idx == bins - 1 and prob == 1.0)
        ]
        if not items:
            continue
        pred_mean = sum(item[0] for item in items) / len(items)
        obs_mean = sum(item[1] for item in items) / len(items)
        ece += (len(items) / total) * abs(pred_mean - obs_mean)
    return float(ece)


def _initial_states(preseason_snapshot: Any) -> dict[str, dict[str, float]]:
    states: dict[str, dict[str, float]] = {}
    for row in preseason_snapshot.to_dict(orient="records"):
        key = str(row["school_key"])
        mu = float(row.get("season_delta_mu", row.get("regional_prior_theta", 0.0)))
        sigma = float(row.get("season_delta_sigma_theta", row.get("effective_sigma_theta", 0.30)))
        states[key] = {
            "base_theta": float(row.get("rmuc_program_base_theta", row.get("program_base_theta", 0.0))),
            "season_delta_mu": mu,
            "season_delta_sigma": sigma,
            "preseason_delta_mu": mu,
            "momentum_theta": 0.0,
            "matches_played": 0.0,
            "match_wins": 0.0,
            "match_losses": 0.0,
            "result_residual_sum": 0.0,
            "last_result_residual": 0.0,
        }
    return states


def _form_observation_map(form_observations: Any | None) -> dict[tuple[str, str], dict[str, float]]:
    if form_observations is None or getattr(form_observations, "empty", True):
        return {}
    out: dict[tuple[str, str], dict[str, float]] = {}
    for row in form_observations.to_dict(orient="records"):
        try:
            obs_mu = float(row["obs_mu"])
            obs_sigma = float(row["obs_sigma"])
        except (KeyError, TypeError, ValueError):
            continue
        out[(str(row["match_id"]), str(row["school_key"]))] = {
            "obs_mu": obs_mu,
            "obs_sigma": obs_sigma,
        }
    return out


def _match_actual_red_score(match: dict[str, Any]) -> float:
    red = float(match.get("red_wins", 0) or 0)
    blue = float(match.get("blue_wins", 0) or 0)
    total = red + blue
    if total > 0.0:
        return red / total
    winner = str(match.get("winner_side", "")).lower()
    if winner == "red":
        return 1.0
    if winner == "blue":
        return 0.0
    return 0.5


def _signed_conflict_score(*signals: float) -> float:
    signs = [1 if value > 1e-9 else -1 if value < -1e-9 else 0 for value in signals]
    nonzero = [sign for sign in signs if sign != 0]
    if len(nonzero) <= 1:
        return 0.0
    positives = sum(1 for sign in nonzero if sign > 0)
    negatives = sum(1 for sign in nonzero if sign < 0)
    return float((2.0 * min(positives, negatives)) / len(nonzero))


def _residual_conflict_calibrated_probability(
    *,
    p_red: float,
    result_residual_diff: float,
    process_residual_diff: float,
    component_conflict_score: float,
) -> float:
    raw_logit = _logit(p_red)
    residual_logit = raw_logit + (
        RESIDUAL_HEAD_RESULT_WEIGHT * float(result_residual_diff)
    ) + (
        RESIDUAL_HEAD_PROCESS_WEIGHT * float(process_residual_diff)
    )
    shrink = 1.0 - min(
        max(float(component_conflict_score), 0.0) * RESIDUAL_HEAD_CONFLICT_SHRINK_WEIGHT,
        0.65,
    )
    return _sigmoid(residual_logit * shrink)


def _summarize_strategy(
    *,
    name: str,
    states: dict[str, dict[str, float]],
    predictions: list[dict[str, Any]],
    prematch_feature_frame: list[dict[str, Any]],
) -> dict[str, Any]:
    probabilities = [float(row["p_red_win"]) for row in predictions]
    outcomes = [int(row["actual_red_win"]) for row in predictions]
    if probabilities:
        log_losses = [
            -(outcome * math.log(max(prob, 1e-9)) + ((1 - outcome) * math.log(max(1.0 - prob, 1e-9))))
            for prob, outcome in zip(probabilities, outcomes, strict=True)
        ]
        briers = [(prob - outcome) ** 2 for prob, outcome in zip(probabilities, outcomes, strict=True)]
        accuracy = sum(
            1
            for prob, outcome in zip(probabilities, outcomes, strict=True)
            if (prob >= 0.5 and outcome == 1) or (prob < 0.5 and outcome == 0)
        ) / len(probabilities)
    else:
        log_losses = [0.0]
        briers = [0.0]
        accuracy = 0.0
    correction_after_2 = {}
    for key, state in states.items():
        if state["matches_played"] >= 2:
            correction_after_2[key] = float(state["preseason_delta_mu"] - state["season_delta_mu"])
    return {
        "name": name,
        "match_count": len(predictions),
        "log_loss": float(sum(log_losses) / len(log_losses)),
        "brier": float(sum(briers) / len(briers)),
        "accuracy": float(accuracy),
        "ece": _ece(probabilities, outcomes),
        "correction_after_2": correction_after_2,
        "team_states": deepcopy(states),
        "predictions": predictions,
        "prematch_feature_frame": prematch_feature_frame,
    }


def run_strategy_replay(
    *,
    preseason_snapshot: Any,
    matches: Any,
    beta_perf: float,
    online_update_scale: float = 0.50,
    form_observations: Any | None = None,
    config: SeasonDeltaConfig | None = None,
) -> dict[str, Any]:
    cfg = config or SeasonDeltaConfig()
    form_map = _form_observation_map(form_observations)
    strategy_reports: list[dict[str, Any]] = []

    for strategy in STRATEGIES:
        states = _initial_states(preseason_snapshot)
        predictions: list[dict[str, Any]] = []
        prematch_feature_frame: list[dict[str, Any]] = []
        for match in matches.sort_values(["match_date", "match_id"], kind="stable").to_dict(orient="records"):
            red_key = str(match["red_school_key"])
            blue_key = str(match["blue_school_key"])
            if red_key not in states or blue_key not in states:
                continue

            uses_form = strategy in {"D_result_fusion_form", "E_general_flow_momentum"}
            uses_fusion = strategy in {
                "C_result_fusion",
                "D_result_fusion_form",
                "E_general_flow_momentum",
                "F_transient_process_residual",
            }
            uses_sigma = strategy in {
                "B_new_sigma0",
                "C_result_fusion",
                "D_result_fusion_form",
                "E_general_flow_momentum",
                "F_transient_process_residual",
            }
            uses_momentum = strategy == "E_general_flow_momentum"
            uses_process_head = strategy == "F_transient_process_residual"

            red_pre_form = states[red_key]
            blue_pre_form = states[blue_key]
            process_residual: dict[str, float] = {red_key: 0.0, blue_key: 0.0}
            process_obs_mu: dict[str, float] = {red_key: 0.0, blue_key: 0.0}
            process_obs_sigma: dict[str, float] = {red_key: 0.0, blue_key: 0.0}
            pre_form_theta = {
                red_key: red_pre_form["base_theta"]
                + red_pre_form["season_delta_mu"]
                + (red_pre_form["momentum_theta"] if uses_momentum else 0.0),
                blue_key: blue_pre_form["base_theta"]
                + blue_pre_form["season_delta_mu"]
                + (blue_pre_form["momentum_theta"] if uses_momentum else 0.0),
            }
            for key, opponent_key in ((red_key, blue_key), (blue_key, red_key)):
                form_row = form_map.get((str(match["match_id"]), key))
                if form_row is None:
                    continue
                adjusted_form = compute_opponent_adjusted_form_observation(
                    obs_mu=float(form_row["obs_mu"]),
                    team_theta=pre_form_theta[key],
                    opponent_theta=pre_form_theta[opponent_key],
                    beta_perf=beta_perf,
                    config=cfg,
                )
                adjusted_obs_mu = float(adjusted_form.adjusted_obs_mu)
                process_obs_mu[key] = adjusted_obs_mu
                process_obs_sigma[key] = float(form_row["obs_sigma"])
                process_residual[key] = adjusted_obs_mu - float(states[key]["season_delta_mu"])

            if uses_form:
                for key in (red_key, blue_key):
                    form = form_map.get((str(match["match_id"]), key))
                    if form is None:
                        continue
                    mu_new, sigma_new, _gain = fuse_observation(
                        mu=states[key]["season_delta_mu"],
                        sigma=states[key]["season_delta_sigma"],
                        obs_mu=process_obs_mu[key],
                        obs_sigma=float(form["obs_sigma"]),
                        process_sigma=cfg.process_sigma,
                        sigma_floor=cfg.sigma_floor,
                        delta_cap=cfg.delta_cap,
                    )
                    states[key]["season_delta_mu"] = mu_new
                    states[key]["season_delta_sigma"] = sigma_new

            red = states[red_key]
            blue = states[blue_key]
            theta_red = red["base_theta"] + red["season_delta_mu"] + (red["momentum_theta"] if uses_momentum else 0.0)
            theta_blue = blue["base_theta"] + blue["season_delta_mu"] + (blue["momentum_theta"] if uses_momentum else 0.0)
            if uses_sigma:
                beta_eff = math.sqrt((float(beta_perf) ** 2) + (red["season_delta_sigma"] ** 2) + (blue["season_delta_sigma"] ** 2))
            else:
                beta_eff = float(beta_perf)
            p_red = _probability_red(theta_red, theta_blue, beta_eff)
            base_theta_diff = float(red["base_theta"] - blue["base_theta"])
            season_delta_diff = float(red["season_delta_mu"] - blue["season_delta_mu"])
            momentum_diff = float(red["momentum_theta"] - blue["momentum_theta"]) if uses_momentum else 0.0
            result_residual_diff = float(red["result_residual_sum"] - blue["result_residual_sum"])
            process_residual_diff = float(process_residual[red_key] - process_residual[blue_key])
            component_conflict_score = _signed_conflict_score(
                base_theta_diff,
                season_delta_diff,
                momentum_diff,
                result_residual_diff,
                process_residual_diff,
            )
            if uses_process_head:
                p_red = _residual_conflict_calibrated_probability(
                    p_red=p_red,
                    result_residual_diff=result_residual_diff,
                    process_residual_diff=process_residual_diff,
                    component_conflict_score=component_conflict_score,
                )
            actual_red = _match_actual_red_score(match)
            actual_red_win = 1 if str(match.get("winner_side", "")).lower() == "red" else 0
            same_record = (
                int(red["match_wins"]) == int(blue["match_wins"])
                and int(red["match_losses"]) == int(blue["match_losses"])
            )
            feature_row = {
                "strategy": strategy,
                "match_id": str(match["match_id"]),
                "match_date": str(match["match_date"]),
                "red_school_key": red_key,
                "blue_school_key": blue_key,
                "red_matches_played_before": float(red["matches_played"]),
                "blue_matches_played_before": float(blue["matches_played"]),
                "same_record_flag": int(same_record),
                "base_theta_diff": base_theta_diff,
                "season_delta_diff": season_delta_diff,
                "momentum_diff": momentum_diff,
                "sigma_sum": float(red["season_delta_sigma"] + blue["season_delta_sigma"]),
                "red_result_residual_sum_before": float(red["result_residual_sum"]),
                "blue_result_residual_sum_before": float(blue["result_residual_sum"]),
                "result_residual_diff": result_residual_diff,
                "red_last_result_residual": float(red["last_result_residual"]),
                "blue_last_result_residual": float(blue["last_result_residual"]),
                "red_process_residual": float(process_residual[red_key]),
                "blue_process_residual": float(process_residual[blue_key]),
                "process_residual_diff": process_residual_diff,
                "red_process_obs_mu": float(process_obs_mu[red_key]),
                "blue_process_obs_mu": float(process_obs_mu[blue_key]),
                "red_process_obs_sigma": float(process_obs_sigma[red_key]),
                "blue_process_obs_sigma": float(process_obs_sigma[blue_key]),
                "component_conflict_score": component_conflict_score,
                "p_red_win": float(p_red),
                "actual_red_win": int(actual_red_win),
            }
            prematch_feature_frame.append(feature_row)
            predictions.append(
                {
                    "match_id": str(match["match_id"]),
                    "p_red_win": float(p_red),
                    "actual_red_win": int(actual_red_win),
                    "red_school_key": red_key,
                    "blue_school_key": blue_key,
                    "strategy": strategy,
                    "red_momentum_theta": float(red["momentum_theta"]),
                    "blue_momentum_theta": float(blue["momentum_theta"]),
                }
            )

            total_games = float(match.get("red_wins", 0) or 0) + float(match.get("blue_wins", 0) or 0)
            side_result_residual = float(beta_perf) * (float(actual_red) - float(p_red))
            if uses_fusion:
                obs = compute_match_result_observations(
                    theta_red=theta_red,
                    theta_blue=theta_blue,
                    season_delta_mu_red=red["season_delta_mu"],
                    season_delta_mu_blue=blue["season_delta_mu"],
                    actual_red_score=actual_red,
                    total_games=max(total_games, 1.0),
                    beta_perf=beta_perf,
                    config=cfg,
                )
                red_mu, red_sigma, _ = fuse_observation(
                    mu=red["season_delta_mu"],
                    sigma=red["season_delta_sigma"],
                    obs_mu=obs.red_obs_mu,
                    obs_sigma=obs.red_obs_sigma,
                    process_sigma=cfg.process_sigma,
                    sigma_floor=cfg.sigma_floor,
                    delta_cap=cfg.delta_cap,
                )
                blue_mu, blue_sigma, _ = fuse_observation(
                    mu=blue["season_delta_mu"],
                    sigma=blue["season_delta_sigma"],
                    obs_mu=obs.blue_obs_mu,
                    obs_sigma=obs.blue_obs_sigma,
                    process_sigma=cfg.process_sigma,
                    sigma_floor=cfg.sigma_floor,
                    delta_cap=cfg.delta_cap,
                )
                red["season_delta_mu"] = red_mu
                red["season_delta_sigma"] = red_sigma
                blue["season_delta_mu"] = blue_mu
                blue["season_delta_sigma"] = blue_sigma
                if uses_momentum:
                    red["momentum_theta"] = compute_result_momentum_update(
                        previous_momentum=red["momentum_theta"],
                        side="red",
                        actual_red_score=actual_red,
                        probability_red=p_red,
                        total_games=max(total_games, 1.0),
                        config=cfg,
                    )
                    blue["momentum_theta"] = compute_result_momentum_update(
                        previous_momentum=blue["momentum_theta"],
                        side="blue",
                        actual_red_score=actual_red,
                        probability_red=p_red,
                        total_games=max(total_games, 1.0),
                        config=cfg,
                    )
            else:
                delta_red = float(online_update_scale) * float(beta_perf) * (actual_red - p_red)
                red["season_delta_mu"] += delta_red
                blue["season_delta_mu"] -= delta_red

            red["result_residual_sum"] += side_result_residual
            blue["result_residual_sum"] -= side_result_residual
            red["last_result_residual"] = side_result_residual
            blue["last_result_residual"] = -side_result_residual
            if actual_red_win == 1:
                red["match_wins"] += 1.0
                blue["match_losses"] += 1.0
            else:
                red["match_losses"] += 1.0
                blue["match_wins"] += 1.0
            red["matches_played"] += 1.0
            blue["matches_played"] += 1.0

        strategy_reports.append(
            _summarize_strategy(
                name=strategy,
                states=states,
                predictions=predictions,
                prematch_feature_frame=prematch_feature_frame,
            )
        )

    return {
        "created_at": datetime.now(tz=UTC).isoformat(),
        "residual_head_config": {
            "result_weight": float(RESIDUAL_HEAD_RESULT_WEIGHT),
            "process_weight": float(RESIDUAL_HEAD_PROCESS_WEIGHT),
            "conflict_shrink_weight": float(RESIDUAL_HEAD_CONFLICT_SHRINK_WEIGHT),
        },
        "strategies": strategy_reports,
        "prematch_feature_frame": [
            row
            for strategy_report in strategy_reports
            for row in strategy_report["prematch_feature_frame"]
        ],
    }


def run_strategy_backtest(
    *,
    preseason_path: Path,
    matches_path: Path,
    out_dir: Path,
    beta_perf: float,
    online_update_scale: float = 0.50,
    form_observations_path: Path | None = None,
) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    preseason = pd.read_csv(preseason_path) if preseason_path.suffix == ".csv" else pd.read_parquet(preseason_path)
    matches = pd.read_csv(matches_path) if matches_path.suffix == ".csv" else pd.read_parquet(matches_path)
    form = None
    if form_observations_path is not None and form_observations_path.exists():
        form = pd.read_csv(form_observations_path) if form_observations_path.suffix == ".csv" else pd.read_parquet(form_observations_path)
    report = run_strategy_replay(
        preseason_snapshot=preseason,
        matches=matches,
        beta_perf=beta_perf,
        online_update_scale=online_update_scale,
        form_observations=form,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "strategy_report.json").write_text(
        __import__("json").dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    feature_frame = pd.DataFrame(report.get("prematch_feature_frame", []))
    feature_frame.to_csv(out_dir / "prematch_feature_frame.csv", index=False)
    return report
