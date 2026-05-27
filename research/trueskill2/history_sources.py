from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from .ingest import ROOT, canonicalize_school, require_dataframe_deps, school_key


SHAPE_2024_URL = "https://www.robomaster.com/zh-CN/resource/pages/announcement/1707"
SHAPE_2025_URL = "https://www.robomaster.com/zh-CN/resource/pages/announcement/1831"
RMUL_2024_URL = "https://www.robomaster.com/zh-CN/resource/pages/announcement/1711"
RMUL_2025_URL = "https://www.robomaster.com/zh-CN/resource/pages/announcement/1830"
RMUL_2026_URL = "https://www.robomaster.com/zh-CN/resource/pages/announcement/1913"

SHAPE_2026_PATH = ROOT / "data" / "cleaned" / "reference" / "2026RMUC_96_teams.csv"


@dataclass(frozen=True)
class RegionalPreModelConfig:
    alpha: float = 0.50
    kappa: float = 2.40
    rho_2024: float = 0.25
    rho_terminal: float = 0.15
    recent_season_retention: float = 0.35
    recent_season_carry_retention: float = 0.20
    terminal_season_retention: float = 0.10
    regional_prior_ridge: float = 0.25
    regional_prior_train_terminal_weight: float = 0.20
    regional_prior_target_pseudocount: float = 6.0
    school_retention_floor: float = 0.35
    school_uncertainty_weight: float = 0.35
    school_terminal_only_penalty: float = 0.75
    recent_match_cap: float = 12.0
    history_uncertainty_scale: float = 1.0
    pre_decay_matches: int = 3
    aligned_sd_scale: float = 0.85
    conflict_sd_scale: float = 1.25
    blend_lambda_min: float = 0.20
    blend_lambda_max: float = 0.75
    blend_uncertainty_weight: float = 0.25
    blend_signal_scale: float = 0.75
    deviation_lambda_boost: float = 0.12
    same_year_shape_weight: float = 0.55
    same_year_rmul_weight: float = 0.75
    same_year_consistency_weight: float = 0.45
    shape_evidence_scale: float = 0.90
    rmul_finish_scale: float = 1.00
    station_calibration_scale: float = 0.12
    prior_delta_cap_min: float = 0.22
    prior_delta_cap_max: float = 0.90
    history_cap_curve: float = 0.80
    online_live_update_scale: float = 0.50
    live_update_strategy: str = "fixed_k"
    prior_delta_sigma_weight: float = 0.55
    history_sigma_weight: float = 0.30
    base_event_sigma: float = 0.25
    season_delta_cap: float = 3.00
    season_delta_sigma_floor: float = 0.30
    season_delta_process_sigma: float = 0.08
    result_obs_sigma_base: float = 0.60
    expected_loss_sigma_multiplier: float = 1.00
    expected_loss_probability_threshold: float = 0.35
    live_form_update_enabled: bool = False
    form_team_damage_weight: float = 0.90
    form_base_hp_weight: float = 0.10
    form_opponent_points_weight: float = 0.0
    form_scale: float = 1.60
    form_temperature: float = 1.20
    form_obs_sigma_base: float = 0.60
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
    form_freshness_mode: str = "event_count_v1"
    early_group_sigma_floor: float = 0.30
    early_group_sigma_floor_matches: float = 0.0
    opponent_form_expected_scale: float = 0.50
    opponent_form_adjustment_weight: float = 0.35
    robot_gate_conflict_weight: float = 0.05
    robot_gate_robot_only_weight: float = 0.50
    robot_gate_neutral_weight: float = 0.25
    prediction_head_base_weight: float = 0.25
    prediction_head_season_delta_weight: float = 1.00
    prediction_head_momentum_weight: float = 0.00
    prediction_head_temperature: float = 1.00
    prediction_head_opening_group_temperature: float = 2.50
    prediction_head_non_opening_temperature: float = 0.70
    prediction_head_post_group_temperature: float = 0.75
    prediction_head_early_group_min_matches: float = 1.0
    prediction_head_early_group_max_matches: float = 1.0
    prediction_head_component_blend_max_weight: float = 0.90
    prediction_head_component_blend_min_matches: float = 1.0
    prediction_head_component_blend_max_matches: float = 1.0
    prediction_head_process_residual_weight: float = 0.00
    prediction_head_process_residual_cap: float = 0.40
    prediction_head_group_form_residual_weight: float = 0.05
    prediction_head_group_form_residual_cap: float = 0.20
    prediction_head_group_form_residual_min_matches: float = 2.0
    prediction_head_group_form_residual_max_matches: float = 99.0
    prediction_head_robot_form_agreement_weight: float = 0.15
    prediction_head_robot_form_agreement_cap: float = 0.30
    prediction_head_robot_output_residual_weight: float = 0.10
    prediction_head_robot_output_residual_cap: float = 0.18
    prediction_head_robot_output_residual_min_matches: float = 1.0
    prediction_head_robot_output_residual_max_matches: float = 99.0
    prediction_head_robot_base_capability_residual_weight: float = 0.08
    prediction_head_robot_base_capability_residual_cap: float = 0.08
    prediction_head_robot_base_capability_residual_min_matches: float = 1.0
    prediction_head_robot_base_capability_residual_max_matches: float = 99.0
    prediction_head_robot_conflict_blend_weight: float = 0.35
    prediction_head_robot_conflict_min_matches: float = 1.0
    prediction_head_robot_conflict_max_matches: float = 1.0
    prediction_head_robot_conflict_signal_scale: float = 0.60
    prediction_head_robot_conflict_model_delta_cap: float = 0.45
    prediction_head_group_objective_conflict_blend_weight: float = 0.55
    prediction_head_group_objective_conflict_min_matches: float = 2.0
    prediction_head_group_objective_conflict_max_matches: float = 99.0
    prediction_head_group_objective_conflict_signal_scale: float = 0.70
    prediction_head_group_objective_conflict_signal_threshold: float = 0.50
    prediction_head_group_objective_conflict_model_delta_cap: float = 0.45
    prediction_head_post_conflict_temperature_weight: float = 0.35
    prediction_head_post_conflict_temperature_cap: float = 0.55
    prediction_head_post_conflict_min_signals: float = 2.0
    prediction_head_post_conflict_model_delta_min: float = 0.35
    prediction_head_post_conflict_live_signal_threshold: float = 0.30
    prediction_head_post_conflict_robot_signal_threshold: float = 0.80


