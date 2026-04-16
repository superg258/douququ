from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as elo_model  # noqa: E402
import predict_match as predictor  # noqa: E402
import simulate_region as region_sim  # noqa: E402
import simulate_region_monte_carlo as region_mc  # noqa: E402


class SimulateRegionMonteCarloTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        outputs = elo_model.build_outputs()
        elo_model.write_outputs(outputs)
        cls.ratings_path = predictor.DEFAULT_RATINGS_CSV

    def test_run_region_monte_carlo_probability_mass(self) -> None:
        result = region_mc.run_region_monte_carlo(
            "东部赛区",
            iterations=20,
            seed=77,
            ratings_csv=self.ratings_path,
            pair_samples=300,
        )
        rows = result["probability_rows"]
        self.assertEqual(len(rows), 32)
        summary = result["summary"]["aggregate_checks"]
        self.assertAlmostEqual(summary["sum_round_of_16_rate"], 16.0, places=4)
        self.assertAlmostEqual(summary["sum_quarterfinal_rate"], 8.0, places=4)
        self.assertAlmostEqual(summary["sum_semifinal_rate"], 4.0, places=4)
        self.assertAlmostEqual(summary["sum_final_rate"], 2.0, places=4)
        self.assertAlmostEqual(summary["sum_champion_rate"], 1.0, places=4)
        self.assertAlmostEqual(
            summary["sum_national_rate"],
            region_sim.REGION_CONFIGS["东部赛区"]["national_slots"],
            places=4,
        )
        self.assertAlmostEqual(
            summary["sum_repechage_rate"],
            region_sim.REGION_CONFIGS["东部赛区"]["repechage_slots"],
            places=4,
        )
        for row in rows:
            for key in [
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
            ]:
                self.assertGreaterEqual(float(row[key]), 0.0)
                self.assertLessEqual(float(row[key]), 1.0)

    def test_write_region_monte_carlo_outputs(self) -> None:
        result = region_mc.run_region_monte_carlo(
            "东部赛区",
            iterations=12,
            seed=88,
            ratings_csv=self.ratings_path,
            pair_samples=200,
        )
        paths = region_mc.write_region_monte_carlo_outputs(result)
        for path in paths.values():
            self.assertTrue(path.exists(), msg=str(path))


if __name__ == "__main__":
    unittest.main()
