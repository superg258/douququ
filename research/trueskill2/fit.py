from __future__ import annotations

from collections import defaultdict
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from . import schemas
from .history_sources import RegionalPreModelConfig, build_selection_report_payload
from .ingest import RMUL_FINAL_DATE, read_dataset, require_dataframe_deps, resolve_school_identifier
from .model import (
    PreparedData,
    build_prediction_frame,
    build_state_summary_frames,
    fit_numpyro_model,
    prepare_model_data,
)
from .regional_pre import (
    _regional_group_decay_factor,
    build_regional_pre_frame,
    build_regional_prior_training_samples,
    compute_regional_prior_runtime_components,
    fit_regional_prior_model,
)


def _save_npz(path: Path, arrays: dict[str, Any]) -> None:
    schemas.ensure_parent(path)
    np.savez_compressed(path, **arrays)


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    schemas.ensure_parent(path)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _save_tabular_outputs(frame: Any, out_path: Path) -> Path:
    schemas.ensure_parent(out_path)
    frame.to_parquet(out_path, index=False)
    frame.to_csv(out_path.with_suffix(".csv"), index=False)
    out_path.with_suffix(".json").write_text(
        frame.to_json(orient="records", force_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out_path


def _serializable_state_rows(state_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in row.items()} for row in state_rows]


def _regional_pre_config(config: dict[str, Any] | None) -> RegionalPreModelConfig:
    payload = ((config or {}).get("regional_pre_model") or (config or {}).get("regional_pre") or {}) if isinstance(config, dict) else {}
    return RegionalPreModelConfig(
        alpha=float(payload.get("alpha", 0.50)),
        kappa=float(payload.get("kappa", 2.40)),
        rho_2024=float(payload.get("rho_2024", 0.25)),
        rho_terminal=float(payload.get("rho_terminal", 0.15)),
        recent_season_retention=float(payload.get("recent_season_retention", 0.35)),
        terminal_season_retention=float(payload.get("terminal_season_retention", 0.10)),
        regional_prior_ridge=float(payload.get("regional_prior_ridge", payload.get("prior_ridge", 0.25))),
        regional_prior_train_terminal_weight=float(
            payload.get("regional_prior_train_terminal_weight", payload.get("rho_terminal", 0.20))
        ),
        regional_prior_target_pseudocount=float(payload.get("regional_prior_target_pseudocount", 6.0)),
        school_retention_floor=float(payload.get("school_retention_floor", 0.35)),
        school_uncertainty_weight=float(payload.get("school_uncertainty_weight", 0.35)),
        school_terminal_only_penalty=float(payload.get("school_terminal_only_penalty", 0.75)),
        recent_match_cap=float(payload.get("recent_match_cap", 12.0)),
        history_uncertainty_scale=float(payload.get("history_uncertainty_scale", 1.0)),
        pre_decay_matches=int(payload.get("pre_decay_matches", 3)),
        aligned_sd_scale=float(payload.get("aligned_sd_scale", 0.85)),
        conflict_sd_scale=float(payload.get("conflict_sd_scale", 1.25)),
        blend_lambda_min=float(payload.get("blend_lambda_min", 0.20)),
        blend_lambda_max=float(payload.get("blend_lambda_max", 0.75)),
        blend_uncertainty_weight=float(payload.get("blend_uncertainty_weight", 0.25)),
        blend_signal_scale=float(payload.get("blend_signal_scale", 0.75)),
        deviation_lambda_boost=float(payload.get("deviation_lambda_boost", 0.12)),
        same_year_shape_weight=float(payload.get("same_year_shape_weight", 0.55)),
        same_year_rmul_weight=float(payload.get("same_year_rmul_weight", 0.75)),
        same_year_consistency_weight=float(payload.get("same_year_consistency_weight", 0.45)),
        shape_evidence_scale=float(payload.get("shape_evidence_scale", 0.90)),
        rmul_finish_scale=float(payload.get("rmul_finish_scale", 1.00)),
        station_calibration_scale=float(payload.get("station_calibration_scale", 0.12)),
        prior_delta_cap_min=float(payload.get("prior_delta_cap_min", 0.12)),
        prior_delta_cap_max=float(payload.get("prior_delta_cap_max", 0.60)),
        history_cap_curve=float(payload.get("history_cap_curve", 1.10)),
    )


def _historical_season_weight(age: int, config: RegionalPreModelConfig) -> float:
    if age <= 0 or age >= 3:
        return 0.0
    if age == 1:
        return 1.0
    return float(np.exp(-config.kappa) * config.rho_terminal)


def _build_recent_rmuc_match_count_map(canonical_matches: Any) -> dict[tuple[str, int], int]:
    records = canonical_matches[canonical_matches["ruleset_id"] == "RMUC"].copy()
    if records.empty:
        return {}
    count_map: dict[tuple[str, int], int] = {}
    for row in records[["season", "red_school_key", "blue_school_key"]].to_dict(orient="records"):
        season = int(row["season"])
        for school_key in (row["red_school_key"], row["blue_school_key"]):
            key = (str(school_key), season)
            count_map[key] = count_map.get(key, 0) + 1
    return count_map


def _build_rmuc_long_term_base_snapshot(
    posterior: dict[str, Any],
    report: dict[str, Any],
    config: RegionalPreModelConfig,
    canonical_matches: Any,
    target_year: int,
) -> Any:
    pd, _ = require_dataframe_deps()
    school_key_to_index = {key: idx for idx, key in enumerate(report["school_keys"])}
    season_team_to_index = {key: idx for idx, key in enumerate(report["season_team_keys"])}
    u_school = posterior["u_school"]
    recent_match_count_map = _build_recent_rmuc_match_count_map(canonical_matches)
    base_rows = []
    for school_key in report["school_keys"]:
        school_index = school_key_to_index[school_key]
        school_samples = u_school[:, school_index]
        season_terms = []
        recent_terms = []
        terminal_terms = []
        source_seasons = []
        season_match_counts: dict[int, int] = {}
        for season_team_key in report["season_team_keys"]:
            season, key = season_team_key.split(":", 1)
            season = int(season)
            if key != school_key or season >= target_year:
                continue
            season_team_key = f"{season}:{school_key}"
            season_index = season_team_to_index[season_team_key]
            age = max(0, target_year - season)
            season_weight = _historical_season_weight(age, config)
            if season_weight <= 0.0:
                continue
            season_values = posterior["u_season"][:, season_index]
            season_terms.append((season, season_weight, season_values))
            source_seasons.append(season)
            season_match_counts[season] = int(recent_match_count_map.get((school_key, season), 0))
            if age == 2:
                terminal_terms.append((season_weight, season_values))
            else:
                recent_terms.append((season_weight, season_values))

        latest_historical_season = max(source_seasons) if source_seasons else None
        latest_match_count = int(season_match_counts.get(target_year - 1, 0))
        terminal_match_count = int(season_match_counts.get(target_year - 2, 0))
        effective_recent_match_count = float(latest_match_count + (config.rho_terminal * terminal_match_count))
        coverage_strength = min(
            effective_recent_match_count / max(config.recent_match_cap, 1e-6),
            1.0,
        )
        recent_match_share = (
            latest_match_count / max(effective_recent_match_count, 1e-6) if effective_recent_match_count > 1e-9 else 0.0
        )
        school_uncertainty = float(np.std(school_samples))
        certainty = 1.0 / (1.0 + (school_uncertainty / max(config.history_uncertainty_scale, 1e-6)))
        terminal_only_support = latest_match_count == 0 and terminal_match_count > 0
        alpha_effective = config.alpha * (
            config.school_retention_floor + ((1.0 - config.school_retention_floor) * coverage_strength)
        ) * ((1.0 - config.school_uncertainty_weight) + (config.school_uncertainty_weight * certainty))
        if terminal_only_support:
            alpha_effective *= config.school_terminal_only_penalty
        school_values = alpha_effective * school_samples
        if season_terms:
            recent_values_raw = (
                sum(weight * values for weight, values in recent_terms) if recent_terms else np.zeros_like(school_values)
            )
            terminal_values_raw = (
                sum(weight * values for weight, values in terminal_terms) if terminal_terms else np.zeros_like(school_values)
            )
            recent_values = config.recent_season_retention * recent_values_raw
            terminal_values = config.terminal_season_retention * terminal_values_raw
            season_values = recent_values + terminal_values
            latest_season: int | None = latest_historical_season
            source_label = ",".join(str(season) for season in sorted(source_seasons))
            terminal_weight = float(sum(weight for weight, _ in terminal_terms))
            total_weight = float(sum(weight for _, weight, _ in season_terms))
        else:
            season_values = np.zeros_like(school_values)
            recent_values = np.zeros_like(school_values)
            terminal_values = np.zeros_like(school_values)
            latest_season = None
            source_label = ""
            terminal_weight = 0.0
            total_weight = 0.0

        total_values = school_values + season_values
        base_rows.append(
            {
                "school_key": school_key,
                "rmuc_long_term_base_theta_mean": float(np.mean(total_values)),
                "rmuc_long_term_base_theta_sd": float(np.std(total_values)),
                "rmuc_long_term_base_theta_q05": float(np.quantile(total_values, 0.05)),
                "rmuc_long_term_base_theta_q50": float(np.quantile(total_values, 0.50)),
                "rmuc_long_term_base_theta_q95": float(np.quantile(total_values, 0.95)),
                "rmuc_long_term_school_alpha": float(alpha_effective),
                "rmuc_long_term_school_uncertainty": school_uncertainty,
                "rmuc_long_term_school_component_mean": float(np.mean(school_values)),
                "rmuc_long_term_season_component_mean": float(np.mean(season_values)),
                "rmuc_long_term_recent_season_component_mean": float(np.mean(recent_values)),
                "rmuc_long_term_terminal_season_component_mean": float(np.mean(terminal_values)),
                "rmuc_terminal_season_weight": float(terminal_weight / total_weight) if total_weight > 1e-9 else 0.0,
                "rmuc_long_term_base_source_seasons": source_label,
                "rmuc_long_term_base_latest_season": latest_season,
                "rmuc_long_term_base_season_count": int(len(source_seasons)),
                "rmuc_recent_match_count": int(latest_match_count + terminal_match_count),
                "rmuc_recent_match_effective_count": float(effective_recent_match_count),
                "rmuc_latest_season_match_share": float(recent_match_share),
                "rmuc_terminal_only_support": bool(terminal_only_support),
            }
        )
    return pd.DataFrame.from_records(base_rows)[
        [
            "school_key",
            "rmuc_long_term_base_theta_mean",
            "rmuc_long_term_base_theta_sd",
            "rmuc_long_term_base_theta_q05",
            "rmuc_long_term_base_theta_q50",
            "rmuc_long_term_base_theta_q95",
            "rmuc_long_term_school_alpha",
            "rmuc_long_term_school_uncertainty",
            "rmuc_long_term_school_component_mean",
            "rmuc_long_term_season_component_mean",
            "rmuc_long_term_recent_season_component_mean",
            "rmuc_long_term_terminal_season_component_mean",
            "rmuc_terminal_season_weight",
            "rmuc_long_term_base_source_seasons",
            "rmuc_long_term_base_latest_season",
            "rmuc_long_term_base_season_count",
            "rmuc_recent_match_count",
            "rmuc_recent_match_effective_count",
            "rmuc_latest_season_match_share",
            "rmuc_terminal_only_support",
        ]
    ]


def _train_regional_prior_model(
    dataset_dir: Path,
    posterior: dict[str, Any],
    report: dict[str, Any],
    config: RegionalPreModelConfig,
    canonical_matches: Any,
) -> tuple[dict[str, Any], Any]:
    pd, _ = require_dataframe_deps()
    beta_perf = float(np.asarray(posterior["beta_perf"]).mean())
    training_frames = []
    for season in (2024, 2025):
        base_snapshot = _build_rmuc_long_term_base_snapshot(
            posterior,
            report,
            config,
            canonical_matches,
            season,
        )[["school_key", "rmuc_long_term_base_theta_mean"]]
        season_training = build_regional_prior_training_samples(
            dataset_dir=dataset_dir,
            season=season,
            base_snapshot=base_snapshot,
            beta_perf=beta_perf,
            config=config,
        )
        if not season_training.empty:
            training_frames.append(season_training)
    if training_frames:
        training_frame = pd.concat(training_frames, ignore_index=True)
    else:
        training_frame = pd.DataFrame()
    model = fit_regional_prior_model(training_frame, config)
    return model, training_frame


def _load_regional_prior_model(model_dir: Path) -> dict[str, Any]:
    path = model_dir / "regional_prior_model.json"
    if not path.exists():
        pd, _ = require_dataframe_deps()
        return fit_regional_prior_model(pd.DataFrame(), RegionalPreModelConfig())
    return json.loads(path.read_text(encoding="utf-8"))


def _build_regional_pre_snapshot(model_dir: Path, snapshot_date: str) -> Any:
    artifact = load_model_artifact(model_dir)
    report = artifact["report"]
    pd, _ = require_dataframe_deps()
    config_path = Path(report["config_path"])
    config = _load_config(config_path) if config_path.exists() else {}
    regional_cfg = _regional_pre_config(config)
    dataset = read_dataset(Path(report["dataset_path"]))
    snapshot_year = int(snapshot_date[:4])
    prior_model = _load_regional_prior_model(model_dir)

    school_frame = pd.DataFrame({"school_key": report["school_keys"], "school_name": report["school_names"]})
    base_snapshot = _build_rmuc_long_term_base_snapshot(
        artifact["posterior"],
        report,
        regional_cfg,
        dataset["canonical_matches"],
        snapshot_year,
    )
    pre_frame = build_regional_pre_frame(
        Path(report["dataset_path"]),
        snapshot_date,
        prior_model,
        base_snapshot,
        regional_cfg,
    )
    rating_scale = float(report.get("rating_scale", 120.0))

    snapshot = school_frame.merge(base_snapshot, on="school_key", how="left").merge(pre_frame, on=["school_key", "school_name"], how="left")
    snapshot["shape_prior_signal"] = snapshot["shape_prior_signal"].fillna(0.0)
    snapshot["rmul_ranking_signal"] = snapshot["rmul_ranking_signal"].fillna(0.0)
    snapshot["regional_prior_consistency_feature"] = snapshot["regional_prior_consistency_feature"].fillna(0.0)
    snapshot["pre_signal_sd"] = snapshot["pre_signal_sd"].fillna(snapshot["rmuc_long_term_base_theta_sd"])
    snapshot["pre_signal_conflict_flag"] = np.where(snapshot["pre_signal_conflict_flag"].notna(), snapshot["pre_signal_conflict_flag"], False)
    snapshot["regional_prior_score_theta"] = snapshot["regional_prior_score_theta"].fillna(0.0)
    snapshot["regional_prior_effective_theta"] = snapshot["regional_prior_effective_theta"].fillna(0.0)
    snapshot["regional_group_matches_played"] = snapshot["regional_group_matches_played"].fillna(0).astype(int)
    snapshot["regional_post_group_started"] = np.where(
        snapshot["regional_post_group_started"].notna(),
        snapshot["regional_post_group_started"],
        False,
    ).astype(bool)
    snapshot["regional_pre_decay_factor"] = snapshot["regional_pre_decay_factor"].fillna(1.0)
    snapshot["shape_signal_season_count"] = snapshot["shape_signal_season_count"].fillna(0).astype(int)
    snapshot["rmul_ranking_season_count"] = snapshot["rmul_ranking_season_count"].fillna(0).astype(int)
    snapshot["shape_source_years"] = snapshot["shape_source_years"].fillna("")
    snapshot["rmul_ranking_source_years"] = snapshot["rmul_ranking_source_years"].fillna("")
    snapshot["shape_missing_flag"] = snapshot["shape_missing_flag"].fillna(1.0)
    snapshot["rmul_missing_flag"] = snapshot["rmul_missing_flag"].fillna(1.0)
    snapshot["rmuc_long_term_base_rating"] = 1500.0 + (rating_scale * snapshot["rmuc_long_term_base_theta_mean"])
    for column in [
        "shape_evidence_theta",
        "rmul_finish_evidence_theta",
        "rmul_station_calibration_theta",
        "evidence_score_raw",
        "evidence_score_centered",
        "prior_delta_cap_theta",
        "rmuc_history_strength",
        "recent_evidence_support",
        "regional_prior_delta_theta",
    ]:
        snapshot[column] = snapshot[column].fillna(0.0)
    snapshot["regional_prior_score_rating"] = 1500.0 + (rating_scale * snapshot["regional_prior_score_theta"])
    snapshot["regional_prior_delta_rating"] = rating_scale * snapshot["regional_prior_delta_theta"]
    snapshot["regional_pre_blend_lambda"] = np.nan
    snapshot["regional_pre_offset_theta"] = snapshot["regional_prior_delta_theta"]
    snapshot["regional_pre_offset_rating"] = rating_scale * snapshot["regional_pre_offset_theta"]
    snapshot["regional_live_pre_residual_signal"] = snapshot["regional_pre_offset_theta"] * snapshot["regional_pre_decay_factor"]
    snapshot["regional_live_pre_residual_rating"] = rating_scale * snapshot["regional_live_pre_residual_signal"]
    snapshot["regional_prior_effective_theta"] = snapshot["regional_live_pre_residual_signal"]
    snapshot["rmuc_regional_pre_start_theta"] = snapshot["rmuc_long_term_base_theta_mean"] + snapshot["regional_pre_offset_theta"]
    snapshot["rmuc_regional_pre_theta"] = snapshot["rmuc_regional_pre_start_theta"]
    snapshot["rmuc_regional_pre_rating"] = 1500.0 + (rating_scale * snapshot["rmuc_regional_pre_theta"])
    return snapshot


def _build_rmuc_live_state_snapshot(
    summary: Any,
    regional_pre_snapshot: Any,
    snapshot_date: str,
    rating_scale: float,
) -> Any:
    pd, _ = require_dataframe_deps()
    snapshot_year = int(snapshot_date[:4])
    if summary.empty:
        live_snapshot = pd.DataFrame(columns=["school_key", "state_theta_mean", "state_theta_sd", "state_latest_date"])
    else:
        live_snapshot = (
            summary[
                (summary["season"] == snapshot_year)
                & (summary["date_bucket"] <= snapshot_date)
            ]
            .sort_values(["school_key", "date_bucket"], kind="stable")
            .groupby("school_key", as_index=False)
            .tail(1)
            .rename(
                columns={
                    "mean": "state_theta_mean",
                    "sd": "state_theta_sd",
                    "date_bucket": "state_latest_date",
                }
            )[["school_key", "state_theta_mean", "state_theta_sd", "state_latest_date"]]
        )

    snapshot = regional_pre_snapshot.merge(live_snapshot, on="school_key", how="left")
    has_live = (
        snapshot["state_theta_mean"].notna()
        & (
            (snapshot["regional_group_matches_played"] > 0)
            | snapshot["regional_post_group_started"]
        )
    )
    snapshot["rmuc_live_state_theta_mean"] = np.where(
        has_live,
        snapshot["state_theta_mean"] - snapshot["rmuc_long_term_base_theta_mean"],
        0.0,
    )
    snapshot["rmuc_live_state_theta_sd"] = np.where(
        has_live,
        snapshot["state_theta_sd"].fillna(snapshot["rmuc_long_term_base_theta_sd"]),
        snapshot["rmuc_long_term_base_theta_sd"],
    )
    snapshot["rmuc_live_state_rating"] = rating_scale * snapshot["rmuc_live_state_theta_mean"]
    snapshot["rmuc_live_state_latest_date"] = np.where(has_live, snapshot["state_latest_date"], None)
    prior_components = snapshot.apply(
        lambda row: compute_regional_prior_runtime_components(
            prior_theta=float(row["regional_pre_offset_theta"]),
            live_state_theta=float(row["rmuc_live_state_theta_mean"]),
            decay_factor=float(row["regional_pre_decay_factor"]),
        ),
        axis=1,
        result_type="expand",
    )
    snapshot["regional_live_pre_confirmed_signal"] = prior_components[0]
    snapshot["regional_live_pre_residual_signal"] = prior_components[1]
    snapshot["regional_live_pre_confirmed_rating"] = rating_scale * snapshot["regional_live_pre_confirmed_signal"]
    snapshot["rmuc_regional_live_theta"] = (
        snapshot["rmuc_long_term_base_theta_mean"]
        + snapshot["regional_live_pre_confirmed_signal"]
        + snapshot["regional_live_pre_residual_signal"]
        + snapshot["rmuc_live_state_theta_mean"]
    )
    snapshot["rmuc_regional_live_rating"] = 1500.0 + (rating_scale * snapshot["rmuc_regional_live_theta"])
    return snapshot[
        [
            "school_key",
            "rmuc_live_state_theta_mean",
            "rmuc_live_state_theta_sd",
            "rmuc_live_state_rating",
            "rmuc_live_state_latest_date",
            "regional_live_pre_confirmed_signal",
            "regional_live_pre_confirmed_rating",
            "rmuc_regional_live_theta",
            "rmuc_regional_live_rating",
        ]
    ]


def compute_published_rating(
    program_base_theta: float,
    prior_theta: float,
    confirmed_prior_theta: float,
    decay_factor: float,
    live_state_theta: float,
    rating_scale: float,
) -> float:
    total_theta = (
        float(program_base_theta)
        + float(confirmed_prior_theta)
        + (float(prior_theta) * float(decay_factor))
        + float(live_state_theta)
    )
    return 1500.0 + (float(rating_scale) * total_theta)


def build_published_preseason_snapshot(
    snapshot: Any,
    season: int,
    freeze_date: str,
    rating_scale: float,
) -> Any:
    pd, _ = require_dataframe_deps()
    frame = snapshot.copy()
    if "school_name" not in frame.columns:
        frame["school_name"] = frame["school_key"]
    frame = frame[["school_key", "school_name", "rmuc_long_term_base_theta_mean", "regional_pre_offset_theta"]].copy()
    frame = frame.rename(
        columns={
            "rmuc_long_term_base_theta_mean": "rmuc_program_base_theta",
            "regional_pre_offset_theta": "regional_prior_theta",
        }
    )
    frame["season"] = int(season)
    frame["freeze_date"] = str(freeze_date)
    frame["regional_prior_decay_version"] = "regional_group_linear_3_match_v1"
    frame["rating_scale"] = float(rating_scale)
    frame["published_regional_pre_rating"] = frame.apply(
        lambda row: compute_published_rating(
            program_base_theta=float(row["rmuc_program_base_theta"]),
            prior_theta=float(row["regional_prior_theta"]),
            confirmed_prior_theta=0.0,
            decay_factor=1.0,
            live_state_theta=0.0,
            rating_scale=float(rating_scale),
        ),
        axis=1,
    )
    return frame[
        [
            "school_key",
            "school_name",
            "season",
            "freeze_date",
            "rmuc_program_base_theta",
            "regional_prior_theta",
            "regional_prior_decay_version",
            "rating_scale",
            "published_regional_pre_rating",
        ]
    ].sort_values(["school_key"], kind="stable").reset_index(drop=True)


def _published_match_stage_family(match_row: dict[str, Any]) -> str:
    stage_family = str(match_row.get("stage_family", "") or "")
    if stage_family:
        return stage_family
    stage_id = str(match_row.get("stage_id", "") or "")
    if stage_id == "rmuc_regional_group":
        return "regional_group"
    if stage_id == "rmuc_regional_knockout":
        return "post_group"
    if stage_id.startswith("rmuc_repechage"):
        return "repechage"
    if stage_id.startswith("rmuc_national"):
        return "nationals"
    return "other"


def _infer_live_delta_map_from_summary(
    summary: Any,
    canonical_matches: Any,
    season: int,
    snapshot_date: str,
    base_theta_map: dict[str, float],
) -> dict[str, dict[str, float]]:
    if summary.empty:
        return {}
    pd, _ = require_dataframe_deps()
    season_summary = summary[(summary["season"] == season) & (summary["date_bucket"] <= snapshot_date)].copy()
    if season_summary.empty:
        return {}
    season_summary = season_summary.sort_values(["school_key", "date_bucket"], kind="stable").reset_index(drop=True)
    season_summary["live_theta"] = season_summary.apply(
        lambda row: float(row["mean"]) - float(base_theta_map.get(str(row["school_key"]), 0.0)),
        axis=1,
    )
    season_summary["prev_live_theta"] = season_summary.groupby("school_key", sort=False)["live_theta"].shift(1).fillna(0.0)
    season_summary["day_live_delta"] = season_summary["live_theta"] - season_summary["prev_live_theta"]

    rmuc_matches = canonical_matches[
        (canonical_matches["season"] == season)
        & (canonical_matches["ruleset_id"] == "RMUC")
        & (canonical_matches["match_date"] <= snapshot_date)
    ].copy()
    if rmuc_matches.empty:
        return {}
    day_counts: dict[tuple[str, str], int] = defaultdict(int)
    for row in rmuc_matches[["match_id", "match_date", "red_school_key", "blue_school_key"]].to_dict(orient="records"):
        match_date = str(row["match_date"])
        for school_key in (str(row["red_school_key"]), str(row["blue_school_key"])):
            day_counts[(school_key, match_date)] += 1

    day_delta_map = {
        (str(row["school_key"]), str(row["date_bucket"])): float(row["day_live_delta"])
        for row in season_summary[["school_key", "date_bucket", "day_live_delta"]].to_dict(orient="records")
    }
    per_match_sequence: dict[tuple[str, str], int] = defaultdict(int)
    live_delta_map: dict[str, dict[str, float]] = {}
    for row in rmuc_matches.sort_values(["match_date", "match_id"], kind="stable").to_dict(orient="records"):
        match_id = str(row["match_id"])
        match_date = str(row["match_date"])
        payload: dict[str, float] = {}
        for school_key in (str(row["red_school_key"]), str(row["blue_school_key"])):
            per_match_sequence[(school_key, match_date)] += 1
            total = max(day_counts.get((school_key, match_date), 0), 1)
            day_delta = day_delta_map.get((school_key, match_date), 0.0)
            payload[school_key] = float(day_delta) / float(total)
        live_delta_map[match_id] = payload
    return live_delta_map


def build_published_live_state_updates(
    preseason_snapshot: Any,
    live_state_store: Any,
    new_matches: Any,
    live_delta_map: dict[str, dict[str, float]],
    rating_scale: float,
    pre_decay_matches: int,
) -> Any:
    pd, _ = require_dataframe_deps()
    if new_matches.empty:
        return pd.DataFrame(
            columns=[
                "match_id",
                "match_date",
                "season",
                "school_key",
                "school_name",
                "stage_family",
                "live_state_theta_after_match",
                "regional_group_matches_played",
                "pre_decay_factor_after_match",
                "published_rating_after_match",
            ]
        )

    existing = live_state_store.copy()
    existing_match_school = set()
    if not existing.empty:
        existing_match_school = {
            (str(row["match_id"]), str(row["school_key"]))
            for row in existing[["match_id", "school_key"]].to_dict(orient="records")
        }

    preseason_rows = preseason_snapshot.to_dict(orient="records")
    base_theta_map = {str(row["school_key"]): float(row["rmuc_program_base_theta"]) for row in preseason_rows}
    prior_theta_map = {str(row["school_key"]): float(row["regional_prior_theta"]) for row in preseason_rows}
    school_name_map = {str(row["school_key"]): str(row.get("school_name", row["school_key"])) for row in preseason_rows}
    season_map = {str(row["school_key"]): int(row["season"]) for row in preseason_rows}

    current_live_map = {key: 0.0 for key in base_theta_map}
    current_group_count_map = {key: 0 for key in base_theta_map}
    current_confirmed_prior_map = {key: 0.0 for key in base_theta_map}
    if not existing.empty:
        latest_existing = existing.sort_values(["match_date", "match_id"], kind="stable").groupby("school_key", as_index=False).tail(1)
        for row in latest_existing.to_dict(orient="records"):
            school_key = str(row["school_key"])
            current_live_map[school_key] = float(row["live_state_theta_after_match"])
            current_group_count_map[school_key] = int(row["regional_group_matches_played"])
            current_confirmed_prior_map[school_key] = float(row.get("confirmed_prior_theta_after_match", 0.0))

    update_rows: list[dict[str, Any]] = []
    for match in new_matches.sort_values(["match_date", "match_id"], kind="stable").to_dict(orient="records"):
        if str(match.get("ruleset_id")) != "RMUC":
            continue
        match_id = str(match["match_id"])
        match_date = str(match["match_date"])
        season = int(match["season"])
        stage_family = _published_match_stage_family(match)
        for school_key in (str(match["red_school_key"]), str(match["blue_school_key"])):
            if (match_id, school_key) in existing_match_school:
                continue
            if school_key not in base_theta_map:
                continue
            current_live = float(current_live_map.get(school_key, 0.0))
            delta = float(live_delta_map.get(match_id, {}).get(school_key, 0.0))
            new_live = current_live + delta
            current_live_map[school_key] = new_live

            if stage_family == "regional_group":
                current_group_count_map[school_key] = int(current_group_count_map.get(school_key, 0)) + 1
            decay_factor = (
                0.0
                if stage_family in {"post_group", "repechage", "nationals"}
                else _regional_group_decay_factor(int(current_group_count_map.get(school_key, 0)), pre_decay_matches)
            )
            confirmed_prior_theta, residual_prior_theta = compute_regional_prior_runtime_components(
                prior_theta=float(prior_theta_map.get(school_key, 0.0)),
                live_state_theta=float(new_live),
                decay_factor=float(decay_factor),
            )
            current_confirmed_prior_map[school_key] = float(confirmed_prior_theta)
            update_rows.append(
                {
                    "match_id": match_id,
                    "match_date": match_date,
                    "season": season,
                    "school_key": school_key,
                    "school_name": school_name_map.get(school_key, school_key),
                    "stage_family": stage_family,
                    "live_state_theta_after_match": new_live,
                    "confirmed_prior_theta_after_match": float(confirmed_prior_theta),
                    "residual_prior_theta_after_match": float(residual_prior_theta),
                    "regional_group_matches_played": int(current_group_count_map.get(school_key, 0)),
                    "pre_decay_factor_after_match": float(decay_factor),
                    "published_rating_after_match": compute_published_rating(
                        program_base_theta=float(base_theta_map.get(school_key, 0.0)),
                        prior_theta=float(prior_theta_map.get(school_key, 0.0)),
                        confirmed_prior_theta=float(confirmed_prior_theta),
                        decay_factor=float(decay_factor),
                        live_state_theta=float(new_live),
                        rating_scale=float(rating_scale),
                    ),
                }
            )
    return pd.DataFrame.from_records(update_rows)


def _build_published_current_snapshot(
    preseason_snapshot: Any,
    live_state_store: Any,
    rating_scale: float,
    season: int,
) -> Any:
    pd, _ = require_dataframe_deps()
    current = preseason_snapshot.copy()
    current["rmuc_live_state_theta"] = 0.0
    current["confirmed_prior_theta"] = 0.0
    current["residual_prior_theta"] = current["regional_prior_theta"]
    current["regional_group_matches_played"] = 0
    current["regional_pre_decay_factor"] = 1.0
    current["current_stage_family"] = "regional_pre"
    if not live_state_store.empty:
        latest = (
            live_state_store.sort_values(["match_date", "match_id"], kind="stable")
            .groupby("school_key", as_index=False)
            .tail(1)
            .rename(
                columns={
                    "live_state_theta_after_match": "rmuc_live_state_theta",
                    "confirmed_prior_theta_after_match": "confirmed_prior_theta",
                    "residual_prior_theta_after_match": "residual_prior_theta",
                    "pre_decay_factor_after_match": "regional_pre_decay_factor",
                    "stage_family": "current_stage_family",
                }
            )[
                [
                    "school_key",
                    "rmuc_live_state_theta",
                    "confirmed_prior_theta",
                    "residual_prior_theta",
                    "regional_group_matches_played",
                    "regional_pre_decay_factor",
                    "current_stage_family",
                ]
            ]
        )
        current = current.drop(columns=["rmuc_live_state_theta", "confirmed_prior_theta", "residual_prior_theta", "regional_group_matches_played", "regional_pre_decay_factor", "current_stage_family"]).merge(
            latest,
            on="school_key",
            how="left",
        )
        current["rmuc_live_state_theta"] = current["rmuc_live_state_theta"].fillna(0.0)
        current["confirmed_prior_theta"] = current["confirmed_prior_theta"].fillna(0.0)
        current["residual_prior_theta"] = current["residual_prior_theta"].fillna(current["regional_prior_theta"])
        current["regional_group_matches_played"] = current["regional_group_matches_played"].fillna(0).astype(int)
        current["regional_pre_decay_factor"] = current["regional_pre_decay_factor"].fillna(1.0)
        current["current_stage_family"] = current["current_stage_family"].fillna("regional_pre")

    current["season"] = int(season)
    current["published_theta"] = (
        current["rmuc_program_base_theta"]
        + current["confirmed_prior_theta"]
        + current["residual_prior_theta"]
        + current["rmuc_live_state_theta"]
    )
    current["published_rating"] = 1500.0 + (float(rating_scale) * current["published_theta"])
    return current


def build_carryover_seed_snapshot(
    final_snapshot: Any,
    target_season: int,
    match_cap: float,
    uncertainty_scale: float,
) -> Any:
    pd, _ = require_dataframe_deps()
    frame = final_snapshot.copy()
    coverage_strength = np.clip(frame["rmuc_official_match_count"].astype(float) / max(float(match_cap), 1e-6), 0.0, 1.0)
    certainty = 1.0 / (1.0 + (frame["rmuc_live_state_theta_sd"].astype(float) / max(float(uncertainty_scale), 1e-6)))
    frame["carryover_factor"] = coverage_strength * certainty
    frame["carryover_live_state_theta"] = frame["carryover_factor"] * frame["rmuc_live_state_theta_final"].astype(float)
    result = frame[
        [
            "school_key",
            "school_name",
            "carryover_factor",
            "carryover_live_state_theta",
        ]
    ].copy()
    result["season"] = int(target_season)
    return result[
        [
            "school_key",
            "school_name",
            "season",
            "carryover_factor",
            "carryover_live_state_theta",
        ]
    ].sort_values(["school_key"], kind="stable").reset_index(drop=True)


def export_published_rating_artifacts(model_dir: Path, snapshot_date: str, out_dir: Path) -> dict[str, Path]:
    pd, _ = require_dataframe_deps()
    artifact = load_model_artifact(model_dir)
    report = artifact["report"]
    dataset = read_dataset(Path(report["dataset_path"]))
    rating_scale = float(report.get("rating_scale", 120.0))
    regional_pre_snapshot = _build_regional_pre_snapshot(model_dir, snapshot_date)
    season = int(snapshot_date[:4])

    preseason_snapshot = build_published_preseason_snapshot(
        snapshot=regional_pre_snapshot[["school_key", "school_name", "rmuc_long_term_base_theta_mean", "regional_pre_offset_theta"]],
        season=season,
        freeze_date=snapshot_date,
        rating_scale=rating_scale,
    )
    base_theta_map = {
        str(row["school_key"]): float(row["rmuc_program_base_theta"])
        for row in preseason_snapshot[["school_key", "rmuc_program_base_theta"]].to_dict(orient="records")
    }
    official_matches = dataset["canonical_matches"][
        (dataset["canonical_matches"]["season"] == season)
        & (dataset["canonical_matches"]["ruleset_id"] == "RMUC")
        & (dataset["canonical_matches"]["match_date"] <= snapshot_date)
    ].copy()
    live_delta_map = _infer_live_delta_map_from_summary(
        summary=artifact["summary"],
        canonical_matches=dataset["canonical_matches"],
        season=season,
        snapshot_date=snapshot_date,
        base_theta_map=base_theta_map,
    )
    live_state_updates = build_published_live_state_updates(
        preseason_snapshot=preseason_snapshot,
        live_state_store=pd.DataFrame(),
        new_matches=official_matches,
        live_delta_map=live_delta_map,
        rating_scale=rating_scale,
        pre_decay_matches=int(_regional_pre_config(_load_config(Path(report["config_path"]))).pre_decay_matches),
    )

    current_snapshot = _build_published_current_snapshot(
        preseason_snapshot=preseason_snapshot,
        live_state_store=live_state_updates,
        rating_scale=rating_scale,
        season=season,
    )
    preseason_history = preseason_snapshot[
        [
            "school_key",
            "school_name",
            "season",
            "freeze_date",
            "rmuc_program_base_theta",
            "regional_prior_theta",
            "published_regional_pre_rating",
        ]
    ].copy()
    preseason_history["entry_type"] = "preseason"
    preseason_history["match_id"] = None
    preseason_history["match_date"] = preseason_history["freeze_date"]
    preseason_history["live_state_theta_after_match"] = 0.0
    preseason_history["regional_group_matches_played"] = 0
    preseason_history["pre_decay_factor_after_match"] = 1.0
    preseason_history["published_rating_after_match"] = preseason_history["published_regional_pre_rating"]
    live_history = live_state_updates.copy()
    if not live_history.empty:
        live_history["entry_type"] = "match_update"
        live_history["freeze_date"] = snapshot_date
        live_history["rmuc_program_base_theta"] = live_history["school_key"].map(
            preseason_snapshot.set_index("school_key")["rmuc_program_base_theta"].to_dict()
        )
        live_history["regional_prior_theta"] = live_history["school_key"].map(
            preseason_snapshot.set_index("school_key")["regional_prior_theta"].to_dict()
        )
    published_rating_history = pd.concat(
        [
            preseason_history[
                [
                    "entry_type",
                    "match_id",
                    "match_date",
                    "freeze_date",
                    "season",
                    "school_key",
                    "school_name",
                    "rmuc_program_base_theta",
                    "regional_prior_theta",
                    "live_state_theta_after_match",
                    "regional_group_matches_played",
                    "pre_decay_factor_after_match",
                    "published_rating_after_match",
                ]
            ],
            live_history[
                [
                    "entry_type",
                    "match_id",
                    "match_date",
                    "freeze_date",
                    "season",
                    "school_key",
                    "school_name",
                    "rmuc_program_base_theta",
                    "regional_prior_theta",
                    "live_state_theta_after_match",
                    "regional_group_matches_played",
                    "pre_decay_factor_after_match",
                    "published_rating_after_match",
                ]
            ]
            if not live_history.empty
            else pd.DataFrame(),
        ],
        ignore_index=True,
    )
    final_snapshot = current_snapshot.copy()
    final_snapshot["rmuc_live_state_theta_final"] = final_snapshot["rmuc_live_state_theta"]
    final_snapshot["rmuc_live_state_theta_sd"] = float(np.asarray(artifact["posterior"]["beta_perf"]).mean())
    official_match_count_map = defaultdict(int)
    for row in official_matches[["red_school_key", "blue_school_key"]].to_dict(orient="records"):
        official_match_count_map[str(row["red_school_key"])] += 1
        official_match_count_map[str(row["blue_school_key"])] += 1
    final_snapshot["rmuc_official_match_count"] = final_snapshot["school_key"].map(lambda key: int(official_match_count_map.get(str(key), 0)))
    final_snapshot["final_2026_theta"] = final_snapshot["rmuc_program_base_theta"] + final_snapshot["rmuc_live_state_theta_final"]
    final_snapshot["final_2026_rating"] = 1500.0 + (rating_scale * final_snapshot["final_2026_theta"])
    carryover_seed = build_carryover_seed_snapshot(
        final_snapshot=final_snapshot,
        target_season=season + 1,
        match_cap=float(_regional_pre_config(_load_config(Path(report["config_path"]))).recent_match_cap),
        uncertainty_scale=float(_regional_pre_config(_load_config(Path(report["config_path"]))).history_uncertainty_scale),
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    preseason_path = out_dir / "preseason_snapshot.parquet"
    live_updates_path = out_dir / "live_state_updates.parquet"
    rating_history_path = out_dir / "published_rating_history.parquet"
    current_snapshot_path = out_dir / "current_snapshot.parquet"
    final_path = out_dir / "final_2026_snapshot.parquet"
    carryover_path = out_dir.parent / f"published_{season + 1}" / "carryover_seed.parquet"
    manifest_path = out_dir / "published_manifest.json"

    _save_tabular_outputs(preseason_snapshot, preseason_path)
    _save_tabular_outputs(live_state_updates, live_updates_path)
    _save_tabular_outputs(published_rating_history, rating_history_path)
    _save_tabular_outputs(current_snapshot, current_snapshot_path)
    _save_tabular_outputs(final_snapshot, final_path)
    _save_tabular_outputs(carryover_seed, carryover_path)
    _save_json(
        manifest_path,
        {
            "season": season,
            "snapshot_date": snapshot_date,
            "rating_scale": rating_scale,
            "beta_perf": float(np.asarray(artifact["posterior"]["beta_perf"]).mean()),
            "source_model_dir": str(model_dir),
            "preseason_snapshot_path": str(preseason_path),
            "live_state_updates_path": str(live_updates_path),
            "published_rating_history_path": str(rating_history_path),
            "current_snapshot_path": str(current_snapshot_path),
            "final_snapshot_path": str(final_path),
            "carryover_seed_path": str(carryover_path),
        },
    )
    return {
        "preseason_snapshot_path": preseason_path,
        "live_state_updates_path": live_updates_path,
        "published_rating_history_path": rating_history_path,
        "current_snapshot_path": current_snapshot_path,
        "final_snapshot_path": final_path,
        "carryover_seed_path": carryover_path,
        "published_manifest_path": manifest_path,
    }


def run_fit(dataset_dir: Path, config_path: Path, out_dir: Path) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    dataset = read_dataset(dataset_dir)
    config = json.loads(json.dumps(_load_config(config_path)))
    regional_cfg = _regional_pre_config(config)
    max_train_matches = config["training"].get("max_train_matches")
    prepared = prepare_model_data(
        dataset["canonical_matches"],
        dataset["school_static_features"],
        max_train_matches=max_train_matches,
    )
    used_matches = dataset["canonical_matches"].iloc[: len(prepared.arrays["match_red_wins"])].reset_index(drop=True)
    posterior = fit_numpyro_model(prepared, config)

    summary_frame, timeline_frame = build_state_summary_frames(prepared, posterior)
    predictions_frame = build_prediction_frame(prepared, posterior, used_matches, split_name="train")

    out_dir.mkdir(parents=True, exist_ok=True)
    posterior_summary_path = out_dir / "posterior_summary.parquet"
    ratings_timeline_path = out_dir / "ratings_timeline.parquet"
    match_predictions_path = out_dir / "match_predictions.parquet"
    posterior_samples_path = out_dir / "posterior_samples.npz"
    model_report_path = out_dir / "model_report.json"
    model_selection_report_path = out_dir / "model_selection_report.json"
    regional_prior_model_path = out_dir / "regional_prior_model.json"
    regional_prior_training_path = out_dir / "regional_prior_training_samples.parquet"

    summary_frame.to_parquet(posterior_summary_path, index=False)
    timeline_frame.to_parquet(ratings_timeline_path, index=False)
    predictions_frame.to_parquet(match_predictions_path, index=False)

    sample_arrays = {key: value for key, value in posterior.items() if isinstance(value, np.ndarray)}
    _save_npz(posterior_samples_path, sample_arrays)

    regional_prior_model, regional_prior_training = _train_regional_prior_model(
        dataset_dir=dataset_dir,
        posterior=posterior,
        report={
            "school_keys": prepared.school_keys,
            "season_team_keys": prepared.season_team_keys,
        },
        config=regional_cfg,
        canonical_matches=dataset["canonical_matches"],
    )
    _save_json(regional_prior_model_path, regional_prior_model)
    _save_tabular_outputs(regional_prior_training, regional_prior_training_path)

    diagnostics = posterior["diagnostics"]
    _save_json(model_selection_report_path, build_selection_report_payload(regional_cfg))
    report = {
        "artifact_version": schemas.MODEL_ARTIFACT_VERSION,
        "created_at": datetime.now(tz=UTC).isoformat(),
        "dataset_path": str(dataset_dir),
        "config_path": str(config_path),
        "rating_scale": float(config.get("outputs", {}).get("rating_scale", 120.0)),
        "inference_mode": posterior["inference_mode"],
        "match_count": int(len(used_matches)),
        "school_count": len(prepared.school_keys),
        "season_team_count": len(prepared.season_team_keys),
        "state_count": len(prepared.state_rows),
        "stage_values": prepared.stage_values,
        "format_values": prepared.format_values,
        "ruleset_values": prepared.ruleset_values,
        "school_keys": prepared.school_keys,
        "school_names": prepared.school_names,
        "season_team_keys": prepared.season_team_keys,
        "team_last_state_index": prepared.team_last_state_index,
        "state_rows": _serializable_state_rows(prepared.state_rows),
        "feature_names": prepared.feature_names,
        "posterior_samples_path": str(posterior_samples_path),
        "posterior_summary_path": str(posterior_summary_path),
        "ratings_timeline_path": str(ratings_timeline_path),
        "match_predictions_path": str(match_predictions_path),
        "model_selection_report_path": str(model_selection_report_path),
        "regional_prior_model_path": str(regional_prior_model_path),
        "regional_prior_training_path": str(regional_prior_training_path),
        "diagnostics": diagnostics,
        "posterior_means": {
            "sigma_drift": float(np.asarray(sample_arrays["sigma_drift"]).mean()),
            "beta_perf": float(np.asarray(sample_arrays["beta_perf"]).mean()),
            "alpha_side": float(np.asarray(sample_arrays.get("alpha_side", np.array([0.0]))).mean()),
        },
    }
    _save_json(model_report_path, report)
    return {
        "posterior_summary_path": posterior_summary_path,
        "ratings_timeline_path": ratings_timeline_path,
        "match_predictions_path": match_predictions_path,
        "posterior_samples_path": posterior_samples_path,
        "model_report_path": model_report_path,
        "model_selection_report_path": model_selection_report_path,
    }


def _load_config(path: Path) -> dict[str, Any]:
    from .ingest import load_config

    return load_config(path)


def load_model_artifact(model_dir: Path) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    report = json.loads((model_dir / "model_report.json").read_text(encoding="utf-8"))
    posterior = np.load(model_dir / "posterior_samples.npz", allow_pickle=False)
    timeline = pd.read_parquet(model_dir / "ratings_timeline.parquet")
    summary = pd.read_parquet(model_dir / "posterior_summary.parquet")
    return {
        "report": report,
        "posterior": {key: posterior[key] for key in posterior.files},
        "timeline": timeline,
        "summary": summary,
    }


def _resolve_team_state(report: dict[str, Any], school_key: str, match_date: str) -> tuple[int | None, str | None]:
    season = int(match_date[:4])
    season_team_key = f"{season}:{school_key}"
    state_rows = report["state_rows"]
    matching = [row for row in state_rows if row["season_team_key"] == season_team_key and row["date_bucket"] <= match_date]
    if not matching:
        fallback = [row for row in state_rows if row["school_key"] == school_key]
        if not fallback:
            return None, None
        chosen = fallback[-1]
    else:
        chosen = matching[-1]
    return int(chosen["state_index"]), str(chosen["date_bucket"])


def predict_from_artifact(
    model_dir: Path,
    school_a: str,
    school_b: str,
    match_date: str,
    stage: str,
    best_of: int,
    ruleset: str,
) -> dict[str, Any]:
    artifact = load_model_artifact(model_dir)
    report = artifact["report"]
    import pandas as pd

    school_table = pd.DataFrame({"school_key": report["school_keys"], "school_name": report["school_names"]})
    school_a_key = resolve_school_identifier(school_a, school_table)
    school_b_key = resolve_school_identifier(school_b, school_table)
    school_key_to_index = {key: idx for idx, key in enumerate(report["school_keys"])}

    red_state_idx, red_state_date = _resolve_team_state(report, school_a_key, match_date)
    blue_state_idx, blue_state_date = _resolve_team_state(report, school_b_key, match_date)

    posterior = artifact["posterior"]
    theta_state = posterior["theta_state"]
    beta_perf = posterior["beta_perf"]

    red_theta = (
        posterior["u_school"][:, school_key_to_index[school_a_key]]
        if red_state_idx is None
        else theta_state[:, red_state_idx]
    )
    blue_theta = (
        posterior["u_school"][:, school_key_to_index[school_b_key]]
        if blue_state_idx is None
        else theta_state[:, blue_state_idx]
    )

    logits = (
        red_theta
        - blue_theta
    ) / beta_perf
    p_red = 1.0 / (1.0 + np.exp(-logits))
    return {
        "team_a": school_a_key,
        "team_b": school_b_key,
        "match_date": match_date,
        "stage": stage,
        "best_of": int(best_of),
        "ruleset": ruleset,
        "p_red_win": float(np.mean(p_red)),
        "p_blue_win": float(1.0 - np.mean(p_red)),
        "p_red_q05": float(np.quantile(p_red, 0.05)),
        "p_red_q95": float(np.quantile(p_red, 0.95)),
        "red_state_date": red_state_date,
        "blue_state_date": blue_state_date,
    }


def predict_stage_from_artifact(
    model_dir: Path,
    school_a: str,
    school_b: str,
    match_date: str,
    mode: str,
) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    artifact = load_model_artifact(model_dir)
    snapshot = _build_regional_pre_snapshot(model_dir, match_date)
    live_snapshot = _build_rmuc_live_state_snapshot(
        artifact["summary"],
        snapshot,
        match_date,
        float(artifact["report"].get("rating_scale", 120.0)),
    )
    snapshot = snapshot.merge(live_snapshot, on="school_key", how="left")
    school_table = snapshot[["school_key", "school_name"]].copy()
    school_a_key = resolve_school_identifier(school_a, school_table)
    school_b_key = resolve_school_identifier(school_b, school_table)
    row_a = snapshot[snapshot["school_key"] == school_a_key].iloc[0]
    row_b = snapshot[snapshot["school_key"] == school_b_key].iloc[0]

    beta_perf = float(np.asarray(artifact["posterior"]["beta_perf"]).mean())

    if mode == "rmuc_regional_pre":
        theta_a = float(row_a["rmuc_regional_pre_theta"])
        theta_b = float(row_b["rmuc_regional_pre_theta"])
        prior_a = float(row_a["regional_pre_offset_theta"])
        prior_b = float(row_b["regional_pre_offset_theta"])
        live_a = 0.0
        live_b = 0.0
        residual_a = float(row_a["regional_live_pre_residual_signal"])
        residual_b = float(row_b["regional_live_pre_residual_signal"])
    elif mode == "rmuc_regional_live":
        theta_a = float(row_a["rmuc_regional_live_theta"])
        theta_b = float(row_b["rmuc_regional_live_theta"])
        live_a = float(row_a["rmuc_live_state_theta_mean"])
        live_b = float(row_b["rmuc_live_state_theta_mean"])
        residual_a = float(row_a["regional_live_pre_residual_signal"])
        residual_b = float(row_b["regional_live_pre_residual_signal"])
        prior_a = float(row_a["regional_pre_offset_theta"])
        prior_b = float(row_b["regional_pre_offset_theta"])
    elif mode in {"rmuc_repechage", "rmuc_nationals"}:
        theta_a = float(row_a["rmuc_long_term_base_theta_mean"] + row_a["rmuc_live_state_theta_mean"])
        theta_b = float(row_b["rmuc_long_term_base_theta_mean"] + row_b["rmuc_live_state_theta_mean"])
        live_a = float(row_a["rmuc_live_state_theta_mean"])
        live_b = float(row_b["rmuc_live_state_theta_mean"])
        residual_a = 0.0
        residual_b = 0.0
        prior_a = 0.0
        prior_b = 0.0
    else:
        theta_a = float(row_a["rmuc_long_term_base_theta_mean"])
        theta_b = float(row_b["rmuc_long_term_base_theta_mean"])
        prior_a = 0.0
        prior_b = 0.0
        live_a = 0.0
        live_b = 0.0
        residual_a = 0.0
        residual_b = 0.0

    probability = 1.0 / (1.0 + np.exp(-((theta_a - theta_b) / beta_perf)))
    payload = {
        "mode": mode,
        "team_a": school_a_key,
        "team_b": school_b_key,
        "match_date": match_date,
        "base_component": {
            "rmuc_long_term_base": {
                "team_a": float(row_a["rmuc_long_term_base_theta_mean"]),
                "team_b": float(row_b["rmuc_long_term_base_theta_mean"]),
            },
        },
        "regional_prior_component": {
            "team_a": float(prior_a),
            "team_b": float(prior_b),
        },
        "regional_prior_score_component": {
            "team_a": float(row_a.get("regional_prior_score_theta", row_a["rmuc_regional_pre_theta"])),
            "team_b": float(row_b.get("regional_prior_score_theta", row_b["rmuc_regional_pre_theta"])),
        },
        "total_probability": float(probability),
        "team_a_probability": float(probability),
        "team_b_probability": float(1.0 - probability),
    }
    if mode in {"rmuc_regional_live", "rmuc_repechage", "rmuc_nationals"}:
        payload["live_state_component"] = {"team_a": live_a, "team_b": live_b}
    if mode == "rmuc_regional_live":
        payload["pre_residual_component"] = {
            "team_a": residual_a,
            "team_b": residual_b,
            "decay_factor_team_a": float(row_a.get("regional_pre_decay_factor", 0.0)),
            "decay_factor_team_b": float(row_b.get("regional_pre_decay_factor", 0.0)),
        }
    return payload


def predict_stage_from_published(
    published_dir: Path,
    school_a: str,
    school_b: str,
    match_date: str,
    mode: str,
) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    manifest = json.loads((published_dir / "published_manifest.json").read_text(encoding="utf-8"))
    preseason = pd.read_parquet(published_dir / "preseason_snapshot.parquet")
    live_updates_path = published_dir / "live_state_updates.parquet"
    live_updates = pd.read_parquet(live_updates_path) if live_updates_path.exists() else pd.DataFrame()
    school_table = preseason[["school_key", "school_name"]].copy()
    school_a_key = resolve_school_identifier(school_a, school_table)
    school_b_key = resolve_school_identifier(school_b, school_table)
    rating_scale = float(manifest["rating_scale"])
    beta_perf = float(manifest["beta_perf"])
    season = int(manifest["season"])

    current = _build_published_current_snapshot(
        preseason_snapshot=preseason,
        live_state_store=live_updates[live_updates["match_date"] <= match_date].copy() if not live_updates.empty else live_updates,
        rating_scale=rating_scale,
        season=season,
    )
    row_a = current[current["school_key"] == school_a_key].iloc[0]
    row_b = current[current["school_key"] == school_b_key].iloc[0]
    if mode == "rmuc_regional_pre":
        theta_a = float(row_a["rmuc_program_base_theta"] + row_a["regional_prior_theta"])
        theta_b = float(row_b["rmuc_program_base_theta"] + row_b["regional_prior_theta"])
        residual_a = float(row_a["regional_prior_theta"])
        residual_b = float(row_b["regional_prior_theta"])
        live_a = 0.0
        live_b = 0.0
    elif mode == "rmuc_regional_live":
        theta_a = float(row_a["published_theta"])
        theta_b = float(row_b["published_theta"])
        residual_a = float(row_a["regional_prior_theta"] * row_a["regional_pre_decay_factor"])
        residual_b = float(row_b["regional_prior_theta"] * row_b["regional_pre_decay_factor"])
        live_a = float(row_a["rmuc_live_state_theta"])
        live_b = float(row_b["rmuc_live_state_theta"])
    else:
        theta_a = float(row_a["rmuc_program_base_theta"] + row_a["rmuc_live_state_theta"])
        theta_b = float(row_b["rmuc_program_base_theta"] + row_b["rmuc_live_state_theta"])
        residual_a = 0.0
        residual_b = 0.0
        live_a = float(row_a["rmuc_live_state_theta"])
        live_b = float(row_b["rmuc_live_state_theta"])

    probability = 1.0 / (1.0 + np.exp(-((theta_a - theta_b) / beta_perf)))
    payload = {
        "mode": mode,
        "team_a": school_a_key,
        "team_b": school_b_key,
        "match_date": match_date,
        "base_component": {
            "rmuc_program_base": {
                "team_a": float(row_a["rmuc_program_base_theta"]),
                "team_b": float(row_b["rmuc_program_base_theta"]),
            },
        },
        "regional_prior_component": {
            "team_a": float(row_a["regional_prior_theta"]),
            "team_b": float(row_b["regional_prior_theta"]),
        },
        "total_probability": float(probability),
        "team_a_probability": float(probability),
        "team_b_probability": float(1.0 - probability),
    }
    if mode in {"rmuc_regional_live", "rmuc_repechage", "rmuc_nationals"}:
        payload["live_state_component"] = {"team_a": live_a, "team_b": live_b}
    if mode == "rmuc_regional_live":
        payload["pre_residual_component"] = {
            "team_a": residual_a,
            "team_b": residual_b,
            "decay_factor_team_a": float(row_a["regional_pre_decay_factor"]),
            "decay_factor_team_b": float(row_b["regional_pre_decay_factor"]),
        }
    return payload


def export_ratings_snapshot(model_dir: Path, snapshot_date: str, out_path: Path, mode: str = "research") -> Path:
    if mode == "published":
        season = int(snapshot_date[:4])
        published_dir = out_path.parent / f"published_{season}"
        published_outputs = export_published_rating_artifacts(model_dir, snapshot_date, published_dir)
        pd, _ = require_dataframe_deps()
        current_snapshot = pd.read_parquet(published_outputs["current_snapshot_path"])
        return _save_tabular_outputs(current_snapshot, out_path)
    pd, _ = require_dataframe_deps()
    artifact = load_model_artifact(model_dir)
    report = artifact["report"]
    dataset = read_dataset(Path(report["dataset_path"]))
    summary = artifact["summary"].copy()
    posterior = artifact["posterior"]
    config_path = Path(report["config_path"])
    config = _load_config(config_path) if config_path.exists() else {}
    regional_cfg = _regional_pre_config(config)

    rating_scale = float(report.get("rating_scale", 120.0))
    school_frame = dataset["school_static_features"][["school_key", "school_name"]].copy()
    school_frame = school_frame.sort_values("school_key", kind="stable").reset_index(drop=True)

    if not summary.empty:
        state_snapshot = (
            summary[summary["date_bucket"] <= snapshot_date]
            .sort_values(["school_key", "date_bucket"], kind="stable")
            .groupby("school_key", as_index=False)
            .tail(1)
            .rename(
                columns={
                    "mean": "theta_mean",
                    "sd": "theta_sd",
                    "q05": "theta_q05",
                    "q50": "theta_q50",
                    "q95": "theta_q95",
                    "date_bucket": "latest_state_date",
                }
            )[
                [
                    "school_key",
                    "theta_mean",
                    "theta_sd",
                    "theta_q05",
                    "theta_q50",
                    "theta_q95",
                    "latest_state_date",
                ]
            ]
        )
    else:
        state_snapshot = pd.DataFrame(
            columns=[
                "school_key",
                "theta_mean",
                "theta_sd",
                "theta_q05",
                "theta_q50",
                "theta_q95",
                "latest_state_date",
            ]
        )

    snapshot_year = int(snapshot_date[:4])

    school_prior = _build_rmuc_long_term_base_snapshot(
        posterior,
        report,
        regional_cfg,
        dataset["canonical_matches"],
        snapshot_year,
    ).rename(
        columns={
            "rmuc_long_term_base_theta_mean": "school_theta_mean",
            "rmuc_long_term_base_theta_sd": "school_theta_sd",
            "rmuc_long_term_base_theta_q05": "school_theta_q05",
            "rmuc_long_term_base_theta_q50": "school_theta_q50",
            "rmuc_long_term_base_theta_q95": "school_theta_q95",
        }
    )[["school_key", "school_theta_mean", "school_theta_sd", "school_theta_q05", "school_theta_q50", "school_theta_q95"]]

    match_keys = set(dataset["canonical_matches"]["red_school_key"].tolist()) | set(dataset["canonical_matches"]["blue_school_key"].tolist())
    rmul_keys = set(
        dataset["canonical_matches"][dataset["canonical_matches"]["event_code"] == "2026RMUL"]["red_school_key"].tolist()
    ) | set(
        dataset["canonical_matches"][dataset["canonical_matches"]["event_code"] == "2026RMUL"]["blue_school_key"].tolist()
    )

    snapshot = school_frame.merge(state_snapshot, on="school_key", how="left").merge(school_prior, on="school_key", how="left")
    snapshot["rating_source_level"] = np.where(snapshot["theta_mean"].notna(), "state_posterior", "school_prior_posterior")
    for theta_column, school_column in [
        ("theta_mean", "school_theta_mean"),
        ("theta_sd", "school_theta_sd"),
        ("theta_q05", "school_theta_q05"),
        ("theta_q50", "school_theta_q50"),
        ("theta_q95", "school_theta_q95"),
    ]:
        snapshot[theta_column] = snapshot[theta_column].where(snapshot[theta_column].notna(), snapshot[school_column])

    snapshot["rating_1500_mean"] = 1500.0 + (rating_scale * snapshot["theta_mean"])
    snapshot["rating_1500_q05"] = 1500.0 + (rating_scale * snapshot["theta_q05"])
    snapshot["rating_1500_q95"] = 1500.0 + (rating_scale * snapshot["theta_q95"])
    snapshot["has_match_history"] = snapshot["school_key"].isin(match_keys)
    snapshot["has_2026_rmul_history"] = snapshot["school_key"].isin(rmul_keys)
    snapshot["has_reference_only"] = ~snapshot["has_match_history"]
    snapshot["reference_only_flag"] = snapshot["has_reference_only"]
    snapshot["cold_start_flag"] = (~snapshot["has_2026_rmul_history"]) | snapshot["has_reference_only"]
    snapshot["latest_state_date"] = snapshot["latest_state_date"].where(snapshot["latest_state_date"].notna(), None)
    snapshot["forecast_days_from_2026rmul_end"] = int(
        max(0, (pd.Timestamp(snapshot_date) - pd.Timestamp(RMUL_FINAL_DATE)).days)
    )

    interval_width = snapshot["theta_q95"] - snapshot["theta_q05"]
    uncertainty_threshold = float(interval_width.quantile(0.9)) if len(interval_width) else 0.0
    snapshot["high_uncertainty_flag"] = interval_width >= uncertainty_threshold
    snapshot["theta_interval_width"] = interval_width

    regional_pre_snapshot = _build_regional_pre_snapshot(model_dir, snapshot_date)
    live_snapshot = _build_rmuc_live_state_snapshot(summary, regional_pre_snapshot, snapshot_date, rating_scale)
    regional_pre_columns = [
        "school_key",
        "is_rmuc_2026_team",
        "shape_rank",
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
        "regional_prior_delta_theta",
        "regional_prior_delta_rating",
        "regional_prior_score_theta",
        "regional_prior_score_rating",
        "regional_pre_blend_lambda",
        "regional_pre_offset_theta",
        "regional_pre_offset_rating",
        "regional_prior_effective_theta",
        "regional_group_matches_played",
        "regional_post_group_started",
        "regional_pre_decay_factor",
        "regional_live_pre_residual_signal",
        "regional_live_pre_residual_rating",
        "rmuc_history_strength",
        "recent_evidence_support",
        "regional_pre_active",
        "shape_signal_season_count",
        "shape_source_years",
        "rmul_ranking_season_count",
        "rmul_ranking_source_years",
        "rmuc_long_term_base_theta_mean",
        "rmuc_long_term_base_theta_sd",
        "rmuc_long_term_base_theta_q05",
        "rmuc_long_term_base_theta_q50",
        "rmuc_long_term_base_theta_q95",
        "rmuc_long_term_school_alpha",
        "rmuc_long_term_school_uncertainty",
        "rmuc_long_term_school_component_mean",
        "rmuc_long_term_season_component_mean",
        "rmuc_long_term_recent_season_component_mean",
        "rmuc_long_term_terminal_season_component_mean",
        "rmuc_terminal_season_weight",
        "rmuc_long_term_base_source_seasons",
        "rmuc_long_term_base_latest_season",
        "rmuc_long_term_base_season_count",
        "rmuc_recent_match_count",
        "rmuc_recent_match_effective_count",
        "rmuc_latest_season_match_share",
        "rmuc_terminal_only_support",
        "rmuc_long_term_base_rating",
        "rmuc_regional_pre_start_theta",
        "rmuc_regional_pre_theta",
        "rmuc_regional_pre_rating",
    ]
    snapshot = snapshot.merge(regional_pre_snapshot[regional_pre_columns], on="school_key", how="left")
    snapshot = snapshot.merge(live_snapshot, on="school_key", how="left")
    snapshot["rmuc_regional_pre_rank_96"] = pd.Series([pd.NA] * len(snapshot), dtype="Int64")
    regional_mask = snapshot["is_rmuc_2026_team"].fillna(False)
    regional_ranks = (
        snapshot.loc[regional_mask, ["school_key", "rmuc_regional_pre_rating"]]
        .sort_values(["rmuc_regional_pre_rating", "school_key"], ascending=[False, True], kind="stable")
        .reset_index(drop=True)
    )
    regional_ranks["rmuc_regional_pre_rank_96"] = np.arange(1, len(regional_ranks) + 1, dtype=np.int32)
    snapshot = snapshot.merge(regional_ranks[["school_key", "rmuc_regional_pre_rank_96"]], on="school_key", how="left", suffixes=("", "_ranked"))
    snapshot["rmuc_regional_pre_rank_96"] = snapshot["rmuc_regional_pre_rank_96_ranked"].astype("Int64")
    snapshot = snapshot.drop(columns=["rmuc_regional_pre_rank_96_ranked"])
    snapshot["rmuc_regional_live_rank_96"] = pd.Series([pd.NA] * len(snapshot), dtype="Int64")
    live_ranks = (
        snapshot.loc[regional_mask, ["school_key", "rmuc_regional_live_rating"]]
        .sort_values(["rmuc_regional_live_rating", "school_key"], ascending=[False, True], kind="stable")
        .reset_index(drop=True)
    )
    live_ranks["rmuc_regional_live_rank_96"] = np.arange(1, len(live_ranks) + 1, dtype=np.int32)
    snapshot = snapshot.merge(live_ranks[["school_key", "rmuc_regional_live_rank_96"]], on="school_key", how="left", suffixes=("", "_live"))
    snapshot["rmuc_regional_live_rank_96"] = snapshot["rmuc_regional_live_rank_96_live"].astype("Int64")
    snapshot = snapshot.drop(columns=["rmuc_regional_live_rank_96_live"])

    snapshot = snapshot[
        [
            "school_key",
            "school_name",
            "theta_mean",
            "theta_sd",
            "theta_q05",
            "theta_q50",
            "theta_q95",
            "rating_1500_mean",
            "rating_1500_q05",
            "rating_1500_q95",
            "rating_source_level",
            "latest_state_date",
            "forecast_days_from_2026rmul_end",
            "has_match_history",
            "has_2026_rmul_history",
            "has_reference_only",
            "high_uncertainty_flag",
            "cold_start_flag",
            "reference_only_flag",
            "theta_interval_width",
            "is_rmuc_2026_team",
            "shape_rank",
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
            "regional_prior_delta_theta",
            "regional_prior_delta_rating",
            "regional_prior_score_theta",
            "regional_prior_score_rating",
            "regional_pre_blend_lambda",
            "regional_pre_offset_theta",
            "regional_pre_offset_rating",
            "regional_prior_effective_theta",
            "regional_group_matches_played",
            "regional_post_group_started",
            "regional_pre_decay_factor",
            "regional_live_pre_residual_signal",
            "regional_live_pre_residual_rating",
            "rmuc_history_strength",
            "recent_evidence_support",
            "regional_pre_active",
            "shape_signal_season_count",
            "shape_source_years",
            "rmul_ranking_season_count",
            "rmul_ranking_source_years",
            "rmuc_long_term_base_theta_mean",
            "rmuc_long_term_base_theta_sd",
            "rmuc_long_term_base_theta_q05",
            "rmuc_long_term_base_theta_q50",
            "rmuc_long_term_base_theta_q95",
            "rmuc_long_term_school_alpha",
            "rmuc_long_term_school_uncertainty",
            "rmuc_long_term_school_component_mean",
            "rmuc_long_term_season_component_mean",
            "rmuc_long_term_recent_season_component_mean",
            "rmuc_long_term_terminal_season_component_mean",
            "rmuc_terminal_season_weight",
            "rmuc_long_term_base_source_seasons",
            "rmuc_long_term_base_latest_season",
            "rmuc_long_term_base_season_count",
            "rmuc_recent_match_count",
            "rmuc_recent_match_effective_count",
            "rmuc_latest_season_match_share",
            "rmuc_terminal_only_support",
            "rmuc_long_term_base_rating",
            "rmuc_regional_pre_start_theta",
            "rmuc_regional_pre_theta",
            "rmuc_regional_pre_rating",
            "rmuc_regional_pre_rank_96",
            "rmuc_live_state_theta_mean",
            "rmuc_live_state_theta_sd",
            "rmuc_live_state_rating",
            "rmuc_live_state_latest_date",
            "rmuc_regional_live_theta",
            "rmuc_regional_live_rating",
            "rmuc_regional_live_rank_96",
        ]
    ].sort_values(["rating_1500_mean", "school_key"], ascending=[False, True], kind="stable").reset_index(drop=True)
    snapshot["rating_rank"] = np.arange(1, len(snapshot) + 1, dtype=np.int32)
    return _save_tabular_outputs(snapshot, out_path)
