from __future__ import annotations

import random
import sys
import types
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
if "build_rmuc_ts2_backend" not in sys.modules:
    ts2_stub = types.ModuleType("build_rmuc_ts2_backend")
    ts2_stub.ROOT = ROOT
    ts2_stub.DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"
    sys.modules["build_rmuc_ts2_backend"] = ts2_stub

import simulate_region  # noqa: E402


region_core = simulate_region.region_core

OFFICIAL_TIER1_SLOTS = {"A1", "A3", "A5", "A7", "B1", "B3", "B5", "B7"}
OFFICIAL_TIER2_SLOTS = {"A2", "A4", "A6", "A8", "B2", "B4", "B6", "B8"}
OFFICIAL_UNSEEDED_SLOTS = {
    *{f"A{index}" for index in range(9, 17)},
    *{f"B{index}" for index in range(9, 17)},
}


def _team(index: int) -> region_core.RegionTeam:
    return region_core.RegionTeam(
        team_key=f"team-{index}",
        college_name=f"Team {index}",
        team_name=f"T{index}",
        admitted_region="南部赛区",
        seed_tier="unseeded",
        seed_rank_in_region=index,
        ranking_global_rank=index,
        shape_rank=index,
        mu0=1500.0 + index,
        sigma0=30.0,
        z_25game=0.0,
        z_robot25_raw=0.0,
        z_26rmul=0.0,
        z_form=0.0,
        tilde_z_hist=0.0,
        n_matches_2025_rmuc=0,
        n_matches_2026_rmul=0,
        robot_stage_reliability=0.0,
        simulation_mu=1500.0 + index,
        match_sigma=10.0,
    )


class SouthOfficialScheduleTests(unittest.TestCase):
    def test_south_draw_slots_keep_second_tier_out_of_unseeded_positions(self) -> None:
        for seed in (20260414, 20261111, 20260512):
            with self.subTest(seed=seed):
                teams = simulate_region.parse_team_rows("南部赛区", simulate_region.DEFAULT_RATINGS_CSV)
                slot_rows = region_core.assign_region_slots(teams, random.Random(seed))

                tier_by_slot = {row["slot"]: row["seed_tier"] for row in slot_rows}
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_TIER1_SLOTS}, {"tier1"})
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_TIER2_SLOTS}, {"tier2"})
                self.assertEqual({tier_by_slot[slot] for slot in OFFICIAL_UNSEEDED_SLOTS}, {"unseeded"})

    def test_south_semifinals_follow_official_qf_cross_paths(self) -> None:
        self.assertEqual(
            region_core.SEMIFINAL_MAPPING,
            [
                ("QF-1", "QF-3"),
                ("QF-2", "QF-4"),
            ],
        )

    def test_south_qualification_pairs_follow_official_winner_paths(self) -> None:
        losers = [_team(index) for index in range(1, 9)]
        captured: list[tuple[str, list[tuple[str, str]]]] = []
        original = region_core.simulate_named_round

        def fake_simulate_named_round(
            stage: str,
            match_names: list[str],
            pairs: list[tuple[region_core.RegionTeam, region_core.RegionTeam]],
            **_: Any,
        ) -> tuple[list[region_core.RegionTeam], list[region_core.RegionTeam], list[dict[str, str]]]:
            captured.append((stage, [(left.college_name, right.college_name) for left, right in pairs]))
            rows = [{"winner_next": "tbd", "loser_next": "tbd"} for _pair in pairs]
            return [left for left, _right in pairs], [right for _left, right in pairs], rows

        region_core.simulate_named_round = fake_simulate_named_round
        try:
            region_core.simulate_qualification_path(
                "南部赛区",
                losers,
                rng=random.Random(20260414),
                head_to_head_index={},
                samples=0,
            )
        finally:
            region_core.simulate_named_round = original

        self.assertEqual(
            captured,
            [
                (
                    "qualification_round1",
                    [
                        ("Team 1", "Team 2"),
                        ("Team 4", "Team 3"),
                        ("Team 5", "Team 6"),
                        ("Team 8", "Team 7"),
                    ],
                ),
                (
                    "qualification_round2",
                    [
                        ("Team 1", "Team 5"),
                        ("Team 4", "Team 8"),
                    ],
                ),
            ],
        )

    def test_south_round5_pairings_follow_csv_rank_positions(self) -> None:
        teams = [_team(index) for index in range(1, 17)]
        for index, team in enumerate(teams, start=1):
            team.group_name = "A"
            team.slot = f"A{index}"
            team.mu0 = 1500.0
            if index <= 5:
                team.swiss_wins = 3
                team.swiss_losses = 1
                team.swiss_qualified_round = 4
            elif index <= 11:
                team.swiss_wins = 2
                team.swiss_losses = 2
            else:
                team.swiss_wins = 1
                team.swiss_losses = 3
                team.swiss_eliminated_round = 4

        teams_by_key = {team.team_key: team for team in teams}

        self.assertEqual(
            [(left.college_name, right.college_name) for left, right in region_core.south_round5_csv_pairings("A", teams, teams_by_key)],
            [
                ("Team 6", "Team 11"),
                ("Team 10", "Team 7"),
                ("Team 8", "Team 9"),
            ],
        )

        self.assertEqual(
            [(left.college_name, right.college_name) for left, right in region_core.south_round5_csv_pairings("B", teams, teams_by_key)],
            [
                ("Team 11", "Team 6"),
                ("Team 7", "Team 10"),
                ("Team 9", "Team 8"),
            ],
        )

    def test_swiss_ranking_metrics_expose_official_fields_without_simulating_hp_damage(self) -> None:
        teams = [_team(index) for index in range(1, 4)]
        teams[0].swiss_opponents = [teams[1].team_key, teams[2].team_key]
        teams[1].swiss_game_wins = 4
        teams[1].swiss_game_losses = 2
        teams[2].swiss_game_wins = 1
        teams[2].swiss_game_losses = 3
        teams_by_key = {team.team_key: team for team in teams}

        metrics = region_core.swiss_ranking_metrics(teams[0], teams_by_key)

        self.assertEqual(metrics["opponent_score"], 0)
        self.assertIsNone(metrics["official_opponent_points"])
        self.assertIsNone(metrics["official_avg_base_hp_diff"])
        self.assertIsNone(metrics["official_avg_team_damage"])
        self.assertEqual(metrics["ranking_metric_source"], "simulation_proxy")


if __name__ == "__main__":
    unittest.main()
