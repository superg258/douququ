from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from . import schemas

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
RMUL_FINAL_DATE = "2026-04-05"
SCHOOL_UNIVERSE_POLICY = "historical_matches_union_reference_2026"
import sys

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_elo as legacy_elo  # noqa: E402


@dataclass
class DatasetPaths:
    canonical_matches: Path
    school_static_features: Path
    season_team_index: Path
    shape_history: Path
    rmul_3v3_ranking_history: Path
    dataset_manifest: Path
    feature_manifest: Path


def require_dataframe_deps() -> tuple[Any, Any]:
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised only in missing envs
        raise RuntimeError("pandas is required for research.trueskill2. Install research/trueskill2/requirements.txt") from exc
    try:
        import pyarrow  # noqa: F401
    except ImportError as exc:  # pragma: no cover - exercised only in missing envs
        raise RuntimeError("pyarrow is required for parquet outputs. Install research/trueskill2/requirements.txt") from exc
    return pd, yaml


def stage_id_for_row(row: dict[str, str]) -> str:
    return legacy_elo.classify_dynamic_stage(
        row["event_code"],
        row["zone_name"],
        row["stage_bucket"],
    )


def canonicalize_school(name: str) -> str:
    return legacy_elo.normalize_school(name)


def school_key(name: str) -> str:
    return legacy_elo.make_school_key(name)


def series_best_of(red_wins: int, blue_wins: int) -> int:
    decisive_wins = max(red_wins, blue_wins, 1)
    return max(1, (2 * decisive_wins) - 1)


def ruleset_id(event_code: str) -> str:
    if "RMUL" in event_code:
        return "RMUL"
    return "RMUC"


def competition_family_for_event(event_code: str) -> str:
    return "rmul" if "RMUL" in event_code else "rmuc"


def stage_family_for_stage_id(stage_id: str) -> str:
    if stage_id == "rmuc_regional_group":
        return "regional_group"
    if stage_id == "rmuc_regional_knockout":
        return "post_group"
    if stage_id.startswith("rmuc_repechage"):
        return "repechage"
    if stage_id.startswith("rmuc_national"):
        return "nationals"
    if stage_id == "rmul_group":
        return "rmul_group"
    if stage_id == "rmul_knockout":
        return "rmul_knockout"
    return "other"


def dataset_paths(out_dir: Path) -> DatasetPaths:
    return DatasetPaths(
        canonical_matches=out_dir / "canonical_matches.parquet",
        school_static_features=out_dir / "school_static_features.parquet",
        season_team_index=out_dir / "season_team_index.parquet",
        shape_history=out_dir / "shape_history.parquet",
        rmul_3v3_ranking_history=out_dir / "rmul_3v3_ranking_history.parquet",
        dataset_manifest=out_dir / "dataset_manifest.json",
        feature_manifest=out_dir / "feature_manifest.json",
    )


def load_match_rows(event_code: str) -> list[dict[str, str]]:
    path = ROOT / "data" / "extracted" / event_code / "matches.csv"
    rows = legacy_elo.read_csv(path)
    cleaned: list[dict[str, str]] = []
    for row in rows:
        if row.get("status") != "DONE":
            continue
        if row.get("winner_side") not in {"red", "blue"}:
            continue
        cleaned.append(row)
    return cleaned


def limit_rows_by_event(
    rows_by_event: dict[str, list[dict[str, str]]],
    limit_matches: int | None,
) -> dict[str, list[dict[str, str]]]:
    if limit_matches is None:
        return rows_by_event
    events = list(rows_by_event)
    if not events:
        return rows_by_event
    base = limit_matches // len(events)
    remainder = limit_matches % len(events)
    limited: dict[str, list[dict[str, str]]] = {}
    for index, event_code in enumerate(events):
        count = base + (1 if index < remainder else 0)
        limited[event_code] = rows_by_event[event_code][:count]
    return limited


def build_canonical_matches_dataframe(event_codes: list[str], limit_matches: int | None = None) -> Any:
    pd, _ = require_dataframe_deps()
    rows_by_event = {event_code: load_match_rows(event_code) for event_code in event_codes}
    limited = limit_rows_by_event(rows_by_event, limit_matches)
    records: list[dict[str, Any]] = []
    for event_code in event_codes:
        for row in limited[event_code]:
            red_name = canonicalize_school(row["red_college_name"])
            blue_name = canonicalize_school(row["blue_college_name"])
            red_key = school_key(red_name)
            blue_key = school_key(blue_name)
            red_wins = int(row["red_side_win_game_count"])
            blue_wins = int(row["blue_side_win_game_count"])
            season = int(row["season"])
            records.append(
                {
                    "match_id": f"{event_code}:{row['match_id']}",
                    "event_code": event_code,
                    "season": season,
                    "match_date": row["match_date"],
                    "stage_id": stage_id_for_row(row),
                    "stage_bucket": row["stage_bucket"],
                    "competition_family": competition_family_for_event(event_code),
                    "stage_family": stage_family_for_stage_id(stage_id_for_row(row)),
                    "is_regional_group_match": stage_id_for_row(row) == "rmuc_regional_group",
                    "is_post_group_match": stage_family_for_stage_id(stage_id_for_row(row))
                    in {"post_group", "repechage", "nationals"},
                    "best_of": series_best_of(red_wins, blue_wins),
                    "ruleset_id": ruleset_id(event_code),
                    "red_school_key": red_key,
                    "blue_school_key": blue_key,
                    "red_school_name": red_name,
                    "blue_school_name": blue_name,
                    "red_season_team_key": f"{season}:{red_key}",
                    "blue_season_team_key": f"{season}:{blue_key}",
                    "winner_side": row["winner_side"],
                    "red_wins": red_wins,
                    "blue_wins": blue_wins,
                    "completed_games": red_wins + blue_wins,
                    "source_path": str(ROOT / "data" / "extracted" / event_code / "matches.csv"),
                }
            )
    frame = pd.DataFrame.from_records(records, columns=schemas.CANONICAL_MATCH_COLUMNS)
    frame = frame.sort_values(["match_date", "event_code", "match_id"], kind="stable").reset_index(drop=True)
    return frame


