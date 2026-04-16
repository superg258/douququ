from __future__ import annotations

import random
import sys
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as elo_model  # noqa: E402
import predict_match as predictor  # noqa: E402
import simulate_region as region_sim  # noqa: E402


def legacy_prediction_payload(
    red_team: region_sim.RegionTeam,
    blue_team: region_sim.RegionTeam,
    *,
    best_of: int,
    samples: int,
    match_seed: int,
    head_to_head_index: dict[tuple[str, str], dict[str, object]],
) -> dict[str, object]:
    p_game_base_red = predictor.monte_carlo_single_game_probability(
        red_team.mu0,
        red_team.sigma0,
        blue_team.mu0,
        blue_team.sigma0,
        samples=samples,
        seed=match_seed,
        elo_scale=400.0,
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
        if int(scoreline.split(":")[0]) > int(scoreline.split(":")[1])
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


class SimulateRegionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        outputs = elo_model.build_outputs()
        elo_model.write_outputs(outputs)
        cls.ratings_path = predictor.DEFAULT_RATINGS_CSV

    def test_parse_region_counts(self) -> None:
        teams = region_sim.parse_team_rows("东部赛区", self.ratings_path)
        self.assertEqual(len(teams), 32)
        self.assertEqual(
            Counter(team.seed_tier for team in teams),
            Counter({"tier1": 8, "tier2": 8, "unseeded": 16}),
        )

    def test_slot_assignment_respects_draw_boxes(self) -> None:
        teams = region_sim.parse_team_rows("东部赛区", self.ratings_path)
        rows = region_sim.assign_region_slots(teams, random.Random(7))
        self.assertEqual(len(rows), 32)
        slots = [row["slot"] for row in rows]
        self.assertEqual(len(slots), len(set(slots)))
        self.assertEqual(Counter(slot[0] for slot in slots), Counter({"A": 16, "B": 16}))

        tier1_rows = [row for row in rows if row["seed_tier"] == "tier1"]
        self.assertTrue(all(row["slot"] in region_sim.TIER1_SLOTS for row in tier1_rows))

        group_tier_counts = {
            group_name: Counter(row["seed_tier"] for row in rows if row["group_name"] == group_name)
            for group_name in ["A", "B"]
        }
        self.assertEqual(group_tier_counts["A"], Counter({"tier1": 4, "tier2": 4, "unseeded": 8}))
        self.assertEqual(group_tier_counts["B"], Counter({"tier1": 4, "tier2": 4, "unseeded": 8}))

    def test_tournament_strengths_are_seeded_and_bounded(self) -> None:
        first = region_sim.parse_team_rows("东部赛区", self.ratings_path)
        second = region_sim.parse_team_rows("东部赛区", self.ratings_path)
        rng_a = random.Random(17)
        rng_b = random.Random(17)
        region_sim.assign_region_slots(first, rng_a)
        region_sim.assign_region_slots(second, rng_b)
        region_sim.assign_tournament_strengths(first, rng_a)
        region_sim.assign_tournament_strengths(second, rng_b)

        shifted = 0
        for team_a, team_b in zip(first, second, strict=True):
            self.assertEqual(team_a.team_key, team_b.team_key)
            self.assertAlmostEqual(team_a.simulation_mu, team_b.simulation_mu, places=6)
            self.assertAlmostEqual(team_a.match_sigma, team_b.match_sigma, places=6)
            self.assertLessEqual(
                abs(team_a.simulation_mu - team_a.mu0),
                team_a.sigma0 * region_sim.TOURNAMENT_LATENT_SIGMA_CLIP + 1e-9,
            )
            self.assertAlmostEqual(
                team_a.match_sigma,
                max(team_a.sigma0 * region_sim.TOURNAMENT_MATCH_SIGMA_FACTOR, region_sim.TOURNAMENT_MATCH_SIGMA_FLOOR),
                places=6,
            )
            if abs(team_a.simulation_mu - team_a.mu0) > 1e-6:
                shifted += 1
        self.assertGreater(shifted, 0)

    def test_simulation_is_reproducible_with_fixed_seed(self) -> None:
        first = region_sim.simulate_region("东部赛区", seed=123, ratings_csv=self.ratings_path, samples=300)
        second = region_sim.simulate_region("东部赛区", seed=123, ratings_csv=self.ratings_path, samples=300)
        self.assertEqual(first["slot_rows"], second["slot_rows"])
        self.assertEqual(first["match_rows"], second["match_rows"])
        self.assertEqual(first["summary"], second["summary"])

    def test_swiss_resolution_and_round_bounds(self) -> None:
        simulation = region_sim.simulate_region("东部赛区", seed=5, ratings_csv=self.ratings_path, samples=250)
        swiss_rows = [row for row in simulation["match_rows"] if row["stage"] == "swiss"]
        self.assertLessEqual(max(row["round_number"] for row in swiss_rows), 5)
        self.assertTrue(all(row["best_of"] == 3 for row in swiss_rows))

        for group_name, group_rows in simulation["summary"]["group_rankings"].items():
            self.assertEqual(len(group_rows), 16, msg=group_name)
            qualified = [row for row in group_rows if row["status"] == "qualified"]
            eliminated = [row for row in group_rows if row["status"] == "eliminated"]
            self.assertEqual(len(qualified), 8, msg=group_name)
            self.assertEqual(len(eliminated), 8, msg=group_name)
            self.assertTrue(all((row["wins"] == 3) or (row["losses"] == 3) for row in group_rows))

    def test_region_quotas_match_configuration(self) -> None:
        for region_name, config in region_sim.REGION_CONFIGS.items():
            simulation = region_sim.simulate_region(region_name, seed=9, ratings_csv=self.ratings_path, samples=180)
            summary = simulation["summary"]
            self.assertEqual(len(summary["national_qualifiers"]), config["national_slots"], msg=region_name)
            self.assertEqual(len(summary["repechage_qualifiers"]), config["repechage_slots"], msg=region_name)

    def test_probabilities_and_scorelines_are_valid(self) -> None:
        simulation = region_sim.simulate_region("东部赛区", seed=19, ratings_csv=self.ratings_path, samples=220)
        valid_bo3 = {"2:0", "2:1", "1:2", "0:2"}
        valid_bo5 = {"3:0", "3:1", "3:2", "2:3", "1:3", "0:3"}
        for row in simulation["match_rows"]:
            self.assertAlmostEqual(row["p_game_red"] + row["p_game_blue"], 1.0, places=6)
            self.assertAlmostEqual(row["p_series_red"] + row["p_series_blue"], 1.0, places=6)
            valid = valid_bo3 if row["best_of"] == 3 else valid_bo5
            self.assertIn(row["scoreline"], valid)

    def test_fixed_seed_reduces_low_favorite_series_rates_against_legacy_mapping(self) -> None:
        current_low_favorite_count = 0
        legacy_low_favorite_count = 0
        for region_name in region_sim.REGION_CONFIGS:
            current = region_sim.simulate_region(
                region_name,
                seed=20260414,
                ratings_csv=self.ratings_path,
                samples=4000,
            )
            legacy = region_sim.simulate_region(
                region_name,
                seed=20260414,
                ratings_csv=self.ratings_path,
                samples=4000,
                payload_builder=legacy_prediction_payload,
            )
            for simulation, counter_name in [
                (current, "current"),
                (legacy, "legacy"),
            ]:
                mu_by_team = {
                    (row["college_name"], row["team_name"]): float(row["mu0"])
                    for row in simulation["slot_rows"]
                }
                for row in simulation["match_rows"]:
                    red_key = (row["red_college_name"], row["red_team_name"])
                    blue_key = (row["blue_college_name"], row["blue_team_name"])
                    p_favorite = (
                        float(row["p_series_red"])
                        if mu_by_team[red_key] >= mu_by_team[blue_key]
                        else float(row["p_series_blue"])
                    )
                    if p_favorite < 0.60:
                        if counter_name == "current":
                            current_low_favorite_count += 1
                        else:
                            legacy_low_favorite_count += 1
        self.assertLess(current_low_favorite_count, legacy_low_favorite_count)
        self.assertLessEqual(current_low_favorite_count, 120)

    def test_write_outputs_creates_expected_files(self) -> None:
        simulation = region_sim.simulate_region("东部赛区", seed=21, ratings_csv=self.ratings_path, samples=200)
        paths = region_sim.write_simulation_outputs(simulation)
        for path in paths.values():
            self.assertTrue(path.exists(), msg=str(path))


if __name__ == "__main__":
    unittest.main()
