from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as elo_model  # noqa: E402
import predict_match as predictor  # noqa: E402


def series_win_probability(best_of: int, p_game: float) -> float:
    distribution = predictor.compute_scoreline_distribution(best_of, p_game)
    return sum(
        probability
        for scoreline, probability in distribution.items()
        if int(scoreline.split(":")[0]) > int(scoreline.split(":")[1])
    )


class PredictMatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        outputs = elo_model.build_outputs()
        elo_model.write_outputs(outputs)
        cls.ratings_path = predictor.DEFAULT_RATINGS_CSV

    def test_resolve_school_alias(self) -> None:
        ratings = predictor.load_ratings(self.ratings_path)
        row = predictor.resolve_school_row("北京理工大学（珠海）", ratings)
        self.assertEqual(row["college_name"], "北京理工大学珠海学院")

    def test_unknown_school_raises_with_suggestion(self) -> None:
        ratings = predictor.load_ratings(self.ratings_path)
        with self.assertRaisesRegex(ValueError, "School not found"):
            predictor.resolve_school_row("上海交大", ratings)

    def test_probabilities_sum_to_one(self) -> None:
        prediction = predictor.predict_matchup(
            "上海交通大学",
            "东北大学",
            best_of=3,
            samples=4000,
            seed=7,
        )
        self.assertAlmostEqual(prediction["p_game_adj_a"] + prediction["p_game_adj_b"], 1.0, places=6)
        self.assertAlmostEqual(prediction["p_series_a"] + prediction["p_series_b"], 1.0, places=6)
        self.assertAlmostEqual(sum(prediction["scoreline_distribution"].values()), 1.0, places=4)

    def test_scoreline_distribution_sums_to_one_for_supported_series(self) -> None:
        for best_of, expected_scores in [
            (3, {"2:0", "2:1", "1:2", "0:2"}),
            (5, {"3:0", "3:1", "3:2", "2:3", "1:3", "0:3"}),
        ]:
            distribution = predictor.compute_scoreline_distribution(best_of, 0.67)
            self.assertEqual(set(distribution), expected_scores)
            self.assertAlmostEqual(sum(distribution.values()), 1.0, places=9)

    def test_prediction_is_stable_with_fixed_seed(self) -> None:
        first = predictor.predict_matchup("上海交通大学", "东北大学", best_of=5, samples=4000, seed=123)
        second = predictor.predict_matchup("上海交通大学", "东北大学", best_of=5, samples=4000, seed=123)
        self.assertEqual(first, second)

    def test_matchup_probability_targets_for_equal_sigma(self) -> None:
        expectations = {
            100: {"bo3": (0.74, 0.75), "bo5": (0.79, 0.80)},
            150: {"bo3": (0.83, 0.84), "bo5": (0.88, 0.89)},
            200: {"bo3": (0.89, 0.91), "bo5": (0.94, 0.95)},
        }
        for delta_mu, windows in expectations.items():
            p_game = predictor.monte_carlo_single_game_probability(
                1500.0 + delta_mu,
                50.0,
                1500.0,
                50.0,
                samples=120_000,
                seed=20260414,
            )
            p_bo3 = series_win_probability(3, p_game)
            p_bo5 = series_win_probability(5, p_game)
            self.assertGreaterEqual(p_bo3, windows["bo3"][0], msg=f"delta_mu={delta_mu}")
            self.assertLessEqual(p_bo3, windows["bo3"][1], msg=f"delta_mu={delta_mu}")
            self.assertGreaterEqual(p_bo5, windows["bo5"][0], msg=f"delta_mu={delta_mu}")
            self.assertLessEqual(p_bo5, windows["bo5"][1], msg=f"delta_mu={delta_mu}")

    def test_new_mapping_is_more_decisive_than_legacy_baseline(self) -> None:
        cases = [
            (100.0, 50.0, 50.0),
            (150.0, 50.0, 50.0),
            (200.0, 50.0, 90.0),
            (250.0, 50.0, 90.0),
        ]
        for delta_mu, sigma_a, sigma_b in cases:
            modern = predictor.monte_carlo_single_game_probability(
                1500.0 + delta_mu,
                sigma_a,
                1500.0,
                sigma_b,
                samples=80_000,
                seed=20260414,
            )
            legacy = predictor.monte_carlo_single_game_probability(
                1500.0 + delta_mu,
                sigma_a,
                1500.0,
                sigma_b,
                samples=80_000,
                seed=20260414,
                elo_scale=400.0,
                sigma_factor=1.0,
            )
            self.assertGreater(modern, legacy, msg=f"delta_mu={delta_mu}, sigmas=({sigma_a}, {sigma_b})")

    def test_h2h_delta_zero_for_pair_without_history(self) -> None:
        ratings = predictor.load_ratings(self.ratings_path)
        schools = sorted(ratings)
        h2h_index = predictor.load_head_to_head_index()
        missing_pair = None
        for left in schools:
            for right in schools:
                if left >= right:
                    continue
                if tuple(sorted((left, right))) not in h2h_index:
                    missing_pair = (left, right)
                    break
            if missing_pair is not None:
                break
        self.assertIsNotNone(missing_pair)
        summary = predictor.summarize_head_to_head(missing_pair[0], missing_pair[1], h2h_index)
        self.assertEqual(summary["meetings_count"], 0)
        self.assertEqual(summary["delta_h2h"], 0.0)

    def test_rmuc_h2h_adjustment_stronger_than_rmul(self) -> None:
        rmuc_delta = predictor.compute_head_to_head_delta_from_weights(1.0, 0.0)["delta_h2h"]
        rmul_delta = predictor.compute_head_to_head_delta_from_weights(0.35, 0.0)["delta_h2h"]
        self.assertGreater(rmuc_delta, rmul_delta)

    def test_h2h_delta_is_capped(self) -> None:
        dominant_delta = predictor.compute_head_to_head_delta_from_weights(100.0, 0.0)["delta_h2h"]
        self.assertLessEqual(dominant_delta, 0.04)

    def test_cli_json_output(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "predict_match.py"),
                "--school-a",
                "上海交通大学",
                "--school-b",
                "东北大学",
                "--best-of",
                "3",
                "--format",
                "json",
                "--samples",
                "4000",
                "--seed",
                "42",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
        self.assertIn("team_a", payload)
        self.assertIn("team_b", payload)
        self.assertIn("head_to_head_summary", payload)
        self.assertIn("scoreline_distribution", payload)

    def test_cli_rejects_invalid_best_of(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "predict_match.py"),
                "--school-a",
                "上海交通大学",
                "--school-b",
                "东北大学",
                "--best-of",
                "7",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
