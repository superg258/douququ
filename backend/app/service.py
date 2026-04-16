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

import build_rmuc_elo as elo_model  # noqa: E402
import simulate_region as region_sim  # noqa: E402


DEFAULT_SIMULATION_SAMPLES = int(os.getenv("RMUC_SIMULATION_SAMPLES", "1200"))
REGION_SLUG_ORDER = ["south_region", "east_region", "north_region"]
REGION_SLUG_ORDER_INDEX = {region_slug: index for index, region_slug in enumerate(REGION_SLUG_ORDER)}
REGION_SLUG_TO_NAME = {config["slug"]: region for region, config in region_sim.REGION_CONFIGS.items()}
PRESEASON_RATINGS_CSV = elo_model.DERIVED_DIR / "preseason_ratings.csv"
REGION_SIM_DIR = elo_model.ROOT / "data" / "derived" / "2026_rmuc_region_simulations"


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _read_json(path: Path) -> dict[str, Any]:
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
    return elo_model.make_team_key(college_name, team_name)


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
        match_rows.append(
            {
                "matchLabel": row["match_label"],
                "stage": row["stage"],
                "stageOrder": int(row["stage_order"]),
                "roundNumber": int(row["round_number"]),
                "groupName": row["group_name"],
                "bestOf": int(row["best_of"]),
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
        )

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


@lru_cache(maxsize=128)
def build_simulation_payload(region_slug: str, seed: int, samples: int = DEFAULT_SIMULATION_SAMPLES) -> dict[str, Any]:
    region_name = resolve_region_name(region_slug)
    simulation = region_sim.simulate_region(region_name, seed=seed, samples=samples)
    return _serialize_simulation(region_slug, seed, simulation)
