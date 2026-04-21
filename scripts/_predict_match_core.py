#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import build_rmuc_elo as elo_model


DEFAULT_RATINGS_CSV = elo_model.DERIVED_DIR / "preseason_ratings.csv"
ENABLE_HEAD_TO_HEAD = False
HISTORICAL_MATCH_PATHS = [
    elo_model.ROOT / "data" / "extracted" / "2024RMUC" / "matches.csv",
    elo_model.ROOT / "data" / "extracted" / "2025RMUC" / "matches.csv",
    elo_model.ROOT / "data" / "extracted" / "2026RMUL" / "matches.csv",
]
H2H_MATCH_WEIGHTS = {
    "2024RMUC": 0.75,
    "2025RMUC": 1.00,
    "2026RMUL": 0.35,
}
DEFAULT_MONTE_CARLO_SAMPLES = 20_000
DEFAULT_MONTE_CARLO_SEED = 20260414
MATCHUP_ELO_SCALE = 320.0
MATCHUP_SIGMA_FACTOR = 0.5


def load_ratings(path: Path) -> dict[str, dict[str, str]]:
    rows = elo_model.read_csv(path)
    by_school: dict[str, dict[str, str]] = {}
    duplicates: list[str] = []
    for row in rows:
        school_name = elo_model.normalize_school(row["college_name"])
        if school_name in by_school:
            duplicates.append(school_name)
            continue
        by_school[school_name] = row
    if duplicates:
        duplicate_text = ", ".join(sorted(set(duplicates)))
        raise ValueError(f"Duplicate schools in ratings table: {duplicate_text}")
    return by_school


def suggest_school_names(query: str, choices: list[str]) -> list[str]:
    normalized_query = elo_model.normalize_school(query)
    exact_substring = [choice for choice in choices if normalized_query in choice or choice in normalized_query]
    if exact_substring:
        return exact_substring[:5]
    return difflib.get_close_matches(normalized_query, choices, n=5, cutoff=0.4)


def resolve_school_row(school_name: str, ratings_by_school: dict[str, dict[str, str]]) -> dict[str, str]:
    normalized = elo_model.normalize_school(school_name)
    row = ratings_by_school.get(normalized)
    if row is not None:
        return row
    suggestions = suggest_school_names(normalized, sorted(ratings_by_school))
    if suggestions:
        raise ValueError(f"School not found: {school_name}. Did you mean: {', '.join(suggestions)}")
    raise ValueError(f"School not found: {school_name}")


def load_head_to_head_index() -> dict[tuple[str, str], dict[str, Any]]:
    if not ENABLE_HEAD_TO_HEAD:
        return {}
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for path in HISTORICAL_MATCH_PATHS:
        season_key = path.parent.name
        weight = H2H_MATCH_WEIGHTS[season_key]
        for row in elo_model.read_csv(path):
            school_a = elo_model.normalize_school(row["red_college_name"])
            school_b = elo_model.normalize_school(row["blue_college_name"])
            pair_key = tuple(sorted((school_a, school_b)))
            if pair_key not in index:
                index[pair_key] = {
                    "meetings_count": 0,
                    "school_weights": defaultdict(float),
                    "season_counts": Counter(),
                    "season_weights": defaultdict(float),
                    "weighted_ties": 0.0,
                }
            summary = index[pair_key]
            summary["meetings_count"] += 1
            summary["season_counts"][season_key] += 1
            summary["season_weights"][season_key] += weight
            if row["result"] == "TIE":
                summary["school_weights"][school_a] += 0.5 * weight
                summary["school_weights"][school_b] += 0.5 * weight
                summary["weighted_ties"] += weight
                continue
            if row["winner_side"] == "red":
                winner_school = school_a
            elif row["winner_side"] == "blue":
                winner_school = school_b
            else:
                continue
            summary["school_weights"][winner_school] += weight
    return index


