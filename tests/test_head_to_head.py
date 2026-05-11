from __future__ import annotations

import sys
import types
import unittest
import random
from datetime import date
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as legacy_elo  # noqa: E402

if "build_rmuc_ts2_backend" not in sys.modules:
    ts2_stub = types.ModuleType("build_rmuc_ts2_backend")
    ts2_stub.DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"
    ts2_stub.ROOT = ROOT
    ts2_stub.make_team_key = legacy_elo.make_team_key
    sys.modules["build_rmuc_ts2_backend"] = ts2_stub

import head_to_head as h2h  # noqa: E402
import simulate_region  # noqa: E402
import simulate_region_monte_carlo as region_mc  # noqa: E402


def _make_row(
    *,
    red_college_name: str,
    blue_college_name: str,
    winner_side: str,
    match_date: str,
    league: str = "RMUC",
    result: str = "RED",
) -> dict[str, str]:
    return {
        "event_code": f"TEST_{league}",
        "league": league,
        "match_date": match_date,
        "red_college_name": red_college_name,
        "blue_college_name": blue_college_name,
        "winner_side": winner_side,
        "result": result,
    }


class HeadToHeadTests(unittest.TestCase):
    def test_no_history_returns_zero_delta(self) -> None:
        summary = h2h.summarize_head_to_head(
            "甲大学",
            "乙大学",
            p_base=0.61,
            head_to_head_index={},
        )
        self.assertEqual(summary["delta_h2h"], 0.0)
        self.assertAlmostEqual(summary["p_game_adj"], 0.61)

    def test_swapping_sides_flips_delta(self) -> None:
        rows = [
            _make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05"),
            _make_row(red_college_name="乙大学", blue_college_name="甲大学", winner_side="blue", match_date="2026-04-05"),
            _make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05"),
        ]
        index = h2h.build_head_to_head_index(rows, reference_date=date(2026, 4, 5))
        forward = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.43, head_to_head_index=index)
        reverse = h2h.summarize_head_to_head("乙大学", "甲大学", p_base=0.57, head_to_head_index=index)
        self.assertAlmostEqual(forward["delta_h2h"], -reverse["delta_h2h"], places=6)
        self.assertAlmostEqual(forward["delta_logit"], -reverse["delta_logit"], places=6)

    def test_single_match_is_weaker_than_multiple_matches_with_same_direction(self) -> None:
        single_index = h2h.build_head_to_head_index(
            [_make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05")],
            reference_date=date(2026, 4, 5),
        )
        repeated_index = h2h.build_head_to_head_index(
            [
                _make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05")
                for _ in range(4)
            ],
            reference_date=date(2026, 4, 5),
        )
        single = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.75, head_to_head_index=single_index)
        repeated = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.75, head_to_head_index=repeated_index)
        self.assertGreater(abs(repeated["delta_h2h"]), abs(single["delta_h2h"]))
        self.assertLessEqual(abs(repeated["delta_logit"]), h2h.MAX_DELTA_LOGIT)

    def test_older_match_has_smaller_weight_than_newer_match(self) -> None:
        newer_index = h2h.build_head_to_head_index(
            [_make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05")],
            reference_date=date(2026, 4, 5),
        )
        older_index = h2h.build_head_to_head_index(
            [_make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2025-04-05")],
            reference_date=date(2026, 4, 5),
        )
        newer_weight = newer_index[("乙大学", "甲大学")]["effective_weight"]
        older_weight = older_index[("乙大学", "甲大学")]["effective_weight"]
        self.assertGreater(newer_weight, older_weight)

    def test_rmul_has_lower_weight_than_rmuc_on_same_date(self) -> None:
        rmuc_index = h2h.build_head_to_head_index(
            [_make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05", league="RMUC")],
            reference_date=date(2026, 4, 5),
        )
        rmul_index = h2h.build_head_to_head_index(
            [_make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05", league="RMUL")],
            reference_date=date(2026, 4, 5),
        )
        rmuc_weight = rmuc_index[("乙大学", "甲大学")]["effective_weight"]
        rmul_weight = rmul_index[("乙大学", "甲大学")]["effective_weight"]
        self.assertGreater(rmuc_weight, rmul_weight)

    def test_large_history_is_capped_by_max_logit_shift(self) -> None:
        rows = [
            _make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05")
            for _ in range(24)
        ]
        index = h2h.build_head_to_head_index(rows, reference_date=date(2026, 4, 5))
        summary = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.1, head_to_head_index=index)
        self.assertAlmostEqual(summary["delta_logit"], h2h.MAX_DELTA_LOGIT, places=6)

    def test_strong_history_can_move_near_ten_percentage_points(self) -> None:
        rows = [
            _make_row(red_college_name="甲大学", blue_college_name="乙大学", winner_side="red", match_date="2026-04-05")
            for _ in range(2)
        ]
        index = h2h.build_head_to_head_index(rows, reference_date=date(2026, 4, 5))
        summary = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.5, head_to_head_index=index)
        self.assertGreaterEqual(summary["delta_h2h"], 0.09)
        self.assertLessEqual(summary["delta_h2h"], 0.10)

    def test_ts2_build_prediction_payload_applies_h2h_adjustment(self) -> None:
        teams = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        red_team = teams[0]
        blue_team = teams[1]
        index = h2h.build_head_to_head_index(
            [
                _make_row(
                    red_college_name=red_team.college_name,
                    blue_college_name=blue_team.college_name,
                    winner_side="red",
                    match_date="2026-04-05",
                )
                for _ in range(3)
            ],
            reference_date=date(2026, 4, 5),
        )
        payload = simulate_region.build_prediction_payload(
            red_team,
            blue_team,
            best_of=3,
            samples=128,
            match_seed=20260420,
            head_to_head_index=index,
        )
        self.assertNotEqual(payload["p_game_adj_red"], payload["p_game_base_red"])
        self.assertAlmostEqual(
            payload["p_game_adj_red"] - payload["p_game_base_red"],
            payload["head_to_head_summary"]["delta_h2h"],
            places=6,
        )

    def test_pair_cache_matches_runtime_payload_for_actual_h2h_pair(self) -> None:
        teams = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        index = h2h.load_head_to_head_index()

        selected_pair: tuple[simulate_region.RegionTeam, simulate_region.RegionTeam] | None = None
        for red_team, blue_team in combinations(teams, 2):
            summary = h2h.summarize_head_to_head(
                red_team.college_name,
                blue_team.college_name,
                p_base=0.5,
                head_to_head_index=index,
            )
            if abs(float(summary["delta_h2h"])) > 0.0:
                selected_pair = (red_team, blue_team)
                break

        self.assertIsNotNone(selected_pair)
        red_team, blue_team = selected_pair
        cache = region_mc.build_pair_probability_cache(
            teams,
            pair_samples=96,
            seed=20260420,
            head_to_head_index=index,
        )
        cached = cache[(red_team.team_key, blue_team.team_key, 3)]
        direct = simulate_region.build_prediction_payload(
            red_team,
            blue_team,
            best_of=3,
            samples=96,
            match_seed=region_mc.stable_seed(20260420, red_team.team_key, blue_team.team_key, 3),
            head_to_head_index=index,
        )
        self.assertAlmostEqual(cached["p_game_adj_red"], direct["p_game_adj_red"], places=6)
        self.assertAlmostEqual(
            cached["head_to_head_summary"]["delta_h2h"],
            direct["head_to_head_summary"]["delta_h2h"],
            places=6,
        )

    def test_actual_same_simulation_result_updates_later_runtime_h2h(self) -> None:
        teams = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        red_team = teams[0]
        blue_team = teams[1]
        runtime_index: dict[tuple[str, str], dict[str, object]] = {}

        before = simulate_region.build_prediction_payload(
            red_team,
            blue_team,
            best_of=3,
            samples=64,
            match_seed=20260511,
            head_to_head_index=runtime_index,
        )
        self.assertEqual(before["head_to_head_summary"]["meetings_count"], 0)
        self.assertEqual(before["head_to_head_summary"]["delta_h2h"], 0.0)

        recorder = getattr(simulate_region, "record_runtime_head_to_head_result", lambda *args, **kwargs: None)
        recorder(runtime_index, red_team, blue_team, 2, 0)

        after = simulate_region.build_prediction_payload(
            red_team,
            blue_team,
            best_of=3,
            samples=64,
            match_seed=20260511,
            head_to_head_index=runtime_index,
        )
        self.assertEqual(after["head_to_head_summary"]["meetings_count"], 1)
        self.assertGreater(after["head_to_head_summary"]["delta_h2h"], 0.0)

    def test_runtime_h2h_clone_does_not_mutate_source_index(self) -> None:
        source_index: dict[tuple[str, str], dict[str, object]] = {}
        runtime_index = h2h.clone_runtime_head_to_head_index(source_index)
        h2h.record_runtime_match(runtime_index, "甲大学", "乙大学", 2, 0)

        runtime_summary = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.5, head_to_head_index=runtime_index)
        source_summary = h2h.summarize_head_to_head("甲大学", "乙大学", p_base=0.5, head_to_head_index=source_index)

        self.assertEqual(runtime_summary["meetings_count"], 1)
        self.assertEqual(source_summary["meetings_count"], 0)
        self.assertEqual(source_summary["delta_h2h"], 0.0)

    def test_fixed_scoreline_series_records_runtime_h2h_for_later_rematch(self) -> None:
        teams = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        red_team = teams[0]
        blue_team = teams[1]
        runtime_index: dict[tuple[str, str], dict[str, object]] = {}
        observed: list[tuple[int, float]] = []

        def fixed_builder(red_team, blue_team, *, best_of, samples, match_seed, head_to_head_index, **kwargs):
            payload = simulate_region.build_prediction_payload(
                red_team,
                blue_team,
                best_of=best_of,
                samples=samples,
                match_seed=match_seed,
                head_to_head_index=head_to_head_index,
            )
            summary = payload["head_to_head_summary"]
            observed.append((int(summary["meetings_count"]), float(summary["delta_h2h"])))
            payload["fixed_scoreline"] = "2:0"
            return payload

        for match_index in range(2):
            simulate_region.region_core.simulate_series(
                red_team,
                blue_team,
                best_of=3,
                stage="swiss",
                round_number=match_index + 1,
                match_label=f"REMATCH-{match_index + 1}",
                rng=random.Random(20260511 + match_index),
                head_to_head_index=runtime_index,
                samples=64,
                payload_builder=fixed_builder,
                head_to_head_recorder=simulate_region.record_runtime_head_to_head_result,
            )

        self.assertEqual(observed[0], (0, 0.0))
        self.assertEqual(observed[1][0], 1)
        self.assertGreater(observed[1][1], 0.0)

    def test_simulated_scoreline_does_not_record_runtime_h2h(self) -> None:
        teams = simulate_region.parse_team_rows("东部赛区", simulate_region.DEFAULT_RATINGS_CSV)
        red_team = teams[0]
        blue_team = teams[1]
        runtime_index: dict[tuple[str, str], dict[str, object]] = {}

        simulate_region.region_core.simulate_series(
            red_team,
            blue_team,
            best_of=3,
            stage="swiss",
            round_number=1,
            match_label="SIMULATED-1",
            rng=random.Random(20260511),
            head_to_head_index=runtime_index,
            samples=64,
            payload_builder=simulate_region.build_prediction_payload,
            head_to_head_recorder=simulate_region.record_runtime_head_to_head_result,
        )

        summary = h2h.summarize_head_to_head(
            red_team.college_name,
            blue_team.college_name,
            p_base=0.5,
            head_to_head_index=runtime_index,
        )
        self.assertEqual(summary["meetings_count"], 0)
        self.assertEqual(summary["delta_h2h"], 0.0)


if __name__ == "__main__":
    unittest.main()
