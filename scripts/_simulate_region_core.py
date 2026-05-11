#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

import build_rmuc_elo as elo_model
import _predict_match_core as predictor


TS2_DERIVED_DIR = elo_model.ROOT / "data" / "derived" / "2026_rmuc_ts2"
TEAM_MASTER_CSV = TS2_DERIVED_DIR / "preseason_ratings.csv"
DEFAULT_RATINGS_CSV = predictor.DEFAULT_RATINGS_CSV
DEFAULT_MONTE_CARLO_SAMPLES = 4_000
DEFAULT_SIMULATION_SEED = 20260414
SIMULATION_DERIVED_DIR = elo_model.ROOT / "data" / "derived" / "2026_rmuc_region_simulations"
# Split preseason uncertainty into a tournament-level strength draw and a smaller
# match-level variance so black runs can happen without making teams unrecognizably strong.
TOURNAMENT_LATENT_SIGMA_FACTOR = 0.30
TOURNAMENT_LATENT_SIGMA_CLIP = 0.55
TOURNAMENT_MATCH_SIGMA_FACTOR = 0.40
TOURNAMENT_MATCH_SIGMA_FLOOR = 10.0

REGION_CONFIGS = {
    "东部赛区": {"slug": "east_region", "national_slots": 8, "repechage_slots": 6},
    "南部赛区": {"slug": "south_region", "national_slots": 10, "repechage_slots": 6},
    "北部赛区": {"slug": "north_region", "national_slots": 10, "repechage_slots": 4},
}

TIER1_SLOTS = ["A1", "A3", "A5", "A7", "B1", "B3", "B5", "B7"]
TIER2_SLOTS = ["A2", "A4", "A6", "A8", "B2", "B4", "B6", "B8"]
UNSEEDED_SLOTS = [
    "A9",
    "A10",
    "A11",
    "A12",
    "A13",
    "A14",
    "A15",
    "A16",
    "B9",
    "B10",
    "B11",
    "B12",
    "B13",
    "B14",
    "B15",
    "B16",
]
BOX4_SLOTS = TIER2_SLOTS
BOX5_SLOTS = UNSEEDED_SLOTS
ALL_SLOTS = [
    *[f"A{i}" for i in range(1, 17)],
    *[f"B{i}" for i in range(1, 17)],
]

SWISS_ROUND1_PAIRINGS = {
    "A": [("A1", "A9"), ("A2", "A10"), ("A11", "A3"), ("A12", "A4"), ("A5", "A13"), ("A6", "A14"), ("A15", "A7"), ("A16", "A8")],
    "B": [("B9", "B1"), ("B10", "B2"), ("B3", "B11"), ("B4", "B12"), ("B13", "B5"), ("B14", "B6"), ("B7", "B15"), ("B8", "B16")],
}

SWISS_CSV_RANK_PAIRINGS = {
    2: {
        "A": [(1, 2), (3, 4), (6, 5), (8, 7), (9, 10), (11, 12), (14, 13), (16, 15)],
        "B": [(2, 1), (4, 3), (5, 6), (7, 8), (10, 9), (12, 11), (13, 14), (15, 16)],
    },
    3: {
        "A": [(1, 2), (3, 4), (6, 5), (8, 7), (9, 10), (11, 12), (14, 13), (16, 15)],
        "B": [(2, 1), (4, 3), (5, 6), (7, 8), (10, 9), (12, 11), (13, 14), (15, 16)],
    },
    4: {
        "A": [(3, 4), (6, 5), (8, 7), (9, 10), (11, 12), (14, 13)],
        "B": [(4, 3), (5, 6), (7, 8), (10, 9), (12, 11), (13, 14)],
    },
    5: {
        "A": [(6, 11), (10, 7), (8, 9)],
        "B": [(11, 6), (7, 10), (9, 8)],
    },
}
SWISS_ROUND5_CSV_RANK_PAIRINGS = SWISS_CSV_RANK_PAIRINGS[5]
SOUTH_SWISS_ROUND5_CSV_RANK_PAIRINGS = SWISS_ROUND5_CSV_RANK_PAIRINGS

ROUND_OF_16_PAIRINGS = [
    ("B-1", "A-8"),
    ("B-5", "A-4"),
    ("A-7", "B-2"),
    ("A-3", "B-6"),
    ("A-6", "B-3"),
    ("A-2", "B-7"),
    ("B-4", "A-5"),
    ("B-8", "A-1"),
]

QUARTERFINAL_MAPPING = [
    ("R16-1", "R16-2"),
    ("R16-4", "R16-3"),
    ("R16-5", "R16-6"),
    ("R16-8", "R16-7"),
]

SEMIFINAL_MAPPING = [
    ("QF-1", "QF-3"),
    ("QF-2", "QF-4"),
]

STAGE_ORDER = {
    "swiss": 1,
    "round_of_16": 2,
    "quarterfinal": 3,
    "qualification_round1": 4,
    "qualification_round2": 5,
    "semifinal": 6,
    "third_place": 7,
    "final": 8,
}

FINAL_BUCKET_PRIORITY = {
    "champion": 100,
    "runner_up": 99,
    "third_place": 98,
    "fourth_place": 97,
    "quarterfinalist": 90,
    "national_via_qualifier": 85,
    "repechage_direct": 80,
    "repechage_via_playoff": 75,
    "repechage_from_national_playoff_loss": 74,
    "eliminated_in_qualification": 70,
    "swiss_eliminated": 50,
}


@dataclass
class RegionTeam:
    team_key: str
    college_name: str
    team_name: str
    admitted_region: str
    seed_tier: str
    seed_rank_in_region: int
    ranking_global_rank: int | None
    shape_rank: int | None
    mu0: float
    sigma0: float
    z_25game: float
    z_robot25_raw: float
    z_26rmul: float
    z_form: float
    tilde_z_hist: float
    n_matches_2025_rmuc: int
    n_matches_2026_rmul: int
    robot_stage_reliability: float
    simulation_mu: float
    match_sigma: float
    display_mu: float | None = None
    slot: str = ""
    group_name: str = ""
    draw_box: str = ""
    swiss_wins: int = 0
    swiss_losses: int = 0
    swiss_game_wins: int = 0
    swiss_game_losses: int = 0
    swiss_opponents: list[str] = field(default_factory=list)
    swiss_qualified_round: int | None = None
    swiss_eliminated_round: int | None = None
    swiss_final_group_rank: int | None = None
    official_opponent_points: float | None = None
    source_reported_opponent_points: float | None = None
    official_avg_base_hp_diff: float | None = None
    official_avg_team_damage: float | None = None
    ranking_metric_source: str = "simulation_proxy"
    ranking_completeness: str = "simulation_proxy"
    official_record_seeded: bool = False
    final_bucket: str = ""
    advancement: str = ""
    final_rank: int | None = None
    dependent_on_prediction: bool = False

    @property
    def swiss_status(self) -> str:
        if self.swiss_qualified_round is not None:
            return "qualified"
        if self.swiss_eliminated_round is not None:
            return "eliminated"
        return "active"

    @property
    def swiss_game_diff(self) -> int:
        return self.swiss_game_wins - self.swiss_game_losses

    def current_display_mu(self) -> float:
        return self.mu0 if self.display_mu is None else self.display_mu


PayloadBuilder = Callable[..., dict[str, Any]]
HeadToHeadRecorder = Callable[[dict[tuple[str, str], dict[str, Any]], RegionTeam, RegionTeam, int, int], None]


