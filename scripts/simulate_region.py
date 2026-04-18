#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import random
from pathlib import Path
from typing import Any

import _simulate_region_core as region_core
import build_rmuc_elo as legacy_elo

import build_rmuc_ts2_backend as ts2_model


RegionTeam = region_core.RegionTeam
PayloadBuilder = region_core.PayloadBuilder
REGION_CONFIGS = region_core.REGION_CONFIGS
DEFAULT_MONTE_CARLO_SAMPLES = region_core.DEFAULT_MONTE_CARLO_SAMPLES
DEFAULT_SIMULATION_SEED = region_core.DEFAULT_SIMULATION_SEED
SIMULATION_DERIVED_DIR = region_core.SIMULATION_DERIVED_DIR
DEFAULT_RATINGS_CSV = ts2_model.DERIVED_DIR / "preseason_ratings.csv"
TOURNAMENT_LATENT_SIGMA_FACTOR = region_core.TOURNAMENT_LATENT_SIGMA_FACTOR
TOURNAMENT_LATENT_SIGMA_CLIP = region_core.TOURNAMENT_LATENT_SIGMA_CLIP
TOURNAMENT_MATCH_SIGMA_FACTOR = region_core.TOURNAMENT_MATCH_SIGMA_FACTOR
RATING_SIGMA_FLOOR = 10.0
RATING_SCALE = 120.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate a single 2026 RMUC regional event with TS2 preseason ratings.")
    parser.add_argument("--region", required=True, choices=sorted(REGION_CONFIGS), help="Region to simulate.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SIMULATION_SEED, help="Simulation random seed.")
    parser.add_argument("--ratings-csv", type=Path, default=DEFAULT_RATINGS_CSV, help="Path to TS2 preseason_ratings.csv.")
    parser.add_argument("--samples", type=int, default=DEFAULT_MONTE_CARLO_SAMPLES, help="Monte Carlo samples per matchup probability estimate.")
    return parser.parse_args()


def parse_team_rows(region: str, ratings_csv: Path) -> list[RegionTeam]:
    rating_rows = legacy_elo.read_csv(ratings_csv)
    teams: list[RegionTeam] = []
    for row in rating_rows:
        if row["admitted_region"] != region:
            continue
        team = RegionTeam(
            team_key=row["team_key"],
            college_name=row["college_name"],
            team_name=row["team_name"],
            admitted_region=row["admitted_region"],
            seed_tier=row["seed_tier"],
            seed_rank_in_region=int(row["seed_rank_in_region"]),
            ranking_global_rank=legacy_elo.parse_int(row.get("ranking_global_rank")),
            shape_rank=legacy_elo.parse_int(row.get("shape_rank")),
            mu0=float(row["mu0"]),
            sigma0=float(row["sigma0"]),
            z_25game=0.0,
            z_robot25_raw=0.0,
            z_26rmul=0.0,
            z_form=0.0,
            tilde_z_hist=0.0,
            n_matches_2025_rmuc=0,
            n_matches_2026_rmul=0,
            robot_stage_reliability=0.0,
            simulation_mu=float(row["mu0"]),
            match_sigma=max(float(row["sigma0"]) * TOURNAMENT_MATCH_SIGMA_FACTOR, RATING_SIGMA_FLOOR),
        )
        team.program_base_theta = float(row["program_base_theta"])
        team.prior_delta_theta = float(row["prior_delta_theta"])
        team.regional_pre_theta = float(row["regional_pre_theta"])
        team.pre_signal_sd_theta = float(row["pre_signal_sd_theta"])
        team.rmuc_history_strength = float(row["rmuc_history_strength"])
        team.beta_perf = float(row["beta_perf"])
        team.simulation_theta = float(row["regional_pre_theta"])
        team.match_sigma_theta = max(
            float(row["pre_signal_sd_theta"]) * TOURNAMENT_MATCH_SIGMA_FACTOR,
            RATING_SIGMA_FLOOR / RATING_SCALE,
        )
        teams.append(team)
    if len(teams) != 32:
        raise ValueError(f"Expected 32 teams in {region}, found {len(teams)}")
    return teams


def _logistic_expectation(theta_delta: float, beta_perf: float) -> float:
    return 1.0 / (1.0 + math.exp(-(theta_delta / max(beta_perf, 1e-6))))


def _monte_carlo_single_game_probability(
    red_theta: float,
    red_sigma_theta: float,
    blue_theta: float,
    blue_sigma_theta: float,
    *,
    beta_perf: float,
    samples: int,
    seed: int,
) -> float:
    rng = random.Random(seed)
    total = 0.0
    for _ in range(samples):
        sampled_red = rng.gauss(red_theta, red_sigma_theta)
        sampled_blue = rng.gauss(blue_theta, blue_sigma_theta)
        total += _logistic_expectation(sampled_red - sampled_blue, beta_perf)
    return total / max(samples, 1)


def _compute_scoreline_distribution(best_of: int, p_game_red: float) -> dict[str, float]:
    p_game_blue = 1.0 - p_game_red
    if best_of == 3:
        return {
            "2:0": p_game_red**2,
            "2:1": 2.0 * (p_game_red**2) * p_game_blue,
            "1:2": 2.0 * p_game_red * (p_game_blue**2),
            "0:2": p_game_blue**2,
        }
    if best_of == 5:
        return {
            "3:0": p_game_red**3,
            "3:1": 3.0 * (p_game_red**3) * p_game_blue,
            "3:2": 6.0 * (p_game_red**3) * (p_game_blue**2),
            "2:3": 6.0 * (p_game_red**2) * (p_game_blue**3),
            "1:3": 3.0 * p_game_red * (p_game_blue**3),
            "0:3": p_game_blue**3,
        }
    raise ValueError(f"Unsupported best_of: {best_of}")


def _classify_confidence(red_team: RegionTeam, blue_team: RegionTeam) -> str:
    max_sigma = max(float(red_team.sigma0), float(blue_team.sigma0))
    min_history = min(
        float(getattr(red_team, "rmuc_history_strength", 0.0)),
        float(getattr(blue_team, "rmuc_history_strength", 0.0)),
    )
    if max_sigma <= 58.0 and min_history >= 0.80:
        return "high"
    if max_sigma <= 72.0:
        return "medium"
    return "low"


def build_prediction_payload(
    red_team: RegionTeam,
    blue_team: RegionTeam,
    *,
    best_of: int,
    samples: int,
    match_seed: int,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    del head_to_head_index
    beta_perf = (float(getattr(red_team, "beta_perf", 0.0)) + float(getattr(blue_team, "beta_perf", 0.0))) / 2.0
    p_game_red = _monte_carlo_single_game_probability(
        float(getattr(red_team, "simulation_theta", getattr(red_team, "regional_pre_theta"))),
        float(getattr(red_team, "match_sigma_theta", getattr(red_team, "pre_signal_sd_theta", 0.0))),
        float(getattr(blue_team, "simulation_theta", getattr(blue_team, "regional_pre_theta"))),
        float(getattr(blue_team, "match_sigma_theta", getattr(blue_team, "pre_signal_sd_theta", 0.0))),
        beta_perf=beta_perf,
        samples=samples,
        seed=match_seed,
    )
    p_game_red = legacy_elo.clip(p_game_red, 0.05, 0.95)
    raw_distribution = _compute_scoreline_distribution(best_of, p_game_red)
    p_series_red = sum(
        probability
        for scoreline, probability in raw_distribution.items()
        if int(scoreline.split(":")[0]) > int(scoreline.split(":")[1])
    )
    return {
        "p_game_base_red": p_game_red,
        "p_game_adj_red": p_game_red,
        "p_series_red": p_series_red,
        "p_series_blue": 1.0 - p_series_red,
        "scoreline_distribution": raw_distribution,
        "head_to_head_summary": {
            "meetings_count": 0,
            "effective_meeting_weight": 0.0,
            "weighted_record": {
                "school_a_weighted_wins": 0.0,
                "school_b_weighted_wins": 0.0,
                "weighted_ties": 0.0,
            },
            "sources_used": [],
            "season_counts": {},
            "season_weights": {},
            "p_h2h": 0.5,
            "reliability": 0.0,
            "delta_h2h": 0.0,
        },
        "confidence_label": _classify_confidence(red_team, blue_team),
    }


def assign_tournament_strengths(teams: list[RegionTeam], rng: random.Random) -> None:
    for team in teams:
        pre_signal_sd_theta = float(getattr(team, "pre_signal_sd_theta", 0.0))
        latent_sigma_theta = pre_signal_sd_theta * TOURNAMENT_LATENT_SIGMA_FACTOR
        latent_clip_theta = pre_signal_sd_theta * TOURNAMENT_LATENT_SIGMA_CLIP
        latent_offset_theta = rng.gauss(0.0, latent_sigma_theta)
        latent_offset_theta = legacy_elo.clip(latent_offset_theta, -latent_clip_theta, latent_clip_theta)
        team.simulation_theta = float(getattr(team, "regional_pre_theta")) + latent_offset_theta
        team.match_sigma_theta = max(pre_signal_sd_theta * TOURNAMENT_MATCH_SIGMA_FACTOR, RATING_SIGMA_FLOOR / RATING_SCALE)


def simulate_region(
    region: str,
    *,
    seed: int = DEFAULT_SIMULATION_SEED,
    ratings_csv: Path = DEFAULT_RATINGS_CSV,
    samples: int = DEFAULT_MONTE_CARLO_SAMPLES,
    payload_builder: PayloadBuilder | None = None,
) -> dict[str, Any]:
    if region not in REGION_CONFIGS:
        raise ValueError(f"Unsupported region: {region}")
    rng = random.Random(seed)
    teams = parse_team_rows(region, ratings_csv)
    slot_rows = region_core.assign_region_slots(teams, rng)
    assign_tournament_strengths(teams, rng)

    group_rankings: dict[str, list[RegionTeam]] = {}
    match_rows: list[dict[str, Any]] = []
    for group_name in ["A", "B"]:
        group_teams = [team for team in teams if team.group_name == group_name]
        ranked_group, swiss_rows = region_core.simulate_swiss_group(
            group_name,
            group_teams,
            rng=rng,
            head_to_head_index={},
            samples=samples,
            payload_builder=payload_builder or build_prediction_payload,
        )
        group_rankings[group_name] = ranked_group
        match_rows.extend(swiss_rows)

    bracket_rows, bracket_summary = region_core.simulate_bracket(
        region,
        group_rankings,
        rng=rng,
        head_to_head_index={},
        samples=samples,
        payload_builder=payload_builder or build_prediction_payload,
    )
    match_rows.extend(bracket_rows)
    final_rankings = region_core.build_final_rankings(region, teams, bracket_summary)
    config = REGION_CONFIGS[region]
    national_qualifiers = [team.college_name for team in final_rankings if team.advancement == "national_qualified"]
    repechage_qualifiers = [team.college_name for team in final_rankings if team.advancement == "repechage_qualified"]
    if len(national_qualifiers) != config["national_slots"]:
        raise ValueError(f"{region} national qualifier count mismatch: {len(national_qualifiers)}")
    if len(repechage_qualifiers) != config["repechage_slots"]:
        raise ValueError(f"{region} repechage qualifier count mismatch: {len(repechage_qualifiers)}")

    ranking_rows = []
    for team in final_rankings:
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
                "box1": region_core.TIER1_SLOTS,
                "box4": region_core.BOX4_SLOTS,
                "box5": region_core.BOX5_SLOTS,
            },
            "swiss": {
                "rounds": 5,
                "advance_wins": 3,
                "eliminate_losses": 3,
                "allow_rematches": True,
                "ranking_tiebreak_proxy": ["official_opponent_score", "game_diff", "ts2_preseason_rating"],
            },
        },
        "champion": {"college_name": bracket_summary["champion"].college_name, "team_name": bracket_summary["champion"].team_name},
        "runner_up": {"college_name": bracket_summary["runner_up"].college_name, "team_name": bracket_summary["runner_up"].team_name},
        "third_place": {"college_name": bracket_summary["third_place"].college_name, "team_name": bracket_summary["third_place"].team_name},
        "fourth_place": {"college_name": bracket_summary["fourth_place"].college_name, "team_name": bracket_summary["fourth_place"].team_name},
        "national_qualifiers": national_qualifiers,
        "repechage_qualifiers": repechage_qualifiers,
        "eliminated_teams": [team.college_name for team in final_rankings if team.advancement in {"eliminated", "group_eliminated"}],
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
                }
                for index, team in enumerate(group_teams, start=1)
            ]
            for group_name, group_teams in group_rankings.items()
        },
        "final_rankings": ranking_rows,
        "match_count_by_stage": dict(sorted(region_core.Counter(row["stage"] for row in match_rows).items())),
    }
    return {
        "region": region,
        "slot_rows": slot_rows,
        "match_rows": sorted(match_rows, key=lambda row: (row["stage_order"], row["round_number"], row["match_label"])),
        "summary": summary,
    }


def write_simulation_outputs(simulation: dict[str, Any]) -> dict[str, Path]:
    return region_core.write_simulation_outputs(simulation)


def render_summary(region: str, seed: int, summary: dict[str, Any]) -> str:
    return region_core.render_summary(region, seed, summary)


def main() -> None:
    args = parse_args()
    simulation = simulate_region(args.region, seed=args.seed, ratings_csv=args.ratings_csv, samples=args.samples)
    paths = write_simulation_outputs(simulation)
    print(render_summary(args.region, args.seed, simulation["summary"]))
    print(f"Outputs: {paths['output_dir']}")


if __name__ == "__main__":
    main()
