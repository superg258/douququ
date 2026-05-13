from __future__ import annotations

import csv
import json
import math
import os
import sys
from datetime import UTC, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_ts2_backend as ts2_model  # noqa: E402
import simulate_region as region_sim  # noqa: E402
from . import rmuc_live


DEFAULT_SIMULATION_SAMPLES = int(os.getenv("RMUC_SIMULATION_SAMPLES", "1200"))
DEFAULT_PREMATCH_TIMEZONE = "Asia/Shanghai"
PREMATCH_STRONG_GLOBAL_RANK_CUTOFF = 32
PREMATCH_OVERPERFORMER_ELO_DELTA_CUTOFF = 50.0
REGION_SLUG_ORDER = ["south_region", "east_region", "north_region"]
REGION_SLUG_ORDER_INDEX = {region_slug: index for index, region_slug in enumerate(REGION_SLUG_ORDER)}
REGION_SLUG_TO_NAME = {config["slug"]: region for region, config in region_sim.REGION_CONFIGS.items()}
PRESEASON_RATINGS_CSV = ts2_model.DERIVED_DIR / "preseason_ratings.csv"
PUBLISHED_RATINGS_DIR = ts2_model.DERIVED_DIR / "published_2026"
REGION_SIM_DIR = ts2_model.ROOT / "data" / "derived" / "2026_rmuc_region_simulations"
RUNTIME_LIVE_DIR = ROOT / "data" / "runtime" / "rmuc_live"
NORMALIZED_LIVE_SCHEDULE_PATH = RUNTIME_LIVE_DIR / "normalized_schedule.json"
MINI_PROGRAM_PREDICTIONS_PATH = RUNTIME_LIVE_DIR / "mini_program_predictions.json"
RUNTIME_PUBLISHED_RATINGS_DIR = RUNTIME_LIVE_DIR / "published_2026"
MINI_PROGRAM_CLIENT = rmuc_live.MiniProgramPredictionClient()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _path_signature(path: Path) -> tuple[str, int, int]:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return (str(path), 0, -1)
    return (str(path), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=1)
def load_ratings_rows() -> list[dict[str, str]]:
    return _read_csv(PRESEASON_RATINGS_CSV)


def _school_key_from_rating_row(row: dict[str, str]) -> str:
    school_key = str(row.get("school_key") or "")
    if school_key:
        return school_key
    return rmuc_live.legacy_elo.make_school_key(str(row["college_name"]))


@lru_cache(maxsize=1)
def load_preseason_global_elo_rank_map() -> dict[str, int]:
    rows = sorted(
        load_ratings_rows(),
        key=lambda row: (
            -float(row["mu0"]),
            row["college_name"],
            row["team_name"],
        ),
    )
    return {row["team_key"]: index for index, row in enumerate(rows, start=1)}


@lru_cache(maxsize=8)
def _load_current_rating_index_cached(
    snapshot_path_text: str,
    snapshot_mtime_ns: int,
    snapshot_size: int,
) -> dict[str, dict[str, Any]]:
    snapshot_path = Path(snapshot_path_text)
    snapshot_rows = _read_json_if_exists(snapshot_path)
    snapshot_by_school_key: dict[str, dict[str, Any]] = {}
    if isinstance(snapshot_rows, list):
        snapshot_by_school_key = {
            str(row.get("school_key")): row
            for row in snapshot_rows
            if isinstance(row, dict) and row.get("school_key") and row.get("published_rating") is not None
        }

    out: dict[str, dict[str, Any]] = {}
    for row in load_ratings_rows():
        team_key = str(row["team_key"])
        school_key = _school_key_from_rating_row(row)
        preseason_elo = float(row["mu0"])
        snapshot = snapshot_by_school_key.get(school_key)
        current_elo = float(snapshot["published_rating"]) if snapshot is not None else preseason_elo
        out[team_key] = {
            "teamKey": team_key,
            "schoolKey": school_key,
            "currentElo": current_elo,
            "preseasonElo": preseason_elo,
            "eloDeltaFromPreseason": current_elo - preseason_elo,
            "eloRankSource": "live" if snapshot is not None else "preseason",
        }
    return out


def load_current_rating_index() -> dict[str, dict[str, Any]]:
    snapshot_path = _published_current_snapshot_path_for(RUNTIME_PUBLISHED_RATINGS_DIR)
    return _load_current_rating_index_cached(*_path_signature(snapshot_path))


load_current_rating_index.cache_clear = _load_current_rating_index_cached.cache_clear  # type: ignore[attr-defined]


@lru_cache(maxsize=8)
def _load_global_elo_rank_map_cached(
    snapshot_path_text: str,
    snapshot_mtime_ns: int,
    snapshot_size: int,
) -> dict[str, int]:
    current_rows = sorted(
        load_current_rating_index().values(),
        key=lambda row: (
            -float(row["currentElo"]),
            str(row["teamKey"]),
        ),
    )
    return {str(row["teamKey"]): index for index, row in enumerate(current_rows, start=1)}


def load_global_elo_rank_map() -> dict[str, int]:
    snapshot_path = _published_current_snapshot_path_for(RUNTIME_PUBLISHED_RATINGS_DIR)
    return _load_global_elo_rank_map_cached(*_path_signature(snapshot_path))


load_global_elo_rank_map.cache_clear = _load_global_elo_rank_map_cached.cache_clear  # type: ignore[attr-defined]


