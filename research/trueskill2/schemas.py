from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


DATASET_VERSION = 2
MODEL_ARTIFACT_VERSION = 2

CANONICAL_MATCH_COLUMNS = [
    "match_id",
    "event_code",
    "season",
    "match_date",
    "stage_id",
    "stage_bucket",
    "competition_family",
    "stage_family",
    "is_regional_group_match",
    "is_post_group_match",
    "best_of",
    "ruleset_id",
    "red_school_key",
    "blue_school_key",
    "red_school_name",
    "blue_school_name",
    "red_season_team_key",
    "blue_season_team_key",
    "winner_side",
    "red_wins",
    "blue_wins",
    "completed_games",
    "source_path",
]

STATIC_FEATURE_COLUMNS = [
    "school_key",
    "school_name",
    "feature_ranking_score",
    "feature_ranking_rank",
    "feature_seed_rank",
    "feature_group_rank_mean",
    "feature_group_points_mean",
    "feature_group_damage_mean",
    "feature_rank_score_2024",
    "feature_rank_score_2025",
    "feature_robot_summary_2025",
    "feature_robot_summary_2026",
    "feature_match_coverage_2024",
    "feature_match_coverage_2025",
    "feature_match_coverage_2026",
    "feature_first_seen_season",
    "missing_feature_ranking_score",
    "missing_feature_ranking_rank",
    "missing_feature_seed_rank",
    "missing_feature_group_rank_mean",
    "missing_feature_group_points_mean",
    "missing_feature_group_damage_mean",
    "missing_feature_rank_score_2024",
    "missing_feature_rank_score_2025",
    "missing_feature_robot_summary_2025",
    "missing_feature_robot_summary_2026",
]

SEASON_TEAM_INDEX_COLUMNS = [
    "season_team_key",
    "school_key",
    "school_name",
    "season",
    "event_code",
    "first_match_date",
    "last_match_date",
    "match_count",
]


@dataclass
class DatasetManifest:
    dataset_version: int
    created_at: str
    event_codes: list[str]
    match_count: int
    school_count: int
    school_universe_count: int
    school_universe_policy: str
    cutoff_date: str
    season_team_count: int
    canonical_matches_path: str
    school_static_features_path: str
    season_team_index_path: str
    shape_history_path: str
    rmul_3v3_ranking_history_path: str
    feature_manifest_path: str
    limit_matches: int | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class FitManifest:
    artifact_version: int
    dataset_path: str
    config_path: str
    inference_mode: str
    seed: int
    posterior_samples_path: str
    posterior_summary_path: str
    ratings_timeline_path: str
    match_predictions_path: str
    model_report_path: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
