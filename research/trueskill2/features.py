from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from . import schemas
from .ingest import ROOT, canonicalize_school, school_key

import sys

SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_elo as legacy_elo  # noqa: E402


def require_pandas() -> Any:
    from .ingest import require_dataframe_deps

    pd, _ = require_dataframe_deps()
    return pd


def _safe_mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _standardize_in_place(frame: Any, columns: list[str]) -> None:
    for column in columns:
        valid = frame[column].dropna()
        if valid.empty:
            frame[column] = 0.0
            continue
        mean = float(valid.mean())
        std = float(valid.std(ddof=0))
        if std <= 1e-9:
            frame[column] = frame[column].fillna(mean) - mean
        else:
            frame[column] = (frame[column].fillna(mean) - mean) / std


def _build_group_rank_summary(path: Path) -> dict[str, dict[str, float]]:
    rows = legacy_elo.read_csv(path)
    by_school: dict[str, list[dict[str, float]]] = defaultdict(list)
    for row in rows:
        key = school_key(row["college_name"])
        by_school[key].append(
            {
                "rank": float(legacy_elo.parse_int(row.get("group_order")) or 0),
                "points": float(legacy_elo.parse_float(row.get("points")) or 0.0),
                "damage": float(legacy_elo.parse_float(row.get("avg_team_damage")) or 0.0),
            }
        )
    summary: dict[str, dict[str, float]] = {}
    for key, values in by_school.items():
        summary[key] = {
            "group_rank_mean": _safe_mean([value["rank"] for value in values]) or 0.0,
            "group_points_mean": _safe_mean([value["points"] for value in values]) or 0.0,
            "group_damage_mean": _safe_mean([value["damage"] for value in values]) or 0.0,
        }
    return summary


def _build_robot_summary(path: Path) -> dict[str, float]:
    if not path.exists():
        return {}
    rows = legacy_elo.read_csv(path)
    scores_by_school: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        key = school_key(row["college_name"])
        robot_type = row.get("robot_type", "")
        metrics = legacy_elo.ROBOT_TYPE_METRICS.get(robot_type, [])
        score = 0.0
        used = 0
        for metric_name, direction in metrics:
            numeric = legacy_elo.parse_float(row.get(metric_name))
            if numeric is None:
                continue
            score += direction * numeric
            used += 1
        if used == 0:
            continue
        scores_by_school[key].append(score / used)
    return {
        key: _safe_mean(values) or 0.0
        for key, values in scores_by_school.items()
    }


def _build_rank_score_map(path: Path) -> dict[str, float]:
    if not path.exists():
        return {}
    rows = legacy_elo.read_csv(path)
    return {
        school_key(row["school_chinese"]): float(row["score"])
        for row in rows
    }


def _build_ranking_reference() -> dict[str, dict[str, float]]:
    rows = legacy_elo.read_csv(ROOT / "data" / "reference" / "2026_regionals" / "ranking_1884.csv")
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        key = school_key(row["college_name"])
        out[key] = {
            "school_name": canonicalize_school(row["college_name"]),
            "ranking_score": float(row["score"]),
            "ranking_rank": float(row["rank"]),
        }
    return out


def _build_participant_reference() -> dict[str, dict[str, float]]:
    rows = legacy_elo.read_csv(ROOT / "data" / "reference" / "2026_regionals" / "participants_1912.csv")
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        key = school_key(row["college_name"])
        out[key] = {
            "school_name": canonicalize_school(row["college_name"]),
            "seed_rank": float(legacy_elo.parse_int(row.get("seed_rank_in_region")) or 0),
        }
    return out


def _build_historical_school_universe(event_codes: list[str]) -> tuple[set[str], dict[str, str]]:
    schools: set[str] = set()
    school_names: dict[str, str] = {}
    for event_code in event_codes:
        rows = legacy_elo.read_csv(ROOT / "data" / "extracted" / event_code / "matches.csv")
        for row in rows:
            if row.get("status") != "DONE":
                continue
            for column in ["red_college_name", "blue_college_name"]:
                name = canonicalize_school(row[column])
                key = school_key(name)
                schools.add(key)
                school_names[key] = name
    return schools, school_names