def float_field(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    value = row.get(key)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def int_field(row: dict[str, Any], key: str, default: int = 0) -> int:
    value = row.get(key)
    if value in (None, ""):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate a single 2026 RMUC regional event.")
    parser.add_argument("--region", required=True, choices=sorted(REGION_CONFIGS), help="Region to simulate.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SIMULATION_SEED, help="Simulation random seed.")
    parser.add_argument(
        "--ratings-csv",
        type=Path,
        default=DEFAULT_RATINGS_CSV,
        help="Path to preseason_ratings.csv.",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=DEFAULT_MONTE_CARLO_SAMPLES,
        help="Monte Carlo samples per matchup probability estimate.",
    )
    return parser.parse_args()


def parse_team_rows(region: str, ratings_csv: Path) -> list[RegionTeam]:
    rating_rows = elo_model.read_csv(ratings_csv)
    team_master_rows = rating_rows
    ratings_by_key = {elo_model.make_team_key(row["college_name"], row["team_name"]): row for row in rating_rows}
    teams: list[RegionTeam] = []
    for team_row in team_master_rows:
        admitted_region = team_row.get("admitted_region") or team_row.get("preferred_region")
        if admitted_region != region:
            continue
        team_key = elo_model.make_team_key(team_row["college_name"], team_row["team_name"])
        rating_row = ratings_by_key.get(team_key)
        if rating_row is None:
            raise ValueError(f"Missing preseason rating for team_key={team_key}")
        college_name = elo_model.normalize_school(team_row["college_name"])
        team_name = elo_model.normalize_team(team_row["team_name"])
        teams.append(
            RegionTeam(
                team_key=team_key,
                college_name=college_name,
                team_name=team_name,
                admitted_region=admitted_region,
                seed_tier=team_row["seed_tier"],
                seed_rank_in_region=int_field(team_row, "seed_rank_in_region"),
                ranking_global_rank=elo_model.parse_int(team_row.get("ranking_global_rank")),
                shape_rank=elo_model.parse_int(team_row.get("shape_rank")),
                mu0=float_field(rating_row, "mu0"),
                sigma0=float_field(rating_row, "sigma0"),
                z_25game=float_field(rating_row, "z_25game"),
                z_robot25_raw=float_field(rating_row, "z_robot25_raw"),
                z_26rmul=float_field(rating_row, "z_26rmul"),
                z_form=float_field(rating_row, "z_form"),
                tilde_z_hist=float_field(rating_row, "tilde_z_hist"),
                n_matches_2025_rmuc=int_field(
                    rating_row,
                    "n_matches_2025_rmuc",
                    int(round(float_field(rating_row, "rmuc_history_strength") * 12.0)),
                ),
                n_matches_2026_rmul=int_field(rating_row, "n_matches_2026_rmul"),
                robot_stage_reliability=float_field(
                    rating_row,
                    "robot_stage_reliability",
                    float_field(rating_row, "rmuc_history_strength"),
                ),
                simulation_mu=float_field(rating_row, "mu0"),
                match_sigma=max(float_field(rating_row, "sigma0") * TOURNAMENT_MATCH_SIGMA_FACTOR, TOURNAMENT_MATCH_SIGMA_FLOOR),
            )
        )
    if len(teams) != 32:
        raise ValueError(f"Expected 32 teams in {region}, found {len(teams)}")
    tier_counts = Counter(team.seed_tier for team in teams)
    if tier_counts != Counter({"tier1": 8, "tier2": 8, "unseeded": 16}):
        raise ValueError(f"Unexpected tier distribution in {region}: {dict(tier_counts)}")
    return teams


def slot_sort_key(slot: str) -> tuple[int, int]:
    return (0 if slot.startswith("A") else 1, int(slot[1:]))


def assign_region_slots(teams: list[RegionTeam], rng: random.Random) -> list[dict[str, Any]]:
    tier1 = [team for team in teams if team.seed_tier == "tier1"]
    tier2 = [team for team in teams if team.seed_tier == "tier2"]
    unseeded = [team for team in teams if team.seed_tier == "unseeded"]
    rng.shuffle(tier1)
    rng.shuffle(tier2)
    rng.shuffle(unseeded)

    assignments: list[tuple[str, RegionTeam, str]] = []
    for slot, team in zip(TIER1_SLOTS, tier1, strict=True):
        assignments.append((slot, team, "box1"))
    for slot, team in zip(TIER2_SLOTS, tier2, strict=True):
        assignments.append((slot, team, "box2"))
    for slot, team in zip(UNSEEDED_SLOTS, unseeded, strict=True):
        assignments.append((slot, team, "box3"))

    rows: list[dict[str, Any]] = []
    for slot, team, draw_box in sorted(assignments, key=lambda item: slot_sort_key(item[0])):
        team.slot = slot
        team.group_name = slot[0]
        team.draw_box = draw_box
        rows.append(
            {
                "region": team.admitted_region,
                "group_name": team.group_name,
                "slot": team.slot,
                "draw_box": draw_box,
                "seed_tier": team.seed_tier,
                "seed_rank_in_region": team.seed_rank_in_region,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "mu0": round(team.mu0, 6),
                "sigma0": round(team.sigma0, 6),
                "shape_rank": team.shape_rank or "",
                "ranking_global_rank": team.ranking_global_rank or "",
            }
        )
    return rows


def assign_region_slots_from_map(teams: list[RegionTeam], slot_assignments: dict[str, str]) -> list[dict[str, Any]]:
    if len(slot_assignments) != len(teams):
        raise ValueError(f"Expected {len(teams)} official slot assignments, found {len(slot_assignments)}")
    seen_slots: set[str] = set()
    rows: list[dict[str, Any]] = []
    for team in teams:
        slot = slot_assignments.get(team.team_key)
        if not slot:
            raise ValueError(f"Missing official slot assignment for team_key={team.team_key}")
        if slot in seen_slots:
            raise ValueError(f"Duplicate official slot assignment: {slot}")
        seen_slots.add(slot)
        team.slot = slot
        team.group_name = slot[0]
        if slot in TIER1_SLOTS:
            draw_box = "box1"
        elif slot in TIER2_SLOTS:
            draw_box = "box2"
        elif slot in UNSEEDED_SLOTS:
            draw_box = "box3"
        else:
            draw_box = "official"
        team.draw_box = draw_box
        rows.append(
            {
                "region": team.admitted_region,
                "group_name": team.group_name,
                "slot": team.slot,
                "draw_box": draw_box,
                "seed_tier": team.seed_tier,
                "seed_rank_in_region": team.seed_rank_in_region,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "mu0": round(team.mu0, 6),
                "sigma0": round(team.sigma0, 6),
                "shape_rank": team.shape_rank or "",
                "ranking_global_rank": team.ranking_global_rank or "",
            }
        )
    return sorted(rows, key=lambda row: slot_sort_key(row["slot"]))


def _parse_optional_metric(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_metric(row: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = _parse_optional_metric(row.get(key))
        if value is not None:
            return value
    return None


def _is_empty_official_rank_snapshot(metrics_by_team_key: dict[str, dict[str, Any]]) -> bool:
    has_rank_records = False
    rank_metric_keys = (
        "official_opponent_points",
        "source_reported_opponent_points",
        "opponent_points",
        "opponentScore",
        "opponent_score",
        "official_avg_base_hp_diff",
        "avg_base_hp_diff",
        "avgBaseHpDiff",
        "baseHpDiff",
        "official_avg_team_damage",
        "avg_team_damage",
        "avgTeamDamage",
        "teamDamage",
    )
    for metrics in metrics_by_team_key.values():
        wins = _parse_optional_metric(metrics.get("wins"))
        losses = _parse_optional_metric(metrics.get("losses"))
        if wins is not None or losses is not None:
            has_rank_records = True
        if (wins or 0.0) + (losses or 0.0) > 0.0:
            return False
        for key in rank_metric_keys:
            value = _parse_optional_metric(metrics.get(key))
            if value is not None and abs(value) > 1e-9:
                return False
    return has_rank_records


def apply_official_swiss_ranking_metrics(
    teams: list[RegionTeam],
    metrics_by_team_key: dict[str, dict[str, Any]] | None,
    *,
    seed_current_state: bool = False,
) -> None:
    if not metrics_by_team_key:
        return
    empty_rank_snapshot = _is_empty_official_rank_snapshot(metrics_by_team_key)
    for team in teams:
        metrics = metrics_by_team_key.get(team.team_key)
        if not metrics:
            continue
        if not empty_rank_snapshot:
            team.official_opponent_points = _first_metric(
                metrics,
                "official_opponent_points",
                "source_reported_opponent_points",
                "opponent_points",
                "opponentScore",
                "opponent_score",
            )
            team.source_reported_opponent_points = _first_metric(metrics, "source_reported_opponent_points")
            team.official_avg_base_hp_diff = _first_metric(
                metrics,
                "official_avg_base_hp_diff",
                "avg_base_hp_diff",
                "avgBaseHpDiff",
                "baseHpDiff",
            )
            team.official_avg_team_damage = _first_metric(
                metrics,
                "official_avg_team_damage",
                "avg_team_damage",
                "avgTeamDamage",
                "teamDamage",
            )
        if any(
            value is not None
            for value in (team.official_opponent_points, team.official_avg_base_hp_diff, team.official_avg_team_damage)
        ):
            team.ranking_metric_source = str(metrics.get("ranking_metric_source") or metrics.get("source") or "official_live")
            team.ranking_completeness = str(metrics.get("ranking_completeness") or "official_rank_snapshot")
        if seed_current_state:
            wins = _parse_optional_metric(metrics.get("wins"))
            losses = _parse_optional_metric(metrics.get("losses"))
            if wins is not None and losses is not None:
                team.swiss_wins = int(wins)
                team.swiss_losses = int(losses)
                played_round = int(wins + losses)
                if team.swiss_wins >= 3 and team.swiss_qualified_round is None:
                    team.swiss_qualified_round = played_round
                if team.swiss_losses >= 3 and team.swiss_eliminated_round is None:
                    team.swiss_eliminated_round = played_round
                team.official_record_seeded = True
                if team.official_opponent_points is not None and not team.swiss_opponents:
                    team.ranking_completeness = "opponent_points_frozen"


def sample_from_distribution(distribution: dict[str, float], rng: random.Random) -> str:
    threshold = rng.random()
    cumulative = 0.0
    last_scoreline = ""
    for scoreline, probability in distribution.items():
        cumulative += probability
        last_scoreline = scoreline
        if threshold <= cumulative:
            return scoreline
    return last_scoreline


def parse_scoreline(scoreline: str) -> tuple[int, int]:
    left, right = scoreline.split(":")
    return int(left), int(right)


def swiss_status_priority(team: RegionTeam) -> int:
    return {"qualified": 2, "active": 1, "eliminated": 0}[team.swiss_status]


def swiss_opponent_score(team: RegionTeam, teams_by_key: dict[str, RegionTeam]) -> int:
    # Follow the manual's "opponent score" definition:
    # sum over all faced opponents of (their total Swiss game wins - game losses).
    return sum(
        teams_by_key[opponent_key].swiss_game_diff
        for opponent_key in team.swiss_opponents
    )


def effective_swiss_opponent_score(team: RegionTeam, teams_by_key: dict[str, RegionTeam]) -> float:
    if team.official_opponent_points is not None:
        return team.official_opponent_points
    return float(swiss_opponent_score(team, teams_by_key))


def swiss_ranking_metrics(team: RegionTeam, teams_by_key: dict[str, RegionTeam]) -> dict[str, Any]:
    calculated_opponent_score = float(swiss_opponent_score(team, teams_by_key))
    return {
        "opponent_score": effective_swiss_opponent_score(team, teams_by_key),
        "calculated_opponent_score": calculated_opponent_score,
        "official_opponent_points": team.official_opponent_points,
        "source_reported_opponent_points": team.source_reported_opponent_points,
        "official_avg_base_hp_diff": team.official_avg_base_hp_diff,
        "official_avg_team_damage": team.official_avg_team_damage,
        "ranking_metric_source": team.ranking_metric_source,
        "ranking_completeness": team.ranking_completeness,
        "simulation_game_diff": team.swiss_game_diff,
    }


def _official_metric_or_zero(value: float | None) -> float:
    return 0.0 if value is None else float(value)


def swiss_sort_key(team: RegionTeam, teams_by_key: dict[str, RegionTeam]) -> tuple[float, ...]:
    qualified_speed = -float(team.swiss_qualified_round) if team.swiss_qualified_round is not None else -99.0
    seed_fallback = -float(team.seed_rank_in_region)
    return (
        float(swiss_status_priority(team)),
        float(team.swiss_wins),
        -float(team.swiss_losses),
        qualified_speed,
        effective_swiss_opponent_score(team, teams_by_key),
        _official_metric_or_zero(team.official_avg_base_hp_diff),
        _official_metric_or_zero(team.official_avg_team_damage),
        float(team.swiss_game_diff),
        team.mu0,
        seed_fallback,
    )


def swiss_cross_group_key(team: RegionTeam, teams_by_key: dict[str, RegionTeam]) -> tuple[float, ...]:
    return (
        float(team.swiss_wins),
        -float(team.swiss_losses),
        -float(team.swiss_qualified_round) if team.swiss_qualified_round is not None else -99.0,
        effective_swiss_opponent_score(team, teams_by_key),
        _official_metric_or_zero(team.official_avg_base_hp_diff),
        _official_metric_or_zero(team.official_avg_team_damage),
        float(team.swiss_game_diff),
        team.mu0,
        -float(team.seed_rank_in_region),
    )


def swiss_csv_rank_pairings(
    round_number: int,
    group_name: str,
    group_teams: list[RegionTeam],
    teams_by_key: dict[str, RegionTeam],
) -> list[tuple[RegionTeam, RegionTeam]]:
    round_pairings = SWISS_CSV_RANK_PAIRINGS.get(round_number)
    if round_pairings is None:
        raise ValueError(f"Unsupported Swiss CSV rank pairing round: {round_number}")
    rank_pairings = round_pairings.get(group_name)
    if rank_pairings is None:
        raise ValueError(f"Unsupported Swiss CSV rank pairing group: {group_name}")
    ranked = sorted(group_teams, key=lambda team: swiss_sort_key(team, teams_by_key), reverse=True)
    active = [team for team in ranked if team.swiss_status == "active"]
    expected_active_count = len(rank_pairings) * 2
    if len(active) != expected_active_count:
        raise ValueError(
            f"Swiss round {round_number} expects exactly {expected_active_count} active teams in group {group_name}, "
            f"found {len(active)}"
        )
    position_to_team = {index: team for index, team in enumerate(ranked, start=1)}
    pairings: list[tuple[RegionTeam, RegionTeam]] = []
    for red_position, blue_position in rank_pairings:
        red_team = position_to_team[red_position]
        blue_team = position_to_team[blue_position]
        if red_team.swiss_status != "active" or blue_team.swiss_status != "active":
            raise ValueError(
                f"Swiss round {round_number} CSV position {red_position}-{blue_position} did not resolve to two active teams"
            )
        pairings.append((red_team, blue_team))
    return pairings


def _official_swiss_pairings_to_teams(
    official_round_pairings: list[tuple[str, str]],
    teams_by_key: dict[str, RegionTeam],
) -> list[tuple[RegionTeam, RegionTeam]]:
    pairings: list[tuple[RegionTeam, RegionTeam]] = []
    for red_team_key, blue_team_key in official_round_pairings:
        try:
            pairings.append((teams_by_key[red_team_key], teams_by_key[blue_team_key]))
        except KeyError as exc:
            raise ValueError(f"Official Swiss pairing references unknown team_key={exc.args[0]}") from exc
    return pairings


def _merge_official_swiss_pairings(
    fallback_pairings: list[tuple[RegionTeam, RegionTeam]],
    official_pairings: list[tuple[RegionTeam, RegionTeam]],
) -> list[tuple[RegionTeam, RegionTeam]]:
    if not official_pairings:
        return fallback_pairings

    official_by_team_set: dict[frozenset[str], tuple[RegionTeam, RegionTeam]] = {
        frozenset((red_team.team_key, blue_team.team_key)): (red_team, blue_team)
        for red_team, blue_team in official_pairings
    }
    used_official_sets: set[frozenset[str]] = set()
    merged: list[tuple[RegionTeam, RegionTeam]] = []
    for fallback_red, fallback_blue in fallback_pairings:
        team_set = frozenset((fallback_red.team_key, fallback_blue.team_key))
        official_pairing = official_by_team_set.get(team_set)
        if official_pairing is None:
            merged.append((fallback_red, fallback_blue))
            continue
        merged.append(official_pairing)
        used_official_sets.add(team_set)

    unmatched_official_pairings = [
        pairing
        for team_set, pairing in official_by_team_set.items()
        if team_set not in used_official_sets
    ]
    if not unmatched_official_pairings:
        return merged

    official_team_keys = {
        team.team_key
        for pairing in unmatched_official_pairings
        for team in pairing
    }
    return unmatched_official_pairings + [
        (red_team, blue_team)
        for red_team, blue_team in fallback_pairings
        if red_team.team_key not in official_team_keys and blue_team.team_key not in official_team_keys
    ]


def round5_csv_pairings(
    group_name: str,
    group_teams: list[RegionTeam],
    teams_by_key: dict[str, RegionTeam],
) -> list[tuple[RegionTeam, RegionTeam]]:
    return swiss_csv_rank_pairings(5, group_name, group_teams, teams_by_key)


def south_round5_csv_pairings(
    group_name: str,
    group_teams: list[RegionTeam],
    teams_by_key: dict[str, RegionTeam],
) -> list[tuple[RegionTeam, RegionTeam]]:
    return round5_csv_pairings(group_name, group_teams, teams_by_key)


def _initial_swiss_round(group_teams: list[RegionTeam]) -> int:
    if not group_teams or not all(team.official_record_seeded for team in group_teams):
        return 1
    max_played = max(team.swiss_wins + team.swiss_losses for team in group_teams)
    return min(max(max_played + 1, 1), 6)


def build_prediction_payload(
    red_team: RegionTeam,
    blue_team: RegionTeam,
    *,
    best_of: int,
    samples: int,
    match_seed: int,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    **kwargs,
) -> dict[str, Any]:
    p_game_base_red = predictor.monte_carlo_single_game_probability(
        red_team.simulation_mu,
        red_team.match_sigma,
        blue_team.simulation_mu,
        blue_team.match_sigma,
        samples=samples,
        seed=match_seed,
        sigma_factor=1.0,
    )
    head_to_head_summary = predictor.summarize_head_to_head(
        red_team.college_name,
        blue_team.college_name,
        head_to_head_index,
    )
    delta_h2h = float(head_to_head_summary["delta_h2h"])
    p_game_adj_red = elo_model.clip(p_game_base_red + delta_h2h, 0.05, 0.95)
    raw_distribution = predictor.compute_scoreline_distribution(best_of, p_game_adj_red)
    p_series_red = sum(
        probability
        for scoreline, probability in raw_distribution.items()
        if parse_scoreline(scoreline)[0] > parse_scoreline(scoreline)[1]
    )
    return {
        "p_game_base_red": p_game_base_red,
        "p_game_adj_red": p_game_adj_red,
        "p_series_red": p_series_red,
        "p_series_blue": 1.0 - p_series_red,
        "scoreline_distribution": raw_distribution,
        "head_to_head_summary": head_to_head_summary,
        "confidence_label": predictor.classify_confidence(
            {
                "sigma0": red_team.sigma0,
                "n_matches_2025_rmuc": red_team.n_matches_2025_rmuc,
            },
            {
                "sigma0": blue_team.sigma0,
                "n_matches_2025_rmuc": blue_team.n_matches_2025_rmuc,
            },
        ),
    }


def assign_tournament_strengths(teams: list[RegionTeam], rng: random.Random) -> None:
    for team in teams:
        latent_sigma = team.sigma0 * TOURNAMENT_LATENT_SIGMA_FACTOR
        latent_clip = team.sigma0 * TOURNAMENT_LATENT_SIGMA_CLIP
        latent_offset = rng.gauss(0.0, latent_sigma)
        team.simulation_mu = team.mu0 + elo_model.clip(latent_offset, -latent_clip, latent_clip)
        team.match_sigma = max(team.sigma0 * TOURNAMENT_MATCH_SIGMA_FACTOR, TOURNAMENT_MATCH_SIGMA_FLOOR)


def simulate_series(
    red_team: RegionTeam,
    blue_team: RegionTeam,
    *,
    best_of: int,
    stage: str,
    round_number: int,
    match_label: str,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    group_name: str = "",
    payload_builder: PayloadBuilder | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> dict[str, Any]:
    match_seed = rng.randrange(1, 1_000_000_000)
    builder = payload_builder or build_prediction_payload
    payload = builder(
        red_team,
        blue_team,
        best_of=best_of,
        samples=samples,
        match_seed=match_seed,
        head_to_head_index=head_to_head_index,
        stage=stage,
        round_number=round_number,
        match_label=match_label,
    )
    forced_scoreline = payload.get("fixed_scoreline")
    scoreline = forced_scoreline if forced_scoreline else sample_from_distribution(payload["scoreline_distribution"], rng)
    
    is_confirmed_matchup = not (red_team.dependent_on_prediction or blue_team.dependent_on_prediction)
    if not forced_scoreline:
        red_team.dependent_on_prediction = True
        blue_team.dependent_on_prediction = True

    red_games, blue_games = parse_scoreline(scoreline)
    winner = red_team if red_games > blue_games else blue_team
    loser = blue_team if winner is red_team else red_team
    result = {
        "stage": stage,
        "stage_order": STAGE_ORDER[stage],
        "round_number": round_number,
        "match_label": match_label,
        "group_name": group_name,
        "best_of": best_of,
        "red_team": red_team,
        "blue_team": blue_team,
        "p_game_base_red": payload["p_game_base_red"],
        "p_game_adj_red": payload["p_game_adj_red"],
        "p_series_red": payload["p_series_red"],
        "p_series_blue": payload["p_series_blue"],
        "delta_h2h": float(payload["head_to_head_summary"]["delta_h2h"]),
        "head_to_head_summary": payload["head_to_head_summary"],
        "confidence_label": payload["confidence_label"],
        "scoreline": scoreline,
        "is_actual_result": bool(forced_scoreline),
        "is_confirmed_matchup": is_confirmed_matchup,
        "red_games": red_games,
        "blue_games": blue_games,
        "winner": winner,
        "loser": loser,
        "official_match_id": payload.get("official_match_id"),
        "official_status": payload.get("official_status"),
        "planned_start_at": payload.get("planned_start_at"),
        "mini_program_prediction": payload.get("mini_program_prediction"),
    }
    if forced_scoreline and head_to_head_recorder is not None:
        head_to_head_recorder(head_to_head_index, red_team, blue_team, red_games, blue_games)
    for optional_key in (
        "red_rating_before_match",
        "red_rating_after_match",
        "blue_rating_before_match",
        "blue_rating_after_match",
        "red_live_delta",
        "blue_live_delta",
        "red_prior_delta",
        "blue_prior_delta",
        "red_prior_adjustment_label",
        "blue_prior_adjustment_label",
    ):
        if payload.get(optional_key) is not None:
            result[optional_key] = payload[optional_key]
    return result


def _optional_float_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _set_team_live_rating(team: RegionTeam, rating: float) -> None:
    team.display_mu = rating
    team.simulation_mu = rating
    if hasattr(team, "simulation_theta"):
        setattr(team, "simulation_theta", (rating - 1500.0) / 120.0)


def match_row(
    result: dict[str, Any],
    *,
    winner_next: str,
    loser_next: str,
) -> dict[str, Any]:
    red_team: RegionTeam = result["red_team"]
    blue_team: RegionTeam = result["blue_team"]
    winner: RegionTeam = result["winner"]
    loser: RegionTeam = result["loser"]

    red_wins, blue_wins = 0, 0
    if ":" in result["scoreline"]:
        rw, bw = result["scoreline"].split(":")
        red_wins = int(rw)
        blue_wins = int(bw)

    is_actual_result = bool(result.get("is_actual_result", False))
    red_history_before = _optional_float_value(result.get("red_rating_before_match"))
    red_history_after = _optional_float_value(result.get("red_rating_after_match"))
    blue_history_before = _optional_float_value(result.get("blue_rating_before_match"))
    blue_history_after = _optional_float_value(result.get("blue_rating_after_match"))
    has_published_rating_history = all(
        value is not None
        for value in (red_history_before, red_history_after, blue_history_before, blue_history_after)
    )
    red_mu_before = red_history_before if is_actual_result and has_published_rating_history else red_team.current_display_mu()
    blue_mu_before = blue_history_before if is_actual_result and has_published_rating_history else blue_team.current_display_mu()
    update: dict[str, float] | None = None
    if is_actual_result:
        if has_published_rating_history:
            update = {
                "red_delta": float(red_history_after) - float(red_history_before),
                "blue_delta": float(blue_history_after) - float(blue_history_before),
            }
            _set_team_live_rating(red_team, float(red_history_after))
            _set_team_live_rating(blue_team, float(blue_history_after))
        else:
            update = elo_model.average_ordered_series_update(
                float(red_mu_before),
                float(blue_mu_before),
                red_wins,
                blue_wins,
                64.0,  # Dynamic stage weight proxy K=64.0
            )
            _set_team_live_rating(red_team, float(red_mu_before) + update["red_delta"])
            _set_team_live_rating(blue_team, float(blue_mu_before) + update["blue_delta"])

    row = {
        "stage": result["stage"],
        "stage_order": result["stage_order"],
        "round_number": result["round_number"],
        "match_label": result["match_label"],
        "group_name": result["group_name"],
        "best_of": result["best_of"],
        "red_slot": red_team.slot,
        "red_college_name": red_team.college_name,
        "red_team_name": red_team.team_name,
        "blue_slot": blue_team.slot,
        "blue_college_name": blue_team.college_name,
        "blue_team_name": blue_team.team_name,
        "p_game_red": round(result["p_game_adj_red"], 6),
        "p_game_blue": round(1.0 - result["p_game_adj_red"], 6),
        "p_series_red": round(result["p_series_red"], 6),
        "p_series_blue": round(result["p_series_blue"], 6),
        "delta_h2h": round(result["delta_h2h"], 6),
        "scoreline": result["scoreline"],
        "winner_college_name": winner.college_name,
        "winner_team_name": winner.team_name,
        "loser_college_name": loser.college_name,
        "loser_team_name": loser.team_name,
        "winner_next": winner_next,
        "loser_next": loser_next,
        "confidence_label": result["confidence_label"],
        "is_actual_result": is_actual_result,
        "is_confirmed_matchup": bool(result.get("is_confirmed_matchup", False)),
    }
    for optional_key in ("official_match_id", "official_status", "planned_start_at", "mini_program_prediction"):
        if result.get(optional_key) is not None:
            row[optional_key] = result[optional_key]
    if update is not None:
        row["red_mu0"] = round(red_mu_before, 1)
        row["blue_mu0"] = round(blue_mu_before, 1)
        row["red_delta"] = round(update["red_delta"], 1)
        row["blue_delta"] = round(update["blue_delta"], 1)
        if "red_live_delta" in result and "blue_live_delta" in result:
            row["red_live_delta"] = round(float(result["red_live_delta"]), 1)
            row["blue_live_delta"] = round(float(result["blue_live_delta"]), 1)
        if "red_prior_delta" in result and "blue_prior_delta" in result:
            row["red_prior_delta"] = round(float(result["red_prior_delta"]), 1)
            row["blue_prior_delta"] = round(float(result["blue_prior_delta"]), 1)
        if "red_prior_adjustment_label" in result:
            row["red_prior_adjustment_label"] = str(result["red_prior_adjustment_label"])
        if "blue_prior_adjustment_label" in result:
            row["blue_prior_adjustment_label"] = str(result["blue_prior_adjustment_label"])
    return row


def update_swiss_team_state(team: RegionTeam, *, won: bool, own_games: int, opp_games: int, opponent_key: str, round_number: int) -> None:
    team.swiss_opponents.append(opponent_key)
    team.swiss_game_wins += own_games
    team.swiss_game_losses += opp_games
    if won:
        team.swiss_wins += 1
        if team.swiss_wins >= 3 and team.swiss_qualified_round is None:
            team.swiss_qualified_round = round_number
    else:
        team.swiss_losses += 1
        if team.swiss_losses >= 3 and team.swiss_eliminated_round is None:
            team.swiss_eliminated_round = round_number


def simulate_swiss_group(
    group_name: str,
    group_teams: list[RegionTeam],
    *,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    payload_builder: PayloadBuilder | None = None,
    official_pairings: dict[int, list[tuple[str, str]]] | None = None,
    use_csv_rank_pairings: bool = False,
    use_round5_csv_pairings: bool | None = None,
    use_south_round5_csv_pairings: bool | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> tuple[list[RegionTeam], list[dict[str, Any]]]:
    if use_round5_csv_pairings is not None:
        use_csv_rank_pairings = use_round5_csv_pairings
    if use_south_round5_csv_pairings is not None:
        use_csv_rank_pairings = use_south_round5_csv_pairings
    teams_by_key = {team.team_key: team for team in group_teams}
    slot_to_team = {team.slot: team for team in group_teams}
    match_rows: list[dict[str, Any]] = []

    for round_number in range(_initial_swiss_round(group_teams), 6):
        official_round_pairings = (official_pairings or {}).get(round_number)
        if round_number == 1:
            pairings = [(slot_to_team[left], slot_to_team[right]) for left, right in SWISS_ROUND1_PAIRINGS[group_name]]
        elif round_number in SWISS_CSV_RANK_PAIRINGS and use_csv_rank_pairings:
            pairings = swiss_csv_rank_pairings(round_number, group_name, group_teams, teams_by_key)
        else:
            ranked = sorted(group_teams, key=lambda team: swiss_sort_key(team, teams_by_key), reverse=True)
            active = [team for team in ranked if team.swiss_status == "active"]
            if not active:
                break
            if len(active) % 2 != 0:
                raise ValueError(f"Odd number of active teams in Swiss round {round_number} for group {group_name}")
            pairings = [(active[index], active[index + 1]) for index in range(0, len(active), 2)]

        if official_round_pairings:
            pairings = _merge_official_swiss_pairings(
                pairings,
                _official_swiss_pairings_to_teams(official_round_pairings, teams_by_key),
            )

        for pairing_index, (red_team, blue_team) in enumerate(pairings, start=1):
            result = simulate_series(
                red_team,
                blue_team,
                best_of=3,
                stage="swiss",
                round_number=round_number,
                match_label=f"{group_name}-SWISS-{round_number}-{pairing_index}",
                rng=rng,
                head_to_head_index=head_to_head_index,
                samples=samples,
                group_name=group_name,
                payload_builder=payload_builder,
                head_to_head_recorder=head_to_head_recorder,
            )
            red_games = int(result["red_games"])
            blue_games = int(result["blue_games"])
            winner_is_red = result["winner"] is red_team
            update_swiss_team_state(
                red_team,
                won=winner_is_red,
                own_games=red_games,
                opp_games=blue_games,
                opponent_key=blue_team.team_key,
                round_number=round_number,
            )
            update_swiss_team_state(
                blue_team,
                won=not winner_is_red,
                own_games=blue_games,
                opp_games=red_games,
                opponent_key=red_team.team_key,
                round_number=round_number,
            )
            winner_next = "qualified" if result["winner"].swiss_status == "qualified" else f"{group_name}-Swiss-R{round_number + 1}"
            loser_next = "eliminated" if result["loser"].swiss_status == "eliminated" else f"{group_name}-Swiss-R{round_number + 1}"
            match_rows.append(match_row(result, winner_next=winner_next, loser_next=loser_next))

        if all(team.swiss_status != "active" for team in group_teams):
            break

    ranked_final = sorted(group_teams, key=lambda team: swiss_sort_key(team, teams_by_key), reverse=True)
    qualified_count = sum(1 for team in group_teams if team.swiss_status == "qualified")
    eliminated_count = sum(1 for team in group_teams if team.swiss_status == "eliminated")
    if qualified_count != 8 or eliminated_count != 8:
        raise ValueError(
            f"Unexpected Swiss resolution in group {group_name}: qualified={qualified_count}, eliminated={eliminated_count}"
        )
    for index, team in enumerate(ranked_final, start=1):
        team.swiss_final_group_rank = index
        if team.swiss_status == "eliminated":
            team.final_bucket = "swiss_eliminated"
            team.advancement = "group_eliminated"
    return ranked_final, match_rows


def group_rank_reference_to_team(reference: str, group_rankings: dict[str, list[RegionTeam]]) -> RegionTeam:
    group_name, rank_text = reference.split("-")
    rank = int(rank_text)
    return group_rankings[group_name][rank - 1]


def simulate_round_of_16(
    group_rankings: dict[str, list[RegionTeam]],
    *,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    payload_builder: PayloadBuilder | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> tuple[list[RegionTeam], list[RegionTeam], list[dict[str, Any]]]:
    winners: list[RegionTeam] = []
    losers: list[RegionTeam] = []
    rows: list[dict[str, Any]] = []
    for index, (red_ref, blue_ref) in enumerate(ROUND_OF_16_PAIRINGS, start=1):
        red_team = group_rank_reference_to_team(red_ref, group_rankings)
        blue_team = group_rank_reference_to_team(blue_ref, group_rankings)
        result = simulate_series(
            red_team,
            blue_team,
            best_of=3,
            stage="round_of_16",
            round_number=1,
            match_label=f"R16-{index}",
            rng=rng,
            head_to_head_index=head_to_head_index,
            samples=samples,
            payload_builder=payload_builder,
            head_to_head_recorder=head_to_head_recorder,
        )
        winners.append(result["winner"])
        losers.append(result["loser"])
        rows.append(match_row(result, winner_next="quarterfinal", loser_next="qualification_round1"))
    return winners, losers, rows


def simulate_named_round(
    stage: str,
    match_names: list[str],
    pairs: list[tuple[RegionTeam, RegionTeam]],
    *,
    best_of: int,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    winner_next: str,
    loser_next: str,
    payload_builder: PayloadBuilder | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> tuple[list[RegionTeam], list[RegionTeam], list[dict[str, Any]]]:
    winners: list[RegionTeam] = []
    losers: list[RegionTeam] = []
    rows: list[dict[str, Any]] = []
    for index, ((red_team, blue_team), match_name) in enumerate(zip(pairs, match_names, strict=True), start=1):
        result = simulate_series(
            red_team,
            blue_team,
            best_of=best_of,
            stage=stage,
            round_number=1,
            match_label=match_name,
            rng=rng,
            head_to_head_index=head_to_head_index,
            samples=samples,
            payload_builder=payload_builder,
            head_to_head_recorder=head_to_head_recorder,
        )
        winners.append(result["winner"])
        losers.append(result["loser"])
        rows.append(match_row(result, winner_next=winner_next, loser_next=loser_next))
    return winners, losers, rows


def simulate_bracket(
    region: str,
    group_rankings: dict[str, list[RegionTeam]],
    *,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    payload_builder: PayloadBuilder | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    r16_winners, r16_losers, round16_rows = simulate_round_of_16(
        group_rankings,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(round16_rows)
    r16_winner_map = {f"R16-{index}": team for index, team in enumerate(r16_winners, start=1)}

    qf_pairs = [(r16_winner_map[left], r16_winner_map[right]) for left, right in QUARTERFINAL_MAPPING]
    qf_winners, qf_losers, qf_rows = simulate_named_round(
        "quarterfinal",
        [f"QF-{index}" for index in range(1, 5)],
        qf_pairs,
        best_of=3,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="semifinal",
        loser_next="national_qualified",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(qf_rows)
    qf_winner_map = {f"QF-{index}": team for index, team in enumerate(qf_winners, start=1)}

    sf_pairs = [(qf_winner_map[left], qf_winner_map[right]) for left, right in SEMIFINAL_MAPPING]
    sf_winners, sf_losers, sf_rows = simulate_named_round(
        "semifinal",
        ["SF-1", "SF-2"],
        sf_pairs,
        best_of=3,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="final",
        loser_next="third_place",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(sf_rows)

    third_winners, third_losers, third_rows = simulate_named_round(
        "third_place",
        ["THIRD-1"],
        [(sf_losers[0], sf_losers[1])],
        best_of=5,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="3rd_place",
        loser_next="4th_place",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(third_rows)

    final_winners, final_losers, final_rows = simulate_named_round(
        "final",
        ["FINAL-1"],
        [(sf_winners[0], sf_winners[1])],
        best_of=5,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="champion",
        loser_next="runner_up",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(final_rows)

    champion = final_winners[0]
    runner_up = final_losers[0]
    third_place = third_winners[0]
    fourth_place = third_losers[0]
    champion.final_bucket = "champion"
    champion.advancement = "national_qualified"
    runner_up.final_bucket = "runner_up"
    runner_up.advancement = "national_qualified"
    third_place.final_bucket = "third_place"
    third_place.advancement = "national_qualified"
    fourth_place.final_bucket = "fourth_place"
    fourth_place.advancement = "national_qualified"
    for team in qf_losers:
        team.final_bucket = "quarterfinalist"
        team.advancement = "national_qualified"

    qualification_rows, qualification_summary = simulate_qualification_path(
        region,
        r16_losers,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    all_rows.extend(qualification_rows)
    return all_rows, {
        "champion": champion,
        "runner_up": runner_up,
        "third_place": third_place,
        "fourth_place": fourth_place,
        "quarterfinal_losers": qf_losers,
        "round_of_16_losers": r16_losers,
        "qualification": qualification_summary,
    }


def simulate_qualification_path(
    region: str,
    round_of_16_losers: list[RegionTeam],
    *,
    rng: random.Random,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
    samples: int,
    payload_builder: PayloadBuilder | None = None,
    head_to_head_recorder: HeadToHeadRecorder | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    q1_pairs = [
        (round_of_16_losers[0], round_of_16_losers[1]),
        (round_of_16_losers[3], round_of_16_losers[2]),
        (round_of_16_losers[4], round_of_16_losers[5]),
        (round_of_16_losers[7], round_of_16_losers[6]),
    ]
    q1_winners, q1_losers, q1_rows = simulate_named_round(
        "qualification_round1",
        [f"QUAL-1-{index}" for index in range(1, 5)],
        q1_pairs,
        best_of=3,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="tbd",
        loser_next="tbd",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    if region == "东部赛区":
        for row in q1_rows:
            row["winner_next"] = "repechage_qualified"
            row["loser_next"] = "qualification_round2"
    elif region in {"南部赛区", "北部赛区"}:
        for row in q1_rows:
            row["winner_next"] = "qualification_round2_national"
            row["loser_next"] = "repechage_qualified" if region == "南部赛区" else "qualification_round2_repechage"
    rows.extend(q1_rows)

    summary: dict[str, Any] = {
        "round1_winners": q1_winners,
        "round1_losers": q1_losers,
        "national_via_qualifier": [],
        "repechage_qualified": [],
        "eliminated": [],
    }

    if region == "东部赛区":
        for team in q1_winners:
            team.final_bucket = "repechage_direct"
            team.advancement = "repechage_qualified"
        q2_pairs = [(q1_losers[0], q1_losers[2]), (q1_losers[1], q1_losers[3])]
        q2_winners, q2_losers, q2_rows = simulate_named_round(
            "qualification_round2",
            ["QUAL-2-1", "QUAL-2-2"],
            q2_pairs,
            best_of=3,
            rng=rng,
            head_to_head_index=head_to_head_index,
            samples=samples,
            winner_next="repechage_qualified",
            loser_next="eliminated",
            payload_builder=payload_builder,
            head_to_head_recorder=head_to_head_recorder,
        )
        rows.extend(q2_rows)
        for team in q2_winners:
            team.final_bucket = "repechage_via_playoff"
            team.advancement = "repechage_qualified"
        for team in q2_losers:
            team.final_bucket = "eliminated_in_qualification"
            team.advancement = "eliminated"
        summary["repechage_qualified"] = [*q1_winners, *q2_winners]
        summary["eliminated"] = q2_losers
        summary["round2_winners"] = q2_winners
        summary["round2_losers"] = q2_losers
        return rows, summary

    national_pairs = [(q1_winners[0], q1_winners[2]), (q1_winners[1], q1_winners[3])]
    national_winners, national_losers, national_rows = simulate_named_round(
        "qualification_round2",
        ["QUAL-2-1", "QUAL-2-2"],
        national_pairs,
        best_of=3,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        winner_next="national_qualified",
        loser_next="tbd",
        payload_builder=payload_builder,
        head_to_head_recorder=head_to_head_recorder,
    )
    for row in national_rows:
        row["loser_next"] = "repechage_qualified"
    rows.extend(national_rows)
    for team in national_winners:
        team.final_bucket = "national_via_qualifier"
        team.advancement = "national_qualified"
    summary["national_via_qualifier"] = national_winners

    if region == "南部赛区":
        for team in national_losers:
            team.final_bucket = "repechage_from_national_playoff_loss"
            team.advancement = "repechage_qualified"
        for team in q1_losers:
            team.final_bucket = "repechage_direct"
            team.advancement = "repechage_qualified"
        summary["repechage_qualified"] = [*national_losers, *q1_losers]
        summary["eliminated"] = []
        summary["round2_losers"] = national_losers
        return rows, summary

    if region == "北部赛区":
        for team in national_losers:
            team.final_bucket = "repechage_from_national_playoff_loss"
            team.advancement = "repechage_qualified"
        repechage_pairs = [(q1_losers[0], q1_losers[2]), (q1_losers[1], q1_losers[3])]
        repechage_winners, repechage_losers, repechage_rows = simulate_named_round(
            "qualification_round2",
            ["QUAL-R-1", "QUAL-R-2"],
            repechage_pairs,
            best_of=3,
            rng=rng,
            head_to_head_index=head_to_head_index,
            samples=samples,
            winner_next="repechage_qualified",
            loser_next="eliminated",
            payload_builder=payload_builder,
            head_to_head_recorder=head_to_head_recorder,
        )
        rows.extend(repechage_rows)
        for team in repechage_winners:
            team.final_bucket = "repechage_via_playoff"
            team.advancement = "repechage_qualified"
        for team in repechage_losers:
            team.final_bucket = "eliminated_in_qualification"
            team.advancement = "eliminated"
        summary["repechage_qualified"] = [*national_losers, *repechage_winners]
        summary["eliminated"] = repechage_losers
        summary["round2_losers"] = national_losers
        summary["repechage_round_winners"] = repechage_winners
        summary["repechage_round_losers"] = repechage_losers
        return rows, summary

    raise ValueError(f"Unsupported region: {region}")


def build_final_rankings(
    region: str,
    teams: list[RegionTeam],
    bracket_summary: dict[str, Any],
) -> list[RegionTeam]:
    teams_by_key = {team.team_key: team for team in teams}

    ordered: list[RegionTeam] = [
        bracket_summary["champion"],
        bracket_summary["runner_up"],
        bracket_summary["third_place"],
        bracket_summary["fourth_place"],
    ]

    ordered.extend(
        sorted(
            bracket_summary["quarterfinal_losers"],
            key=lambda team: swiss_cross_group_key(team, teams_by_key),
            reverse=True,
        )
    )

    qualification = bracket_summary["qualification"]
    if region == "东部赛区":
        ordered.extend(
            sorted(
                qualification["round1_winners"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["round2_winners"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["round2_losers"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
    elif region == "南部赛区":
        ordered.extend(
            sorted(
                qualification["national_via_qualifier"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["round2_losers"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["round1_losers"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
    elif region == "北部赛区":
        ordered.extend(
            sorted(
                qualification["national_via_qualifier"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["round2_losers"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["repechage_round_winners"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
        ordered.extend(
            sorted(
                qualification["repechage_round_losers"],
                key=lambda team: swiss_cross_group_key(team, teams_by_key),
                reverse=True,
            )
        )
    else:
        raise ValueError(f"Unsupported region: {region}")

    swiss_eliminated = [team for team in teams if team.final_bucket == "swiss_eliminated"]
    ordered.extend(sorted(swiss_eliminated, key=lambda team: swiss_cross_group_key(team, teams_by_key), reverse=True))

    unique_keys = [team.team_key for team in ordered]
    if len(unique_keys) != len(set(unique_keys)):
        raise ValueError("Duplicate team found while building final rankings")
    if len(ordered) != 32:
        raise ValueError(f"Final ranking should contain 32 teams, found {len(ordered)}")
    for index, team in enumerate(ordered, start=1):
        team.final_rank = index
    return ordered


def render_summary(
    region: str,
    seed: int,
    summary: dict[str, Any],
) -> str:
    champion = summary["champion"]["college_name"]
    runner_up = summary["runner_up"]["college_name"]
    third_place = summary["third_place"]["college_name"]
    fourth_place = summary["fourth_place"]["college_name"]
    national = ", ".join(summary["national_qualifiers"])
    repechage = ", ".join(summary["repechage_qualifiers"])
    return "\n".join(
        [
            f"Region: {region}",
            f"Seed: {seed}",
            f"Champion: {champion}",
            f"Runner-up: {runner_up}",
            f"Third place: {third_place}",
            f"Fourth place: {fourth_place}",
            f"National qualifiers: {national}",
            f"Repechage qualifiers: {repechage}",
        ]
    )


def simulate_region(
    region: str,
    *,
    seed: int = DEFAULT_SIMULATION_SEED,
    ratings_csv: Path = DEFAULT_RATINGS_CSV,
    samples: int = DEFAULT_MONTE_CARLO_SAMPLES,
    payload_builder: PayloadBuilder | None = None,
    official_group_rank_metrics: dict[str, dict[str, Any]] | None = None,
    seed_swiss_state_from_official_metrics: bool = False,
) -> dict[str, Any]:
    if region not in REGION_CONFIGS:
        raise ValueError(f"Unsupported region: {region}")
    rng = random.Random(seed)
    teams = parse_team_rows(region, ratings_csv)
    slot_rows = assign_region_slots(teams, rng)
    apply_official_swiss_ranking_metrics(
        teams,
        official_group_rank_metrics,
        seed_current_state=seed_swiss_state_from_official_metrics,
    )
    assign_tournament_strengths(teams, rng)
    head_to_head_index = predictor.load_head_to_head_index()

    group_rankings: dict[str, list[RegionTeam]] = {}
    match_rows: list[dict[str, Any]] = []
    for group_name in ["A", "B"]:
        group_teams = [team for team in teams if team.group_name == group_name]
        ranked_group, swiss_rows = simulate_swiss_group(
            group_name,
            group_teams,
            rng=rng,
            head_to_head_index=head_to_head_index,
            samples=samples,
            payload_builder=payload_builder,
            use_csv_rank_pairings=True,
        )
        group_rankings[group_name] = ranked_group
        match_rows.extend(swiss_rows)

    bracket_rows, bracket_summary = simulate_bracket(
        region,
        group_rankings,
        rng=rng,
        head_to_head_index=head_to_head_index,
        samples=samples,
        payload_builder=payload_builder,
    )
    match_rows.extend(bracket_rows)
    final_rankings = build_final_rankings(region, teams, bracket_summary)
    config = REGION_CONFIGS[region]
    teams_by_key = {team.team_key: team for team in teams}
    national_qualifiers = [team.college_name for team in final_rankings if team.advancement == "national_qualified"]
    repechage_qualifiers = [team.college_name for team in final_rankings if team.advancement == "repechage_qualified"]
    if len(national_qualifiers) != config["national_slots"]:
        raise ValueError(f"{region} national qualifier count mismatch: {len(national_qualifiers)}")
    if len(repechage_qualifiers) != config["repechage_slots"]:
        raise ValueError(f"{region} repechage qualifier count mismatch: {len(repechage_qualifiers)}")

    ranking_rows = []
    for team in final_rankings:
        metrics = swiss_ranking_metrics(team, teams_by_key)
        ranking_rows.append(
            {
                "rank": team.final_rank,
                "college_name": team.college_name,
                "team_name": team.team_name,
                "group_name": team.group_name,
                "slot": team.slot,
                "seed_tier": team.seed_tier,
                "seed_rank_in_region": team.seed_rank_in_region,
                "swiss_wins": team.swiss_wins,
                "swiss_losses": team.swiss_losses,
                "swiss_group_rank": team.swiss_final_group_rank or "",
                "opponent_score": metrics["opponent_score"],
                "calculated_opponent_score": metrics["calculated_opponent_score"],
                "official_opponent_points": metrics["official_opponent_points"],
                "source_reported_opponent_points": metrics["source_reported_opponent_points"],
                "official_avg_base_hp_diff": metrics["official_avg_base_hp_diff"],
                "official_avg_team_damage": metrics["official_avg_team_damage"],
                "ranking_metric_source": metrics["ranking_metric_source"],
                "ranking_completeness": metrics["ranking_completeness"],
                "mu0": round(team.mu0, 6),
                "final_bucket": team.final_bucket,
                "advancement": team.advancement,
            }
        )

    summary = {
        "region": region,
        "region_slug": config["slug"],
        "seed": seed,
        "ratings_csv": str(ratings_csv),
        "samples_per_match": samples,
        "configuration": {
            "national_slots": config["national_slots"],
            "repechage_slots": config["repechage_slots"],
            "slot_rules": {
                "box1": TIER1_SLOTS,
                "box2": TIER2_SLOTS,
                "box3": UNSEEDED_SLOTS,
            },
            "swiss": {
                "rounds": 5,
                "advance_wins": 3,
                "eliminate_losses": 3,
                "allow_rematches": True,
                "swiss_pairing_source": "round2_to_round5_csv_rank_positions",
                "round5_pairing_source": "csv_rank_positions",
                "official_ranking_order": [
                    "completed_rounds_to_3_wins",
                    "opponent_score",
                    "avg_base_hp_diff",
                    "avg_team_damage",
                ],
                "simulation_metric_policy": "pure simulation does not predict base HP differential or team damage; those official fields stay null unless live data supplies them",
                "simulation_fallback_after_official_metrics": ["game_diff", "preseason_mu0", "seed_rank"],
            },
        },
        "champion": {
            "college_name": bracket_summary["champion"].college_name,
            "team_name": bracket_summary["champion"].team_name,
        },
        "runner_up": {
            "college_name": bracket_summary["runner_up"].college_name,
            "team_name": bracket_summary["runner_up"].team_name,
        },
        "third_place": {
            "college_name": bracket_summary["third_place"].college_name,
            "team_name": bracket_summary["third_place"].team_name,
        },
        "fourth_place": {
            "college_name": bracket_summary["fourth_place"].college_name,
            "team_name": bracket_summary["fourth_place"].team_name,
        },
        "national_qualifiers": national_qualifiers,
        "repechage_qualifiers": repechage_qualifiers,
        "eliminated_teams": [team.college_name for team in final_rankings if team.advancement == "eliminated" or team.advancement == "group_eliminated"],
        "group_rankings": {
            group_name: [
                {
                    "group_rank": index,
                    "college_name": team.college_name,
                    "team_name": team.team_name,
                    "slot": team.slot,
                    "wins": team.swiss_wins,
                    "losses": team.swiss_losses,
                    "status": team.swiss_status,
                    **swiss_ranking_metrics(team, teams_by_key),
                }
                for index, team in enumerate(group_teams, start=1)
            ]
            for group_name, group_teams in group_rankings.items()
        },
        "final_rankings": ranking_rows,
        "match_count_by_stage": dict(sorted(Counter(row["stage"] for row in match_rows).items())),
    }

    return {
        "region": region,
        "slot_rows": slot_rows,
        "match_rows": sorted(match_rows, key=lambda row: (row["stage_order"], row["round_number"], row["match_label"])),
        "summary": summary,
    }


def write_simulation_outputs(simulation: dict[str, Any]) -> dict[str, Path]:
    region = simulation["region"]
    config = REGION_CONFIGS[region]
    output_dir = SIMULATION_DERIVED_DIR / config["slug"]
    output_dir.mkdir(parents=True, exist_ok=True)
    slot_path = output_dir / "region_slot_assignments.csv"
    match_path = output_dir / "region_match_results.csv"
    summary_path = output_dir / "region_summary.json"
    ranking_path = output_dir / "region_final_rankings.csv"
    elo_model.write_csv(
        slot_path,
        simulation["slot_rows"],
        fieldnames=[
            "region",
            "group_name",
            "slot",
            "draw_box",
            "seed_tier",
            "seed_rank_in_region",
            "college_name",
            "team_name",
            "mu0",
            "sigma0",
            "shape_rank",
            "ranking_global_rank",
        ],
    )
    elo_model.write_csv(
        match_path,
        simulation["match_rows"],
        fieldnames=[
            "stage",
            "stage_order",
            "round_number",
            "match_label",
            "group_name",
            "best_of",
            "red_slot",
            "red_college_name",
            "red_team_name",
            "blue_slot",
            "blue_college_name",
            "blue_team_name",
            "p_game_red",
            "p_game_blue",
            "p_series_red",
            "p_series_blue",
            "delta_h2h",
            "red_mu0",
            "blue_mu0",
            "red_delta",
            "blue_delta",
            "red_live_delta",
            "blue_live_delta",
            "red_prior_delta",
            "blue_prior_delta",
            "red_prior_adjustment_label",
            "blue_prior_adjustment_label",
            "scoreline",
            "winner_college_name",
            "winner_team_name",
            "loser_college_name",
            "loser_team_name",
            "winner_next",
            "loser_next",
            "confidence_label",
            "is_actual_result",
            "is_confirmed_matchup",
            "official_match_id",
            "official_status",
            "planned_start_at",
            "mini_program_prediction",
        ],
    )
    elo_model.write_csv(
        ranking_path,
        simulation["summary"]["final_rankings"],
        fieldnames=[
            "rank",
            "college_name",
            "team_name",
            "group_name",
            "slot",
            "seed_tier",
            "seed_rank_in_region",
            "swiss_wins",
            "swiss_losses",
            "swiss_group_rank",
            "opponent_score",
            "calculated_opponent_score",
            "official_opponent_points",
            "source_reported_opponent_points",
            "official_avg_base_hp_diff",
            "official_avg_team_damage",
            "ranking_metric_source",
            "ranking_completeness",
            "mu0",
            "final_bucket",
            "advancement",
        ],
    )
    elo_model.write_json(summary_path, simulation["summary"])
    return {
        "output_dir": output_dir,
        "slot_path": slot_path,
        "match_path": match_path,
        "ranking_path": ranking_path,
        "summary_path": summary_path,
    }


def main() -> None:
    args = parse_args()
    simulation = simulate_region(
        args.region,
        seed=args.seed,
        ratings_csv=args.ratings_csv,
        samples=args.samples,
    )
    paths = write_simulation_outputs(simulation)
    text = render_summary(args.region, args.seed, simulation["summary"])
    print(text)
    print(f"Outputs: {paths['output_dir']}")


if __name__ == "__main__":
    main()
