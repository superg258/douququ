from __future__ import annotations

import csv
import json
import os
import sys
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_rmuc_ts2_backend as ts2_model  # noqa: E402
import simulate_region as region_sim  # noqa: E402
from . import rmuc_live


DEFAULT_SIMULATION_SAMPLES = int(os.getenv("RMUC_SIMULATION_SAMPLES", "1200"))
REGION_SLUG_ORDER = ["south_region", "east_region", "north_region"]
REGION_SLUG_ORDER_INDEX = {region_slug: index for index, region_slug in enumerate(REGION_SLUG_ORDER)}
REGION_SLUG_TO_NAME = {config["slug"]: region for region, config in region_sim.REGION_CONFIGS.items()}
PRESEASON_RATINGS_CSV = ts2_model.DERIVED_DIR / "preseason_ratings.csv"
PUBLISHED_RATINGS_DIR = ts2_model.DERIVED_DIR / "published_2026"
REGION_SIM_DIR = ts2_model.ROOT / "data" / "derived" / "2026_rmuc_region_simulations"
RUNTIME_LIVE_DIR = ROOT / "data" / "runtime" / "rmuc_live"
NORMALIZED_LIVE_SCHEDULE_PATH = RUNTIME_LIVE_DIR / "normalized_schedule.json"
RUNTIME_PUBLISHED_RATINGS_DIR = RUNTIME_LIVE_DIR / "published_2026"
MINI_PROGRAM_CLIENT = rmuc_live.MiniProgramPredictionClient()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def load_ratings_rows() -> list[dict[str, str]]:
    return _read_csv(PRESEASON_RATINGS_CSV)

@lru_cache(maxsize=1)
def load_global_elo_rank_map() -> dict[str, int]:
    rows = sorted(
        load_ratings_rows(),
        key=lambda row: (
            -float(row["mu0"]),
            row["college_name"],
            row["team_name"],
        ),
    )
    return {row["team_key"]: index for index, row in enumerate(rows, start=1)}


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


def _read_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return _read_json(path)


def load_normalized_live_schedule() -> dict[str, Any] | None:
    payload = _read_json_if_exists(NORMALIZED_LIVE_SCHEDULE_PATH)
    return payload if isinstance(payload, dict) else None


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
        return {
            "sourceStatus": "missing",
            "sourceReason": "尚未同步官方实时赛程",
            "sourceUpdatedAt": None,
            "completedOfficialMatches": 0,
            "confirmedOfficialMatches": 0,
            "ledgerRows": 0,
            "recentError": None,
        }
    source_status = str(normalized.get("sourceStatus") or "inactive")
    region = normalized.get("regions", {}).get(region_slug) if isinstance(normalized.get("regions"), dict) else None
    context = rmuc_live.LiveRuntimeContext.from_normalized(normalized, region_slug)
    ledger = _read_json_if_exists(_published_live_match_ledger_path_for(RUNTIME_PUBLISHED_RATINGS_DIR))
    ledger_rows = len(ledger) if isinstance(ledger, list) else 0
    return {
        "sourceStatus": source_status if region or source_status != "active" else "inactive",
        "sourceReason": normalized.get("reason") if source_status != "active" else (None if region else "实时源未包含当前赛区"),
        "sourceUpdatedAt": normalized.get("sourceUpdatedAt") or normalized.get("fetchedAt"),
        "completedOfficialMatches": context.completed_count if context.source_status == "active" else 0,
        "confirmedOfficialMatches": context.confirmed_count if context.source_status == "active" else 0,
        "ledgerRows": ledger_rows,
        "recentError": normalized.get("reason") if source_status != "active" else None,
    }