def compute_head_to_head_delta_from_weights(weight_a: float, weight_b: float) -> dict[str, float]:
    n_eff = weight_a + weight_b
    if n_eff <= 0.0:
        return {
            "p_h2h": 0.5,
            "edge": 0.0,
            "reliability": 0.0,
            "delta_h2h": 0.0,
            "effective_meeting_weight": 0.0,
        }
    p_h2h = (1.0 + weight_a) / (2.0 + n_eff)
    edge = p_h2h - 0.5
    reliability = min(n_eff / 4.0, 1.0)
    delta_h2h = elo_model.clip(edge * reliability * 0.16, -0.04, 0.04)
    return {
        "p_h2h": p_h2h,
        "edge": edge,
        "reliability": reliability,
        "delta_h2h": delta_h2h,
        "effective_meeting_weight": n_eff,
    }


def summarize_head_to_head(
    school_a: str,
    school_b: str,
    head_to_head_index: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    pair_key = tuple(sorted((school_a, school_b)))
    raw = head_to_head_index.get(pair_key)
    if raw is None:
        return {
            "enabled": ENABLE_HEAD_TO_HEAD,
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
        }
    weight_a = float(raw["school_weights"].get(school_a, 0.0))
    weight_b = float(raw["school_weights"].get(school_b, 0.0))
    delta = compute_head_to_head_delta_from_weights(weight_a, weight_b)
    return {
        "enabled": ENABLE_HEAD_TO_HEAD,
        "meetings_count": int(raw["meetings_count"]),
        "effective_meeting_weight": round(delta["effective_meeting_weight"], 6),
        "weighted_record": {
            "school_a_weighted_wins": round(weight_a, 6),
            "school_b_weighted_wins": round(weight_b, 6),
            "weighted_ties": round(float(raw["weighted_ties"]), 6),
        },
        "sources_used": sorted(raw["season_counts"].keys()),
        "season_counts": dict(sorted(raw["season_counts"].items())),
        "season_weights": {key: round(float(value), 6) for key, value in sorted(raw["season_weights"].items())},
        "p_h2h": round(delta["p_h2h"], 6),
        "reliability": round(delta["reliability"], 6),
        "delta_h2h": round(delta["delta_h2h"], 6),
    }


def matchup_logistic_expectation(delta: float, *, elo_scale: float = MATCHUP_ELO_SCALE) -> float:
    return 1.0 / (1.0 + 10.0 ** (-delta / elo_scale))


def monte_carlo_single_game_probability(
    mu_a: float,
    sigma_a: float,
    mu_b: float,
    sigma_b: float,
    *,
    samples: int = DEFAULT_MONTE_CARLO_SAMPLES,
    seed: int = DEFAULT_MONTE_CARLO_SEED,
    elo_scale: float = MATCHUP_ELO_SCALE,
    sigma_factor: float = MATCHUP_SIGMA_FACTOR,
) -> float:
    rng = random.Random(seed)
    delta_mu = mu_a - mu_b
    delta_sigma = math.sqrt((sigma_a ** 2) + (sigma_b ** 2)) * sigma_factor
    total = 0.0
    for _ in range(samples):
        sampled_delta = rng.gauss(delta_mu, delta_sigma)
        total += matchup_logistic_expectation(sampled_delta, elo_scale=elo_scale)
    return total / samples


def compute_scoreline_distribution(best_of: int, p_game_a: float) -> dict[str, float]:
    p_game_b = 1.0 - p_game_a
    if best_of == 3:
        return {
            "2:0": p_game_a ** 2,
            "2:1": 2.0 * (p_game_a ** 2) * p_game_b,
            "1:2": 2.0 * p_game_a * (p_game_b ** 2),
            "0:2": p_game_b ** 2,
        }
    if best_of == 5:
        return {
            "3:0": p_game_a ** 3,
            "3:1": 3.0 * (p_game_a ** 3) * p_game_b,
            "3:2": 6.0 * (p_game_a ** 3) * (p_game_b ** 2),
            "2:3": 6.0 * (p_game_a ** 2) * (p_game_b ** 3),
            "1:3": 3.0 * p_game_a * (p_game_b ** 3),
            "0:3": p_game_b ** 3,
        }
    raise ValueError(f"Unsupported best_of: {best_of}")


def classify_confidence(row_a: dict[str, str], row_b: dict[str, str]) -> str:
    sigma_a = float(row_a["sigma0"])
    sigma_b = float(row_b["sigma0"])
    max_sigma = max(sigma_a, sigma_b)
    min_rmuc_matches = min(int(row_a["n_matches_2025_rmuc"]), int(row_b["n_matches_2025_rmuc"]))
    if max_sigma <= 58.0 and min_rmuc_matches >= 8:
        return "high"
    if max_sigma <= 72.0:
        return "medium"
    return "low"


def build_feature_deltas(row_a: dict[str, str], row_b: dict[str, str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for name in ["mu0", "sigma0", "z_25game", "z_robot25_raw", "z_26rmul", "z_form", "tilde_z_hist"]:
        out[name] = round(float(row_a[name]) - float(row_b[name]), 6)
    out["n_matches_2025_rmuc"] = int(row_a["n_matches_2025_rmuc"]) - int(row_b["n_matches_2025_rmuc"])
    out["n_matches_2026_rmul"] = int(row_a["n_matches_2026_rmul"]) - int(row_b["n_matches_2026_rmul"])
    out["robot_stage_reliability"] = round(
        float(row_a["robot_stage_reliability"]) - float(row_b["robot_stage_reliability"]),
        6,
    )
    return out


def summarize_feature_edges(feature_deltas: dict[str, float], school_a: str, school_b: str) -> str:
    label_map = {
        "z_25game": "2025RMUC实战",
        "z_robot25_raw": "robot工程质量",
        "z_26rmul": "RMUL近期状态",
        "z_form": "完整形态",
        "tilde_z_hist": "学校历史底蕴",
    }
    ranked = sorted(label_map, key=lambda key: abs(feature_deltas[key]), reverse=True)[:2]
    parts = []
    for key in ranked:
        diff = feature_deltas[key]
        if abs(diff) < 1e-9:
            continue
        leader = school_a if diff > 0 else school_b
        parts.append(f"{label_map[key]}偏向{leader}({abs(diff):.3f})")
    return "；".join(parts) if parts else "主要先验差异不明显"


def predict_matchup(
    school_a: str,
    school_b: str,
    *,
    best_of: int,
    ratings_csv: Path = DEFAULT_RATINGS_CSV,
    samples: int = DEFAULT_MONTE_CARLO_SAMPLES,
    seed: int = DEFAULT_MONTE_CARLO_SEED,
) -> dict[str, Any]:
    ratings_by_school = load_ratings(ratings_csv)
    row_a = resolve_school_row(school_a, ratings_by_school)
    row_b = resolve_school_row(school_b, ratings_by_school)
    resolved_a = elo_model.normalize_school(row_a["college_name"])
    resolved_b = elo_model.normalize_school(row_b["college_name"])
    if resolved_a == resolved_b:
        raise ValueError("school-a and school-b resolve to the same school")

    mu_a = float(row_a["mu0"])
    mu_b = float(row_b["mu0"])
    sigma_a = float(row_a["sigma0"])
    sigma_b = float(row_b["sigma0"])
    p_game_base_a = monte_carlo_single_game_probability(mu_a, sigma_a, mu_b, sigma_b, samples=samples, seed=seed)

    head_to_head_index = load_head_to_head_index()
    head_to_head_summary = summarize_head_to_head(resolved_a, resolved_b, head_to_head_index)
    delta_h2h = float(head_to_head_summary["delta_h2h"])
    p_game_adj_a = elo_model.clip(p_game_base_a + delta_h2h, 0.05, 0.95)
    raw_scoreline_distribution = compute_scoreline_distribution(best_of, p_game_adj_a)
    p_series_a = round(
        sum(
            probability
            for score, probability in raw_scoreline_distribution.items()
            if int(score.split(":")[0]) > int(score.split(":")[1])
        ),
        6,
    )
    p_series_b = round(1.0 - p_series_a, 6)
    scoreline_distribution = {
        score: round(probability, 6)
        for score, probability in raw_scoreline_distribution.items()
    }
    feature_deltas = build_feature_deltas(row_a, row_b)
    confidence_label = classify_confidence(row_a, row_b)
    predicted_winner = resolved_a if p_series_a >= p_series_b else resolved_b

    return {
        "team_a": {
            "school_name": resolved_a,
            "team_name": row_a["team_name"],
            "mu0": round(mu_a, 6),
            "sigma0": round(sigma_a, 6),
        },
        "team_b": {
            "school_name": resolved_b,
            "team_name": row_b["team_name"],
            "mu0": round(mu_b, 6),
            "sigma0": round(sigma_b, 6),
        },
        "best_of": best_of,
        "p_game_base_a": round(p_game_base_a, 6),
        "p_game_base_b": round(1.0 - p_game_base_a, 6),
        "p_game_adj_a": round(p_game_adj_a, 6),
        "p_game_adj_b": round(1.0 - p_game_adj_a, 6),
        "p_series_a": p_series_a,
        "p_series_b": p_series_b,
        "scoreline_distribution": scoreline_distribution,
        "predicted_winner": predicted_winner,
        "head_to_head_summary": head_to_head_summary,
        "feature_deltas": feature_deltas,
        "confidence_label": confidence_label,
        "explanation_summary": {
            "elo_diff": round(mu_a - mu_b, 6),
            "top_feature_edges": summarize_feature_edges(feature_deltas, resolved_a, resolved_b),
        },
    }


def render_text_prediction(prediction: dict[str, Any]) -> str:
    team_a = prediction["team_a"]
    team_b = prediction["team_b"]
    head_to_head = prediction["head_to_head_summary"]
    winner = prediction["predicted_winner"]
    lines = [
        f"{team_a['school_name']} vs {team_b['school_name']} | BO{prediction['best_of']}",
        (
            f"Elo: {team_a['school_name']} {team_a['mu0']:.3f} (sigma {team_a['sigma0']:.3f}) | "
            f"{team_b['school_name']} {team_b['mu0']:.3f} (sigma {team_b['sigma0']:.3f})"
        ),
        (
            f"Single game win prob: {team_a['school_name']} {prediction['p_game_base_a']:.3%} "
            f"-> adjusted {prediction['p_game_adj_a']:.3%}"
        ),
        (
            f"Series win prob: {team_a['school_name']} {prediction['p_series_a']:.3%} | "
            f"{team_b['school_name']} {prediction['p_series_b']:.3%}"
        ),
        (
            "Head-to-head: disabled by default"
            if not head_to_head.get("enabled", True)
            else (
                f"Head-to-head: meetings={head_to_head['meetings_count']}, "
                f"effective_weight={head_to_head['effective_meeting_weight']:.3f}, "
                f"delta_h2h={head_to_head['delta_h2h']:+.3%}, sources={','.join(head_to_head['sources_used']) or 'none'}"
            )
        ),
        f"Predicted winner: {winner}",
        (
            f"Explanation: Elo diff {prediction['explanation_summary']['elo_diff']:+.3f}; "
            f"{prediction['explanation_summary']['top_feature_edges']}; "
            f"confidence={prediction['confidence_label']}"
        ),
    ]
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict a RMUC BO3/BO5 matchup from preseason Elo priors.")
    parser.add_argument("--school-a", required=True, help="School name for side A.")
    parser.add_argument("--school-b", required=True, help="School name for side B.")
    parser.add_argument("--best-of", required=True, type=int, choices=[3, 5], help="Series length: 3 or 5.")
    parser.add_argument("--ratings-csv", type=Path, default=DEFAULT_RATINGS_CSV, help="Path to preseason_ratings.csv.")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format.")
    parser.add_argument("--samples", type=int, default=DEFAULT_MONTE_CARLO_SAMPLES, help="Monte Carlo samples.")
    parser.add_argument("--seed", type=int, default=DEFAULT_MONTE_CARLO_SEED, help="Monte Carlo random seed.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        prediction = predict_matchup(
            args.school_a,
            args.school_b,
            best_of=args.best_of,
            ratings_csv=args.ratings_csv,
            samples=args.samples,
            seed=args.seed,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if args.format == "json":
        print(json.dumps(prediction, ensure_ascii=False, indent=2))
        return
    print(render_text_prediction(prediction))


if __name__ == "__main__":
    main()