def build_season_team_index(canonical_matches: Any) -> Any:
    pd, _ = require_dataframe_deps()
    red = canonical_matches[
        ["red_season_team_key", "red_school_key", "red_school_name", "season", "event_code", "match_date"]
    ].rename(
        columns={
            "red_season_team_key": "season_team_key",
            "red_school_key": "school_key",
            "red_school_name": "school_name",
        }
    )
    blue = canonical_matches[
        ["blue_season_team_key", "blue_school_key", "blue_school_name", "season", "event_code", "match_date"]
    ].rename(
        columns={
            "blue_season_team_key": "season_team_key",
            "blue_school_key": "school_key",
            "blue_school_name": "school_name",
        }
    )
    combined = pd.concat([red, blue], ignore_index=True)
    grouped = (
        combined.groupby(["season_team_key", "school_key", "school_name", "season", "event_code"], as_index=False)
        .agg(first_match_date=("match_date", "min"), last_match_date=("match_date", "max"), match_count=("match_date", "size"))
        .sort_values(["season", "school_key"], kind="stable")
        .reset_index(drop=True)
    )
    return grouped[schemas.SEASON_TEAM_INDEX_COLUMNS]


def save_parquet(frame: Any, path: Path) -> None:
    schemas.ensure_parent(path)
    frame.to_parquet(path, index=False)


def save_json(payload: dict[str, Any], path: Path) -> None:
    schemas.ensure_parent(path)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_dataset_artifacts(
    out_dir: Path,
    canonical_matches: Any,
    school_static_features: Any,
    season_team_index: Any,
    shape_history: Any,
    rmul_3v3_ranking_history: Any,
    feature_manifest: dict[str, Any],
    limit_matches: int | None,
) -> DatasetPaths:
    paths = dataset_paths(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    save_parquet(canonical_matches, paths.canonical_matches)
    save_parquet(school_static_features, paths.school_static_features)
    save_parquet(season_team_index, paths.season_team_index)
    save_parquet(shape_history, paths.shape_history)
    save_parquet(rmul_3v3_ranking_history, paths.rmul_3v3_ranking_history)
    save_json(feature_manifest, paths.feature_manifest)
    manifest = schemas.DatasetManifest(
        dataset_version=schemas.DATASET_VERSION,
        created_at=datetime.now(tz=UTC).isoformat(),
        event_codes=sorted(canonical_matches["event_code"].unique().tolist()),
        match_count=int(len(canonical_matches)),
        school_count=int(len(school_static_features)),
        school_universe_count=int(len(school_static_features)),
        school_universe_policy=SCHOOL_UNIVERSE_POLICY,
        cutoff_date=RMUL_FINAL_DATE,
        season_team_count=int(len(season_team_index)),
        canonical_matches_path=str(paths.canonical_matches),
        school_static_features_path=str(paths.school_static_features),
        season_team_index_path=str(paths.season_team_index),
        shape_history_path=str(paths.shape_history),
        rmul_3v3_ranking_history_path=str(paths.rmul_3v3_ranking_history),
        feature_manifest_path=str(paths.feature_manifest),
        limit_matches=limit_matches,
    )
    save_json(manifest.to_dict(), paths.dataset_manifest)
    return paths


def read_dataset(dataset_dir: Path) -> dict[str, Any]:
    pd, _ = require_dataframe_deps()
    paths = dataset_paths(dataset_dir)
    manifest = json.loads(paths.dataset_manifest.read_text(encoding="utf-8"))
    feature_manifest = json.loads(paths.feature_manifest.read_text(encoding="utf-8"))
    return {
        "manifest": manifest,
        "feature_manifest": feature_manifest,
        "canonical_matches": pd.read_parquet(paths.canonical_matches),
        "school_static_features": pd.read_parquet(paths.school_static_features),
        "season_team_index": pd.read_parquet(paths.season_team_index),
        "shape_history": pd.read_parquet(paths.shape_history),
        "rmul_3v3_ranking_history": pd.read_parquet(paths.rmul_3v3_ranking_history),
        "paths": paths,
    }


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def build_lookup_by_school(static_features: Any) -> dict[str, str]:
    return {
        row["school_key"]: row["school_name"]
        for row in static_features[["school_key", "school_name"]].to_dict(orient="records")
    }


def resolve_school_identifier(identifier: str, static_features: Any) -> str:
    normalized = canonicalize_school(identifier)
    by_key = set(static_features["school_key"].tolist())
    if normalized in by_key:
        return normalized
    matches = static_features[static_features["school_name"] == normalized]
    if not matches.empty:
        return matches.iloc[0]["school_key"]
    raise ValueError(f"Unknown school identifier: {identifier}")