def build_overview_payload() -> dict[str, Any]:
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
            teams.append(
                {
                    "teamKey": team_key,
                    "collegeName": row["college_name"],
                    "teamName": row["team_name"],
                    "mu0": round(float(row["mu0"]), 6),
                    "sigma0": round(float(row["sigma0"]), 6),
                    "eloGlobalRank": global_rank_map[team_key],
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
                -team["mu0"],
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


def _serialize_simulation(region_slug: str, seed: int, simulation: dict[str, Any]) -> dict[str, Any]:
    region_name = resolve_region_name(region_slug)
    monte_carlo = serialize_region_monte_carlo(region_slug)
    team_lookup = _team_lookup_from_simulation(simulation)
    final_rankings = simulation["summary"]["final_rankings"]
    final_rankings_by_key = _final_rankings_by_team_key(final_rankings, team_lookup)
    global_elo_rank_map = load_global_elo_rank_map()

    slots = []
    for row in simulation["slot_rows"]:
        team_key = team_lookup[(row["college_name"], row["team_name"])]
        slots.append(
            {
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
        )

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
        if "red_mu0" in row and "blue_mu0" in row and "red_delta" in row and "blue_delta" in row:
            serialized_match["redMu0"] = float(row["red_mu0"])
            serialized_match["blueMu0"] = float(row["blue_mu0"])
            serialized_match["redDelta"] = float(row["red_delta"])
            serialized_match["blueDelta"] = float(row["blue_delta"])
        if row.get("official_match_id") is not None:
            serialized_match["officialMatchId"] = str(row["official_match_id"])
        if row.get("official_status") is not None:
            serialized_match["officialStatus"] = str(row["official_status"])
        if row.get("planned_start_at") is not None:
            serialized_match["plannedStartAt"] = str(row["planned_start_at"])
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
                    "simulationGameDiff": _optional_float(row.get("simulation_game_diff")),
                    "finalRank": int(ranking_row["rank"]),
                }
            )

    serialized_rankings = []
    for row in final_rankings:
        team_key = team_lookup[(row["college_name"], row["team_name"])]
        serialized_rankings.append(
            {
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
                "mu0": float(row["mu0"]),
                "finalBucket": row["final_bucket"],
                "advancement": row["advancement"],
            }
        )

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
        "teamIndex": team_index,
    }


def _mini_program_predictions_for_context(context: rmuc_live.LiveRuntimeContext) -> dict[str, dict[str, Any]]:
    if os.getenv("RMUC_MINI_PROGRAM_ENABLED", "1") in {"0", "false", "False"}:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for match in context.matches_by_pair.values():
        if isinstance(match.get("miniProgramPrediction"), dict):
            continue
        official_id = str(match.get("officialMatchId") or "")
        if official_id and official_id not in out:
            out[official_id] = MINI_PROGRAM_CLIENT.get(official_id)
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


def live_payload_builder_factory(
    context: rmuc_live.LiveRuntimeContext,
    rating_index: dict[tuple[str, str], dict[str, Any]] | None = None,
):
    rating_index = rating_index or {}

    def _builder(red_team, blue_team, *, best_of, samples, match_seed, head_to_head_index, **kwargs):
        payload = region_sim.build_prediction_payload(
            red_team,
            blue_team,
            best_of=best_of,
            samples=samples,
            match_seed=match_seed,
            head_to_head_index=head_to_head_index,
            **kwargs,
        )
        payload.update(
            context.payload_override_for(
                red_team_key=red_team.team_key,
                blue_team_key=blue_team.team_key,
                stage=str(kwargs.get("stage") or ""),
                round_number=int(kwargs["round_number"]) if kwargs.get("round_number") is not None else None,
                match_label=str(kwargs["match_label"]) if kwargs.get("match_label") is not None else None,
            )
        )
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
        builder = live_payload_builder_factory(context, _published_match_rating_index(region_slug))
        slot_assignments, live_slot_assignment_reason = _validated_live_slot_assignments(region_slug, context)
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
    )
    payload = _serialize_simulation(region_slug, effective_seed, simulation)
    if mode == "live":
        live_status = payload["meta"].setdefault("liveStatus", {})
        live_status["slotAssignmentSource"] = "official" if slot_assignments is not None else "simulated_fallback"
        live_status["slotAssignmentReason"] = live_slot_assignment_reason
    return payload