def _fetch_html(url: str) -> str:
    with urlopen(url, timeout=30) as response:  # noqa: S310 - fixed trusted URLs
        return response.read().decode("utf-8", errors="ignore")


def _extract_first_table_after_marker(page_html: str, marker: str) -> str:
    marker_index = page_html.find(marker)
    if marker_index < 0:
        raise ValueError(f"marker not found in source html: {marker}")
    table_start = page_html.find("<table", marker_index)
    if table_start < 0:
        raise ValueError(f"table not found after marker: {marker}")
    table_end = page_html.find("</table>", table_start)
    if table_end < 0:
        raise ValueError(f"table end not found after marker: {marker}")
    return page_html[table_start : table_end + len("</table>")]


def _clean_cell(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_html_table(table_html: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.IGNORECASE | re.DOTALL)
        if not cells:
            continue
        rows.append([_clean_cell(cell) for cell in cells])
    return rows


def _normalize_shape_score(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def build_shape_history_frame() -> Any:
    pd, _ = require_dataframe_deps()
    records: list[dict[str, Any]] = []

    frame_2026 = pd.read_csv(SHAPE_2026_PATH)
    for row in frame_2026.to_dict(orient="records"):
        school_name = canonicalize_school(row["school_name"])
        records.append(
            {
                "season": 2026,
                "school_key": school_key(school_name),
                "school_name": school_name,
                "team_name": row["team_name"],
                "shape_rank": int(row["rank"]),
                "shape_score": None,
                "doc_bonus": None,
                "tech_bonus": None,
                "source_url": str(SHAPE_2026_PATH),
                "source_type": "local_reference",
            }
        )

    shape_2025_rows = _parse_html_table(_extract_first_table_after_marker(_fetch_html(SHAPE_2025_URL), "一、完整形态考核"))
    for row in shape_2025_rows[1:]:
        if len(row) < 3:
            continue
        school_name = canonicalize_school(row[1])
        records.append(
            {
                "season": 2025,
                "school_key": school_key(school_name),
                "school_name": school_name,
                "team_name": row[2],
                "shape_rank": int(row[0]),
                "shape_score": None,
                "doc_bonus": None,
                "tech_bonus": None,
                "source_url": SHAPE_2025_URL,
                "source_type": "official_announcement",
            }
        )

    shape_2024_rows = _parse_html_table(_extract_first_table_after_marker(_fetch_html(SHAPE_2024_URL), "一、内地队伍"))
    for rank, row in enumerate(shape_2024_rows[1:], start=1):
        if len(row) < 6:
            continue
        school_name = canonicalize_school(row[0])
        records.append(
            {
                "season": 2024,
                "school_key": school_key(school_name),
                "school_name": school_name,
                "team_name": row[1],
                "shape_rank": rank,
                "shape_score": _normalize_shape_score(row[2]),
                "doc_bonus": _normalize_shape_score(row[3]),
                "tech_bonus": _normalize_shape_score(row[4]),
                "source_url": SHAPE_2024_URL,
                "source_type": "official_announcement",
            }
        )

    return pd.DataFrame.from_records(records).sort_values(["season", "shape_rank", "school_key"], kind="stable").reset_index(drop=True)


def _normalize_placement_bucket(value: str) -> str | None:
    normalized = value.strip()
    mapping = {
        "冠军": "冠军",
        "亚军": "亚军",
        "季军": "季军",
        "殿军": "殿军",
        "八强": "八强",
        "十六强": "十六强",
        "十二强": "十二强",
    }
    return mapping.get(normalized)


def _placement_score(value: str) -> int | None:
    order = {
        "冠军": 7,
        "亚军": 6,
        "季军": 5,
        "殿军": 4,
        "八强": 3,
        "十六强": 2,
        "十二强": 1,
    }
    return order.get(value)


def _extract_rmul_rows(url: str, season: int, school_column: str, station_column: str, placement_column: str, team_column: str) -> list[dict[str, Any]]:
    table_rows = _parse_html_table(_extract_first_table_after_marker(_fetch_html(url), "一、3V3对抗赛"))
    if not table_rows:
        return []
    header = table_rows[0]
    column_index = {name: idx for idx, name in enumerate(header)}
    records: list[dict[str, Any]] = []
    for row in table_rows[1:]:
        if len(row) <= max(column_index.get(school_column, 0), column_index.get(station_column, 0), column_index.get(placement_column, 0), column_index.get(team_column, 0)):
            continue
        placement_bucket = _normalize_placement_bucket(row[column_index[placement_column]])
        if placement_bucket is None:
            continue
        school_name = canonicalize_school(row[column_index[school_column]])
        records.append(
            {
                "season": season,
                "school_key": school_key(school_name),
                "school_name": school_name,
                "team_name": row[column_index[team_column]],
                "source_url": url,
                "station_name": row[column_index[station_column]],
                "placement_bucket": placement_bucket,
                "placement_score": _placement_score(placement_bucket),
                "is_3v3": True,
                "season_reliability": 0.40 if season == 2024 else 1.0,
                "raw_text": " | ".join(row),
            }
        )
    return records


def build_rmul_3v3_ranking_history_frame() -> Any:
    pd, _ = require_dataframe_deps()
    records: list[dict[str, Any]] = []
    records.extend(_extract_rmul_rows(RMUL_2026_URL, 2026, "校名", "站点名称", "排名", "队名"))
    records.extend(_extract_rmul_rows(RMUL_2025_URL, 2025, "学校名称", "站点", "名次", "队伍名称"))
    records.extend(_extract_rmul_rows(RMUL_2024_URL, 2024, "学校名称", "站点", "名次", "队伍名称"))
    return pd.DataFrame.from_records(records).sort_values(
        ["season", "station_name", "placement_score", "school_key"],
        ascending=[True, True, False, True],
        kind="stable",
    ).reset_index(drop=True)


def build_selection_report_payload(config: RegionalPreModelConfig) -> dict[str, Any]:
    return {
        "selection_mode": "config_driven_v1",
        "selected_parameters": {
            "alpha": config.alpha,
            "kappa": config.kappa,
            "rho_2024": config.rho_2024,
            "rho_terminal": config.rho_terminal,
            "recent_season_retention": config.recent_season_retention,
            "recent_season_carry_retention": config.recent_season_carry_retention,
            "terminal_season_retention": config.terminal_season_retention,
            "regional_prior_ridge": config.regional_prior_ridge,
            "regional_prior_train_terminal_weight": config.regional_prior_train_terminal_weight,
            "regional_prior_target_pseudocount": config.regional_prior_target_pseudocount,
            "school_retention_floor": config.school_retention_floor,
            "school_uncertainty_weight": config.school_uncertainty_weight,
            "school_terminal_only_penalty": config.school_terminal_only_penalty,
            "recent_match_cap": config.recent_match_cap,
            "history_uncertainty_scale": config.history_uncertainty_scale,
            "pre_decay_matches": config.pre_decay_matches,
            "blend_lambda_min": config.blend_lambda_min,
            "blend_lambda_max": config.blend_lambda_max,
            "blend_uncertainty_weight": config.blend_uncertainty_weight,
            "blend_signal_scale": config.blend_signal_scale,
            "deviation_lambda_boost": config.deviation_lambda_boost,
        },
        "note": "Current implementation keeps RMUC program base separate from same-year regional prior. Shape and RMUL only train a same-year regional prior model on 2024/2025 RMUC regional outcomes, with weaker 2024 supervision weight and gradual 2026RMUC takeover over the first three regional-group matches. Regional pre ranks are formed by blending program base with same-year prior score according to history strength, uncertainty, and evidence support. No RMUL awards or team-class adjustments are used.",
    }


def save_history_tables(shape_history: Any, rmul_history: Any, out_dir: Path) -> dict[str, Path]:
    shape_path = out_dir / "shape_history.parquet"
    rmul_path = out_dir / "rmul_3v3_ranking_history.parquet"
    out_dir.mkdir(parents=True, exist_ok=True)
    shape_history.to_parquet(shape_path, index=False)
    shape_history.to_csv(shape_path.with_suffix(".csv"), index=False)
    rmul_history.to_parquet(rmul_path, index=False)
    rmul_history.to_csv(rmul_path.with_suffix(".csv"), index=False)
    return {
        "shape_history_path": shape_path,
        "rmul_3v3_ranking_history_path": rmul_path,
    }


def load_history_tables(dataset_dir: Path) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    return {
        "shape_history": pd.read_parquet(dataset_dir / "shape_history.parquet"),
        "rmul_3v3_ranking_history": pd.read_parquet(dataset_dir / "rmul_3v3_ranking_history.parquet"),
    }
