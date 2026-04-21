#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import build_rmuc_elo as legacy_elo
import head_to_head as h2h
import simulate_region as region_sim


DEFAULT_REGION = "东部赛区"
DEFAULT_ITERATIONS = 5_000
DEFAULT_PAIR_SAMPLES = 4_000
DEFAULT_BASE_SEED = 20260414


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Monte Carlo regional simulations with native TS2 ratings.")
    parser.add_argument("--region", default=DEFAULT_REGION, choices=sorted(region_sim.REGION_CONFIGS), help="Region to simulate.")
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS, help="Number of tournament simulations.")
    parser.add_argument("--seed", type=int, default=DEFAULT_BASE_SEED, help="Base random seed.")
    parser.add_argument("--ratings-csv", type=Path, default=region_sim.DEFAULT_RATINGS_CSV, help="Path to TS2 preseason_ratings.csv.")
    parser.add_argument("--pair-samples", type=int, default=DEFAULT_PAIR_SAMPLES, help="Monte Carlo samples used when precomputing each pairwise matchup probability.")
    return parser.parse_args()


def stable_seed(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return int(digest[:15], 16)


def build_pair_probability_cache(
    teams: list[region_sim.RegionTeam],
    *,
    pair_samples: int,
    seed: int,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
) -> dict[tuple[str, str, int], dict[str, Any]]:
    cache: dict[tuple[str, str, int], dict[str, Any]] = {}
    for red_team in teams:
        for blue_team in teams:
            if red_team.team_key == blue_team.team_key:
                continue
            for best_of in (3, 5):
                cache_key = (red_team.team_key, blue_team.team_key, best_of)
                match_seed = stable_seed(seed, red_team.team_key, blue_team.team_key, best_of)
                cache[cache_key] = region_sim.build_prediction_payload(
                    red_team,
                    blue_team,
                    best_of=best_of,
                    samples=pair_samples,
                    match_seed=match_seed,
                    head_to_head_index=head_to_head_index,
                )
    return cache


def make_cached_payload_builder(
    cache: dict[tuple[str, str, int], dict[str, Any]],
) -> region_sim.PayloadBuilder:
    def builder(
        red_team: region_sim.RegionTeam,
        blue_team: region_sim.RegionTeam,
        *,
        best_of: int,
        samples: int,
        match_seed: int,
        head_to_head_index: dict[tuple[str, str], dict[str, Any]],
        **kwargs,
    ) -> dict[str, Any]:
        del samples, match_seed, head_to_head_index, kwargs
        return cache[(red_team.team_key, blue_team.team_key, best_of)]

    return builder


def empty_team_counters() -> dict[str, float]:
    return {
        "round_of_16_count": 0.0,
        "quarterfinal_count": 0.0,
        "semifinal_count": 0.0,
        "final_count": 0.0,
        "champion_count": 0.0,
        "runner_up_count": 0.0,
        "third_place_count": 0.0,
        "national_count": 0.0,
        "repechage_count": 0.0,
        "group_eliminated_count": 0.0,
        "qualification_eliminated_count": 0.0,
        "average_final_rank_total": 0.0,
    }


def accumulate_simulation_counts(
    counters: dict[str, dict[str, float]],
    ranking_rows: list[dict[str, Any]],
) -> None:
    for row in ranking_rows:
        key = row["college_name"]
        counter = counters[key]
        final_bucket = row["final_bucket"]
        advancement = row["advancement"]
        rank = int(row["rank"])

        if final_bucket != "swiss_eliminated":
            counter["round_of_16_count"] += 1.0
        if final_bucket in {"champion", "runner_up", "third_place", "fourth_place", "quarterfinalist"}:
            counter["quarterfinal_count"] += 1.0
        if final_bucket in {"champion", "runner_up", "third_place", "fourth_place"}:
            counter["semifinal_count"] += 1.0
        if final_bucket in {"champion", "runner_up"}:
            counter["final_count"] += 1.0
        if final_bucket == "champion":
            counter["champion_count"] += 1.0
        if final_bucket == "runner_up":
            counter["runner_up_count"] += 1.0
        if final_bucket == "third_place":
            counter["third_place_count"] += 1.0
        if advancement == "national_qualified":
            counter["national_count"] += 1.0
        elif advancement == "repechage_qualified":
            counter["repechage_count"] += 1.0
        elif advancement == "group_eliminated":
            counter["group_eliminated_count"] += 1.0
        elif advancement == "eliminated":
            counter["qualification_eliminated_count"] += 1.0
        counter["average_final_rank_total"] += float(rank)


def build_team_probability_rows(
    teams: list[region_sim.RegionTeam],
    counters: dict[str, dict[str, float]],
    *,
    iterations: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for team in teams:
        counter = counters[team.college_name]
        average_final_rank = counter["average_final_rank_total"] / iterations
        rows.append(
            {
                "college_name": team.college_name,
                "team_name": team.team_name,
                "seed_tier": team.seed_tier,
                "seed_rank_in_region": team.seed_rank_in_region,
                "mu0": round(team.mu0, 6),
                "sigma0": round(team.sigma0, 6),
                "round_of_16_rate": round(counter["round_of_16_count"] / iterations, 6),
                "quarterfinal_rate": round(counter["quarterfinal_count"] / iterations, 6),
                "semifinal_rate": round(counter["semifinal_count"] / iterations, 6),
                "final_rate": round(counter["final_count"] / iterations, 6),
                "champion_rate": round(counter["champion_count"] / iterations, 6),
                "runner_up_rate": round(counter["runner_up_count"] / iterations, 6),
                "third_place_rate": round(counter["third_place_count"] / iterations, 6),
                "national_rate": round(counter["national_count"] / iterations, 6),
                "repechage_rate": round(counter["repechage_count"] / iterations, 6),
                "repechage_or_better_rate": round((counter["national_count"] + counter["repechage_count"]) / iterations, 6),
                "group_eliminated_rate": round(counter["group_eliminated_count"] / iterations, 6),
                "qualification_eliminated_rate": round(counter["qualification_eliminated_count"] / iterations, 6),
                "average_final_rank": round(average_final_rank, 6),
            }
        )
    rows.sort(
        key=lambda row: (
            -float(row["national_rate"]),
            -float(row["repechage_or_better_rate"]),
            -float(row["champion_rate"]),
            float(row["average_final_rank"]),
            -float(row["mu0"]),
        )
    )
    for index, row in enumerate(rows, start=1):
        row["mc_rank"] = index
    return rows


def run_region_monte_carlo(
    region: str,
    *,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_BASE_SEED,
    ratings_csv: Path = region_sim.DEFAULT_RATINGS_CSV,
    pair_samples: int = DEFAULT_PAIR_SAMPLES,
) -> dict[str, Any]:
    template_teams = region_sim.parse_team_rows(region, ratings_csv)
    head_to_head_index = h2h.load_head_to_head_index()
    pair_cache = build_pair_probability_cache(
        template_teams,
        pair_samples=pair_samples,
        seed=seed,
        head_to_head_index=head_to_head_index,
    )
    payload_builder = make_cached_payload_builder(pair_cache)
    counters: dict[str, dict[str, float]] = defaultdict(empty_team_counters)

    national_slot_counts: list[float] = []
    repechage_slot_counts: list[float] = []
    champion_names: list[str] = []

    for simulation_index in range(iterations):
        simulation_seed = stable_seed(seed, region, simulation_index)
        simulation = region_sim.simulate_region(
            region,
            seed=simulation_seed,
            ratings_csv=ratings_csv,
            samples=1,
            payload_builder=payload_builder,
        )
        summary = simulation["summary"]
        accumulate_simulation_counts(counters, summary["final_rankings"])
        national_slot_counts.append(float(len(summary["national_qualifiers"])))
        repechage_slot_counts.append(float(len(summary["repechage_qualifiers"])))
        champion_names.append(summary["champion"]["college_name"])

    probability_rows = build_team_probability_rows(template_teams, counters, iterations=iterations)
    champion_counter = defaultdict(int)
    for name in champion_names:
        champion_counter[name] += 1
    top_champion_rows = sorted(champion_counter.items(), key=lambda item: (-item[1], item[0]))[:10]
    summary = {
        "region": region,
        "region_slug": region_sim.REGION_CONFIGS[region]["slug"],
        "iterations": iterations,
        "seed": seed,
        "ratings_csv": str(ratings_csv),
        "pair_probability_samples": pair_samples,
        "head_to_head": h2h.configuration_payload(),
        "aggregation_mode": "single_seed",
        "aggregate_checks": {
            "sum_round_of_16_rate": round(sum(float(row["round_of_16_rate"]) for row in probability_rows), 6),
            "sum_quarterfinal_rate": round(sum(float(row["quarterfinal_rate"]) for row in probability_rows), 6),
            "sum_semifinal_rate": round(sum(float(row["semifinal_rate"]) for row in probability_rows), 6),
            "sum_final_rate": round(sum(float(row["final_rate"]) for row in probability_rows), 6),
            "sum_champion_rate": round(sum(float(row["champion_rate"]) for row in probability_rows), 6),
            "sum_national_rate": round(sum(float(row["national_rate"]) for row in probability_rows), 6),
            "sum_repechage_rate": round(sum(float(row["repechage_rate"]) for row in probability_rows), 6),
        },
        "average_slot_counts_per_run": {
            "national_slots": round(statistics.fmean(national_slot_counts), 6) if national_slot_counts else 0.0,
            "repechage_slots": round(statistics.fmean(repechage_slot_counts), 6) if repechage_slot_counts else 0.0,
        },
        "top_champion_probabilities": [
            {"college_name": college_name, "champion_rate": round(count / iterations, 6)}
            for college_name, count in top_champion_rows
        ],
    }
    return {"region": region, "probability_rows": probability_rows, "summary": summary}


def write_region_monte_carlo_outputs(result: dict[str, Any]) -> dict[str, Path]:
    region = result["region"]
    slug = region_sim.REGION_CONFIGS[region]["slug"]
    output_dir = region_sim.SIMULATION_DERIVED_DIR / slug
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "monte_carlo_team_rates.csv"
    json_path = output_dir / "monte_carlo_summary.json"
    legacy_elo.write_csv(
        csv_path,
        result["probability_rows"],
        fieldnames=[
            "mc_rank",
            "college_name",
            "team_name",
            "seed_tier",
            "seed_rank_in_region",
            "mu0",
            "sigma0",
            "round_of_16_rate",
            "quarterfinal_rate",
            "semifinal_rate",
            "final_rate",
            "champion_rate",
            "runner_up_rate",
            "third_place_rate",
            "national_rate",
            "repechage_rate",
            "repechage_or_better_rate",
            "group_eliminated_rate",
            "qualification_eliminated_rate",
            "average_final_rank",
        ],
    )
    legacy_elo.write_json(json_path, result["summary"])
    return {"output_dir": output_dir, "csv_path": csv_path, "json_path": json_path}


def main() -> None:
    args = parse_args()
    result = run_region_monte_carlo(
        args.region,
        iterations=args.iterations,
        seed=args.seed,
        ratings_csv=args.ratings_csv,
        pair_samples=args.pair_samples,
    )
    paths = write_region_monte_carlo_outputs(result)
    print(paths["csv_path"])
    print(paths["json_path"])


if __name__ == "__main__":
    main()