def build_static_features(canonical_matches: Any) -> tuple[Any, dict[str, Any]]:
    pd = require_pandas()
    event_codes = sorted(canonical_matches["event_code"].unique().tolist())
    schools, school_names = _build_historical_school_universe(event_codes)
    for row in canonical_matches[["red_school_key", "red_school_name"]].drop_duplicates().to_dict(orient="records"):
        school_names[row["red_school_key"]] = row["red_school_name"]
    for row in canonical_matches[["blue_school_key", "blue_school_name"]].drop_duplicates().to_dict(orient="records"):
        school_names[row["blue_school_key"]] = row["blue_school_name"]

    ranking_ref = _build_ranking_reference()
    participant_ref = _build_participant_reference()
    schools |= set(ranking_ref)
    schools |= set(participant_ref)
    group_2024 = _build_group_rank_summary(ROOT / "data" / "extracted" / "2024RMUC" / "group_rank.csv")
    group_2025 = _build_group_rank_summary(ROOT / "data" / "extracted" / "2025RMUC" / "group_rank.csv")
    rank_2024 = _build_rank_score_map(ROOT / "data" / "extracted" / "2024RMUC" / "rank_score.csv")
    rank_2025 = _build_rank_score_map(ROOT / "data" / "extracted" / "2025RMUC" / "rank_score.csv")
    robot_2025 = _build_robot_summary(ROOT / "data" / "extracted" / "2025RMUC" / "robot_data.csv")
    robot_2026 = _build_robot_summary(ROOT / "data" / "extracted" / "2026RMUL" / "robot_data.csv")
    schools = sorted(schools)

    red_counts = canonical_matches.groupby(["red_school_key", "season"], as_index=False).size().rename(
        columns={"red_school_key": "school_key", "size": "match_count"}
    )
    blue_counts = canonical_matches.groupby(["blue_school_key", "season"], as_index=False).size().rename(
        columns={"blue_school_key": "school_key", "size": "match_count"}
    )
    season_counts = pd.concat([red_counts, blue_counts], ignore_index=True).groupby(
        ["school_key", "season"], as_index=False
    )["match_count"].sum()
    coverage_map = {
        (row["school_key"], int(row["season"])): int(row["match_count"])
        for row in season_counts.to_dict(orient="records")
    }

    first_seen = {}
    all_matches = []
    for row in canonical_matches[
        ["red_school_key", "season", "match_date"]
    ].rename(columns={"red_school_key": "school_key"}).to_dict(orient="records"):
        all_matches.append(row)
    for row in canonical_matches[
        ["blue_school_key", "season", "match_date"]
    ].rename(columns={"blue_school_key": "school_key"}).to_dict(orient="records"):
        all_matches.append(row)
    for row in all_matches:
        key = row["school_key"]
        season = int(row["season"])
        if key not in first_seen or season < first_seen[key]:
            first_seen[key] = season

    records: list[dict[str, Any]] = []
    for key in schools:
        ranking = ranking_ref.get(key, {})
        participants = participant_ref.get(key, {})
        group_summary = group_2025.get(key) or group_2024.get(key) or {}
        records.append(
            {
                "school_key": key,
                "school_name": school_names.get(key)
                or ranking.get("school_name")
                or participants.get("school_name")
                or key,
                "feature_ranking_score": ranking.get("ranking_score"),
                "feature_ranking_rank": ranking.get("ranking_rank"),
                "feature_seed_rank": participants.get("seed_rank"),
                "feature_group_rank_mean": group_summary.get("group_rank_mean"),
                "feature_group_points_mean": group_summary.get("group_points_mean"),
                "feature_group_damage_mean": group_summary.get("group_damage_mean"),
                "feature_rank_score_2024": rank_2024.get(key),
                "feature_rank_score_2025": rank_2025.get(key),
                "feature_robot_summary_2025": robot_2025.get(key),
                "feature_robot_summary_2026": robot_2026.get(key),
                "feature_match_coverage_2024": float(coverage_map.get((key, 2024), 0)),
                "feature_match_coverage_2025": float(coverage_map.get((key, 2025), 0)),
                "feature_match_coverage_2026": float(coverage_map.get((key, 2026), 0)),
                "feature_first_seen_season": float(first_seen.get(key, 2026)),
            }
        )

    frame = pd.DataFrame.from_records(records)
    feature_columns = [column for column in frame.columns if column.startswith("feature_")]
    for column in feature_columns:
        frame[f"missing_{column}"] = frame[column].isna().astype(int)
    _standardize_in_place(frame, feature_columns)
    frame = frame[schemas.STATIC_FEATURE_COLUMNS]
    feature_manifest = {
        "dataset_version": schemas.DATASET_VERSION,
        "source_columns": {
            "ranking_1884": ["rank", "college_name", "score"],
            "participants_1912": ["college_name", "seed_rank_in_region"],
            "rmuc_shape_rank_96": ["rank", "school_name", "team_name"],
            "rank_score": ["school_chinese", "score"],
            "robot_data": ["college_name", "robot_type", *sorted({item[0] for values in legacy_elo.ROBOT_TYPE_METRICS.values() for item in values})],
            "group_rank": ["college_name", "group_order", "points", "avg_team_damage"],
        },
        "time_cutoff_policy": "static priors use pre-match reference snapshots only; dynamic layer uses canonical historical matches only",
        "missing_fill_policy": "numeric features standardized after mean imputation; missing indicators retained as explicit binary columns",
        "feature_columns": feature_columns,
        "missing_indicator_columns": [column for column in frame.columns if column.startswith("missing_")],
    }
    return frame, feature_manifest
