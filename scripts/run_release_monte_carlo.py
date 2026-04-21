#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import statistics
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import simulate_region as region_sim
import simulate_region_monte_carlo as region_mc


REGION_ORDER = ["南部赛区", "东部赛区", "北部赛区"]
RATE_FIELDS = [
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
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run release Monte Carlo outputs with multiple seeds per region.")
    parser.add_argument("--iterations-per-seed", type=int, default=5000, help="Tournament simulations for each seed.")
    parser.add_argument("--seed-count", type=int, default=20, help="Number of seeds to aggregate.")
    parser.add_argument("--base-seed", type=int, default=20260414, help="Base seed used to generate seed list.")
    parser.add_argument("--seed-step", type=int, default=7, help="Step used to generate seed list.")
    parser.add_argument("--pair-samples", type=int, default=4000, help="Pair probability samples.")
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, min(6, os.cpu_count() or 1)),
        help="Process count for per-seed parallel runs in each region.",
    )
    parser.add_argument(
        "--regions",
        nargs="+",
        choices=REGION_ORDER,
        default=REGION_ORDER,
        help="Regions to run.",
    )
    return parser.parse_args()


def build_seeds(base_seed: int, seed_count: int, seed_step: int) -> list[int]:
    return [base_seed + index * seed_step for index in range(seed_count)]


def run_one_seed(
    region: str,
    seed: int,
    iterations_per_seed: int,
    pair_samples: int,
) -> dict[str, Any]:
    return region_mc.run_region_monte_carlo(
        region,
        iterations=iterations_per_seed,
        seed=seed,
        pair_samples=pair_samples,
    )


def aggregate_seed_results(
    region: str,
    seed_results: list[dict[str, Any]],
    *,
    seeds: list[int],
    iterations_per_seed: int,
    pair_samples: int,
) -> dict[str, Any]:
    team_sums: dict[tuple[str, str], dict[str, Any]] = {}
    national_slot_counts: list[float] = []
    repechage_slot_counts: list[float] = []

    for seed_result in seed_results:
        summary = seed_result["summary"]
        slot_stats = summary.get("average_slot_counts_per_run", {})
        national_slot_counts.append(float(slot_stats.get("national_slots", 0.0)))
        repechage_slot_counts.append(float(slot_stats.get("repechage_slots", 0.0)))

        for row in seed_result["probability_rows"]:
            key = (row["college_name"], row["team_name"])
            if key not in team_sums:
                team_sums[key] = {
                    "college_name": row["college_name"],
                    "team_name": row["team_name"],
                    "seed_tier": row["seed_tier"],
                    "seed_rank_in_region": int(row["seed_rank_in_region"]),
                    "mu0": float(row["mu0"]),
                    "sigma0": float(row["sigma0"]),
                    **{field: 0.0 for field in RATE_FIELDS},
                }
            acc = team_sums[key]
            for field in RATE_FIELDS:
                acc[field] += float(row[field])

    seed_count = len(seed_results)
    if seed_count == 0:
        raise ValueError(f"No seed results to aggregate for region={region}")

    rows: list[dict[str, Any]] = []
    for acc in team_sums.values():
        row: dict[str, Any] = {
            "college_name": acc["college_name"],
            "team_name": acc["team_name"],
            "seed_tier": acc["seed_tier"],
            "seed_rank_in_region": acc["seed_rank_in_region"],
            "mu0": round(acc["mu0"], 6),
            "sigma0": round(acc["sigma0"], 6),
        }
        for field in RATE_FIELDS:
            row[field] = round(acc[field] / seed_count, 6)
        rows.append(row)

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

    champion_by_college: dict[str, float] = defaultdict(float)
    for row in rows:
        champion_by_college[row["college_name"]] += float(row["champion_rate"])

    top_champion_probabilities = [
        {
            "college_name": college_name,
            "champion_rate": round(champion_rate, 6),
        }
        for college_name, champion_rate in sorted(champion_by_college.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]

    ratings_csv = seed_results[0]["summary"]["ratings_csv"]
    summary = {
        "region": region,
        "region_slug": region_sim.REGION_CONFIGS[region]["slug"],
        "iterations_per_seed": iterations_per_seed,
        "seed_count": seed_count,
        "effective_iterations": iterations_per_seed * seed_count,
        "seeds": seeds,
        "ratings_csv": ratings_csv,
        "pair_probability_samples": pair_samples,
        "aggregation_mode": "mean_of_seed_runs",
        "aggregate_checks": {
            "sum_round_of_16_rate": round(sum(float(row["round_of_16_rate"]) for row in rows), 6),
            "sum_quarterfinal_rate": round(sum(float(row["quarterfinal_rate"]) for row in rows), 6),
            "sum_semifinal_rate": round(sum(float(row["semifinal_rate"]) for row in rows), 6),
            "sum_final_rate": round(sum(float(row["final_rate"]) for row in rows), 6),
            "sum_champion_rate": round(sum(float(row["champion_rate"]) for row in rows), 6),
            "sum_national_rate": round(sum(float(row["national_rate"]) for row in rows), 6),
            "sum_repechage_rate": round(sum(float(row["repechage_rate"]) for row in rows), 6),
        },
        "average_slot_counts_per_run": {
            "national_slots": round(statistics.fmean(national_slot_counts), 6),
            "repechage_slots": round(statistics.fmean(repechage_slot_counts), 6),
        },
        "top_champion_probabilities": top_champion_probabilities,
    }

    result = {
        "region": region,
        "probability_rows": rows,
        "summary": summary,
    }
    return result


def run_release_outputs(
    *,
    iterations_per_seed: int,
    seeds: list[int],
    pair_samples: int,
    workers: int,
    regions: list[str],
) -> None:
    print(f"Seeds: {seeds}", flush=True)
    print(f"iterations_per_seed={iterations_per_seed}, seed_count={len(seeds)}, effective={iterations_per_seed * len(seeds)}", flush=True)
    print(f"pair_samples={pair_samples}, workers={workers}", flush=True)

    for region in regions:
        print(f"\\n[START] {region}", flush=True)
        seed_results: list[dict[str, Any]] = []

        with ProcessPoolExecutor(max_workers=workers) as executor:
            future_map = {
                executor.submit(run_one_seed, region, seed, iterations_per_seed, pair_samples): seed for seed in seeds
            }
            for future in as_completed(future_map):
                seed = future_map[future]
                seed_result = future.result()
                seed_results.append(seed_result)
                print(f"  finished seed={seed}", flush=True)

        seed_results.sort(key=lambda result: int(result["summary"]["seed"]))
        result = aggregate_seed_results(
            region,
            seed_results,
            seeds=seeds,
            iterations_per_seed=iterations_per_seed,
            pair_samples=pair_samples,
        )
        paths = region_mc.write_region_monte_carlo_outputs(result)
        print(f"[DONE] {region} -> {paths['output_dir']}", flush=True)

    print("\\nAll regions done.", flush=True)


def main() -> None:
    args = parse_args()
    seeds = build_seeds(args.base_seed, args.seed_count, args.seed_step)
    run_release_outputs(
        iterations_per_seed=args.iterations_per_seed,
        seeds=seeds,
        pair_samples=args.pair_samples,
        workers=args.workers,
        regions=args.regions,
    )


if __name__ == "__main__":
    main()