def _rating_fields_for_team(
    team_key: str,
    preseason_elo: float,
    current_rating_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    rating = current_rating_index.get(team_key)
    if rating is None:
        current_elo = float(preseason_elo)
        return {
            "currentElo": current_elo,
            "preseasonElo": float(preseason_elo),
            "eloDeltaFromPreseason": 0.0,
            "eloRankSource": "preseason",
        }
    return {
        "currentElo": float(rating["currentElo"]),
        "preseasonElo": float(rating["preseasonElo"]),
        "eloDeltaFromPreseason": float(rating["eloDeltaFromPreseason"]),
        "eloRankSource": str(rating["eloRankSource"]),
    }


def compute_team_key(college_name: str, team_name: str) -> str:
    return ts2_model.make_team_key(college_name, team_name)


def resolve_region_name(region_slug: str) -> str:
    if region_slug not in REGION_SLUG_TO_NAME:
        raise KeyError(region_slug)
    return REGION_SLUG_TO_NAME[region_slug]


def region_probability_path(region_slug: str) -> Path:
    return REGION_SIM_DIR / region_slug / "monte_carlo_team_rates.csv"


def region_summary_path(region_slug: str) -> Path:
    return REGION_SIM_DIR / region_slug / "monte_carlo_summary.json"


@lru_cache(maxsize=8)
def load_region_probability_rows(region_slug: str) -> list[dict[str, str]]:
    return _read_csv(region_probability_path(region_slug))


@lru_cache(maxsize=8)
def load_region_summary(region_slug: str) -> dict[str, Any]:
    return _read_json(region_summary_path(region_slug))


def serialize_region_monte_carlo(region_slug: str) -> dict[str, Any]:
    summary = load_region_summary(region_slug)
    return {
        "aggregationMode": summary.get("aggregation_mode", "single_seed"),
        "seedCount": int(summary.get("seed_count", 1)),
        "iterationsPerSeed": int(summary.get("iterations_per_seed", summary.get("iterations", 0))),
        "effectiveIterations": int(summary.get("effective_iterations", summary.get("iterations", 0))),
        "seeds": [int(seed) for seed in summary.get("seeds", [])],
        "pairProbabilitySamples": int(summary.get("pair_probability_samples", 0)),
    }


def current_generated_at() -> str:
    mtimes = []
    for region_slug in REGION_SLUG_TO_NAME:
        path = region_probability_path(region_slug)
        if path.exists():
            mtimes.append(path.stat().st_mtime)
    if not mtimes:
        return datetime.now(tz=UTC).isoformat()
    return datetime.fromtimestamp(max(mtimes), tz=UTC).isoformat()


def published_manifest_path() -> Path:
    return PUBLISHED_RATINGS_DIR / "published_manifest.json"


def published_current_snapshot_path() -> Path:
    return PUBLISHED_RATINGS_DIR / "current_snapshot.json"


def published_live_match_ledger_path() -> Path:
    return PUBLISHED_RATINGS_DIR / "live_match_ledger.json"


def _published_manifest_path_for(published_dir: Path) -> Path:
    return published_dir / "published_manifest.json"


def _published_current_snapshot_path_for(published_dir: Path) -> Path:
    return published_dir / "current_snapshot.json"


def _published_live_match_ledger_path_for(published_dir: Path) -> Path:
    return published_dir / "live_match_ledger.json"


def _effective_published_dir() -> Path:
    runtime_required = [
        _published_manifest_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
        _published_current_snapshot_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
        _published_live_match_ledger_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
    ]
    if all(path.exists() for path in runtime_required):
        return RUNTIME_PUBLISHED_RATINGS_DIR
    return PUBLISHED_RATINGS_DIR


def _runtime_live_artifact_version() -> str:
    paths = [
        NORMALIZED_LIVE_SCHEDULE_PATH,
        MINI_PROGRAM_PREDICTIONS_PATH,
        _published_manifest_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
        _published_current_snapshot_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
        _published_live_match_ledger_path_for(RUNTIME_PUBLISHED_RATINGS_DIR),
    ]
    return "|".join(
        f"{Path(path_text).name}:{mtime_ns}:{size}"
        for path_text, mtime_ns, size in (_path_signature(path) for path in paths)
    )


def _read_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return _read_json(path)


def load_normalized_live_schedule() -> dict[str, Any] | None:
    payload = _read_json_if_exists(NORMALIZED_LIVE_SCHEDULE_PATH)
    return payload if isinstance(payload, dict) else None


def _official_schedule_match_counts(region: Any) -> tuple[int, int]:
    if not isinstance(region, dict):
        return 0, 0
    matches = region.get("matches")
    if not isinstance(matches, list):
        return 0, 0
    schedule_count = 0
    placeholder_count = 0
    for match in matches:
        if not isinstance(match, dict) or not match.get("officialMatchId"):
            continue
        schedule_count += 1
        if match.get("isConfirmedMatchup") is False:
            placeholder_count += 1
    return schedule_count, placeholder_count


def _live_data_level(
    *,
    source_status: str,
    completed_count: int,
    confirmed_count: int,
    official_schedule_count: int,
) -> str:
    if source_status != "active":
        return "missing" if source_status == "missing" else "inactive"
    if completed_count > 0:
        return "official_results"
    if confirmed_count > 0:
        return "confirmed_matchups"
    if official_schedule_count > 0:
        return "schedule_shell"
    return "source_connected"


def _live_data_label(level: str, reason: Any = None) -> str:
    labels = {
        "official_results": "官方赛果已接入",
        "confirmed_matchups": "官方对阵已确认，赛果待同步",
        "schedule_shell": "官方排期已接入，对阵待确认",
        "source_connected": "官方实时源已连接，赛程待同步",
        "missing": "尚未同步官方实时赛程",
        "inactive": "官方实时源未接入",
    }
    if level in {"inactive", "missing"} and reason:
        return str(reason)
    return labels.get(level, labels["inactive"])


def _mini_program_predictions_enabled() -> bool:
    return os.getenv("RMUC_MINI_PROGRAM_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def load_mini_program_predictions() -> dict[str, dict[str, Any]]:
    if not _mini_program_predictions_enabled():
        return {}
    payload = _read_json_if_exists(MINI_PROGRAM_PREDICTIONS_PATH)
    if not isinstance(payload, dict):
        return {}
    predictions = payload.get("predictions")
    if not isinstance(predictions, dict):
        return {}
    return {
        str(match_id): prediction
        for match_id, prediction in predictions.items()
        if isinstance(prediction, dict)
    }


@lru_cache(maxsize=1)
def load_published_manifest() -> dict[str, Any]:
    return _read_json(published_manifest_path())


@lru_cache(maxsize=1)
def load_published_current_snapshot_rows() -> list[dict[str, Any]]:
    return _read_json(published_current_snapshot_path())


@lru_cache(maxsize=1)
def load_published_live_match_ledger_rows() -> list[dict[str, Any]]:
    return _read_json(published_live_match_ledger_path())


def _reset_live_state_caches() -> None:
    load_published_manifest.cache_clear()
    load_published_current_snapshot_rows.cache_clear()
    load_published_live_match_ledger_rows.cache_clear()
    load_current_rating_index.cache_clear()
    load_global_elo_rank_map.cache_clear()


def live_state_unavailable_payload(region_slug: str, reason: str) -> dict[str, Any]:
    live_status = summarize_live_status(region_slug)
    return {
        "available": False,
        "reason": reason,
        **live_status,
        "regionSlug": region_slug,
        "regionName": resolve_region_name(region_slug),
        "generatedAt": None,
        "season": None,
        "currentSnapshot": [],
        "matchLedger": [],
        "teamIndex": {},
    }


def summarize_live_status(region_slug: str) -> dict[str, Any]:
    normalized = load_normalized_live_schedule()
    if not normalized:
        level = _live_data_level(
            source_status="missing",
            completed_count=0,
            confirmed_count=0,
            official_schedule_count=0,
        )
        return {
            "sourceStatus": "missing",
            "sourceReason": "尚未同步官方实时赛程",
            "sourceUpdatedAt": None,
            "runtimeArtifactVersion": _runtime_live_artifact_version(),
            "completedOfficialMatches": 0,
            "confirmedOfficialMatches": 0,
            "officialScheduleMatches": 0,
            "officialPlaceholderMatches": 0,
            "liveDataLevel": level,
            "liveDataLabel": _live_data_label(level, "尚未同步官方实时赛程"),
            "ledgerRows": 0,
            "recentError": None,
        }
    source_status = str(normalized.get("sourceStatus") or "inactive")
    region = normalized.get("regions", {}).get(region_slug) if isinstance(normalized.get("regions"), dict) else None
    context = rmuc_live.LiveRuntimeContext.from_normalized(normalized, region_slug)
    ledger = _read_json_if_exists(_published_live_match_ledger_path_for(RUNTIME_PUBLISHED_RATINGS_DIR))
    ledger_rows = len(ledger) if isinstance(ledger, list) else 0
    effective_source_status = source_status if region or source_status != "active" else "inactive"
    official_schedule_matches, official_placeholder_matches = _official_schedule_match_counts(region)
    completed_count = context.completed_count if context.source_status == "active" else 0
    confirmed_count = context.confirmed_count if context.source_status == "active" else 0
    live_data_level = _live_data_level(
        source_status=effective_source_status,
        completed_count=completed_count,
        confirmed_count=confirmed_count,
        official_schedule_count=official_schedule_matches,
    )
    source_reason = normalized.get("reason") if source_status != "active" else (None if region else "实时源未包含当前赛区")
    return {
        "sourceStatus": effective_source_status,
        "sourceReason": source_reason,
        "sourceUpdatedAt": normalized.get("sourceUpdatedAt") or normalized.get("fetchedAt"),
        "runtimeArtifactVersion": _runtime_live_artifact_version(),
        "completedOfficialMatches": completed_count,
        "confirmedOfficialMatches": confirmed_count,
        "officialScheduleMatches": official_schedule_matches if effective_source_status == "active" else 0,
        "officialPlaceholderMatches": official_placeholder_matches if effective_source_status == "active" else 0,
        "liveDataLevel": live_data_level,
        "liveDataLabel": _live_data_label(live_data_level, source_reason),
        "ledgerRows": ledger_rows,
        "recentError": normalized.get("reason") if source_status != "active" else None,
    }


def build_overview_payload() -> dict[str, Any]:
    current_rating_index = load_current_rating_index()
    global_rank_map = load_global_elo_rank_map()
    generated_at = current_generated_at()
    regions: list[dict[str, Any]] = []

    for region_name, config in region_sim.REGION_CONFIGS.items():
        region_slug = config["slug"]
        rows = load_region_probability_rows(region_slug)
        monte_carlo = serialize_region_monte_carlo(region_slug)
        teams: list[dict[str, Any]] = []

        for row in rows:
            team_key = compute_team_key(row["college_name"], row["team_name"])
            preseason_elo = float(row["mu0"])
            rating_fields = _rating_fields_for_team(team_key, preseason_elo, current_rating_index)
            teams.append(
                {
                    "teamKey": team_key,
                    "collegeName": row["college_name"],
                    "teamName": row["team_name"],
                    "mu0": round(preseason_elo, 6),
                    "sigma0": round(float(row["sigma0"]), 6),
                    "eloGlobalRank": global_rank_map[team_key],
                    "currentElo": round(float(rating_fields["currentElo"]), 6),
                    "preseasonElo": round(float(rating_fields["preseasonElo"]), 6),
                    "eloDeltaFromPreseason": round(float(rating_fields["eloDeltaFromPreseason"]), 6),
                    "eloRankSource": rating_fields["eloRankSource"],
                    "seedTier": row["seed_tier"],
                    "seedRankInRegion": int(row["seed_rank_in_region"]),
                    "probabilities": {
                        "roundOf16": float(row["round_of_16_rate"]),
                        "repechage": float(row["repechage_rate"]),
                        "national": float(row["national_rate"]),
                        "champion": float(row["champion_rate"]),
                    },
                }
            )

        teams.sort(
            key=lambda team: (
                -team["currentElo"],
                team["collegeName"],
                team["teamName"],
            )
        )
        for index, team in enumerate(teams, start=1):
            team["eloRegionRank"] = index
            team["regionSlug"] = region_slug
            team["regionName"] = region_name

        regions.append(
            {
                "regionSlug": region_slug,
                "regionName": region_name,
                "nationalSlots": config["national_slots"],
                "repechageSlots": config["repechage_slots"],
                "monteCarlo": monte_carlo,
                "liveStatus": summarize_live_status(region_slug),
                "teams": teams,
            }
        )

    regions.sort(key=lambda region: REGION_SLUG_ORDER_INDEX.get(region["regionSlug"], len(REGION_SLUG_ORDER_INDEX)))
    return {"generatedAt": generated_at, "regions": regions}


def _team_lookup_from_simulation(simulation: dict[str, Any]) -> dict[tuple[str, str], str]:
    lookup: dict[tuple[str, str], str] = {}
    for slot_row in simulation["slot_rows"]:
        lookup[(slot_row["college_name"], slot_row["team_name"])] = compute_team_key(
            slot_row["college_name"], slot_row["team_name"]
        )
    return lookup


def _final_rankings_by_team_key(final_rankings: list[dict[str, Any]], team_lookup: dict[tuple[str, str], str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in final_rankings:
        team_key = team_lookup[(row["college_name"], row["team_name"])]
        out[team_key] = row
    return out


def _serialize_team_ref(
    *,
    team_key: str,
    college_name: str,
    team_name: str,
    slot: str | None = None,
) -> dict[str, Any]:
    return {
        "teamKey": team_key,
        "collegeName": college_name,
        "teamName": team_name,
        "slot": slot,
    }


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


SWISS_ROUND_START_MATCH_NUMBER = {
    1: 1,
    2: 17,
    3: 33,
    4: 49,
    5: 61,
}
SWISS_GROUP_MATCH_COUNT = {
    1: 8,
    2: 8,
    3: 8,
    4: 6,
    5: 3,
}


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def _regional_match_number_from_label(match_label: str, region_slug: str) -> int | None:
    parts = str(match_label or "").split("-")
    if len(parts) == 4 and parts[0] in {"A", "B"} and parts[1] == "SWISS":
        round_number = _positive_int(parts[2])
        index = _positive_int(parts[3])
        start = SWISS_ROUND_START_MATCH_NUMBER.get(round_number or 0)
        group_count = SWISS_GROUP_MATCH_COUNT.get(round_number or 0)
        if start and group_count and index is not None and index <= group_count:
            return start + (group_count if parts[0] == "B" else 0) + index - 1

    if len(parts) == 2:
        stage, index_text = parts
        index = _positive_int(index_text)
        if stage == "R16" and index is not None and index <= 8:
            return 66 + index
        if stage == "QF" and index is not None and index <= 4:
            return 74 + index
        if stage == "SF" and index is not None and index <= 2:
            return 82 + index
        if stage == "THIRD" and index == 1:
            return 89 if region_slug == "north_region" else 87
        if stage == "FINAL" and index == 1:
            return 90 if region_slug == "north_region" else 88

    if len(parts) == 3 and parts[0] == "QUAL":
        round_code = parts[1]
        index = _positive_int(parts[2])
        if round_code == "1" and index is not None and index <= 4:
            return 78 + index
        if round_code == "2" and index is not None and index <= 2:
            return 84 + index
        if round_code == "R" and region_slug == "north_region" and index is not None and index <= 2:
            return 86 + index

    return None


def _serialize_simulation(
    region_slug: str,
    seed: int,
    simulation: dict[str, Any],
    *,
    include_current_ratings: bool = False,
) -> dict[str, Any]:
    region_name = resolve_region_name(region_slug)
    monte_carlo = serialize_region_monte_carlo(region_slug)
    team_lookup = _team_lookup_from_simulation(simulation)
    final_rankings = simulation["summary"]["final_rankings"]
    final_rankings_by_key = _final_rankings_by_team_key(final_rankings, team_lookup)
    current_rating_index = load_current_rating_index() if include_current_ratings else {}
    global_elo_rank_map = load_global_elo_rank_map() if include_current_ratings else load_preseason_global_elo_rank_map()
    preseason_elo_by_team_key = {
        team_lookup[(row["college_name"], row["team_name"])]: float(row["mu0"])
        for row in simulation["slot_rows"]
    }

    slots = []
    for row in simulation["slot_rows"]:
        team_key = team_lookup[(row["college_name"], row["team_name"])]
        slot_payload = {
            "teamKey": team_key,
            "collegeName": row["college_name"],
            "teamName": row["team_name"],
            "groupName": row["group_name"],
            "slot": row["slot"],
            "drawBox": row["draw_box"],
            "seedTier": row["seed_tier"],
            "seedRankInRegion": int(row["seed_rank_in_region"]),
            "mu0": float(row["mu0"]),
            "sigma0": float(row["sigma0"]),
            "eloGlobalRank": global_elo_rank_map[team_key],
        }
        if include_current_ratings:
            slot_payload.update(_rating_fields_for_team(team_key, float(row["mu0"]), current_rating_index))
        slots.append(slot_payload)

    match_rows = []
    for row in simulation["match_rows"]:
        red_key = team_lookup[(row["red_college_name"], row["red_team_name"])]
        blue_key = team_lookup[(row["blue_college_name"], row["blue_team_name"])]
        winner_key = team_lookup[(row["winner_college_name"], row["winner_team_name"])]
        loser_key = team_lookup[(row["loser_college_name"], row["loser_team_name"])]
        serialized_match = {
            "matchLabel": row["match_label"],
            "stage": row["stage"],
            "stageOrder": int(row["stage_order"]),
            "roundNumber": int(row["round_number"]),
            "groupName": row["group_name"],
            "bestOf": int(row["best_of"]),
            "isRealResult": bool(row.get("is_actual_result", False)),
            "isConfirmedMatchup": bool(row.get("is_confirmed_matchup", False)),
            "redTeam": _serialize_team_ref(
                team_key=red_key,
                college_name=row["red_college_name"],
                team_name=row["red_team_name"],
                slot=row["red_slot"],
            ),
            "blueTeam": _serialize_team_ref(
                team_key=blue_key,
                college_name=row["blue_college_name"],
                team_name=row["blue_team_name"],
                slot=row["blue_slot"],
            ),
            "scoreline": row["scoreline"],
            "winnerTeamKey": winner_key,
            "loserTeamKey": loser_key,
            "pGameRed": float(row["p_game_red"]),
            "pGameBlue": float(row["p_game_blue"]),
            "pSeriesRed": float(row["p_series_red"]),
            "pSeriesBlue": float(row["p_series_blue"]),
            "deltaH2H": float(row["delta_h2h"]),
            "confidenceLabel": row["confidence_label"],
            "winnerNext": row["winner_next"],
            "loserNext": row["loser_next"],
        }
        regional_match_number = _regional_match_number_from_label(str(row["match_label"]), region_slug)
        if regional_match_number is not None:
            serialized_match["regionalMatchNumber"] = regional_match_number
        if include_current_ratings:
            serialized_match["redCurrentElo"] = float(
                _rating_fields_for_team(red_key, preseason_elo_by_team_key.get(red_key, 0.0), current_rating_index)["currentElo"]
            )
            serialized_match["blueCurrentElo"] = float(
                _rating_fields_for_team(blue_key, preseason_elo_by_team_key.get(blue_key, 0.0), current_rating_index)["currentElo"]
            )
        if "red_mu0" in row and "blue_mu0" in row and "red_delta" in row and "blue_delta" in row:
            serialized_match["redMu0"] = float(row["red_mu0"])
            serialized_match["blueMu0"] = float(row["blue_mu0"])
            serialized_match["redDelta"] = float(row["red_delta"])
            serialized_match["blueDelta"] = float(row["blue_delta"])
            if "red_live_delta" in row and "blue_live_delta" in row:
                serialized_match["redLiveDelta"] = float(row["red_live_delta"])
                serialized_match["blueLiveDelta"] = float(row["blue_live_delta"])
            if "red_prior_delta" in row and "blue_prior_delta" in row:
                serialized_match["redPriorDelta"] = float(row["red_prior_delta"])
                serialized_match["bluePriorDelta"] = float(row["blue_prior_delta"])
            if "red_prior_adjustment_label" in row:
                serialized_match["redPriorAdjustmentLabel"] = str(row["red_prior_adjustment_label"])
            if "blue_prior_adjustment_label" in row:
                serialized_match["bluePriorAdjustmentLabel"] = str(row["blue_prior_adjustment_label"])
        if row.get("official_match_id") is not None:
            serialized_match["officialMatchId"] = str(row["official_match_id"])
        if row.get("official_status") is not None:
            serialized_match["officialStatus"] = str(row["official_status"])
        if row.get("planned_start_at") is not None:
            serialized_match["plannedStartAt"] = str(row["planned_start_at"])
        if row.get("has_live_scoreline"):
            serialized_match["hasLiveScoreline"] = True
        if row.get("mini_program_prediction") is not None:
            serialized_match["miniProgramPrediction"] = row["mini_program_prediction"]
        match_rows.append(serialized_match)

    group_rankings: dict[str, list[dict[str, Any]]] = {}
    for group_name, rows in simulation["summary"]["group_rankings"].items():
        group_rankings[group_name] = []
        for row in rows:
            team_key = team_lookup[(row["college_name"], row["team_name"])]
            ranking_row = final_rankings_by_key[team_key]
            group_rankings[group_name].append(
                {
                    "groupRank": int(row["group_rank"]),
                    "teamKey": team_key,
                    "collegeName": row["college_name"],
                    "teamName": row["team_name"],
                    "slot": row["slot"],
                    "wins": int(row["wins"]),
                    "losses": int(row["losses"]),
                    "status": row["status"],
                    "opponentScore": _optional_float(row.get("opponent_score")),
                    "calculatedOpponentScore": _optional_float(row.get("calculated_opponent_score")),
                    "officialOpponentPoints": _optional_float(row.get("official_opponent_points")),
                    "officialAvgBaseHpDiff": _optional_float(row.get("official_avg_base_hp_diff")),
                    "officialAvgTeamDamage": _optional_float(row.get("official_avg_team_damage")),
                    "rankingMetricSource": str(row.get("ranking_metric_source") or "simulation_proxy"),
                    "rankingCompleteness": str(row.get("ranking_completeness") or "simulation_proxy"),
                    "sourceReportedOpponentPoints": _optional_float(row.get("source_reported_opponent_points")),
                    "simulationGameDiff": _optional_float(row.get("simulation_game_diff")),
                    "finalRank": int(ranking_row["rank"]),
                }
            )

    serialized_rankings = []
    for row in final_rankings:
        team_key = team_lookup[(row["college_name"], row["team_name"])]
        ranking_payload = {
            "rank": int(row["rank"]),
            "teamKey": team_key,
            "collegeName": row["college_name"],
            "teamName": row["team_name"],
            "groupName": row["group_name"],
            "slot": row["slot"],
            "seedTier": row["seed_tier"],
            "seedRankInRegion": int(row["seed_rank_in_region"]),
            "swissWins": int(row["swiss_wins"]),
            "swissLosses": int(row["swiss_losses"]),
            "swissGroupRank": int(row["swiss_group_rank"]) if row["swiss_group_rank"] != "" else None,
            "opponentScore": _optional_float(row.get("opponent_score")),
            "calculatedOpponentScore": _optional_float(row.get("calculated_opponent_score")),
            "officialOpponentPoints": _optional_float(row.get("official_opponent_points")),
            "officialAvgBaseHpDiff": _optional_float(row.get("official_avg_base_hp_diff")),
            "officialAvgTeamDamage": _optional_float(row.get("official_avg_team_damage")),
            "rankingMetricSource": str(row.get("ranking_metric_source") or "simulation_proxy"),
            "rankingCompleteness": str(row.get("ranking_completeness") or "simulation_proxy"),
            "sourceReportedOpponentPoints": _optional_float(row.get("source_reported_opponent_points")),
            "mu0": float(row["mu0"]),
            "finalBucket": row["final_bucket"],
            "advancement": row["advancement"],
        }
        if include_current_ratings:
            ranking_payload.update(_rating_fields_for_team(team_key, float(row["mu0"]), current_rating_index))
        serialized_rankings.append(ranking_payload)

    summary = simulation["summary"]
    return {
        "meta": {
            "regionSlug": region_slug,
            "regionName": region_name,
            "seed": seed,
            "generatedAt": datetime.now(tz=UTC).isoformat(),
            "samplesPerMatch": int(summary["samples_per_match"]),
            "nationalSlots": int(summary["configuration"]["national_slots"]),
            "repechageSlots": int(summary["configuration"]["repechage_slots"]),
            "monteCarlo": monte_carlo,
            "liveStatus": summarize_live_status(region_slug),
        },
        "slots": slots,
        "groupRankings": group_rankings,
        "matches": match_rows,
        "finalRankings": serialized_rankings,
        "summary": {
            "champion": _serialize_team_ref(
                team_key=team_lookup[(summary["champion"]["college_name"], summary["champion"]["team_name"])],
                college_name=summary["champion"]["college_name"],
                team_name=summary["champion"]["team_name"],
            ),
            "runnerUp": _serialize_team_ref(
                team_key=team_lookup[(summary["runner_up"]["college_name"], summary["runner_up"]["team_name"])],
                college_name=summary["runner_up"]["college_name"],
                team_name=summary["runner_up"]["team_name"],
            ),
            "thirdPlace": _serialize_team_ref(
                team_key=team_lookup[(summary["third_place"]["college_name"], summary["third_place"]["team_name"])],
                college_name=summary["third_place"]["college_name"],
                team_name=summary["third_place"]["team_name"],
            ),
            "fourthPlace": _serialize_team_ref(
                team_key=team_lookup[(summary["fourth_place"]["college_name"], summary["fourth_place"]["team_name"])],
                college_name=summary["fourth_place"]["college_name"],
                team_name=summary["fourth_place"]["team_name"],
            ),
            "nationalQualifiers": [team_lookup[(row["college_name"], row["team_name"])] for row in final_rankings if row["advancement"] == "national_qualified"],
            "repechageQualifiers": [team_lookup[(row["college_name"], row["team_name"])] for row in final_rankings if row["advancement"] == "repechage_qualified"],
            "matchCountByStage": summary["match_count_by_stage"],
        },
    }


def build_live_state_payload(region_slug: str) -> dict[str, Any]:
    live_status = summarize_live_status(region_slug)
    if live_status["sourceStatus"] != "active":
        return live_state_unavailable_payload(
            region_slug,
            str(live_status.get("sourceReason") or "实时赛程源未激活"),
        )

    published_dir = RUNTIME_PUBLISHED_RATINGS_DIR
    manifest = _published_manifest_path_for(published_dir)
    current_snapshot = _published_current_snapshot_path_for(published_dir)
    live_ledger = _published_live_match_ledger_path_for(published_dir)
    if not (manifest.exists() and current_snapshot.exists() and live_ledger.exists()):
        return live_state_unavailable_payload(region_slug, "published artifacts unavailable")

    region_name = resolve_region_name(region_slug)
    ratings_rows = [row for row in load_ratings_rows() if row.get("admitted_region") == region_name]
    if not ratings_rows:
        return live_state_unavailable_payload(region_slug, "no teams found for region")

    manifest_payload = _read_json(manifest)
    snapshot_rows = _read_json(current_snapshot)
    ledger_rows = _read_json(live_ledger)
    snapshot_by_school_key = {str(row["school_key"]): row for row in snapshot_rows}
    region_school_keys = {str(row["school_key"]) for row in ratings_rows if row.get("school_key")}
    region_ledger_rows = [
        row
        for row in ledger_rows
        if str(row.get("region_slug", "")) == region_slug or str(row.get("school_key", "")) in region_school_keys
    ]

    latest_match_by_school_key: dict[str, dict[str, Any]] = {}
    for row in sorted(region_ledger_rows, key=lambda item: (str(item.get("match_date", "")), str(item.get("match_id", "")))):
        latest_match_by_school_key[str(row.get("school_key", ""))] = row

    rating_scale = float(manifest_payload.get("rating_scale", 120.0))
    team_index: dict[str, dict[str, Any]] = {}
    current_snapshot_payload: list[dict[str, Any]] = []
    school_key_to_team_key: dict[str, str] = {}

    for row in ratings_rows:
        school_key = str(row["school_key"])
        team_key = str(row["team_key"])
        school_key_to_team_key[school_key] = team_key
        team_index[team_key] = {
            "teamKey": team_key,
            "schoolKey": school_key,
            "collegeName": row["college_name"],
            "teamName": row["team_name"],
            "regionSlug": region_slug,
            "regionName": region_name,
        }
        current_row = snapshot_by_school_key.get(school_key)
        preseason_rating = float(row["mu0"])
        current_rating = float(current_row.get("published_rating", preseason_rating)) if current_row else preseason_rating
        latest_match = latest_match_by_school_key.get(school_key)
        current_snapshot_payload.append(
            {
                "teamKey": team_key,
                "schoolKey": school_key,
                "collegeName": row["college_name"],
                "teamName": row["team_name"],
                "currentPublishedRating": current_rating,
                "preseasonPublishedRating": preseason_rating,
                "publishedDeltaFromPreseason": current_rating - preseason_rating,
                "liveStateRatingComponent": rating_scale * float(current_row.get("rmuc_live_state_theta", 0.0)) if current_row else 0.0,
                "confirmedPriorRatingComponent": rating_scale * float(current_row.get("confirmed_prior_theta", 0.0)) if current_row else 0.0,
                "residualPriorRatingComponent": rating_scale * float(current_row.get("residual_prior_theta", 0.0)) if current_row else 0.0,
                "priorRetentionFraction": float(current_row.get("prior_retention_fraction", 1.0)) if current_row else 1.0,
                "priorAbsorptionFraction": float(current_row.get("prior_absorption_fraction", 0.0)) if current_row else 0.0,
                "regionalGroupMatchesPlayed": int(current_row.get("regional_group_matches_played", 0)) if current_row else 0,
                "currentStageFamily": str(current_row.get("current_stage_family", "regional_pre")) if current_row else "regional_pre",
                "latestMatchId": str(latest_match.get("match_id")) if latest_match else None,
                "latestMatchDate": str(latest_match.get("match_date")) if latest_match else None,
            }
        )

    current_snapshot_payload.sort(
        key=lambda item: (-float(item["currentPublishedRating"]), str(item["collegeName"]), str(item["teamName"]))
    )

    match_ledger_payload = []
    for row in sorted(region_ledger_rows, key=lambda item: (str(item.get("match_date", "")), str(item.get("match_id", "")), str(item.get("team_side", "")))):
        school_key = str(row["school_key"])
        opponent_school_key = str(row.get("opponent_school_key", ""))
        team_key = school_key_to_team_key.get(school_key)
        opponent_team_key = school_key_to_team_key.get(opponent_school_key)
        if team_key is None or opponent_team_key is None:
            continue
        match_ledger_payload.append(
            {
                "matchId": str(row["match_id"]),
                "matchDate": str(row["match_date"]),
                "regionSlug": str(row.get("region_slug", region_slug) or region_slug),
                "stageFamily": str(row["stage_family"]),
                "teamKey": team_key,
                "opponentTeamKey": opponent_team_key,
                "teamSide": str(row["team_side"]),
                "scoreline": str(row["scoreline"]),
                "matchResult": str(row["match_result"]),
                "publishedRatingBeforeMatch": float(row["published_rating_before_match"]),
                "publishedRatingAfterMatch": float(row["published_rating_after_match"]),
                "publishedDeltaRating": float(row["published_delta_rating"]),
                "liveUpdateDeltaRating": float(row["live_update_delta_rating"]),
                "priorComponentDeltaRating": float(row["prior_component_delta_rating"]),
                "priorRetentionFractionBeforeMatch": float(row.get("prior_retention_fraction_before_match", 1.0)),
                "priorRetentionFractionAfterMatch": float(row.get("prior_retention_fraction_after_match", 1.0)),
                "priorAbsorptionFractionBeforeMatch": float(row.get("prior_absorption_fraction_before_match", 0.0)),
                "priorAbsorptionFractionAfterMatch": float(row.get("prior_absorption_fraction_after_match", 0.0)),
                "confirmedPriorRatingAfterMatch": float(row["confirmed_prior_rating_after_match"]),
                "residualPriorRatingAfterMatch": float(row["residual_prior_rating_after_match"]),
            }
        )

    return {
        "available": True,
        "reason": None,
        **summarize_live_status(region_slug),
        "regionSlug": region_slug,
        "regionName": region_name,
        "generatedAt": manifest_payload.get("generated_at"),
        "season": int(manifest_payload.get("season", 0)),
        "currentSnapshot": current_snapshot_payload,
        "matchLedger": match_ledger_payload,
        "ledgerRows": len(match_ledger_payload),
        "teamIndex": team_index,
    }


def _mini_program_predictions_for_context(context: rmuc_live.LiveRuntimeContext) -> dict[str, dict[str, Any]]:
    if not _mini_program_predictions_enabled():
        return {}
    persisted_predictions = load_mini_program_predictions()
    out: dict[str, dict[str, Any]] = {}
    for match in context.matches_by_pair.values():
        if isinstance(match.get("miniProgramPrediction"), dict):
            continue
        official_id = str(match.get("officialMatchId") or "")
        if official_id and official_id in persisted_predictions and official_id not in out:
            out[official_id] = persisted_predictions[official_id]
    return out


def _load_live_runtime_context(region_slug: str) -> rmuc_live.LiveRuntimeContext:
    normalized = load_normalized_live_schedule()
    if not normalized:
        return rmuc_live.LiveRuntimeContext.inactive(region_slug, "尚未同步官方实时赛程")
    context = rmuc_live.LiveRuntimeContext.from_normalized(normalized, region_slug)
    if context.source_status != "active":
        return context
    mini_program_predictions = _mini_program_predictions_for_context(context)
    return rmuc_live.LiveRuntimeContext.from_normalized(
        normalized,
        region_slug,
        mini_program_predictions=mini_program_predictions,
    )


def _live_schedule_metadata_by_label(region_slug: str) -> dict[str, dict[str, Any]]:
    normalized = load_normalized_live_schedule()
    if not normalized or str(normalized.get("sourceStatus") or "") != "active":
        return {}
    regions = normalized.get("regions")
    if not isinstance(regions, dict):
        return {}
    region = regions.get(region_slug)
    if not isinstance(region, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for match in region.get("matches", []):
        if not isinstance(match, dict):
            continue
        match_label = str(match.get("matchLabel") or "")
        if not match_label:
            continue
        out[match_label] = match
    return out


def _official_schedule_order_by_id(schedule_by_label: dict[str, dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for schedule in schedule_by_label.values():
        official_match_id = str(schedule.get("officialMatchId") or "").strip()
        order_number = _positive_int(schedule.get("orderNumber"))
        if official_match_id and order_number is not None:
            out[official_match_id] = order_number
    return out


def _official_group_source_by_id(schedule_by_label: dict[str, dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for schedule in schedule_by_label.values():
        match_label = str(schedule.get("matchLabel") or "")
        if not match_label.startswith(("A-SWISS-", "B-SWISS-")):
            continue
        group_name = match_label[:1]
        for side in ("red", "blue"):
            source_type = str(schedule.get(f"{side}FillSourceType") or "").strip()
            source_id = str(schedule.get(f"{side}FillSourceId") or "").strip()
            if source_type == "Group" and source_id:
                out[source_id] = group_name
    return out


def _fill_source_result_label(source_number: Any) -> str:
    source_index = _positive_int(source_number)
    if source_index == 1:
        return "胜者"
    if source_index == 2:
        return "败者"
    if source_index is not None:
        return f"第 {source_index} 名"
    return "晋级来源"


def _official_placeholder_team_ref(
    schedule: dict[str, Any],
    side: str,
    source_order_by_id: dict[str, int] | None = None,
    group_source_by_id: dict[str, str] | None = None,
) -> dict[str, Any]:
    slot = str(schedule.get(f"{side}Slot") or "").strip()
    source_type = str(schedule.get(f"{side}FillSourceType") or "").strip()
    source_id = str(schedule.get(f"{side}FillSourceId") or "").strip()
    source_number = schedule.get(f"{side}FillSourceNumber")
    if slot:
        label = slot
        detail = "官方槽位待确认"
    elif source_type == "Match" and source_id:
        result_label = _fill_source_result_label(source_number)
        source_match_number = (source_order_by_id or {}).get(source_id)
        if source_match_number is not None:
            label = f"第{source_match_number}场{result_label}"
        elif result_label == "晋级来源":
            label = "官方来源待确认"
        else:
            label = f"待确认比赛{result_label}"
        detail = "晋级来源待确认"
    elif source_type == "Group" and source_number not in (None, ""):
        source_index = _positive_int(source_number)
        group_name = (group_source_by_id or {}).get(source_id)
        if group_name and source_index is not None:
            label = f"{group_name}组第{source_index}名"
        elif group_name:
            label = f"{group_name}组第{source_number}名"
        elif source_index is not None:
            label = f"小组第{source_index}名"
        else:
            label = f"小组第{source_number}名"
        detail = "官方晋级来源待确认"
    elif source_type and source_number not in (None, ""):
        source_index = _positive_int(source_number)
        label = f"官方来源第 {source_index} 名" if source_index is not None else "官方来源待确认"
        detail = "官方晋级来源待确认"
    elif source_type:
        label = "官方来源待确认"
        detail = "官方晋级来源待确认"
    else:
        label = "待定"
        detail = "官方排期待确认"
    return {
        "teamKey": "",
        "collegeName": label,
        "teamName": detail,
        "slot": slot or None,
    }


def _apply_unconfirmed_official_schedule(
    match: dict[str, Any],
    schedule: dict[str, Any],
    source_order_by_id: dict[str, int],
    group_source_by_id: dict[str, str],
) -> None:
    match["isConfirmedMatchup"] = False
    match["isRealResult"] = False
    match["redTeam"] = _official_placeholder_team_ref(schedule, "red", source_order_by_id, group_source_by_id)
    match["blueTeam"] = _official_placeholder_team_ref(schedule, "blue", source_order_by_id, group_source_by_id)
    match["scoreline"] = str(schedule.get("scoreline") or "0:0")
    match["winnerTeamKey"] = ""
    match["loserTeamKey"] = ""
    match["pGameRed"] = 0.5
    match["pGameBlue"] = 0.5
    match["pSeriesRed"] = 0.5
    match["pSeriesBlue"] = 0.5
    match["deltaH2H"] = 0.0
    match["confidenceLabel"] = "low"
    for key in (
        "redMu0",
        "blueMu0",
        "redCurrentElo",
        "blueCurrentElo",
        "redDelta",
        "blueDelta",
        "redLiveDelta",
        "blueLiveDelta",
        "redPriorDelta",
        "bluePriorDelta",
        "redPriorAdjustmentLabel",
        "bluePriorAdjustmentLabel",
        "red_rating_before_match",
        "red_rating_after_match",
        "blue_rating_before_match",
        "blue_rating_after_match",
    ):
        match.pop(key, None)


def _team_ref_has_key(match: dict[str, Any], side: str) -> bool:
    team_ref = match.get(f"{side}Team")
    return isinstance(team_ref, dict) and bool(str(team_ref.get("teamKey") or "").strip())


def _match_has_predicted_team_refs(match: dict[str, Any]) -> bool:
    return _team_ref_has_key(match, "red") and _team_ref_has_key(match, "blue")


def _attach_live_schedule_metadata(
    payload: dict[str, Any],
    region_slug: str,
    *,
    preserve_predicted_unconfirmed: bool = False,
) -> None:
    schedule_by_label = _live_schedule_metadata_by_label(region_slug)
    if not schedule_by_label:
        return
    source_order_by_id = _official_schedule_order_by_id(schedule_by_label)
    group_source_by_id = _official_group_source_by_id(schedule_by_label)
    persisted_predictions = load_mini_program_predictions()
    for match in payload.get("matches", []):
        if not isinstance(match, dict):
            continue
        schedule = schedule_by_label.get(str(match.get("matchLabel") or ""))
        if not schedule:
            continue
        order_number = _positive_int(schedule.get("orderNumber"))
        if order_number is not None:
            match["regionalMatchNumber"] = order_number
        if not match.get("plannedStartAt") and schedule.get("plannedStartAt"):
            match["plannedStartAt"] = str(schedule["plannedStartAt"])
        if not match.get("miniProgramPrediction") and isinstance(schedule.get("miniProgramPrediction"), dict):
            match["miniProgramPrediction"] = schedule["miniProgramPrediction"]
        if not match.get("miniProgramPrediction"):
            official_match_id = str(schedule.get("officialMatchId") or match.get("officialMatchId") or "").strip()
            persisted_prediction = persisted_predictions.get(official_match_id)
            if isinstance(persisted_prediction, dict):
                match["miniProgramPrediction"] = persisted_prediction
        if schedule.get("hasLiveScoreline") and not match.get("isRealResult"):
            match["scoreline"] = str(schedule.get("scoreline") or match.get("scoreline") or "0:0")
            match["hasLiveScoreline"] = True
        if schedule.get("isConfirmedMatchup") is False:
            if schedule.get("officialMatchId"):
                match["officialMatchId"] = str(schedule["officialMatchId"])
            if schedule.get("officialStatus"):
                match["officialStatus"] = str(schedule["officialStatus"])
            if preserve_predicted_unconfirmed and _match_has_predicted_team_refs(match):
                match["isRealResult"] = False
                match["isConfirmedMatchup"] = False
                continue
            _apply_unconfirmed_official_schedule(match, schedule, source_order_by_id, group_source_by_id)


def _published_match_rating_index(region_slug: str) -> dict[tuple[str, str], dict[str, Any]]:
    rows = _read_json_if_exists(_published_live_match_ledger_path_for(RUNTIME_PUBLISHED_RATINGS_DIR))
    if not isinstance(rows, list):
        return {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_region_slug = str(row.get("region_slug") or "")
        if row_region_slug and row_region_slug != region_slug:
            continue
        match_id = str(row.get("match_id") or "")
        school_key = str(row.get("school_key") or "")
        if match_id and school_key:
            out[(match_id, school_key)] = row
    return out


def _school_key_from_team_key(team_key: str) -> str:
    return team_key.split("::", maxsplit=1)[0]


def _ledger_row_for_match(
    rating_index: dict[tuple[str, str], dict[str, Any]],
    *,
    match_id: str | None,
    official_match_id: str | None,
    school_key: str,
) -> dict[str, Any] | None:
    candidate_match_ids = []
    for candidate in (match_id, f"2026RMUC:{official_match_id}" if official_match_id else None, official_match_id):
        if candidate and candidate not in candidate_match_ids:
            candidate_match_ids.append(candidate)
    for candidate in candidate_match_ids:
        row = rating_index.get((candidate, school_key))
        if row is not None:
            return row
    return None


def _float_from_row(row: dict[str, Any] | None, key: str) -> float | None:
    if row is None:
        return None
    value = row.get(key)
    if value in (None, ""):
        return None
    return float(value)


def _prior_adjustment_label(row: dict[str, Any] | None) -> str:
    if row is None:
        return "赛前先验修正"
    try:
        group_matches_played = int(row.get("regional_group_matches_played") or 0)
    except (TypeError, ValueError):
        group_matches_played = 0
    if str(row.get("stage_family") or "") == "regional_group" and group_matches_played <= 3:
        return "前三轮先验修正"
    return "赛前先验修正"


def _attach_published_match_rating_history(
    payload: dict[str, Any],
    *,
    red_team_key: str,
    blue_team_key: str,
    rating_index: dict[tuple[str, str], dict[str, Any]],
) -> None:
    if not rating_index:
        return
    official_match_id = str(payload.get("official_match_id") or "")
    match_id = str(payload.get("match_id") or "")
    if not official_match_id and not match_id:
        return
    red_row = _ledger_row_for_match(
        rating_index,
        match_id=match_id,
        official_match_id=official_match_id,
        school_key=_school_key_from_team_key(red_team_key),
    )
    blue_row = _ledger_row_for_match(
        rating_index,
        match_id=match_id,
        official_match_id=official_match_id,
        school_key=_school_key_from_team_key(blue_team_key),
    )
    red_before = _float_from_row(red_row, "published_rating_before_match")
    red_after = _float_from_row(red_row, "published_rating_after_match")
    blue_before = _float_from_row(blue_row, "published_rating_before_match")
    blue_after = _float_from_row(blue_row, "published_rating_after_match")
    if None in (red_before, red_after, blue_before, blue_after):
        return
    payload["red_rating_before_match"] = red_before
    payload["red_rating_after_match"] = red_after
    payload["blue_rating_before_match"] = blue_before
    payload["blue_rating_after_match"] = blue_after
    payload["red_live_delta"] = _float_from_row(red_row, "live_update_delta_rating")
    payload["blue_live_delta"] = _float_from_row(blue_row, "live_update_delta_rating")
    payload["red_prior_delta"] = _float_from_row(red_row, "prior_component_delta_rating")
    payload["blue_prior_delta"] = _float_from_row(blue_row, "prior_component_delta_rating")
    payload["red_prior_adjustment_label"] = _prior_adjustment_label(red_row)
    payload["blue_prior_adjustment_label"] = _prior_adjustment_label(blue_row)


def _predicted_scoreline_from_series(p_series_red: float, best_of: int) -> str:
    p_series_red = max(0.0, min(1.0, p_series_red))
    if best_of == 5:
        if p_series_red >= 0.5:
            if p_series_red < 0.65:
                return "3:2"
            if p_series_red < 0.85:
                return "3:1"
            return "3:0"
        if p_series_red > 0.35:
            return "2:3"
        if p_series_red > 0.15:
            return "1:3"
        return "0:3"

    if p_series_red >= 0.5:
        return "2:1" if p_series_red < 0.72 else "2:0"
    return "1:2" if p_series_red > 0.28 else "0:2"


def _collapse_live_prediction_distribution(payload: dict[str, Any], *, best_of: int) -> None:
    if payload.get("fixed_scoreline"):
        return
    payload["scoreline_distribution"] = {
        _predicted_scoreline_from_series(float(payload["p_series_red"]), best_of): 1.0
    }


def _prediction_elo_for_team(team: Any, current_rating_index: dict[str, dict[str, Any]]) -> float:
    rating = current_rating_index.get(str(team.team_key))
    if rating is not None and rating.get("currentElo") is not None:
        return float(rating["currentElo"])
    return float(getattr(team, "mu0"))


def _deterministic_live_prediction_payload(
    red_team: Any,
    blue_team: Any,
    *,
    best_of: int,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    current_rating_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    red_elo = _prediction_elo_for_team(red_team, current_rating_index)
    blue_elo = _prediction_elo_for_team(blue_team, current_rating_index)
    beta_perf = (float(getattr(red_team, "beta_perf", 0.0)) + float(getattr(blue_team, "beta_perf", 0.0))) / 2.0
    red_theta = (red_elo - 1500.0) / float(region_sim.RATING_SCALE)
    blue_theta = (blue_elo - 1500.0) / float(region_sim.RATING_SCALE)
    p_game_base_red = 1.0 / (1.0 + math.exp(-((red_theta - blue_theta) / max(beta_perf, 1e-6))))
    p_game_base_red = region_sim.legacy_elo.clip(p_game_base_red, 0.05, 0.95)
    head_to_head_summary = region_sim.h2h.summarize_head_to_head(
        red_team.college_name,
        blue_team.college_name,
        p_base=p_game_base_red,
        head_to_head_index=head_to_head_index,
    )
    p_game_adj_red = float(head_to_head_summary["p_game_adj"])
    raw_distribution = region_sim._compute_scoreline_distribution(best_of, p_game_adj_red)
    p_series_red = sum(
        probability
        for scoreline, probability in raw_distribution.items()
        if int(scoreline.split(":")[0]) > int(scoreline.split(":")[1])
    )
    return {
        "p_game_base_red": p_game_base_red,
        "p_game_adj_red": p_game_adj_red,
        "p_series_red": p_series_red,
        "p_series_blue": 1.0 - p_series_red,
        "scoreline_distribution": raw_distribution,
        "head_to_head_summary": head_to_head_summary,
        "confidence_label": region_sim._classify_confidence(red_team, blue_team),
    }


def _live_prediction_rating_index_for_match(
    *,
    red_team_key: str,
    blue_team_key: str,
    override: dict[str, Any],
    current_rating_index: dict[str, dict[str, Any]],
    rating_index: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not rating_index:
        return current_rating_index
    red_row = _ledger_row_for_match(
        rating_index,
        match_id=str(override.get("match_id") or "") or None,
        official_match_id=str(override.get("official_match_id") or "") or None,
        school_key=_school_key_from_team_key(red_team_key),
    )
    blue_row = _ledger_row_for_match(
        rating_index,
        match_id=str(override.get("match_id") or "") or None,
        official_match_id=str(override.get("official_match_id") or "") or None,
        school_key=_school_key_from_team_key(blue_team_key),
    )
    red_before = _float_from_row(red_row, "published_rating_before_match")
    blue_before = _float_from_row(blue_row, "published_rating_before_match")
    if red_before is None or blue_before is None:
        return current_rating_index

    out = dict(current_rating_index)
    out[red_team_key] = {**out.get(red_team_key, {}), "currentElo": red_before}
    out[blue_team_key] = {**out.get(blue_team_key, {}), "currentElo": blue_before}
    return out


def _stage_label(stage: str, group_name: str | None = None) -> str:
    labels = {
        "swiss": "瑞士轮",
        "qualification_round1": "资格赛第一轮",
        "qualification_round2": "资格赛第二轮",
        "round_of_16": "16 进 8",
        "quarterfinal": "8 进 4",
        "semifinal": "半决赛",
        "third_place": "季军战",
        "final": "冠军战",
    }
    label = labels.get(stage, stage)
    if stage == "swiss" and group_name:
        return f"{group_name} 组瑞士轮"
    return label


def _workspace_view_for_match(match: dict[str, Any]) -> str:
    stage = str(match.get("stage") or "")
    if stage == "swiss":
        return "swiss-b" if str(match.get("groupName") or "") == "B" else "swiss-a"
    if stage.startswith("qualification"):
        return "qualification"
    return "playoff"


def _confidence_label(confidence: str) -> str:
    labels = {
        "high": "高置信",
        "medium": "中等置信",
        "low": "低置信",
    }
    return labels.get(confidence, confidence)


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError, AttributeError):
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _target_prematch_date(date_text: str | None, timezone_name: str) -> str:
    if date_text:
        try:
            return datetime.fromisoformat(date_text).date().isoformat()
        except ValueError:
            return datetime.now(tz=_prematch_timezone(timezone_name)).date().isoformat()
    return datetime.now(tz=_prematch_timezone(timezone_name)).date().isoformat()


def _local_date(value: Any, timezone_name: str) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return parsed.astimezone(_prematch_timezone(timezone_name)).date().isoformat()


def _prematch_timezone(timezone_name: str) -> timezone | ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name == DEFAULT_PREMATCH_TIMEZONE:
            return timezone(timedelta(hours=8), name=DEFAULT_PREMATCH_TIMEZONE)
        return UTC


def _audience_signal(prediction: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(prediction, dict):
        return {
            "status": "unavailable",
            "available": False,
            "redRate": None,
            "blueRate": None,
            "tieRate": None,
            "totalCount": None,
            "favoriteSide": None,
            "label": "暂无观众预测",
        }

    red_rate = prediction.get("redRate")
    blue_rate = prediction.get("blueRate")
    tie_rate = prediction.get("tieRate")
    has_rates = isinstance(red_rate, (int, float)) and isinstance(blue_rate, (int, float))
    available = str(prediction.get("status") or "") == "available" and has_rates
    favorite_side = None
    if has_rates:
        favorite_side = "red" if float(red_rate) >= float(blue_rate) else "blue"
        if isinstance(tie_rate, (int, float)) and float(tie_rate) > max(float(red_rate), float(blue_rate)):
            favorite_side = "tie"
    status = "available" if available else "stale" if has_rates else "unavailable"
    total_count = prediction.get("totalCount") if isinstance(prediction.get("totalCount"), int) else None
    if status == "available":
        label = f"{total_count or 0} 票"
    elif status == "stale":
        label = "历史记录"
    else:
        label = str(prediction.get("reason") or "暂无观众预测")
    return {
        "status": status,
        "available": has_rates,
        "redRate": float(red_rate) if has_rates else None,
        "blueRate": float(blue_rate) if has_rates else None,
        "tieRate": float(tie_rate) if isinstance(tie_rate, (int, float)) else None,
        "totalCount": total_count,
        "favoriteSide": favorite_side,
        "label": label,
        "fetchedAt": prediction.get("fetchedAt"),
    }


def _model_audience_divergence(model_red_rate: float, audience: dict[str, Any]) -> dict[str, Any]:
    if audience.get("redRate") is None:
        return {
            "available": False,
            "redDelta": None,
            "absoluteDelta": None,
            "label": "暂无观众预测",
            "audienceFavoriteSide": None,
        }
    red_delta = float(audience["redRate"]) - model_red_rate
    absolute_delta = abs(red_delta)
    if absolute_delta >= 0.20:
        label = "明显分歧"
    elif absolute_delta >= 0.10:
        label = "轻微分歧"
    else:
        label = "基本一致"
    return {
        "available": True,
        "redDelta": round(red_delta, 6),
        "absoluteDelta": round(absolute_delta, 6),
        "label": label,
        "audienceFavoriteSide": audience.get("favoriteSide"),
    }


def _upset_risk(red_rate: float, blue_rate: float, divergence: dict[str, Any]) -> dict[str, Any]:
    underdog_rate = min(red_rate, blue_rate)
    margin = abs(red_rate - blue_rate)
    divergence_delta = float(divergence.get("absoluteDelta") or 0.0)
    score = max(0.0, min(1.0, underdog_rate + divergence_delta * 0.25))
    if margin < 0.12:
        label = "均势"
        reason = "模型胜率接近，赛果本身不宜按爆冷理解"
    elif score >= 0.40:
        label = "高"
        reason = "下位方胜率和外部意见分歧都偏高"
    elif score >= 0.30:
        label = "中"
        reason = "下位方有可观胜率，需关注临场波动"
    elif score >= 0.18:
        label = "低"
        reason = "模型优势较清楚，但仍存在常规波动"
    else:
        label = "极低"
        reason = "模型优势明显，爆冷需要较强外部扰动"
    return {
        "score": round(score, 6),
        "label": label,
        "reason": reason,
    }


def _prematch_data_source(requested_mode: str, live_status: dict[str, Any], match: dict[str, Any]) -> str:
    if requested_mode == "sim":
        return "simulation"
    if live_status.get("sourceStatus") == "active" and match.get("officialMatchId"):
        if match.get("isRealResult") or match.get("isConfirmedMatchup") is not False:
            return "official_live"
        if not _match_has_predicted_team_refs(match):
            return "official_live"
        return "simulation_proxy"
    return "simulation_proxy"


def _prematch_schedule_state(data_source: str, match: dict[str, Any]) -> str:
    if data_source == "simulation":
        return "simulation"
    if data_source == "simulation_proxy":
        return "simulation_proxy"
    if match.get("isConfirmedMatchup") is False and not _match_has_predicted_team_refs(match):
        return "official_placeholder"
    if match.get("plannedStartAt"):
        return "scheduled"
    return "confirmed_unfinished"


def _team_key_for_side(match: dict[str, Any], side: str) -> str:
    team = match.get(f"{side}Team")
    if not isinstance(team, dict):
        return ""
    return str(team.get("teamKey") or "")


def _prior_upset_winner_key(match: dict[str, Any]) -> str | None:
    winner_key = str(match.get("winnerTeamKey") or "")
    red_key = _team_key_for_side(match, "red")
    blue_key = _team_key_for_side(match, "blue")
    if not winner_key or winner_key not in {red_key, blue_key}:
        return None
    try:
        red_rate = float(match["pSeriesRed"])
        blue_rate = float(match["pSeriesBlue"])
    except (KeyError, TypeError, ValueError):
        return None
    if winner_key == red_key and red_rate < blue_rate:
        return red_key
    if winner_key == blue_key and blue_rate < red_rate:
        return blue_key
    return None


def _global_rank_for_team(team_key: str, global_rank_map: dict[str, int]) -> int | None:
    rank = global_rank_map.get(team_key)
    return int(rank) if rank is not None else None


def _prematch_rating_signal_for_team(
    team_key: str,
    current_rating_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    rating = current_rating_index.get(team_key)
    if rating is None:
        return {
            "currentElo": None,
            "preseasonElo": None,
            "eloDeltaFromPreseason": None,
            "seasonOverperformer": False,
        }
    current_elo = float(rating["currentElo"])
    preseason_elo = float(rating["preseasonElo"])
    delta = float(rating["eloDeltaFromPreseason"])
    source = str(rating.get("eloRankSource") or "")
    return {
        "currentElo": current_elo,
        "preseasonElo": preseason_elo,
        "eloDeltaFromPreseason": delta,
        "seasonOverperformer": source == "live" and delta >= PREMATCH_OVERPERFORMER_ELO_DELTA_CUTOFF,
    }


def _serialize_prematch_item(
    *,
    region_slug: str,
    region_name: str,
    seed: int,
    requested_mode: str,
    live_status: dict[str, Any],
    match: dict[str, Any],
    timezone_name: str,
    prior_upset_team_keys: set[str],
    global_rank_map: dict[str, int],
    current_rating_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    red_rate = float(match["pSeriesRed"])
    blue_rate = float(match["pSeriesBlue"])
    predicted_winner_side = "red" if red_rate >= blue_rate else "blue"
    predicted_winner = match["redTeam"] if predicted_winner_side == "red" else match["blueTeam"]
    audience = _audience_signal(match.get("miniProgramPrediction"))
    divergence = _model_audience_divergence(red_rate, audience)
    data_source = _prematch_data_source(requested_mode, live_status, match)
    planned_start_at = match.get("plannedStartAt")
    red_team_key = _team_key_for_side(match, "red")
    blue_team_key = _team_key_for_side(match, "blue")
    red_global_rank = _global_rank_for_team(red_team_key, global_rank_map)
    blue_global_rank = _global_rank_for_team(blue_team_key, global_rank_map)
    red_rating = _prematch_rating_signal_for_team(red_team_key, current_rating_index)
    blue_rating = _prematch_rating_signal_for_team(blue_team_key, current_rating_index)
    prior_upset_keys = [
        team_key
        for team_key in (red_team_key, blue_team_key)
        if team_key and team_key in prior_upset_team_keys
    ]
    season_overperformer_keys = [
        team_key
        for team_key, rating in ((red_team_key, red_rating), (blue_team_key, blue_rating))
        if team_key and rating["seasonOverperformer"]
    ]
    strong_team_involved = any(
        rank is not None and rank <= PREMATCH_STRONG_GLOBAL_RANK_CUTOFF
        for rank in (red_global_rank, blue_global_rank)
    )
    return {
        "id": f"{region_slug}:{match.get('officialMatchId') or match['matchLabel']}",
        "regionSlug": region_slug,
        "regionName": region_name,
        "seed": seed,
        "mode": requested_mode,
        "dataSource": data_source,
        "scheduleState": _prematch_schedule_state(data_source, match),
        "workspaceView": _workspace_view_for_match(match),
        "matchLabel": match["matchLabel"],
        "stage": match["stage"],
        "stageLabel": _stage_label(str(match["stage"]), str(match.get("groupName") or "")),
        "stageOrder": int(match["stageOrder"]),
        "roundNumber": int(match["roundNumber"]),
        "groupName": match["groupName"],
        "bestOf": int(match["bestOf"]),
        "isConfirmedMatchup": bool(match.get("isConfirmedMatchup", False)),
        "plannedStartAt": planned_start_at,
        "plannedLocalDate": _local_date(planned_start_at, timezone_name),
        "officialMatchId": match.get("officialMatchId"),
        "officialStatus": match.get("officialStatus"),
        "redTeam": match["redTeam"],
        "blueTeam": match["blueTeam"],
        "pGameRed": float(match["pGameRed"]),
        "pGameBlue": float(match["pGameBlue"]),
        "pSeriesRed": red_rate,
        "pSeriesBlue": blue_rate,
        "favoriteRate": max(red_rate, blue_rate),
        "margin": abs(red_rate - blue_rate),
        "predictedWinnerSide": predicted_winner_side,
        "predictedWinnerTeamKey": predicted_winner["teamKey"],
        "predictedWinnerName": predicted_winner["collegeName"],
        "predictedScoreline": _predicted_scoreline_from_series(red_rate, int(match["bestOf"])),
        "confidenceLabel": match["confidenceLabel"],
        "confidenceText": _confidence_label(str(match["confidenceLabel"])),
        "audience": audience,
        "modelAudienceDivergence": divergence,
        "upsetRisk": _upset_risk(red_rate, blue_rate, divergence),
        "redTeamGlobalRank": red_global_rank,
        "blueTeamGlobalRank": blue_global_rank,
        "redCurrentElo": red_rating["currentElo"],
        "blueCurrentElo": blue_rating["currentElo"],
        "redPreseasonElo": red_rating["preseasonElo"],
        "bluePreseasonElo": blue_rating["preseasonElo"],
        "redEloDeltaFromPreseason": red_rating["eloDeltaFromPreseason"],
        "blueEloDeltaFromPreseason": blue_rating["eloDeltaFromPreseason"],
        "redSeasonOverperformer": red_rating["seasonOverperformer"],
        "blueSeasonOverperformer": blue_rating["seasonOverperformer"],
        "strongTeamInvolved": strong_team_involved,
        "priorUpsetTeamKeys": prior_upset_keys,
        "hasPriorUpsetTeam": bool(prior_upset_keys),
        "seasonOverperformerTeamKeys": season_overperformer_keys,
        "hasSeasonOverperformerTeam": bool(season_overperformer_keys),
    }


def _prematch_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    planned = _parse_datetime(item.get("plannedStartAt"))
    return (
        0 if planned else 1,
        planned or datetime.max.replace(tzinfo=UTC),
        REGION_SLUG_ORDER_INDEX.get(str(item["regionSlug"]), len(REGION_SLUG_ORDER_INDEX)),
        int(item["stageOrder"]),
        int(item["roundNumber"]),
        str(item["matchLabel"]),
    )


ACTIONABLE_PREMATCH_SCHEDULE_STATES = {"scheduled", "confirmed_unfinished"}


def _is_actionable_prematch_schedule(item: dict[str, Any]) -> bool:
    return (
        item.get("dataSource") == "official_live"
        and item.get("scheduleState") in ACTIONABLE_PREMATCH_SCHEDULE_STATES
        and _parse_datetime(item.get("plannedStartAt")) is not None
    )


def _timeline_bucket_template() -> dict[str, list[dict[str, Any]]]:
    return {
        "liveNow": [],
        "upNext": [],
        "todayPending": [],
        "confirmedUpcoming": [],
        "overdueUnresolved": [],
        "simulationUnassigned": [],
        "reviewPending": [],
    }


TIMELINE_BUCKET_BY_STATE = {
    "live_now": "liveNow",
    "up_next": "upNext",
    "today_pending": "todayPending",
    "confirmed_upcoming": "confirmedUpcoming",
    "overdue_unresolved": "overdueUnresolved",
    "simulation_unassigned": "simulationUnassigned",
    "review_pending": "reviewPending",
}


def _is_official_running_status(status: Any) -> bool:
    return str(status or "").strip().upper() in {"RUNNING", "STARTED", "ONGOING", "IN_PROGRESS", "LIVE"}


def _timeline_state_for_prematch(
    item: dict[str, Any],
    *,
    now: datetime,
    target_date: str,
    timezone_name: str,
    up_next_id: str | None,
) -> str:
    if _is_official_running_status(item.get("officialStatus")):
        return "live_now"
    planned = _parse_datetime(item.get("plannedStartAt"))
    if planned is None:
        return "simulation_unassigned"
    if planned.astimezone(UTC) < now.astimezone(UTC):
        return "overdue_unresolved"
    if item.get("dataSource") == "simulation_proxy" or item.get("scheduleState") == "simulation_proxy":
        return "simulation_unassigned"
    if item.get("id") == up_next_id:
        return "up_next"
    if _local_date(item.get("plannedStartAt"), timezone_name) == target_date:
        return "today_pending"
    return "confirmed_upcoming"


def _source_updated_candidates(region_statuses: list[dict[str, Any]]) -> list[datetime]:
    candidates: list[datetime] = []
    for status in region_statuses:
        parsed = _parse_datetime(status.get("sourceUpdatedAt"))
        if parsed is not None:
            candidates.append(parsed)
    return candidates


def _live_elo_updated_at() -> str | None:
    manifest_path = _published_manifest_path_for(_effective_published_dir())
    manifest = _read_json_if_exists(manifest_path)
    if not isinstance(manifest, dict):
        return None
    value = manifest.get("generated_at") or manifest.get("generatedAt")
    return str(value) if value else None


def _coverage_label(region_statuses: list[dict[str, Any]]) -> str:
    if not any(status.get("sourceStatus") == "active" for status in region_statuses):
        return "官方实时源未接入，全部使用模拟代理"

    labels: list[tuple[str, str]] = []
    for status in region_statuses:
        region_name = str(status.get("regionName") or status.get("regionSlug"))
        if status.get("sourceStatus") != "active":
            labels.append((region_name, "模拟代理"))
            continue
        if int(status.get("completedOfficialMatches") or 0) > 0:
            labels.append((region_name, "官方赛果"))
        elif int(status.get("confirmedOfficialMatches") or 0) > 0:
            labels.append((region_name, "官方对阵"))
        elif (
            int(status.get("officialScheduleMatches") or 0) > 0
            or int(status.get("officialPlaceholderMatches") or 0) > 0
            or status.get("slotAssignmentSource") == "official_placeholder"
        ):
            labels.append((region_name, "官方排期"))
        else:
            labels.append((region_name, "官方实时待赛程"))

    active_labels = [label for _, label in labels if label != "模拟代理"]
    inactive_labels = [label for _, label in labels if label == "模拟代理"]
    if not inactive_labels and len(region_statuses) > 1 and len(set(active_labels)) == 1:
        return f"{active_labels[0]}覆盖全部赛区"
    return "，".join(f"{region_name}{label}" for region_name, label in labels)


def build_source_freshness(
    *,
    generated_at: str,
    now: datetime,
    region_statuses: list[dict[str, Any]],
) -> dict[str, Any]:
    source_updates = _source_updated_candidates(region_statuses)
    official_schedule_updated_at = max(source_updates).astimezone(UTC).isoformat() if source_updates else None
    official_age_minutes = None
    if source_updates:
        latest = max(source_updates).astimezone(UTC)
        official_age_minutes = max(0, int((now.astimezone(UTC) - latest).total_seconds() // 60))
    live_elo_updated_at = _live_elo_updated_at()
    return {
        "serviceGeneratedAt": generated_at,
        "modelGeneratedAt": current_generated_at(),
        "officialScheduleUpdatedAt": official_schedule_updated_at,
        "liveEloUpdatedAt": live_elo_updated_at,
        "officialScheduleAgeMinutes": official_age_minutes,
        "liveEloStatus": "active" if live_elo_updated_at else "missing",
        "activeRegionCount": sum(1 for status in region_statuses if status.get("sourceStatus") == "active"),
        "totalRegionCount": len(region_statuses),
        "coverageLabel": _coverage_label(region_statuses),
        "regionStatuses": region_statuses,
    }


def build_prematch_center_payload(
    *,
    seed: int = region_sim.DEFAULT_SIMULATION_SEED,
    mode: str = "live",
    date: str | None = None,
    timezone_name: str = DEFAULT_PREMATCH_TIMEZONE,
    region_slugs: list[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    if mode not in {"live", "sim"}:
        raise ValueError(f"Unsupported prematch mode: {mode}")
    selected_region_slugs = region_slugs or REGION_SLUG_ORDER
    target_date = _target_prematch_date(date, timezone_name)
    now_dt = now or datetime.now(tz=_prematch_timezone(timezone_name))
    upcoming_matches: list[dict[str, Any]] = []
    review_matches: list[dict[str, Any]] = []
    completed_count = 0
    pending_count = 0
    confirmed_pending_count = 0
    scheduled_count = 0
    official_placeholder_count = 0
    region_statuses: list[dict[str, Any]] = []
    current_rating_index = load_current_rating_index()
    global_rank_map = load_global_elo_rank_map()

    for region_slug in selected_region_slugs:
        simulation = build_simulation_payload(region_slug, seed, mode)
        meta = simulation["meta"]
        region_name = str(meta["regionName"])
        live_status = meta.get("liveStatus") if isinstance(meta.get("liveStatus"), dict) else summarize_live_status(region_slug)
        prior_upset_team_keys: set[str] = set()
        region_statuses.append(
            {
                "regionSlug": region_slug,
                "regionName": region_name,
                "sourceStatus": live_status.get("sourceStatus"),
                "sourceReason": live_status.get("sourceReason"),
                "sourceUpdatedAt": live_status.get("sourceUpdatedAt"),
                "completedOfficialMatches": live_status.get("completedOfficialMatches", 0),
                "confirmedOfficialMatches": live_status.get("confirmedOfficialMatches", 0),
                "officialScheduleMatches": live_status.get("officialScheduleMatches", 0),
                "officialPlaceholderMatches": live_status.get("officialPlaceholderMatches", 0),
                "liveDataLevel": live_status.get("liveDataLevel"),
                "liveDataLabel": live_status.get("liveDataLabel"),
                "slotAssignmentSource": live_status.get("slotAssignmentSource"),
                "slotAssignmentReason": live_status.get("slotAssignmentReason"),
            }
        )
        for match in simulation["matches"]:
            data_source = _prematch_data_source(mode, live_status, match)
            if data_source == "simulation_proxy" and not match.get("officialMatchId"):
                continue
            if match.get("isRealResult"):
                completed_count += 1
                upset_winner_key = _prior_upset_winner_key(match)
                if upset_winner_key:
                    prior_upset_team_keys.add(upset_winner_key)
                review_item = _serialize_prematch_item(
                    region_slug=region_slug,
                    region_name=region_name,
                    seed=int(meta.get("seed", seed)),
                    requested_mode=mode,
                    live_status=live_status,
                    match=match,
                    timezone_name=timezone_name,
                    prior_upset_team_keys=prior_upset_team_keys,
                    global_rank_map=global_rank_map,
                    current_rating_index=current_rating_index,
                )
                review_item["timelineState"] = "review_pending"
                review_matches.append(review_item)
                continue
            pending_count += 1
            is_confirmed_matchup = match.get("isConfirmedMatchup") is not False
            if match.get("officialMatchId") and is_confirmed_matchup:
                confirmed_pending_count += 1
            if match.get("plannedStartAt") and is_confirmed_matchup:
                scheduled_count += 1
            item = _serialize_prematch_item(
                region_slug=region_slug,
                region_name=region_name,
                seed=int(meta.get("seed", seed)),
                requested_mode=mode,
                live_status=live_status,
                match=match,
                timezone_name=timezone_name,
                prior_upset_team_keys=prior_upset_team_keys,
                global_rank_map=global_rank_map,
                current_rating_index=current_rating_index,
            )
            if item.get("scheduleState") == "official_placeholder":
                official_placeholder_count += 1
            upcoming_matches.append(item)

    upcoming_matches.sort(key=_prematch_sort_key)
    next_action_match = next(
        (
            match
            for match in upcoming_matches
            if _is_actionable_prematch_schedule(match)
            and _parse_datetime(match.get("plannedStartAt")).astimezone(UTC) >= now_dt.astimezone(UTC)
        ),
        None,
    )
    up_next_id = str(next_action_match.get("id")) if isinstance(next_action_match, dict) else None
    timeline_buckets = _timeline_bucket_template()
    for match in upcoming_matches:
        timeline_state = _timeline_state_for_prematch(
            match,
            now=now_dt,
            target_date=target_date,
            timezone_name=timezone_name,
            up_next_id=up_next_id,
        )
        match["timelineState"] = timeline_state
        if timeline_state == "confirmed_upcoming" and match.get("scheduleState") == "official_placeholder":
            continue
        timeline_buckets[TIMELINE_BUCKET_BY_STATE[timeline_state]].append(match)
    review_matches.sort(key=_prematch_sort_key, reverse=True)
    timeline_buckets["reviewPending"].extend(review_matches[:24])
    live_now = timeline_buckets["liveNow"]
    next_action_match = next((match for match in live_now if _is_actionable_prematch_schedule(match)), None)
    if next_action_match is None:
        next_action_match = next(
            (
                match
                for match in upcoming_matches
                if _is_actionable_prematch_schedule(match)
                and match.get("timelineState")
                in {"up_next", "today_pending", "confirmed_upcoming"}
            ),
            None,
        )
    today_matches = [match for match in upcoming_matches if match.get("plannedLocalDate") == target_date]
    active_live_regions = sum(1 for status in region_statuses if status.get("sourceStatus") == "active")
    effective_mode = mode if mode == "sim" else "live" if active_live_regions else "simulation_proxy"
    generated_at = datetime.now(tz=UTC).isoformat()
    return {
        "generatedAt": generated_at,
        "seed": seed,
        "targetDate": target_date,
        "timezone": timezone_name,
        "source": {
            "requestedMode": mode,
            "effectiveMode": effective_mode,
            "regionStatuses": region_statuses,
        },
        "sourceFreshness": build_source_freshness(
            generated_at=generated_at,
            now=now_dt,
            region_statuses=region_statuses,
        ),
        "completedMatchCount": completed_count,
        "pendingMatchCount": pending_count,
        "confirmedPendingMatchCount": confirmed_pending_count,
        "scheduledPendingMatchCount": scheduled_count,
        "officialPlaceholderMatchCount": official_placeholder_count,
        "nextMatch": upcoming_matches[0] if upcoming_matches else None,
        "nextActionMatch": next_action_match,
        "timelineBuckets": timeline_buckets,
        "todayMatches": today_matches,
        "allUpcomingMatches": upcoming_matches,
    }


def build_command_center_payload(
    *,
    seed: int = region_sim.DEFAULT_SIMULATION_SEED,
    mode: str = "live",
    date: str | None = None,
    timezone_name: str = DEFAULT_PREMATCH_TIMEZONE,
) -> dict[str, Any]:
    prematch = build_prematch_center_payload(
        seed=seed,
        mode=mode,
        date=date,
        timezone_name=timezone_name,
    )
    return {
        "generatedAt": prematch["generatedAt"],
        "seed": prematch["seed"],
        "targetDate": prematch["targetDate"],
        "timezone": prematch["timezone"],
        "source": prematch["source"],
        "sourceFreshness": prematch["sourceFreshness"],
        "completedMatchCount": prematch["completedMatchCount"],
        "pendingMatchCount": prematch["pendingMatchCount"],
        "confirmedPendingMatchCount": prematch["confirmedPendingMatchCount"],
        "scheduledPendingMatchCount": prematch["scheduledPendingMatchCount"],
        "officialPlaceholderMatchCount": prematch["officialPlaceholderMatchCount"],
        "nextActionMatch": prematch["nextActionMatch"],
        "timelineBuckets": prematch["timelineBuckets"],
    }


def _empty_recap_group() -> dict[str, Any]:
    return {
        "completedMatches": 0,
        "pendingMatches": 0,
        "winnerHits": 0,
        "scorelineHits": 0,
        "upsetMisses": 0,
        "winnerHitRate": None,
        "scorelineHitRate": None,
    }


def _finalize_recap_group(group: dict[str, Any]) -> dict[str, Any]:
    completed = int(group["completedMatches"])
    return {
        **group,
        "winnerHitRate": round(group["winnerHits"] / completed, 6) if completed else None,
        "scorelineHitRate": round(group["scorelineHits"] / completed, 6) if completed else None,
    }


def _actual_winner_side(match: dict[str, Any]) -> str | None:
    winner_key = str(match.get("winnerTeamKey") or "")
    if winner_key == _team_key_for_side(match, "red"):
        return "red"
    if winner_key == _team_key_for_side(match, "blue"):
        return "blue"
    return None


def _record_recap_result(group: dict[str, Any], *, winner_hit: bool, score_hit: bool, upset_miss: bool) -> None:
    group["completedMatches"] += 1
    group["winnerHits"] += 1 if winner_hit else 0
    group["scorelineHits"] += 1 if score_hit else 0
    group["upsetMisses"] += 1 if upset_miss else 0


def build_prediction_recap_payload(
    *,
    seed: int = region_sim.DEFAULT_SIMULATION_SEED,
    mode: str = "live",
    region_slugs: list[str] | None = None,
) -> dict[str, Any]:
    if mode not in {"live", "sim"}:
        raise ValueError(f"Unsupported recap mode: {mode}")
    selected_region_slugs = region_slugs or REGION_SLUG_ORDER
    generated_at = datetime.now(tz=UTC).isoformat()
    summary = _empty_recap_group()
    by_region: dict[str, dict[str, Any]] = {}
    by_confidence: dict[str, dict[str, Any]] = {}
    by_stage: dict[str, dict[str, Any]] = {}
    notable_matches: list[dict[str, Any]] = []

    for region_slug in selected_region_slugs:
        simulation = build_simulation_payload(region_slug, seed, mode)
        meta = simulation["meta"]
        live_status = meta.get("liveStatus") if isinstance(meta, dict) else {}
        if not isinstance(live_status, dict):
            live_status = {}
        region_group = by_region.setdefault(region_slug, {**_empty_recap_group(), "regionName": meta["regionName"]})
        for match in simulation.get("matches", []):
            if mode == "live" and _prematch_data_source(mode, live_status, match) == "simulation_proxy":
                continue
            confidence = str(match.get("confidenceLabel") or "unknown")
            stage = str(match.get("stage") or "unknown")
            confidence_group = by_confidence.setdefault(confidence, {**_empty_recap_group(), "confidenceText": _confidence_label(confidence)})
            stage_group = by_stage.setdefault(stage, {**_empty_recap_group(), "stageLabel": _stage_label(stage, str(match.get("groupName") or ""))})
            if not match.get("isRealResult"):
                summary["pendingMatches"] += 1
                region_group["pendingMatches"] += 1
                confidence_group["pendingMatches"] += 1
                stage_group["pendingMatches"] += 1
                continue

            predicted_side = "red" if float(match["pSeriesRed"]) >= float(match["pSeriesBlue"]) else "blue"
            actual_side = _actual_winner_side(match)
            winner_hit = predicted_side == actual_side
            predicted_scoreline = _predicted_scoreline_from_series(float(match["pSeriesRed"]), int(match["bestOf"]))
            score_hit = winner_hit and str(match.get("scoreline") or "") == predicted_scoreline
            upset_miss = actual_side is not None and not winner_hit
            for group in (summary, region_group, confidence_group, stage_group):
                _record_recap_result(group, winner_hit=winner_hit, score_hit=score_hit, upset_miss=upset_miss)

            if upset_miss or not score_hit:
                favorite = match["redTeam"] if predicted_side == "red" else match["blueTeam"]
                actual = match["redTeam"] if actual_side == "red" else match["blueTeam"] if actual_side == "blue" else None
                notable_matches.append(
                    {
                        "id": f"{region_slug}:{match['matchLabel']}",
                        "regionSlug": region_slug,
                        "regionName": meta["regionName"],
                        "seed": int(meta.get("seed", seed)),
                        "workspaceView": _workspace_view_for_match(match),
                        "matchLabel": match["matchLabel"],
                        "stage": stage,
                        "stageLabel": _stage_label(stage, str(match.get("groupName") or "")),
                        "plannedStartAt": match.get("plannedStartAt"),
                        "predictedWinnerTeamKey": favorite["teamKey"],
                        "predictedWinnerName": favorite["collegeName"],
                        "actualWinnerTeamKey": actual["teamKey"] if actual else None,
                        "actualWinnerName": actual["collegeName"] if actual else None,
                        "predictedScoreline": predicted_scoreline,
                        "actualScoreline": match.get("scoreline"),
                        "favoriteRate": max(float(match["pSeriesRed"]), float(match["pSeriesBlue"])),
                        "confidenceLabel": confidence,
                        "confidenceText": _confidence_label(confidence),
                        "deviationType": "upset_miss" if upset_miss else "scoreline_miss",
                        "redTeam": match["redTeam"],
                        "blueTeam": match["blueTeam"],
                        "predictedWinnerSide": predicted_side,
                    }
                )

    notable_matches.sort(
        key=lambda match: (
            0 if match["deviationType"] == "upset_miss" else 1,
            -float(match["favoriteRate"]),
            str(match.get("plannedStartAt") or ""),
        )
    )
    return {
        "generatedAt": generated_at,
        "seed": seed,
        "mode": mode,
        "summary": _finalize_recap_group(summary),
        "byRegion": {key: _finalize_recap_group(value) for key, value in by_region.items()},
        "byConfidence": {key: _finalize_recap_group(value) for key, value in by_confidence.items()},
        "byStage": {key: _finalize_recap_group(value) for key, value in by_stage.items()},
        "notableMatches": notable_matches[:16],
    }


def _team_match_context(match: dict[str, Any], team_key: str) -> dict[str, Any] | None:
    if _team_key_for_side(match, "red") == team_key:
        side = "red"
        opponent = match["blueTeam"]
        win_probability = float(match["pSeriesRed"])
    elif _team_key_for_side(match, "blue") == team_key:
        side = "blue"
        opponent = match["redTeam"]
        win_probability = float(match["pSeriesBlue"])
    else:
        return None
    if match.get("isRealResult"):
        result = "win" if str(match.get("winnerTeamKey") or "") == team_key else "loss"
    else:
        result = "pending"
    return {
        "side": side,
        "opponent": opponent,
        "resultForTeam": result,
        "winProbability": round(win_probability, 6),
    }


def _team_path_sort_key(match: dict[str, Any]) -> tuple[Any, ...]:
    planned = _parse_datetime(match.get("plannedStartAt"))
    return (
        int(match.get("stageOrder") or 0),
        int(match.get("roundNumber") or 0),
        planned or datetime.max.replace(tzinfo=UTC),
        str(match.get("matchLabel") or ""),
    )


def _is_confirmed_team_profile_match(match: dict[str, Any]) -> bool:
    return bool(match.get("isRealResult")) or bool(match.get("officialMatchId"))


def _has_actual_team_profile_final(match_path: list[dict[str, Any]]) -> bool:
    return bool(match_path) and all(bool(match.get("isRealResult")) for match in match_path)


def _has_official_team_profile_slot(simulation: dict[str, Any]) -> bool:
    meta = simulation.get("meta")
    live_status = meta.get("liveStatus") if isinstance(meta, dict) else None
    return isinstance(live_status, dict) and live_status.get("slotAssignmentSource") == "official"


def build_team_profile_payload(
    team_key: str,
    *,
    seed: int = region_sim.DEFAULT_SIMULATION_SEED,
    mode: str = "live",
) -> dict[str, Any]:
    if mode not in {"live", "sim"}:
        raise ValueError(f"Unsupported team profile mode: {mode}")
    decoded_team_key = unquote(team_key)
    overview = build_overview_payload()
    overview_team: dict[str, Any] | None = None
    overview_region: dict[str, Any] | None = None
    for region in overview.get("regions", []):
        if not isinstance(region, dict):
            continue
        for team in region.get("teams", []):
            if isinstance(team, dict) and str(team.get("teamKey") or "") == decoded_team_key:
                overview_team = team
                overview_region = region
                break
        if overview_team is not None:
            break
    if overview_team is None or overview_region is None:
        raise KeyError(decoded_team_key)

    region_slug = str(overview_region["regionSlug"])
    simulation = build_simulation_payload(region_slug, seed, mode)
    slot = next((row for row in simulation.get("slots", []) if row.get("teamKey") == decoded_team_key), None)
    if mode == "live" and not _has_official_team_profile_slot(simulation):
        slot = None
    final_ranking = next((row for row in simulation.get("finalRankings", []) if row.get("teamKey") == decoded_team_key), None)
    match_path = []
    completed_matches = []
    upcoming_matches = []
    team_matches = []
    for match in sorted(simulation.get("matches", []), key=_team_path_sort_key):
        context = _team_match_context(match, decoded_team_key)
        if context is None:
            continue
        item = {
            **match,
            **context,
            "stageLabel": _stage_label(str(match.get("stage") or ""), str(match.get("groupName") or "")),
            "workspaceView": _workspace_view_for_match(match),
        }
        team_matches.append(item)

    if mode == "sim":
        match_path = team_matches
        completed_matches = [match for match in team_matches if match.get("isRealResult")]
        upcoming_matches = [match for match in team_matches if not match.get("isRealResult")]
    else:
        has_live_team_context = _has_official_team_profile_slot(simulation) or any(
            _is_confirmed_team_profile_match(match) for match in team_matches
        )
        if has_live_team_context:
            completed_matches = [match for match in team_matches if match.get("isRealResult")]
            match_path = completed_matches
            upcoming_matches = [match for match in team_matches if not match.get("isRealResult")]
        if not _has_actual_team_profile_final(team_matches):
            final_ranking = None

    live_state = None
    if mode == "live":
        live_payload = build_live_state_payload(region_slug)
        if live_payload.get("available"):
            live_state = {
                "snapshot": next(
                    (row for row in live_payload.get("currentSnapshot", []) if row.get("teamKey") == decoded_team_key),
                    None,
                ),
                "ledger": [
                    row
                    for row in live_payload.get("matchLedger", [])
                    if row.get("teamKey") == decoded_team_key
                ],
            }

    generated_at = datetime.now(tz=UTC).isoformat()
    region_status = simulation.get("meta", {}).get("liveStatus") if isinstance(simulation.get("meta"), dict) else None
    region_statuses = [
        {
            "regionSlug": region_slug,
            "regionName": overview_region["regionName"],
            "sourceStatus": region_status.get("sourceStatus") if isinstance(region_status, dict) else None,
            "sourceReason": region_status.get("sourceReason") if isinstance(region_status, dict) else None,
            "sourceUpdatedAt": region_status.get("sourceUpdatedAt") if isinstance(region_status, dict) else None,
            "completedOfficialMatches": region_status.get("completedOfficialMatches", 0) if isinstance(region_status, dict) else 0,
            "confirmedOfficialMatches": region_status.get("confirmedOfficialMatches", 0) if isinstance(region_status, dict) else 0,
        }
    ]
    return {
        "generatedAt": generated_at,
        "seed": seed,
        "mode": mode,
        "team": overview_team,
        "region": {
            "regionSlug": region_slug,
            "regionName": overview_region["regionName"],
            "nationalSlots": overview_region.get("nationalSlots"),
            "repechageSlots": overview_region.get("repechageSlots"),
        },
        "slot": slot,
        "finalRanking": final_ranking,
        "matchPath": match_path,
        "completedMatches": completed_matches,
        "upcomingMatches": upcoming_matches,
        "liveState": live_state,
        "regionEntry": {
            "regionSlug": region_slug,
            "view": "playoff",
            "seed": seed,
            "mode": mode,
            "highlightTeamKey": decoded_team_key,
        },
        "sourceFreshness": build_source_freshness(
            generated_at=generated_at,
            now=datetime.now(tz=UTC),
            region_statuses=region_statuses,
        ),
    }


def live_payload_builder_factory(
    context: rmuc_live.LiveRuntimeContext,
    rating_index: dict[tuple[str, str], dict[str, Any]] | None = None,
    *,
    current_rating_index: dict[str, dict[str, Any]] | None = None,
):
    rating_index = rating_index or {}
    current_rating_index = current_rating_index or {}

    def _builder(red_team, blue_team, *, best_of, samples, match_seed, head_to_head_index, **kwargs):
        override = context.payload_override_for(
            red_team_key=red_team.team_key,
            blue_team_key=blue_team.team_key,
            stage=str(kwargs.get("stage") or ""),
            round_number=int(kwargs["round_number"]) if kwargs.get("round_number") is not None else None,
            match_label=str(kwargs["match_label"]) if kwargs.get("match_label") is not None else None,
        )
        prediction_rating_index = _live_prediction_rating_index_for_match(
            red_team_key=red_team.team_key,
            blue_team_key=blue_team.team_key,
            override=override,
            current_rating_index=current_rating_index,
            rating_index=rating_index,
        )
        payload = _deterministic_live_prediction_payload(
            red_team,
            blue_team,
            best_of=best_of,
            head_to_head_index=head_to_head_index,
            current_rating_index=prediction_rating_index,
        )
        payload.update(override)
        _collapse_live_prediction_distribution(payload, best_of=best_of)
        _attach_published_match_rating_history(
            payload,
            red_team_key=red_team.team_key,
            blue_team_key=blue_team.team_key,
            rating_index=rating_index,
        )
        return payload

    return _builder


def _validated_live_slot_assignments(region_slug: str, context: rmuc_live.LiveRuntimeContext) -> tuple[dict[str, str] | None, str | None]:
    assignments = context.slot_assignments
    if len(assignments) != 32:
        return None, f"官方落位数量不是 32（当前 {len(assignments)}）"

    slots = list(assignments.values())
    expected_slots = set(region_sim.region_core.ALL_SLOTS)
    actual_slots = set(slots)
    if len(slots) != len(actual_slots):
        duplicate_slots = sorted({slot for slot in actual_slots if slots.count(slot) > 1})
        return None, f"官方落位存在重复槽位：{', '.join(duplicate_slots)}"
    if actual_slots != expected_slots:
        missing = sorted(expected_slots - actual_slots, key=region_sim.region_core.slot_sort_key)
        extra = sorted(actual_slots - expected_slots)
        details = []
        if missing:
            details.append(f"缺少 {', '.join(missing)}")
        if extra:
            details.append(f"未知 {', '.join(extra)}")
        return None, "官方落位槽位不完整：" + "；".join(details)

    region_name = resolve_region_name(region_slug)
    expected_team_keys = {
        compute_team_key(row["college_name"], row["team_name"])
        for row in load_ratings_rows()
        if row.get("admitted_region") == region_name
    }
    actual_team_keys = set(assignments)
    if actual_team_keys != expected_team_keys:
        missing_count = len(expected_team_keys - actual_team_keys)
        extra_count = len(actual_team_keys - expected_team_keys)
        return None, f"官方落位队伍不匹配：缺少 {missing_count} 队，未知 {extra_count} 队"

    return dict(assignments), None


def _seed_tier_for_official_slot(slot: str) -> str:
    try:
        slot_number = int(slot[1:])
    except (TypeError, ValueError):
        return "unseeded"
    if slot_number in {1, 3, 5, 7}:
        return "tier1"
    if slot_number in {2, 4, 6, 8}:
        return "tier2"
    return "unseeded"


def _official_live_slot_placeholders(region_slug: str, context: rmuc_live.LiveRuntimeContext) -> list[dict[str, Any]]:
    region_name = resolve_region_name(region_slug)
    ratings_by_team_key = {
        str(row["team_key"]): row
        for row in load_ratings_rows()
        if row.get("admitted_region") == region_name
    }
    team_key_by_slot = {slot: team_key for team_key, slot in context.slot_assignments.items()}
    out: list[dict[str, Any]] = []
    for index, slot in enumerate(region_sim.region_core.ALL_SLOTS, start=1):
        team_key = team_key_by_slot.get(slot)
        rating_row = ratings_by_team_key.get(team_key or "")
        if rating_row is not None and team_key:
            preseason_elo = float(rating_row["mu0"])
            out.append(
                {
                    "teamKey": team_key,
                    "collegeName": rating_row["college_name"],
                    "teamName": rating_row["team_name"],
                    "groupName": slot[:1],
                    "slot": slot,
                    "drawBox": "official",
                    "seedTier": rating_row["seed_tier"],
                    "seedRankInRegion": int(rating_row["seed_rank_in_region"]),
                    "mu0": preseason_elo,
                    "sigma0": float(rating_row["sigma0"]),
                    "eloGlobalRank": load_preseason_global_elo_rank_map().get(team_key, index),
                }
            )
            continue
        out.append(
            {
                "teamKey": "",
                "collegeName": slot,
                "teamName": "学校队伍待确认",
                "groupName": slot[:1],
                "slot": slot,
                "drawBox": "official_placeholder",
                "seedTier": _seed_tier_for_official_slot(slot),
                "seedRankInRegion": index,
                "mu0": 0.0,
                "sigma0": 0.0,
                "eloGlobalRank": 0,
            }
        )
    return out


def _final_bucket_for_placeholder_rank(rank: int, national_slots: int, repechage_slots: int) -> str:
    if rank == 1:
        return "champion"
    if rank == 2:
        return "runner_up"
    if rank == 3:
        return "third_place"
    if rank == 4:
        return "fourth_place"
    if rank <= 8:
        return "quarterfinalist"
    if rank <= national_slots:
        return "national_via_qualifier"
    if rank <= national_slots + repechage_slots:
        return "repechage_direct"
    return "group_eliminated"


def _official_live_final_ranking_placeholders(region_slug: str) -> list[dict[str, Any]]:
    region_name = resolve_region_name(region_slug)
    config = region_sim.REGION_CONFIGS[region_name]
    national_slots = int(config["national_slots"])
    repechage_slots = int(config["repechage_slots"])
    rows: list[dict[str, Any]] = []
    for rank in range(1, len(region_sim.region_core.ALL_SLOTS) + 1):
        if rank <= national_slots:
            advancement = "national_qualified"
        elif rank <= national_slots + repechage_slots:
            advancement = "repechage_qualified"
        else:
            advancement = "group_eliminated"
        rows.append(
            {
                "rank": rank,
                "teamKey": "",
                "collegeName": "待确认",
                "teamName": "学校队伍待确认",
                "groupName": "",
                "slot": None,
                "seedTier": "official_placeholder",
                "seedRankInRegion": 0,
                "swissWins": 0,
                "swissLosses": 0,
                "swissGroupRank": None,
                "rankingMetricSource": "official_placeholder",
                "mu0": 0.0,
                "finalBucket": _final_bucket_for_placeholder_rank(rank, national_slots, repechage_slots),
                "advancement": advancement,
            }
        )
    return rows


def _official_live_group_ranking_placeholders() -> dict[str, list[dict[str, Any]]]:
    return {"A": [], "B": []}


def _apply_unassigned_live_match_placeholder(match: dict[str, Any]) -> None:
    match["isConfirmedMatchup"] = False
    match["isRealResult"] = False
    match["redTeam"] = {
        "teamKey": "",
        "collegeName": "待确认",
        "teamName": "官方落位待确认",
        "slot": None,
    }
    match["blueTeam"] = {
        "teamKey": "",
        "collegeName": "待确认",
        "teamName": "官方落位待确认",
        "slot": None,
    }
    match["scoreline"] = "0:0"
    match["winnerTeamKey"] = ""
    match["loserTeamKey"] = ""
    match["pGameRed"] = 0.5
    match["pGameBlue"] = 0.5
    match["pSeriesRed"] = 0.5
    match["pSeriesBlue"] = 0.5
    match["deltaH2H"] = 0.0
    match["confidenceLabel"] = "low"
    for key in (
        "redCurrentElo",
        "blueCurrentElo",
        "redMu0",
        "blueMu0",
        "redDelta",
        "blueDelta",
        "redLiveDelta",
        "blueLiveDelta",
        "redPriorDelta",
        "bluePriorDelta",
        "redPriorAdjustmentLabel",
        "bluePriorAdjustmentLabel",
    ):
        match.pop(key, None)


def _hide_unofficial_live_matches_without_slots(payload: dict[str, Any]) -> None:
    for match in payload.get("matches", []):
        if not isinstance(match, dict):
            continue
        if match.get("officialMatchId"):
            continue
        _apply_unassigned_live_match_placeholder(match)


def _live_final_rankings_are_official(payload: dict[str, Any]) -> bool:
    final_matches = [
        match
        for match in payload.get("matches", [])
        if match.get("stage") in {"final", "third_place"}
    ]
    return bool(final_matches) and all(
        match.get("officialMatchId") and match.get("isRealResult") for match in final_matches
    )


def _has_official_rank_records(metrics_by_team_key: dict[str, dict[str, Any]] | None) -> bool:
    if not metrics_by_team_key:
        return False
    return any(
        metrics.get("wins") is not None and metrics.get("losses") is not None
        for metrics in metrics_by_team_key.values()
    )


def _replace_unofficial_live_final_rankings(payload: dict[str, Any], region_slug: str) -> None:
    payload["finalRankings"] = _official_live_final_ranking_placeholders(region_slug)
    summary = payload.setdefault("summary", {})
    placeholder_ref = {"teamKey": "", "collegeName": "待确认", "teamName": "学校队伍待确认"}
    summary["champion"] = placeholder_ref
    summary["runnerUp"] = placeholder_ref
    summary["thirdPlace"] = placeholder_ref
    summary["fourthPlace"] = placeholder_ref
    summary["nationalQualifiers"] = []
    summary["repechageQualifiers"] = []


def build_simulation_payload(region_slug: str, seed: int, mode: str = "sim", samples: int = DEFAULT_SIMULATION_SAMPLES) -> dict[str, Any]:
    region_name = resolve_region_name(region_slug)
    slot_assignments: dict[str, str] | None = None
    official_swiss_pairings: dict[str, dict[int, list[tuple[str, str]]]] | None = None
    official_group_rank_metrics: dict[str, dict[str, Any]] | None = None
    live_slot_assignment_reason: str | None = None
    if mode == "live":
        context = _load_live_runtime_context(region_slug)
    else:
        context = rmuc_live.LiveRuntimeContext.inactive(region_slug)

    if mode == "live" and context.source_status == "active":
        slot_assignments, live_slot_assignment_reason = _validated_live_slot_assignments(region_slug, context)
        builder = live_payload_builder_factory(
            context,
            _published_match_rating_index(region_slug),
            current_rating_index=load_current_rating_index(),
        )
        official_swiss_pairings = context.swiss_pairings
        official_group_rank_metrics = context.group_rank_metrics
        effective_seed = seed
    else:
        builder = None
        effective_seed = seed

    simulation = region_sim.simulate_region(
        region_name,
        seed=effective_seed,
        samples=samples,
        payload_builder=builder,
        slot_assignments=slot_assignments,
        official_swiss_pairings=official_swiss_pairings,
        official_group_rank_metrics=official_group_rank_metrics,
        seed_swiss_state_from_official_metrics=(
            mode == "live"
            and context.source_status == "active"
            and context.completed_count == 0
            and _has_official_rank_records(official_group_rank_metrics)
        ),
    )
    payload = _serialize_simulation(
        region_slug,
        effective_seed,
        simulation,
        include_current_ratings=mode == "live" and context.source_status == "active",
    )
    if mode == "live" and context.source_status == "active":
        _attach_live_schedule_metadata(
            payload,
            region_slug,
            preserve_predicted_unconfirmed=slot_assignments is not None,
        )
        if slot_assignments is None:
            payload["slots"] = _official_live_slot_placeholders(region_slug, context)
            payload["groupRankings"] = _official_live_group_ranking_placeholders()
            _hide_unofficial_live_matches_without_slots(payload)
        if not _live_final_rankings_are_official(payload):
            _replace_unofficial_live_final_rankings(payload, region_slug)
    if mode == "live":
        live_status = payload["meta"].setdefault("liveStatus", {})
        live_status["slotAssignmentSource"] = (
            "official"
            if slot_assignments is not None
            else "official_placeholder"
            if context.source_status == "active"
            else "simulated_fallback"
        )
        live_status["slotAssignmentReason"] = live_slot_assignment_reason
        live_status["predictionBasis"] = (
            "current_elo_h2h_deterministic"
            if context.source_status == "active" and slot_assignments is not None
            else "official_placeholder"
            if context.source_status == "active"
            else "seeded_simulation_fallback"
        )
    return payload
